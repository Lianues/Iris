<template>
  <div ref="containerEl" class="messages" @scroll="handleScroll">
    <div class="messages-shell">
      <div v-if="messagesError && messages.length > 0" class="messages-inline-status error">
        <span>历史消息加载失败：{{ messagesError }}</span>
        <button class="message-state-action" type="button" @click="emit('reload-history')">
          重新加载
        </button>
      </div>

      <div v-if="messageActionError" class="messages-inline-status error">
        <span>{{ messageActionError }}</span>
        <button class="message-state-action" type="button" @click="emit('clear-message-action-error')">
          知道了
        </button>
      </div>

      <div v-if="messagesError && messages.length === 0 && !isStreaming && !sending" class="message-state-card error">
        <span class="message-state-icon"><AppIcon :name="ICONS.status.warn" /></span>
        <h3>无法加载会话历史</h3>
        <p>{{ messagesError }}</p>
        <button class="message-state-action" type="button" @click="emit('reload-history')">
          重新加载
        </button>
      </div>

      <div v-else-if="messagesLoading && messages.length === 0 && !isStreaming && !sending" class="message-state-card loading">
        <span class="message-state-icon"><AppIcon :name="ICONS.status.loading" /></span>
        <h3>正在加载会话历史</h3>
        <p>请稍候，Iris 正在同步这段工作流的上下文。</p>
      </div>

      <div v-else-if="messages.length === 0 && !isStreaming && !sending" class="welcome">
        <div class="welcome-badge">Iris Workspace</div>
        <h2>把灵感、问题和工具流都放进一个对话里</h2>
        <p>
          支持流式响应、多会话记录与工具调用，适合长时间沉浸式协作。
        </p>

        <div class="welcome-tips">
          <div class="welcome-tip">
            <strong>流式回复</strong>
            <span>边生成边阅读，长输出也能保持顺滑。</span>
          </div>
          <div class="welcome-tip">
            <strong>工具调用</strong>
            <span>把搜索、文件与命令结果折叠进同一条工作流。</span>
          </div>
          <div class="welcome-tip">
            <strong>多会话记录</strong>
            <span>保留上下文脉络，像工作台一样持续推进任务。</span>
          </div>
        </div>

        <div class="welcome-starters">
          <button
            v-for="s in starterPrompts"
            :key="s"
            class="welcome-starter-chip"
            type="button"
            @click="emit('starter-prompt', s)"
          >{{ s }}</button>
        </div>
      </div>

      <template v-for="item in displayItems" :key="item.key">
        <template v-if="item.kind === 'message'">
          <template v-for="(part, j) in item.message.parts" :key="`${item.key}-${j}`">
            <MessageBubble
              v-if="part.type === 'text' && part.text?.trim() && !isInternalMarker(part.text!)"
              :role="item.message.role"
              :text="part.text!"
              :meta="item.message.role === 'model' && isLastVisibleTextPart(item.message, j) ? item.message.meta : undefined"
              :timestamp="item.message.timestamp"
              :message-index="item.messageIndex"
              :retry-message-index="getRetryMessageIndex(item.messageIndex)"
              :actions-locked="actionsLocked"
              :retry-disabled="getRetryMessageIndex(item.messageIndex) === null"
              :retry-button-title="buildRetryButtonTitle(item.messageIndex)"
              :delete-state="getDeleteState(item.messageIndex)"
              :delete-button-title="buildDeleteButtonTitle(item.messageIndex)"
              @retry="emit('retry', $event)"
              @delete="emit('delete', $event)"
            />

            <ImageBubble
              v-else-if="part.type === 'image' && part.mimeType && (part.data || part.previewUrl)"
              :role="item.message.role"
              :mime-type="part.mimeType"
              :data="part.data"
              :preview-url="part.previewUrl"
              :revoke-preview-on-unmount="item.message.role === 'user' && !!part.file && !!part.previewUrl"
            />

            <DocumentBubble
              v-else-if="part.type === 'document' && part.mimeType && (part.data || part.fileName)"
              :role="item.message.role"
              :mime-type="part.mimeType"
              :data="part.data"
              :file-name="part.fileName"
            />

            <div
              v-else-if="part.type === 'thought' && part.text?.trim()"
              class="message-stack message-stack-bubble message-stack-model"
            >
              <div class="message message-model message-thought-block" :class="{ expanded: isThoughtExpanded(`${item.key}-thought-${j}`) }" @click="toggleThought(`${item.key}-thought-${j}`)">
                <div class="thought-header">
                  <span class="thought-label">思考过程</span>
                  <span v-if="part.durationMs != null" class="thought-duration">{{ formatThoughtDuration(part.durationMs) }}</span>
                  <span class="thought-toggle">{{ isThoughtExpanded(`${item.key}-thought-${j}`) ? '收起' : '展开' }}</span>
                </div>
                <div class="thought-content" :class="{ expanded: isThoughtExpanded(`${item.key}-thought-${j}`) }">{{ part.text }}</div>
              </div>
            </div>
          </template>
        </template>

        <div
          v-else
          class="message-stack message-stack-model tool-workflow-stack"
          :class="{ compact: isToolGroupCompact(item.key), collapsing: isToolGroupCollapsing(item.key) }"
          :ref="(el) => setToolWorkflowStackEl(item.key, el)"
        >
          <button
            class="tool-workflow-card"
            :class="{ expanded: isToolGroupExpanded(item.key), compact: isToolGroupCompact(item.key), collapsing: isToolGroupCollapsing(item.key) }"
            type="button"
            @click="toggleToolGroup(item.key)"
            :ref="(el) => setToolWorkflowCardEl(item.key, el)"
          >
            <span class="tool-workflow-icon-shell">
              <AppIcon :name="ICONS.tool.call" class="tool-workflow-icon" />
            </span>

            <span class="tool-workflow-main">
              <span class="tool-workflow-title-row">
                <strong class="tool-workflow-title">{{ buildToolGroupTitle(item.entries) }}</strong>
                <span class="tool-workflow-meta">{{ buildToolGroupMeta(item.entries) }}</span>
              </span>

              <Transition name="tool-workflow-inline" mode="out-in">
                <span v-if="shouldShowToolGroupStatusList(item)" key="status" class="tool-workflow-status-list">
                  <span
                    v-for="step in buildToolGroupNoteSteps(item)"
                    :key="step.key"
                    class="tool-workflow-status-item"
                    :class="step.status"
                  >
                    <span class="tool-workflow-status-indicator">
                      <span class="tool-workflow-status-dot"></span>
                    </span>
                    <span class="tool-workflow-status-text">{{ step.text }}</span>
                  </span>
                </span>

                <span v-else-if="shouldShowToolGroupSummary(item)" key="summary" class="tool-workflow-summary">
                  {{ buildToolGroupSummary(item.entries) }}
                </span>
              </Transition>
            </span>

            <AppIcon :name="ICONS.common.chevronRight" class="tool-workflow-chevron" />
          </button>

          <div v-if="shouldShowToolGroupActions(item)" class="tool-workflow-actions">
            <button
              class="message-action-btn tool-workflow-action-btn"
              type="button"
              :title="buildToolGroupRetryButtonTitle(item)"
              :aria-label="buildToolGroupRetryButtonTitle(item)"
              :disabled="actionsLocked || getToolGroupRetryMessageIndex(item) === null"
              @click.stop="emitToolGroupRetry(item)"
            >
              <AppIcon :name="ICONS.common.retry" class="message-action-icon" />
              <span>重试</span>
            </button>
          </div>

          <div class="tool-workflow-body-wrap" :class="{ expanded: isToolGroupExpanded(item.key), collapsing: isToolGroupCollapsing(item.key) }">
            <div class="tool-workflow-body">
              <div class="tool-workflow-body-content" :class="{ hidden: isToolGroupCollapsing(item.key) }">
                <div
                  v-for="entry in item.entries"
                  :key="`tool-entry-${entry.messageIndex}`"
                  class="tool-workflow-section"
                >
                  <template v-for="(part, partIndex) in entry.message.parts" :key="`tool-part-${entry.messageIndex}-${partIndex}`">
                    <ToolBlock
                      v-if="part.type === 'function_call'"
                      type="call"
                      :name="part.name!"
                      :data="part.args"
                      :collapsed="false"
                    />
                    <ToolBlock
                      v-else-if="part.type === 'function_response'"
                      type="response"
                      :name="part.name!"
                      :data="part.response"
                      :call-args="findCallArgsInEntries(item.entries, part)"
                      :collapsed="false"
                    />
                  </template>
                </div>
              </div>
            </div>
          </div>
        </div>
      </template>

      <div v-if="showThinkingBubble" class="message-stack message-stack-model message-stack-thinking">
        <div class="message-meta-row">
          <div class="message-meta-group">
            <div class="message-meta">Iris</div>
            <div class="message-stream-status">正在组织回复与工具结果</div>
          </div>
        </div>

        <div class="message message-model message-thinking" aria-live="polite">
          <div class="thinking-dots" aria-hidden="true">
            <span></span>
            <span></span>
            <span></span>
          </div>
          <div class="thinking-copy">请稍候，Iris 正在整理上下文。</div>
          <div v-if="retryInfo" class="retry-info">
            ⟳ 重试中 ({{ retryInfo.attempt }}/{{ retryInfo.maxRetries }}) · {{ truncateRetryError(retryInfo.error) }}
          </div>
        </div>
      </div>

      <div
        v-if="isStreaming && streamingThought"
        class="message-stack message-stack-bubble message-stack-model"
      >
        <div class="message message-model message-thought-block expanded">
          <div class="thought-header">
            <span class="thought-label">思考过程</span>
            <span v-if="streamingThoughtDurationMs != null" class="thought-duration">{{ formatThoughtDuration(streamingThoughtDurationMs) }}</span>
          </div>
          <div class="thought-content expanded">{{ streamingThought }}</div>
        </div>
      </div>

      <MessageBubble
        v-if="isStreaming && streamingText"
        role="model"
        :text="streamingText"
        :streaming="true"
      />
    </div>

    <button
      v-if="showJumpToBottom"
      class="messages-jump"
      type="button"
      @click="scrollToBottom(true)"
    >
      <AppIcon :name="ICONS.common.arrowDown" class="messages-jump-icon" />
      <span>回到底部</span>
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue'
import type { Message, MessagePart } from '../api/types'
import MessageBubble from './MessageBubble.vue'
import ImageBubble from './ImageBubble.vue'
import DocumentBubble from './DocumentBubble.vue'
import ToolBlock from './ToolBlock.vue'
import AppIcon from './AppIcon.vue'
import { ICONS } from '../constants/icons'
import { hasToolParts } from '../utils/message'
import { getToolSummary } from '../utils/tool-renderers'

interface ToolGroupEntry {
  message: Message
  messageIndex: number
}

interface DisplayMessageItem {
  kind: 'message'
  key: string
  message: Message
  messageIndex: number
}

interface DisplayToolGroupItem {
  kind: 'tool_group'
  key: string
  entries: ToolGroupEntry[]
}

interface ToolWorkflowNoteStep {
  key: string
  text: string
  status: 'running' | 'completed'
}

type DisplayItem = DisplayMessageItem | DisplayToolGroupItem

const props = defineProps<{
  messages: Message[]
  messagesLoading: boolean
  messagesError: string
  messageActionError: string
  sending: boolean
  streamingText: string
  isStreaming: boolean
  streamingThought: string
  streamingThoughtDurationMs: number | undefined
  actionsLocked: boolean
  armedDeleteMessageIndex: number | null
  deletingMessageIndex: number | null
  retryInfo: { attempt: number; maxRetries: number; error: string } | null
}>()

const starterPrompts = [
  '帮我分析当前项目的目录结构',
  '查看最近的 Git 提交记录',
  '搜索项目中的 TODO 注释',
  '列出当前目录下的所有文件',
]

const emit = defineEmits<{
  retry: [messageIndex: number]
  delete: [messageIndex: number]
  'starter-prompt': [text: string]
  'clear-message-action-error': []
  'reload-history': []
}>()

const containerEl = ref<HTMLElement>()
const shouldStickToBottom = ref(true)
const expandedToolGroups = reactive(new Set<string>())
const collapsingToolGroups = reactive(new Set<string>())
const expandedThoughts = reactive(new Set<string>())
const toolWorkflowCompactSizeCache = new Map<string, { width: number, height: number }>()
const toolWorkflowCardEls = new Map<string, HTMLButtonElement>()
const toolWorkflowStackEls = new Map<string, HTMLDivElement>()
const toolWorkflowCollapseTimers = new Map<string, number>()

const showThinkingBubble = computed(() => {
  if (!props.sending || props.isStreaming || !!props.streamingText || !!props.streamingThought) return false
  const lastMessage = props.messages[props.messages.length - 1]
  return !lastMessage || lastMessage.role === 'user'
})

const showJumpToBottom = computed(() => {
  return !shouldStickToBottom.value && (props.messages.length > 0 || props.isStreaming || props.sending)
})

/**
 * 在工具组的所有 entries 中查找与 function_response 匹配的 function_call args。
 * function_call 和 function_response 通常在不同的 message 中（model 消息 vs user 消息），
 * 因此需要跨 entry 搜索。优先按 callId 匹配，回退到同名最近的 call。
 */
function findCallArgsInEntries(entries: ToolGroupEntry[], responsePart: MessagePart): unknown {
  if (!responsePart.callId && !responsePart.name) return undefined

  // 优先按 callId 匹配（在所有 entries 中搜索）
  if (responsePart.callId) {
    for (const entry of entries) {
      const match = entry.message.parts.find(p => p.type === 'function_call' && p.callId === responsePart.callId)
      if (match) return match.args
    }
  }

  // 回退按 name 匹配（取最后一个同名 call）
  for (let ei = entries.length - 1; ei >= 0; ei--) {
    const parts = entries[ei].message.parts
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i]
      if (p.type === 'function_call' && p.name === responsePart.name) {
        return p.args
      }
    }
  }

  return undefined
}

/**
 * 提取工具组中所有不重复的工具名称
 */
function extractToolNames(entries: ToolGroupEntry[]): string[] {
  const names: string[] = []
  const seen = new Set<string>()

  for (const entry of entries) {
    for (const part of entry.message.parts) {
      if (part.type === 'function_call' && part.name && !seen.has(part.name)) {
        seen.add(part.name)
        names.push(part.name)
      }
    }
  }

  return names
}

/**
 * 为工具组中的工具结果生成紧凑摘要列表（用于折叠卡片预览）
 */
function buildToolGroupCompactSummaries(entries: ToolGroupEntry[]): Array<{ name: string; text: string }> {
  const summaries: Array<{ name: string; text: string }> = []

  for (const entry of entries) {
    for (const part of entry.message.parts) {
      if (part.type === 'function_response' && part.name) {
        const callArgs = findCallArgsInEntries(entries, part)
        const summary = getToolSummary(part.name, 'response', part.response, callArgs)
        summaries.push({ name: part.name, text: summary.text })
      }
    }
  }

  return summaries
}

/** 后端存储的内部标记文本，不应在 UI 中单独展示 */
function isInternalMarker(text: string): boolean {
  const normalized = text.trim()

  return /^\[Document: [^\]\r\n]+\]$/.test(normalized)
    || /^\[Image: original [^\]\r\n]+\]$/.test(normalized)
}

function isThoughtExpanded(key: string): boolean {
  return expandedThoughts.has(key)
}

function toggleThought(key: string) {
  if (expandedThoughts.has(key)) {
    expandedThoughts.delete(key)
  } else {
    expandedThoughts.add(key)
  }
}

function formatThoughtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function truncateRetryError(error: string): string {
  const firstLine = error.split('\n')[0] ?? error
  return firstLine.length > 60 ? firstLine.slice(0, 60) + '…' : firstLine
}

function isRetryableUserMessage(message: Message | undefined): boolean {
  return !!message
    && message.role === 'user'
    && message.parts.some((part) => (
      part.type === 'text' || part.type === 'image' || part.type === 'document'
    ))
}

function countToolCalls(msg: Message): number {
  return msg.parts.filter((part) => part.type === 'function_call').length
}

function countToolResponses(msg: Message): number {
  return msg.parts.filter((part) => part.type === 'function_response').length
}

function isVisibleTextPart(part: MessagePart): boolean {
  return part.type === 'text' && !!part.text?.trim() && !isInternalMarker(part.text)
}

function isLastVisibleTextPart(msg: Message, partIndex: number): boolean {
  for (let i = msg.parts.length - 1; i >= 0; i--) {
    if (isVisibleTextPart(msg.parts[i])) return i === partIndex
  }
  return false
}

function getRetryMessageIndex(messageIndex: number): number | null {
  for (let index = Math.min(Math.max(messageIndex, 0), props.messages.length - 1); index >= 0; index -= 1) {
    if (isRetryableUserMessage(props.messages[index])) {
      return index
    }
  }

  return null
}

function buildRetryButtonTitle(messageIndex: number): string {
  if (props.actionsLocked) {
    return '当前仍有回复生成中，暂时无法重试'
  }

  if (getRetryMessageIndex(messageIndex) === null) {
    return '未找到可重试的用户消息'
  }

  return '重新发送这一轮用户消息'
}

function getDeleteState(messageIndex: number): 'idle' | 'armed' | 'deleting' {
  if (props.deletingMessageIndex === messageIndex) {
    return 'deleting'
  }
  if (props.armedDeleteMessageIndex === messageIndex) {
    return 'armed'
  }
  return 'idle'
}

function buildDeleteButtonTitle(messageIndex: number): string {
  const isDeleting = props.deletingMessageIndex === messageIndex
  const deletingLastOnly = messageIndex === props.messages.length - 1
  const scopeLabel = deletingLastOnly ? '这条消息' : '这条消息及其后的所有内容'

  if (props.actionsLocked && !isDeleting) {
    return `当前仍有回复生成中，暂时无法删除：${scopeLabel}`
  }

  if (isDeleting) {
    return `正在删除：${scopeLabel}`
  }

  if (props.armedDeleteMessageIndex === messageIndex) {
    return `再次点击确认删除：${scopeLabel}`
  }

  return `删除：${scopeLabel}`
}

function getToolGroupAnchorMessageIndex(item: DisplayToolGroupItem): number {
  return item.entries[item.entries.length - 1]?.messageIndex ?? -1
}

function getToolGroupRetryMessageIndex(item: DisplayToolGroupItem): number | null {
  const anchorIndex = getToolGroupAnchorMessageIndex(item)
  if (anchorIndex < 0) return null
  return getRetryMessageIndex(anchorIndex)
}

function buildToolGroupRetryButtonTitle(item: DisplayToolGroupItem): string {
  const anchorIndex = getToolGroupAnchorMessageIndex(item)
  if (anchorIndex < 0) {
    return '未找到可重试的工具调用轮次'
  }

  return buildRetryButtonTitle(anchorIndex)
}

function emitToolGroupRetry(item: DisplayToolGroupItem) {
  const retryMessageIndex = getToolGroupRetryMessageIndex(item)
  emit('retry', retryMessageIndex ?? getToolGroupAnchorMessageIndex(item))
}


function getVisibleTextParts(msg: Message): string[] {
  return msg.parts
    .filter(isVisibleTextPart)
    .map((part) => part.text?.trim() ?? '')
    .filter(Boolean)
}

function hasVisibleModelReplyBubble(message: Message): boolean {
  return message.role === 'model' && message.parts.some(isVisibleTextPart)
}

function normalizeWorkflowNote(text: string): string {
  return text.replace(/\s+/g, ' ').replace(/[：:]$/, '').trim()
}

function truncateText(text: string, maxLength = 88): string {
  if (text.length <= maxLength) return text
  return `${text.slice(0, maxLength).trimEnd()}…`
}

function splitWorkflowNoteLines(text: string): string[] {
  return text
    .replace(/\r\n?/g, '\n')
    .split(/\n+/)
    .map(line => line.trim())
    .filter(Boolean)
}

function isToolGroupRunning(key: string): boolean {
  if (!props.sending || props.isStreaming || !!props.streamingText || !!props.streamingThought) {
    return false
  }

  const lastDisplayItem = displayItems.value[displayItems.value.length - 1]
  return !!lastDisplayItem && lastDisplayItem.kind === 'tool_group' && lastDisplayItem.key === key
}

function buildToolGroupNoteSteps(item: DisplayToolGroupItem): ToolWorkflowNoteStep[] {
  const steps: ToolWorkflowNoteStep[] = []

  for (const entry of item.entries) {
    const visibleNotes = getVisibleTextParts(entry.message)

    for (let noteIndex = 0; noteIndex < visibleNotes.length; noteIndex += 1) {
      const note = visibleNotes[noteIndex]
      const lines = splitWorkflowNoteLines(note)

      for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
        steps.push({
          key: `${item.key}-${entry.messageIndex}-${noteIndex}-${lineIndex}`,
          text: lines[lineIndex],
          status: 'completed',
        })
      }
    }
  }

  if (steps.length === 0) {
    return steps
  }

  if (isToolGroupRunning(item.key)) {
    steps[steps.length - 1] = {
      ...steps[steps.length - 1],
      status: 'running',
    }
  }

  return steps
}

function shouldShowToolGroupStatusList(item: DisplayToolGroupItem): boolean {
  if (buildToolGroupNoteSteps(item).length === 0) {
    return false
  }

  return isToolGroupRunning(item.key) || isToolGroupExpanded(item.key)
}

function isToolGroupCompact(key: string): boolean {
  return !isToolGroupRunning(key) && !isToolGroupExpanded(key) && !isToolGroupCollapsing(key)
}

function shouldShowToolGroupSummary(item: DisplayToolGroupItem): boolean {
  if (isToolGroupCompact(item.key) || isToolGroupCollapsing(item.key)) {
    return false
  }

  return !!buildToolGroupSummary(item.entries)
}

function buildToolGroupSummary(entries: ToolGroupEntry[]): string {
  const noteSet = new Set<string>()

  for (const entry of entries) {
    for (const note of getVisibleTextParts(entry.message)) {
      const normalized = normalizeWorkflowNote(note)
      if (normalized) {
        noteSet.add(normalized)
      }
      if (noteSet.size >= 3) break
    }
    if (noteSet.size >= 3) break
  }

  const summary = Array.from(noteSet).join(' · ')
  return summary ? truncateText(summary) : ''
}

function buildToolGroupTitle(entries: ToolGroupEntry[]): string {
  const names = extractToolNames(entries)
  const callCount = entries.reduce((total, entry) => total + countToolCalls(entry.message), 0)

  if (names.length > 0 && names.length <= 3) {
    return names.join(' · ')
  }

  if (names.length > 3) {
    return `${names.slice(0, 3).join(' · ')} +${names.length - 3}`
  }

  if (callCount > 0) {
    return `${callCount} 个工具调用`
  }

  return '工具工作流'
}

function buildToolGroupMeta(entries: ToolGroupEntry[]): string {
  const summaries = buildToolGroupCompactSummaries(entries)

  if (summaries.length > 0) {
    // 显示最多 3 个工具的简要结果
    const parts = summaries.slice(0, 3).map(s => s.text)
    if (summaries.length > 3) parts.push(`+${summaries.length - 3}`)
    const result = parts.join(' · ')
    return result.length > 100 ? result.slice(0, 100) + '…' : result
  }

  const callCount = entries.reduce((total, entry) => total + countToolCalls(entry.message), 0)
  const responseCount = entries.reduce((total, entry) => total + countToolResponses(entry.message), 0)
  const segments: string[] = []

  if (callCount > 0 && responseCount > 0) {
    segments.push(`${responseCount} 个结果`)
  }

  if (entries.length > 1) {
    segments.push(`${entries.length} 个阶段`)
  }

  return segments.join(' · ') || '点击查看'
}

function shouldShowToolGroupActions(item: DisplayToolGroupItem): boolean {
  if (props.actionsLocked || props.sending || props.isStreaming || !!props.streamingText || !!props.streamingThought) {
    return false
  }

  const currentIndex = displayItems.value.findIndex((candidate) => candidate.key === item.key)
  if (currentIndex < 0) return false

  const nextItem = displayItems.value[currentIndex + 1]
  if (!nextItem) return true

  if (nextItem.kind === 'message' && hasVisibleModelReplyBubble(nextItem.message)) {
    return false
  }

  return true
}

const displayItems = computed<DisplayItem[]>(() => {
  const items: DisplayItem[] = []
  let index = 0

  while (index < props.messages.length) {
    const message = props.messages[index]

    if (!hasToolParts(message)) {
      items.push({
        kind: 'message',
        key: `message-${index}`,
        message,
        messageIndex: index,
      })
      index += 1
      continue
    }

    const startIndex = index
    const entries: ToolGroupEntry[] = []

    while (index < props.messages.length && hasToolParts(props.messages[index])) {
      entries.push({
        message: props.messages[index],
        messageIndex: index,
      })
      index += 1
    }

    items.push({
      kind: 'tool_group',
      key: `tool-group-${startIndex}-${index - 1}`,
      entries,
    })
  }

  return items
})

function isToolGroupExpanded(key: string): boolean {
  return expandedToolGroups.has(key)
}

function isToolGroupCollapsing(key: string): boolean {
  return collapsingToolGroups.has(key)
}

function setToolWorkflowStackEl(key: string, el: unknown) {
  if (el instanceof HTMLDivElement) {
    toolWorkflowStackEls.set(key, el)
    return
  }

  toolWorkflowStackEls.delete(key)
}

function clearToolWorkflowCollapseTimer(key: string) {
  const timer = toolWorkflowCollapseTimers.get(key)
  if (typeof timer === 'number') {
    window.clearTimeout(timer)
    toolWorkflowCollapseTimers.delete(key)
  }
}

function cleanupToolWorkflowCollapseStyles(key: string) {
  const stackEl = toolWorkflowStackEls.get(key)
  if (stackEl) {
    stackEl.style.width = ''
    stackEl.style.maxWidth = ''
    stackEl.style.height = ''
    stackEl.style.overflow = ''
    stackEl.style.willChange = ''
    stackEl.style.contain = ''
    stackEl.style.transform = ''
  }
}

function setToolWorkflowCardEl(key: string, el: unknown) {
  if (el instanceof HTMLButtonElement) {
    toolWorkflowCardEls.set(key, el)
    return
  }

  toolWorkflowCardEls.delete(key)
}

function animateToolWorkflowCard(key: string, firstRect: DOMRect | null) {
  if (!firstRect) return

  nextTick(() => {
    const el = toolWorkflowCardEls.get(key)
    if (!el || typeof el.animate !== 'function') return

    // 让缩放方向固定为右/下收放（避免默认中心缩放带来的“不互逆”观感）
    el.style.transformOrigin = '0 0'

    // 取消同元素上的残留动画，避免多次点击叠加造成抖动
    el.getAnimations().forEach((anim) => anim.cancel())

    const lastRect = el.getBoundingClientRect()
    const deltaX = firstRect.left - lastRect.left
    const deltaY = firstRect.top - lastRect.top
    const scaleX = firstRect.width > 0 ? firstRect.width / lastRect.width : 1
    const scaleY = firstRect.height > 0 ? firstRect.height / lastRect.height : 1

    const shouldAnimate = Math.abs(deltaX) > 1
      || Math.abs(deltaY) > 1
      || Math.abs(scaleX - 1) > 0.02
      || Math.abs(scaleY - 1) > 0.02

    if (!shouldAnimate) return

    el.animate([
      {
        transform: `translate(${deltaX}px, ${deltaY}px) scale(${scaleX}, ${scaleY})`,
      },
      {
        transform: 'translate(0, 0) scale(1, 1)',
      },
    ], {
      duration: 260,
      easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
    })
  })
}

function measureCompactToolWorkflowCard(
  key: string,
  cardEl: HTMLButtonElement,
): { width: number, height: number } | null {
  if (typeof document === 'undefined') return null

  const cached = toolWorkflowCompactSizeCache.get(key)
  if (cached) return cached

  const clone = cardEl.cloneNode(true) as HTMLButtonElement
  clone.classList.remove('expanded', 'collapsing')
  clone.classList.add('compact', 'tool-workflow-card-measure')
  clone.querySelector('.tool-workflow-meta')?.remove()
  clone.querySelector('.tool-workflow-status-list')?.remove()
  clone.querySelector('.tool-workflow-summary')?.remove()

  Object.assign(clone.style, {
    position: 'fixed',
    left: '-10000px',
    top: '0',
    width: 'auto',
    maxWidth: '360px',
    visibility: 'hidden',
    pointerEvents: 'none',
    transform: 'none',
  })

  document.body.appendChild(clone)
  const rect = clone.getBoundingClientRect()
  clone.remove()

  if (rect.width <= 0 || rect.height <= 0) {
    return null
  }

  const measured = {
    width: rect.width,
    height: rect.height,
  }

  toolWorkflowCompactSizeCache.set(key, measured)
  return measured
}

function animateToolWorkflowCollapse(key: string) {
  if (collapsingToolGroups.has(key)) return

  const sourceStackEl = toolWorkflowStackEls.get(key)
  const cardEl = toolWorkflowCardEls.get(key)
  const sourceRect = sourceStackEl?.getBoundingClientRect()

  if (!sourceStackEl || !cardEl || !sourceRect) {
    clearToolWorkflowCollapseTimer(key)
    collapsingToolGroups.delete(key)
    expandedToolGroups.delete(key)
    cleanupToolWorkflowCollapseStyles(key)
    return
  }

  const compactSize = measureCompactToolWorkflowCard(key, cardEl)
  if (!compactSize) {
    clearToolWorkflowCollapseTimer(key)
    collapsingToolGroups.delete(key)
    expandedToolGroups.delete(key)
    cleanupToolWorkflowCollapseStyles(key)
    return
  }

  clearToolWorkflowCollapseTimer(key)
  sourceStackEl.style.width = `${sourceRect.width}px`
  sourceStackEl.style.maxWidth = `${sourceRect.width}px`
  sourceStackEl.style.height = `${sourceRect.height}px`
  sourceStackEl.style.overflow = 'hidden'
  sourceStackEl.style.willChange = 'width, height'
  sourceStackEl.style.contain = 'layout paint'
  sourceStackEl.style.transform = 'translateZ(0)'

  void sourceStackEl.offsetWidth

  collapsingToolGroups.add(key)

  requestAnimationFrame(() => {
    sourceStackEl.style.width = `${Math.min(compactSize.width, sourceRect.width)}px`
    sourceStackEl.style.height = `${compactSize.height}px`
  })

  const timer = window.setTimeout(() => {
    collapsingToolGroups.delete(key)
    expandedToolGroups.delete(key)
    cleanupToolWorkflowCollapseStyles(key)
    toolWorkflowCollapseTimers.delete(key)
  }, 280)

  toolWorkflowCollapseTimers.set(key, timer)
}

function collapseExpandedToolGroups() {
  const expandedKeys = Array.from(expandedToolGroups)
  if (expandedKeys.length === 0) return

  expandedKeys.forEach((key) => animateToolWorkflowCollapse(key))
}

function toggleToolGroup(key: string) {
  if (collapsingToolGroups.has(key)) return
  if (expandedToolGroups.has(key)) {
    animateToolWorkflowCollapse(key)
    return
  }

  const firstRect = toolWorkflowCardEls.get(key)?.getBoundingClientRect() ?? null
  expandedToolGroups.add(key)
  animateToolWorkflowCard(key, firstRect)
}

function refreshStickToBottom() {
  if (!containerEl.value) return
  const { scrollTop, clientHeight, scrollHeight } = containerEl.value
  shouldStickToBottom.value = scrollHeight - (scrollTop + clientHeight) <= 80
}

function handleScroll() {
  refreshStickToBottom()
}

function scrollToBottom(force = false) {
  nextTick(() => {
    if (!containerEl.value) return
    if (force || shouldStickToBottom.value) {
      containerEl.value.scrollTo({ top: containerEl.value.scrollHeight, behavior: force ? 'smooth' : 'auto' })
      shouldStickToBottom.value = true
    }
  })
}

watch(() => props.messages.length, (newLen, oldLen) => {
  const delta = newLen - (oldLen ?? 0)
  const previousLastMessage = typeof oldLen === 'number' && oldLen > 0
    ? props.messages[oldLen - 1]
    : null
  const nextLastMessage = newLen > 0
    ? props.messages[newLen - 1]
    : null

  if (delta !== 1) {
    collapseExpandedToolGroups()
    scrollToBottom(true)
    return
  }

  if (previousLastMessage && hasToolParts(previousLastMessage) && nextLastMessage && !hasToolParts(nextLastMessage)) {
    collapseExpandedToolGroups()
  }

  scrollToBottom(false)
})

watch(() => props.messages, () => {
  toolWorkflowCompactSizeCache.clear()
  collapseExpandedToolGroups()
  scrollToBottom(true)
})

watch(() => props.streamingText, (value, oldValue) => {
  if (value && !oldValue) {
    collapseExpandedToolGroups()
  }
  scrollToBottom(false)
})

watch(() => props.streamingThought, () => {
  scrollToBottom(false)
})

watch(() => props.sending, (value) => {
  if (value) scrollToBottom(false)
})

onBeforeUnmount(() => {
  toolWorkflowCollapseTimers.forEach((timer) => window.clearTimeout(timer))
  toolWorkflowCollapseTimers.clear()
  toolWorkflowCompactSizeCache.clear()
  collapsingToolGroups.clear()
  toolWorkflowStackEls.clear()
  toolWorkflowCardEls.clear()
})
</script>
