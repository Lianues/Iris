<template>
  <div class="message-stack" :class="[`message-stack-${role}`, { streaming }]">
    <div class="message-meta-row">
      <div class="message-meta-group">
        <div class="message-meta-badge" :class="`message-meta-badge-${role}`">
          <AppIcon :name="roleIcon" class="message-meta-icon" />
          <span>{{ roleLabel }}</span>
        </div>
        <div v-if="streaming" class="message-stream-status">实时生成中</div>
      </div>

      <div class="message-actions">
        <button class="message-action-btn" :class="messageCopyStateClass" type="button" @click="copyMessage">
          <AppIcon :name="ICONS.common.copy" class="message-action-icon" />
          <span>{{ messageCopyText }}</span>
        </button>
        <button
          v-if="role === 'model' && !streaming"
          class="message-action-btn"
          type="button"
          @click="emit('retry', messageIndex ?? -1)"
        >
          <AppIcon :name="ICONS.common.retry" class="message-action-icon" />
          <span>重试</span>
        </button>
      </div>
    </div>

    <div
      ref="messageEl"
      class="message"
      :class="[`message-${role}`, { streaming }]"
      v-html="renderedText"
    ></div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { renderMarkdown } from '../utils/markdown'
import AppIcon from './AppIcon.vue'
import { ICONS } from '../constants/icons'

const props = defineProps<{
  role: 'user' | 'model'
  text: string
  streaming?: boolean
  messageIndex?: number
}>()

const emit = defineEmits<{ retry: [messageIndex: number] }>()

const roleLabel = computed(() => (props.role === 'user' ? '你' : 'Iris'))
const roleIcon = computed(() => (props.role === 'user' ? ICONS.common.send : ICONS.common.sparkle))
const messageEl = ref<HTMLDivElement | null>(null)
const messageCopyText = ref('复制')
const messageCopyState = ref<'idle' | 'success' | 'error'>('idle')
let messageCopyTimer: number | null = null

const messageCopyStateClass = computed(() => {
  if (messageCopyState.value === 'success') return 'copied'
  if (messageCopyState.value === 'error') return 'error'
  return ''
})

/** 用户消息纯文本转义，模型消息 Markdown 渲染 */
const renderedText = computed(() => {
  if (props.role === 'user') {
    const div = document.createElement('div')
    div.textContent = props.text
    return div.innerHTML
  }
  return renderMarkdown(props.text)
})

function scheduleMessageCopyReset() {
  if (messageCopyTimer !== null) {
    window.clearTimeout(messageCopyTimer)
  }
  messageCopyTimer = window.setTimeout(() => {
    messageCopyText.value = '复制'
    messageCopyState.value = 'idle'
    messageCopyTimer = null
  }, 1800)
}

async function copyMessage() {
  try {
    await navigator.clipboard.writeText(props.text)
    messageCopyText.value = '已复制'
    messageCopyState.value = 'success'
  } catch {
    messageCopyText.value = '复制失败'
    messageCopyState.value = 'error'
  }
  scheduleMessageCopyReset()
}

function resetCodeCopyButton(button: HTMLButtonElement) {
  button.textContent = '复制代码'
  button.classList.remove('copied', 'error')
}

function scheduleCodeCopyReset(button: HTMLButtonElement) {
  const timerId = button.dataset.resetTimer
  if (timerId) {
    window.clearTimeout(Number(timerId))
  }

  const nextTimerId = window.setTimeout(() => {
    resetCodeCopyButton(button)
    delete button.dataset.resetTimer
  }, 1800)

  button.dataset.resetTimer = String(nextTimerId)
}

async function copyCodeBlock(pre: HTMLElement, button: HTMLButtonElement) {
  try {
    await navigator.clipboard.writeText(pre.innerText)
    button.textContent = '已复制'
    button.classList.remove('error')
    button.classList.add('copied')
  } catch {
    button.textContent = '复制失败'
    button.classList.remove('copied')
    button.classList.add('error')
  }

  scheduleCodeCopyReset(button)
}

function detectCodeLabel(pre: HTMLElement) {
  const code = pre.querySelector('code')
  const match = code?.className.match(/language-([\w-]+)/)
  return match?.[1]?.toUpperCase() || '代码片段'
}

function enhanceCodeBlocks() {
  if (props.role !== 'model' || !messageEl.value) return

  const blocks = Array.from(messageEl.value.querySelectorAll('pre'))
  for (const pre of blocks) {
    if (pre.parentElement?.classList.contains('message-code-shell')) continue

    const shell = document.createElement('div')
    shell.className = 'message-code-shell'

    const toolbar = document.createElement('div')
    toolbar.className = 'message-code-toolbar'

    const label = document.createElement('span')
    label.className = 'message-code-label'
    label.textContent = detectCodeLabel(pre)

    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'message-code-copy'
    button.textContent = '复制代码'
    button.addEventListener('click', () => {
      void copyCodeBlock(pre, button)
    })

    toolbar.append(label, button)
    pre.parentNode?.insertBefore(shell, pre)
    shell.append(toolbar, pre)
  }
}

onMounted(() => {
  void nextTick(() => {
    enhanceCodeBlocks()
  })
})

watch(renderedText, () => {
  void nextTick(() => {
    enhanceCodeBlocks()
  })
})

onBeforeUnmount(() => {
  if (messageCopyTimer !== null) {
    window.clearTimeout(messageCopyTimer)
  }

  messageEl.value?.querySelectorAll<HTMLButtonElement>('.message-code-copy').forEach((button) => {
    const timerId = button.dataset.resetTimer
    if (timerId) {
      window.clearTimeout(Number(timerId))
    }
  })
})
</script>
