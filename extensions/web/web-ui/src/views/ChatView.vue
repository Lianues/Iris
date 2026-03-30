<template>
  <main class="chat-area">
    <section class="chat-frame">
      <header class="chat-topbar">
        <div class="chat-topbar-main">
          <span class="chat-kicker">Iris Control Center</span>
          <h2>AI Agent 对话控制台</h2>
        </div>
        <div class="chat-topbar-aside">
          <AppSelect
            v-if="modelOptions.length > 0"
            class="topbar-model-select"
            :model-value="currentModelName"
            :options="modelOptions"
            placeholder="模型"
            size="sm"
            @update:model-value="handleModelSwitch"
          />
          <div class="chat-topbar-actions">
            <button
              class="topbar-icon-btn"
              title="撤销 (Ctrl+Z)"
              :disabled="sending || !currentSessionId"
              @click="undoLastMessage"
            >
              ↩
            </button>
            <button
              class="topbar-icon-btn"
              title="重做 (Ctrl+Shift+Z)"
              :disabled="sending || !currentSessionId"
              @click="redoLastMessage"
            >
              ↪
            </button>
          </div>
          <div v-if="totalTokenCount > 0 || contextWindow > 0" class="context-usage">
            <div class="context-usage-bar">
              <div class="context-usage-fill" :style="{ width: usagePercent + '%' }"></div>
            </div>
            <span class="context-usage-label">{{ usageLabel }}</span>
          </div>
        </div>
      </header>

      <MessageList
        :messages="messages"
        :messages-loading="messagesLoading"
        :messages-error="messagesError"
        :message-action-error="messageActionError"
        :sending="currentSessionSending"
        :streaming-text="streamingText"
        :is-streaming="isStreaming"
        :streaming-thought="streamingThought"
        :streaming-thought-duration-ms="streamingThoughtDurationMs"
        :actions-locked="sending"
        :armed-delete-message-index="armedDeleteMessageIndex"
        :deleting-message-index="deletingMessageIndex"
        :retry-info="retryInfo"
        @retry="retryLastMessage"
        @starter-prompt="handleSend"
        @reload-history="reloadMessages"
        @clear-message-action-error="clearMessageActionError"
        @delete="deleteMessage"
      />
      <MessageQueueBar
        :queue="queue"
        @remove="handleQueueRemove"
        @clear="handleQueueClear"
        @reorder="handleQueueReorder"
        @edit="handleQueueEdit"
      />
      <ChatInput
        :disabled="sending"
        :queue-size="queueSize"
        @send="handleSend"
        @enqueue="handleEnqueue"
        @compact="handleCompact"
      />
      <ToolApprovalBar />
      <DiffApprovalDialog />
    </section>
  </main>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { useChat } from '../composables/useChat'
import { useContextUsage } from '../composables/useContextUsage'
import { useSlashCommands } from '../composables/useSlashCommands'
import { useSessions } from '../composables/useSessions'
import { useMessageQueue } from '../composables/useMessageQueue'
import * as api from '../api/client'
import type { Message } from '../api/types'
import MessageList from '../components/MessageList.vue'
import ChatInput from '../components/ChatInput.vue'
import MessageQueueBar from '../components/MessageQueueBar.vue'
import ToolApprovalBar from '../components/ToolApprovalBar.vue'
import DiffApprovalDialog from '../components/DiffApprovalDialog.vue'
import AppSelect from '../components/AppSelect.vue'

const { currentSessionId } = useSessions()
const { messages, messagesLoading, messagesError, messageActionError, sending, streamingText, isStreaming, streamingThought, streamingThoughtDurationMs, armedDeleteMessageIndex, deletingMessageIndex, retryInfo, clearMessageActionError, currentSessionSending, sendMessage, retryLastMessage, deleteMessage, reloadMessages, undoLastMessage, redoLastMessage } = useChat()
const { totalTokenCount, contextWindow, usageLabel, usagePercent, setContextWindow } = useContextUsage()
const { isSlashCommand, executeCommand } = useSlashCommands()
const { queue, enqueue, remove: queueRemove, clear: queueClear, reorder: queueReorder, update: queueUpdate, size: queueSize } = useMessageQueue()

// ---- 模型选择器 ----
const currentModelName = ref<string | null>(null)
const modelOptions = ref<Array<{ value: string; label: string }>>([])

async function loadModels() {
  try {
    const { models } = await api.listModels()
    modelOptions.value = models.map(m => ({
      value: m.modelName,
      label: m.modelName,
    }))
  } catch { /* ignore */ }
}

async function handleModelSwitch(value: string | number | null) {
  if (!value || typeof value !== 'string') return
  try {
    const info = await api.switchModel(value)
    currentModelName.value = info.modelName ?? info.modelId ?? value
  } catch { /* ignore */ }
}

// 启动时获取 contextWindow + 模型列表
onMounted(async () => {
  try {
    const status = await api.getStatus()
    if (status.contextWindow) setContextWindow(status.contextWindow)
    currentModelName.value = status.model ?? null
  } catch { /* ignore */ }
  loadModels()
})

// Ctrl+Z / Ctrl+Shift+Z 快捷键
function handleKeydown(e: KeyboardEvent) {
  const target = e.target as HTMLElement
  if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return

  if (e.ctrlKey && (e.key === 'z' || e.key === 'Z') && !e.shiftKey) {
    e.preventDefault()
    undoLastMessage()
  } else if (e.ctrlKey && (e.key === 'z' || e.key === 'Z') && e.shiftKey) {
    e.preventDefault()
    redoLastMessage()
  }
}

onMounted(() => window.addEventListener('keydown', handleKeydown))
onUnmounted(() => window.removeEventListener('keydown', handleKeydown))

// 处理发送：优先检查斜杠命令
function handleSend(text: string, images?: any[], documents?: any[]) {
  if (isSlashCommand(text)) {
    executeCommand(text, {
      sendMessage,
      undoLastMessage,
      redoLastMessage,
      currentSessionId,
      messages,
    })
    return
  }
  sendMessage(text, images, documents)
}

// ---- 消息队列 ----
function handleEnqueue(text: string) {
  enqueue(text)
}

function handleQueueRemove(id: string) {
  queueRemove(id)
}

function handleQueueClear() {
  queueClear()
}

function handleQueueReorder(fromIndex: number, toIndex: number) {
  queueReorder(fromIndex, toIndex)
}

function handleQueueEdit(id: string, newText: string) {
  queueUpdate(id, newText)
}

// ---- 上下文压缩 ----

function buildCompactCallMsg(): Message {
  return {
    role: 'model',
    parts: [{ type: 'function_call', name: 'compact_context', args: { action: 'compress' } }],
  }
}

function buildCompactResultMsg(response: Record<string, unknown>): Message {
  return {
    role: 'model',
    parts: [
      { type: 'function_call', name: 'compact_context', args: { action: 'compress' } },
      { type: 'function_response', name: 'compact_context', response },
    ],
  }
}

async function handleCompact() {
  if (!currentSessionId.value || sending.value) return
  const loadingMsg = buildCompactCallMsg()
  messages.value.push(loadingMsg)
  const removeLoading = () => {
    const idx = messages.value.indexOf(loadingMsg)
    if (idx >= 0) messages.value.splice(idx, 1)
  }
  try {
    const result = await api.compactContext(currentSessionId.value)
    removeLoading()
    if (result.ok) {
      messages.value.push(buildCompactResultMsg({ ok: true, summary: result.summary ?? '上下文已压缩' }))
    } else {
      messages.value.push(buildCompactResultMsg({ ok: false, error: result.error }))
    }
  } catch (err) {
    removeLoading()
    messages.value.push(buildCompactResultMsg({ ok: false, error: err instanceof Error ? err.message : String(err) }))
  }
}
</script>
