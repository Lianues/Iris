<template>
  <div ref="containerEl" class="messages" @scroll="handleScroll">
    <div class="messages-shell">
      <div v-if="messages.length === 0 && !isStreaming && !sending" class="welcome">
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
      </div>

      <template v-for="(msg, i) in messages" :key="i">
        <button
          v-if="hasToolParts(msg) && getTextPartIndex(msg) === -1"
          class="tool-collapse-btn"
          :class="{ expanded: !collapsedTools.has(i) }"
          type="button"
          @click="toggleToolCollapse(i)"
        >
          <AppIcon :name="ICONS.common.chevronRight" class="collapse-icon" />
          {{ collapsedTools.has(i) ? `${countToolParts(msg)} 个工具调用（点击展开）` : '折叠工具调用' }}
        </button>

        <template v-for="(part, j) in msg.parts" :key="`${i}-${j}`">
          <MessageBubble
            v-if="part.type === 'text' && part.text?.trim() && !isInternalMarker(part.text!)"
            :role="msg.role"
            :text="part.text!"
            :message-index="i"
            @retry="emit('retry', $event)"
          />

          <ImageBubble
            v-else-if="part.type === 'image' && part.mimeType && part.data"
            :role="msg.role"
            :mime-type="part.mimeType"
            :data="part.data"
          />

          <DocumentBubble
            v-else-if="part.type === 'document' && part.mimeType && part.data"
            :role="msg.role"
            :mime-type="part.mimeType"
            :data="part.data"
            :file-name="part.fileName"
          />

          <button
            v-if="part.type === 'text' && part.text?.trim() && !isInternalMarker(part.text!) && hasToolParts(msg) && isLastTextPart(msg, j)"
            class="tool-collapse-btn"
            :class="{ expanded: !collapsedTools.has(i) }"
            type="button"
            @click="toggleToolCollapse(i)"
          >
            <AppIcon :name="ICONS.common.chevronRight" class="collapse-icon" />
            {{ collapsedTools.has(i) ? `${countToolParts(msg)} 个工具调用（点击展开）` : '折叠工具调用' }}
          </button>

          <ToolBlock
            v-else-if="part.type === 'function_call'"
            type="call"
            :name="part.name!"
            :data="part.args"
            :collapsed="collapsedTools.has(i)"
          />
          <ToolBlock
            v-else-if="part.type === 'function_response'"
            type="response"
            :name="part.name!"
            :data="part.response"
            :collapsed="collapsedTools.has(i)"
          />
        </template>
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
import { computed, nextTick, reactive, ref, watch } from 'vue'
import type { Message } from '../api/types'
import MessageBubble from './MessageBubble.vue'
import ImageBubble from './ImageBubble.vue'
import DocumentBubble from './DocumentBubble.vue'
import ToolBlock from './ToolBlock.vue'
import AppIcon from './AppIcon.vue'
import { ICONS } from '../constants/icons'

const props = defineProps<{
  messages: Message[]
  sending: boolean
  streamingText: string
  isStreaming: boolean
}>()

const emit = defineEmits<{ retry: [messageIndex: number] }>()

const containerEl = ref<HTMLElement>()
const shouldStickToBottom = ref(true)

/** 记录哪些消息索引的工具被折叠 */
const collapsedTools = reactive(new Set<number>())

const showThinkingBubble = computed(() => {
  if (!props.sending || props.isStreaming || !!props.streamingText) return false
  const lastMessage = props.messages[props.messages.length - 1]
  return !lastMessage || lastMessage.role === 'user'
})

const showJumpToBottom = computed(() => {
  return !shouldStickToBottom.value && (props.messages.length > 0 || props.isStreaming || props.sending)
})

/** 后端存储的内部标记文本，不应在 UI 中单独展示 */
function isInternalMarker(text: string): boolean {
  return text.startsWith('[Document: ') || text.startsWith('[Image: original ')
}

function hasToolParts(msg: Message): boolean {
  return msg.parts.some((part) => part.type === 'function_call' || part.type === 'function_response')
}

function countToolParts(msg: Message): number {
  return msg.parts.filter((part) => part.type === 'function_call' || part.type === 'function_response').length
}

/** 判断文本 part 是否为用户可见（非内部标记） */
function isVisibleTextPart(part: { type: string; text?: string }): boolean {
  return part.type === 'text' && !!part.text?.trim() && !isInternalMarker(part.text!)
}

/** 获取消息中第一个有效文本部分的索引，没有则返回 -1 */
function getTextPartIndex(msg: Message): number {
  return msg.parts.findIndex(isVisibleTextPart)
}

/** 判断当前 part 是否是消息中最后一个有效文本部分 */
function isLastTextPart(msg: Message, partIndex: number): boolean {
  for (let index = msg.parts.length - 1; index >= 0; index--) {
    if (isVisibleTextPart(msg.parts[index])) {
      return index === partIndex
    }
  }
  return false
}

function toggleToolCollapse(msgIndex: number) {
  if (collapsedTools.has(msgIndex)) {
    collapsedTools.delete(msgIndex)
  } else {
    collapsedTools.add(msgIndex)
  }
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
  if (delta !== 1) {
    collapsedTools.clear()
    scrollToBottom(true)
    return
  }

  scrollToBottom(false)
})

watch(() => props.messages, () => {
  collapsedTools.clear()
  scrollToBottom(true)
})

watch(() => props.streamingText, () => {
  scrollToBottom(false)
})

watch(() => props.sending, (value) => {
  if (value) scrollToBottom(false)
})
</script>
