/**
 * 聊天逻辑组合式函数
 *
 * 管理消息列表、发送状态、流式输出状态。
 * 监听 currentSessionId 变化自动加载历史。
 */

import { computed, ref, watch } from 'vue'
import { useSessions } from './useSessions'
import { useToolApproval } from './useToolApproval'
import { useContextUsage } from './useContextUsage'
import * as api from '../api/client'
import type { ChatDocumentAttachment, ChatImageAttachment, Message, MessagePart } from '../api/types'
import { hasToolParts } from '../utils/message'

/** 当前会话的消息列表 */
const messages = ref<Message[]>([])

/** 是否正在加载历史消息 */
const messagesLoading = ref(false)

/** 历史消息加载错误 */
const messagesError = ref('')

/** 是否正在发送 */
const sending = ref(false)

/** 待确认删除的消息索引 */
const armedDeleteMessageIndex = ref<number | null>(null)

/** 正在删除的消息索引 */
const deletingMessageIndex = ref<number | null>(null)

/** 消息操作错误（如删除失败） */
const messageActionError = ref('')

/** 流式输出累积文本 */
const streamingText = ref('')

/** 是否正在流式接收 */
const isStreaming = ref(false)

/** 流式思考累积文本 */
const streamingThought = ref('')

/** 流式思考耗时 */
const streamingThoughtDurationMs = ref<number | undefined>()

/** LLM 重试状态（重试中时非 null） */
const retryInfo = ref<{ attempt: number; maxRetries: number; error: string } | null>(null)

/** 尚未刷新到 UI 的流式增量，避免每个 chunk 都触发视图更新 */
let pendingStreamingDelta = ''

/** requestAnimationFrame id，用于合并高频流式刷新 */
let scheduledStreamingFlushId: number | null = null

/** 尚未刷新到 UI 的 thought 增量 */
let pendingThoughtDelta = ''

/** thought 增量的 rAF id */
let scheduledThoughtFlushId: number | null = null

function cancelScheduledStreamingFlush() {
  if (scheduledStreamingFlushId !== null && typeof window !== 'undefined') {
    window.cancelAnimationFrame(scheduledStreamingFlushId)
  }
  scheduledStreamingFlushId = null
}

function flushPendingStreamingDelta() {
  cancelScheduledStreamingFlush()
  if (!pendingStreamingDelta) return
  streamingText.value += pendingStreamingDelta
  pendingStreamingDelta = ''
}

function getBufferedStreamingText(): string {
  return pendingStreamingDelta ? `${streamingText.value}${pendingStreamingDelta}` : streamingText.value
}

function cancelScheduledThoughtFlush() {
  if (scheduledThoughtFlushId !== null && typeof window !== 'undefined') {
    window.cancelAnimationFrame(scheduledThoughtFlushId)
  }
  scheduledThoughtFlushId = null
}

function flushPendingThoughtDelta() {
  cancelScheduledThoughtFlush()
  if (!pendingThoughtDelta) return
  streamingThought.value += pendingThoughtDelta
  pendingThoughtDelta = ''
}

/** 释放消息中所有 blob: URL，防止浏览器 URL store 泄漏 */
function revokeBlobUrls(msgs: Message[]) {
  for (const msg of msgs) {
    for (const part of msg.parts) {
      if (part.previewUrl?.startsWith('blob:')) {
        URL.revokeObjectURL(part.previewUrl)
      }
    }
  }
}

function resetStreamingState() {
  cancelScheduledStreamingFlush()
  pendingStreamingDelta = ''
  streamingText.value = ''
  cancelScheduledThoughtFlush()
  pendingThoughtDelta = ''
  streamingThought.value = ''
  streamingThoughtDurationMs.value = undefined
  isStreaming.value = false
}

/** 当前请求的 AbortController，预留给后续显式取消能力 */
let _currentController: AbortController | null = null

/** 历史加载请求版本号，用于丢弃过期响应 */
let loadVersion = 0

/** 当前活动请求 token，用于丢弃已过期回调 */
let activeRequestToken: symbol | null = null

/** 当前活动请求归属的 sessionId（新会话会在 onSessionId 更新） */
let activeRequestSessionId: string | null = null

/** 服务端回填新 sessionId 时，跳过一次 currentSessionId 变更触发的历史加载 */
let suppressNextSessionLoadForId: string | null = null

/** 非工具消息暂存，等 done 事件时再提交（避免流式被覆盖） */
let deferredAssistantMessage: Message | null = null

const { currentSessionId, loadSessions, markSessionStreaming, markSessionCompleted, clearSessionActivity } = useSessions()
const { setToolInvocations, clearToolState } = useToolApproval()
const { setUsage } = useContextUsage()

function queueStreamingDelta(delta: string) {
  if (!delta) return

  pendingStreamingDelta += delta
  if (!isStreaming.value) {
    isStreaming.value = true
    // 立即刷新首个增量，使流式气泡 (v-if="isStreaming && streamingText") 马上可见，
    // 不必等到下一帧 rAF 才设置 streamingText。
    flushPendingStreamingDelta()
    return
  }

  if (scheduledStreamingFlushId !== null) return

  if (typeof window === 'undefined') {
    flushPendingStreamingDelta()
    return
  }

  scheduledStreamingFlushId = window.requestAnimationFrame(() => {
    scheduledStreamingFlushId = null
    flushPendingStreamingDelta()
  })
}

function queueThoughtDelta(delta: string, durationMs?: number) {
  if (!delta) return

  pendingThoughtDelta += delta
  if (durationMs != null) {
    streamingThoughtDurationMs.value = durationMs
  }
  if (!isStreaming.value) {
    isStreaming.value = true
    flushPendingThoughtDelta()
    return
  }

  if (scheduledThoughtFlushId !== null) return

  if (typeof window === 'undefined') {
    flushPendingThoughtDelta()
    return
  }

  scheduledThoughtFlushId = window.requestAnimationFrame(() => {
    scheduledThoughtFlushId = null
    flushPendingThoughtDelta()
  })
}

function normalizeImages(images?: ChatImageAttachment[]): ChatImageAttachment[] {
  return (images ?? []).map((image) => ({
    mimeType: image.mimeType,
    ...(image.data ? { data: image.data } : {}),
    ...(image.file instanceof File ? { file: image.file } : {}),
    ...(image.fileName ? { fileName: image.fileName } : {}),
    ...(image.previewUrl ? { previewUrl: image.previewUrl } : {}),
    ...(typeof image.size === 'number' ? { size: image.size } : {}),
  }))
}

function normalizeDocuments(documents?: ChatDocumentAttachment[]): ChatDocumentAttachment[] {
  return (documents ?? []).map((doc) => ({
    fileName: doc.fileName,
    mimeType: doc.mimeType,
    ...(doc.data ? { data: doc.data } : {}),
    ...(doc.file instanceof File ? { file: doc.file } : {}),
    ...(typeof doc.size === 'number' ? { size: doc.size } : {}),
  }))
}

/** 构建用户消息 parts。接收已 normalize 的数组，不再重复复制。 */
function buildUserMessageParts(text: string, images: ChatImageAttachment[], documents: ChatDocumentAttachment[]): MessagePart[] {
  const parts: MessagePart[] = []

  for (const image of images) {
    parts.push({
      type: 'image',
      mimeType: image.mimeType,
      ...(image.data ? { data: image.data } : {}),
      ...(image.file instanceof File ? { file: image.file } : {}),
      ...(image.previewUrl ? { previewUrl: image.previewUrl } : {}),
      ...(image.fileName ? { fileName: image.fileName } : {}),
      ...(typeof image.size === 'number' ? { size: image.size } : {}),
    })
  }

  for (const doc of documents) {
    parts.push({
      type: 'document',
      fileName: doc.fileName,
      mimeType: doc.mimeType,
      ...(doc.data ? { data: doc.data } : {}),
      ...(doc.file instanceof File ? { file: doc.file } : {}),
      ...(typeof doc.size === 'number' ? { size: doc.size } : {}),
    })
  }

  if (text.trim().length > 0) {
    parts.push({ type: 'text', text })
  }

  if (parts.length === 0) {
    parts.push({ type: 'text', text: '' })
  }

  return parts
}

async function loadMessagesForSession(id: string | null, preserveExisting = false) {
  const version = ++loadVersion
  messagesError.value = ''
  messageActionError.value = ''
  armedDeleteMessageIndex.value = null
  deletingMessageIndex.value = null

  if (!id) {
    revokeBlobUrls(messages.value)
    messages.value = []
    messagesLoading.value = false
    return
  }

  messagesLoading.value = true

  if (!preserveExisting) {
    revokeBlobUrls(messages.value)
    messages.value = []
  }

  try {
    const data = await api.getMessages(id)
    if (version !== loadVersion) return
    revokeBlobUrls(messages.value)
    messages.value = data.messages || []
  } catch (err) {
    if (version !== loadVersion) return
    if (!preserveExisting) {
      messages.value = []
    }
    messagesError.value = err instanceof Error ? err.message : '加载会话消息失败'
  } finally {
    if (version === loadVersion) {
      messagesLoading.value = false
    }
  }
}

// 模块级 watch，生命周期与模块一致，不受组件卸载影响
watch(currentSessionId, async (id) => {
  if (id !== null && suppressNextSessionLoadForId === id) {
    suppressNextSessionLoadForId = null
    return
  }

  await loadMessagesForSession(id)
})

export function useChat() {
  /** 提交流式文本到消息列表 */
  function isCurrentViewBoundToActiveRequest(): boolean {
    return activeRequestToken !== null && currentSessionId.value === activeRequestSessionId
  }

  function consumeStreamingText(): string {
    const fullText = getBufferedStreamingText()
    resetStreamingState()
    return fullText
  }

  function flushStreaming(targetSessionId: string | null = activeRequestSessionId) {
    const fullText = consumeStreamingText()
    if (fullText && targetSessionId !== null && currentSessionId.value === targetSessionId) {
      messages.value.push({
        role: 'model',
        parts: [{ type: 'text', text: fullText }],
        timestamp: Date.now(),
      })
    }
  }

  function commitPlainAssistantMessage(text: string) {
    const finalText = text || getBufferedStreamingText()
    consumeStreamingText()
    if (!isCurrentViewBoundToActiveRequest()) return
    messages.value.push({
      role: 'model',
      parts: [{ type: 'text', text: finalText }],
      timestamp: Date.now(),
    })
  }

  function isRetryableUserMessage(message: Message | undefined): boolean {
    return !!message
      && message.role === 'user'
      && message.parts.some((part) => (
        part.type === 'text' || part.type === 'image' || part.type === 'document'
      ))
  }

  function commitStructuredAssistantMessage(message: Message) {
    consumeStreamingText()
    if (!isCurrentViewBoundToActiveRequest()) return
    if (!message.timestamp) message.timestamp = Date.now()
    messages.value.push(message)
  }

  const currentSessionSending = computed(() => sending.value && isCurrentViewBoundToActiveRequest())
  const currentSessionStreamingText = computed(() => {
    return isCurrentViewBoundToActiveRequest() ? streamingText.value : ''
  })
  const currentSessionIsStreaming = computed(() => {
    return isCurrentViewBoundToActiveRequest()
      ? isStreaming.value
      : false
  })
  const currentSessionStreamingThought = computed(() => {
    return isCurrentViewBoundToActiveRequest() ? streamingThought.value : ''
  })
  const currentSessionStreamingThoughtDurationMs = computed(() => {
    return isCurrentViewBoundToActiveRequest() ? streamingThoughtDurationMs.value : undefined
  })

  async function reloadMessages() {
    if (sending.value) return
    resetStreamingState()
    await loadMessagesForSession(currentSessionId.value)
  }

  function clearMessageActionError() {
    messageActionError.value = ''
  }

  function resolveRetryUserMessageIndex(messageIndex?: number): number | null {
    if (messages.value.length === 0) return null

    const anchorIndex = typeof messageIndex === 'number'
      ? Math.min(Math.max(messageIndex, 0), messages.value.length - 1)
      : messages.value.length - 1

    for (let index = anchorIndex; index >= 0; index -= 1) {
      if (isRetryableUserMessage(messages.value[index])) {
        return index
      }
    }

    return null
  }

  async function deleteMessage(messageIndex?: number) {
    if (sending.value || deletingMessageIndex.value !== null) return

    const targetIndex = typeof messageIndex === 'number'
      ? Math.min(Math.max(messageIndex, 0), messages.value.length - 1)
      : messages.value.length - 1

    if (targetIndex < 0 || targetIndex >= messages.value.length) return

    if (armedDeleteMessageIndex.value !== targetIndex) {
      armedDeleteMessageIndex.value = targetIndex
      messageActionError.value = ''
      return
    }

    deletingMessageIndex.value = targetIndex
    armedDeleteMessageIndex.value = null

    try {
      messageActionError.value = ''

      if (currentSessionId.value) {
        await api.truncateMessages(currentSessionId.value, targetIndex)
      }

      resetStreamingState()
      revokeBlobUrls(messages.value.slice(targetIndex))
      messages.value.splice(targetIndex)
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e)
      messageActionError.value = `删除消息失败：无法同步更新历史记录 — ${detail}`
    } finally {
      if (deletingMessageIndex.value === targetIndex) {
        deletingMessageIndex.value = null
      }
    }
  }

  async function sendMessage(text: string, images?: ChatImageAttachment[], documents?: ChatDocumentAttachment[]) {
    armedDeleteMessageIndex.value = null
    deletingMessageIndex.value = null
    messageActionError.value = ''

    const normalizedImages = normalizeImages(images)
    const normalizedDocs = normalizeDocuments(documents)
    if (sending.value || (!text.trim() && normalizedImages.length === 0 && normalizedDocs.length === 0)) return

    sending.value = true
    resetStreamingState()
    deferredAssistantMessage = null
    messagesError.value = ''

    // 立即显示用户消息
    messages.value.push({
      role: 'user',
      parts: buildUserMessageParts(text, normalizedImages, normalizedDocs),
      timestamp: Date.now(),
    })

    // 记录本次请求上下文，用于回调归属校验
    const requestToken = Symbol('chat-request')
    activeRequestToken = requestToken
    activeRequestSessionId = currentSessionId.value
    const requestEntrySessionId = activeRequestSessionId

    let receivedFinalAssistantPayload = false
    let requestNeedsHistoryRefresh = false
    if (activeRequestSessionId) {
      markSessionStreaming(activeRequestSessionId)
    }

    /** 检查回调是否仍属于当前活动请求 */
    const isStale = () => activeRequestToken !== requestToken

    _currentController = api.sendChat(activeRequestSessionId, text, {
      onSessionId(id) {
        if (isStale()) return

        // 先更新请求归属，再更新 currentSessionId，避免 watch 误判为"切换会话"
        const shouldAutoFocusRequestSession = currentSessionId.value === null || currentSessionId.value === requestEntrySessionId
        activeRequestSessionId = id
        markSessionStreaming(id)

        if (shouldAutoFocusRequestSession && currentSessionId.value !== id) {
          suppressNextSessionLoadForId = id
          currentSessionId.value = id
        }

        void loadSessions()
      },
      onToolUpdate(invocations) {
        if (isStale()) return
        setToolInvocations(invocations)
      },
      onUsage(usage) {
        if (isStale()) return
        setUsage(usage)
      },
      onRetry(attempt, maxRetries, error) {
        if (isStale()) return
        retryInfo.value = { attempt, maxRetries, error }
      },
      onStreamStart() {
        if (isStale()) return
        receivedFinalAssistantPayload = false
        deferredAssistantMessage = null
      },
      onDelta(delta) {
        if (isStale() || receivedFinalAssistantPayload) return
        queueStreamingDelta(delta)
      },
      onThoughtDelta(text, durationMs) {
        if (isStale() || receivedFinalAssistantPayload) return
        queueThoughtDelta(text, durationMs)
      },
      onMessage(fullText) {
        if (receivedFinalAssistantPayload || isStale()) return
        receivedFinalAssistantPayload = true
        commitPlainAssistantMessage(fullText)
      },
      onAssistantContent(message) {
        if (isStale()) return
        receivedFinalAssistantPayload = true
        if (hasToolParts(message)) {
          // 工具消息：立即提交（保持现有行为）
          requestNeedsHistoryRefresh = true
          commitStructuredAssistantMessage(message)
        } else {
          // 纯文本+思考：暂存，让流式继续显示，等 done 时提交
          deferredAssistantMessage = message
        }
      },
      onStreamEnd() {
        if (isStale()) return
        flushPendingStreamingDelta()
        flushPendingThoughtDelta()
      },
      onDoneMeta(durationMs) {
        if (isStale() || !isCurrentViewBoundToActiveRequest()) return

        // 如果有暂存的非工具消息，直接回填到它的 meta
        if (deferredAssistantMessage) {
          if (!deferredAssistantMessage.meta) deferredAssistantMessage.meta = {}
          deferredAssistantMessage.meta.durationMs = durationMs
          return
        }

        // 否则回填到 messages 中最后一条 model 消息
        for (let i = messages.value.length - 1; i >= 0; i--) {
          const msg = messages.value[i]
          if (msg.role === 'model') {
            if (!msg.meta) msg.meta = {}
            msg.meta.durationMs = durationMs
            break
          }
        }
      },
      onDone() {
        if (isStale()) return
        clearToolState()
        retryInfo.value = null

        const finishedSessionId = activeRequestSessionId
        const shouldKeepCompletedBadge = !!finishedSessionId && currentSessionId.value !== finishedSessionId

        if (deferredAssistantMessage) {
          // 非工具消息：流式已展示完毕，清空流式状态后提交完整消息（含 meta / thought 等结构）
          resetStreamingState()
          if (isCurrentViewBoundToActiveRequest()) {
            messages.value.push(deferredAssistantMessage)
          }
          deferredAssistantMessage = null
        } else if (receivedFinalAssistantPayload) {
          resetStreamingState()
        } else {
          flushStreaming(finishedSessionId)
        }
        if (finishedSessionId) {
          markSessionCompleted(finishedSessionId, shouldKeepCompletedBadge)
        }

        sending.value = false
        _currentController = null
        activeRequestToken = null
        activeRequestSessionId = null
        if (finishedSessionId && currentSessionId.value === finishedSessionId && requestNeedsHistoryRefresh) {
          void loadMessagesForSession(finishedSessionId, true)
        }
        void loadSessions()
      },
      onError(msg) {
        if (isStale()) return
        clearToolState()
        retryInfo.value = null

        const failedSessionId = activeRequestSessionId

        deferredAssistantMessage = null
        flushStreaming(failedSessionId)
        if (failedSessionId) {
          clearSessionActivity(failedSessionId)
        }

        if (isCurrentViewBoundToActiveRequest()) {
          messages.value.push({
            role: 'model',
            parts: [{ type: 'text', text: `错误: ${msg}` }],
          })
        }

        sending.value = false
        _currentController = null
        activeRequestToken = null
        activeRequestSessionId = null
        void loadSessions()
      },
    }, normalizedImages, normalizedDocs)
  }

  function buildRetryImages(message: Message): ChatImageAttachment[] {
    const images: ChatImageAttachment[] = []

    for (const part of message.parts) {
      if (part.type !== 'image' || typeof part.mimeType !== 'string') {
        continue
      }

      if (part.file instanceof File) {
        images.push({
          mimeType: part.mimeType,
          file: part.file,
          fileName: part.fileName,
          previewUrl: URL.createObjectURL(part.file),
          size: typeof part.size === 'number' ? part.size : part.file.size,
        })
        continue
      }

      if (typeof part.data === 'string' && part.data) {
        images.push({ mimeType: part.mimeType, data: part.data, fileName: part.fileName, size: part.size })
      }
    }

    return images
  }

  function buildRetryDocuments(message: Message): ChatDocumentAttachment[] {
    const documents: ChatDocumentAttachment[] = []

    for (const part of message.parts) {
      if (part.type !== 'document' || typeof part.mimeType !== 'string' || !part.fileName) {
        continue
      }

      if (part.file instanceof File) {
        documents.push({ fileName: part.fileName, mimeType: part.mimeType, file: part.file, size: typeof part.size === 'number' ? part.size : part.file.size })
        continue
      }

      if (typeof part.data === 'string' && part.data) {
        documents.push({ fileName: part.fileName, mimeType: part.mimeType, data: part.data, size: part.size })
      }
    }

    return documents
  }

  /** 重试指定消息所属轮次；未传索引时退化为重试最后一轮 */
  async function retryLastMessage(messageIndex?: number) {
    if (sending.value) {
      messageActionError.value = '当前仍有回复生成中，暂时无法重试。'
      return
    }

    armedDeleteMessageIndex.value = null
    deletingMessageIndex.value = null
    messageActionError.value = ''

    const retryUserIndex = resolveRetryUserMessageIndex(messageIndex)
    if (retryUserIndex === null) {
      messageActionError.value = '未找到可重试的用户消息。'
      return
    }

    const userMsg = messages.value[retryUserIndex]
    const text = userMsg.parts
      .filter((part) => part.type === 'text')
      .map((part) => part.text ?? '')
      .join('')
    const images = buildRetryImages(userMsg)
    const documents = buildRetryDocuments(userMsg)

    if (!text.trim() && images.length === 0 && documents.length === 0) {
      messageActionError.value = '该轮对话缺少可重试的文本或附件内容。'
      return
    }

    // 提前置忙，防止异步截断期间重复触发
    sending.value = true
    messagesError.value = ''

    if (currentSessionId.value) {
      try {
        await api.truncateMessages(currentSessionId.value, retryUserIndex)
      } catch (e) {
        const detail = e instanceof Error ? e.message : String(e)
        messageActionError.value = `重试失败：无法截断历史记录 — ${detail}`
        sending.value = false
        return
      }
    }

    revokeBlobUrls(messages.value.slice(retryUserIndex))
    messages.value.splice(retryUserIndex)

    sending.value = false
    void sendMessage(text, images, documents)
  }

  async function undoLastMessage() {
    if (sending.value || !currentSessionId.value) return
    try {
      const data = await api.undoMessage(currentSessionId.value)
      if (data.changed && data.messages) {
        revokeBlobUrls(messages.value)
        messages.value = data.messages
      }
    } catch (err) {
      messageActionError.value = `撤销失败：${err instanceof Error ? err.message : String(err)}`
    }
  }

  async function redoLastMessage() {
    if (sending.value || !currentSessionId.value) return
    try {
      const data = await api.redoMessage(currentSessionId.value)
      if (data.changed && data.messages) {
        revokeBlobUrls(messages.value)
        messages.value = data.messages
      }
    } catch (err) {
      messageActionError.value = `重做失败：${err instanceof Error ? err.message : String(err)}`
    }
  }

  return {
    messages,
    messagesLoading,
    messagesError,
    messageActionError,
    sending,
    streamingText: currentSessionStreamingText,
    isStreaming: currentSessionIsStreaming,
    streamingThought: currentSessionStreamingThought,
    streamingThoughtDurationMs: currentSessionStreamingThoughtDurationMs,
    armedDeleteMessageIndex,
    deletingMessageIndex,
    retryInfo,
    clearMessageActionError,
    currentSessionSending,
    sendMessage,
    retryLastMessage,
    deleteMessage,
    reloadMessages,
    undoLastMessage,
    redoLastMessage,
  }
}
