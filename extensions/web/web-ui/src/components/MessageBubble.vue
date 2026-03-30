<template>
  <div class="message-stack message-stack-bubble" :class="[`message-stack-${role}`, { streaming }]">
    <div class="message-meta-row">
      <div class="message-meta-group">
        <div class="message-meta-badge" :class="[`message-meta-badge-${role}`, { 'message-meta-badge-error': isErrorMessage, 'message-meta-badge-ok': role === 'model' && !isErrorMessage }]">
          <AppIcon :name="roleIcon" class="message-meta-icon" />
          <span>{{ roleLabel }}</span>
        </div>
        <div v-if="streaming" class="message-stream-status">实时生成中</div>
        <span v-if="relativeTime" class="message-timestamp">{{ relativeTime }}</span>
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
          @click="downloadMessage"
        >
          <AppIcon :name="ICONS.common.download" class="message-action-icon" />
          <span>下载</span>
        </button>
        <button
          v-if="role === 'model' && !streaming"
          class="message-action-btn"
          type="button"
          :title="resolvedRetryButtonTitle"
          :aria-label="resolvedRetryButtonTitle"
          :disabled="actionsLocked || retryDisabled"
          @click="emit('retry', retryMessageIndex ?? messageIndex ?? -1)"
        >
          <AppIcon :name="ICONS.common.retry" class="message-action-icon" />
          <span>重试</span>
        </button>
        <button
          v-if="canDeleteMessage"
          class="message-action-btn"
          :class="deleteButtonClass"
          type="button"
          :title="deleteButtonTitle"
          :aria-label="deleteButtonTitle"
          :disabled="resolvedDeleteDisabled"
          @click="emit('delete', messageIndex ?? -1)"
        >
          <AppIcon :name="deleteButtonIcon" class="message-action-icon" />
          <span>{{ deleteButtonLabel }}</span>
        </button>
      </div>
    </div>

    <div ref="messageEl" class="message" :class="[`message-${role}`, { streaming }]">
      <!-- eslint-disable-next-line vue/no-v-html -->
      <div v-if="renderAsPlainText" class="message-plain" v-html="renderedText"></div>
      <!-- eslint-disable-next-line vue/no-v-html -->
      <div v-else class="message-rich" v-html="renderedText" @click="handleRichContentClick"></div>
    </div>

    <div v-if="metaSegments.length > 0" class="message-perf-meta">
      <span v-for="(seg, i) in metaSegments" :key="i" class="message-perf-item">{{ seg }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import AppIcon from './AppIcon.vue'
import { ICONS } from '../constants/icons'
import { copyTextToClipboard } from '../utils/clipboard'
import { useCopyFeedback } from '../composables/useCopyFeedback'
import { openLightbox } from '../composables/useLightbox'
import { hydrateRenderedContent } from '../utils/renderers/registry'
import { getRoleLabel } from '../utils/role'
import type { MessageMeta } from '../api/types'

type RenderRichText = (text: string) => string

let renderRichText: RenderRichText | null = null
let markdownRendererLoader: Promise<void> | null = null

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function renderPlainTextSync(text: string): string {
  return escapeHtml(text).replace(/\n/g, '<br>')
}

async function ensureMarkdownRendererLoaded(): Promise<RenderRichText> {
  if (renderRichText) return renderRichText
  if (!markdownRendererLoader) {
    markdownRendererLoader = import('../utils/markdown').then((module) => {
      renderRichText = module.renderRichText
    })
  }
  await markdownRendererLoader
  if (!renderRichText) {
    throw new Error('富文本渲染器加载失败')
  }
  return renderRichText
}

const props = defineProps<{
  role: 'user' | 'model'
  text: string
  meta?: MessageMeta
  streaming?: boolean
  deleteState?: 'idle' | 'armed' | 'deleting'
  retryMessageIndex?: number | null
  actionsLocked?: boolean
  retryDisabled?: boolean
  retryButtonTitle?: string
  deleteButtonTitle?: string
  messageIndex?: number
  timestamp?: number
}>()

const emit = defineEmits<{
  retry: [messageIndex: number]
  delete: [messageIndex: number]
}>()

const canDeleteMessage = computed(() => !props.streaming && typeof props.messageIndex === 'number' && props.messageIndex >= 0)
const roleLabel = computed(() => getRoleLabel(props.role))
const roleIcon = computed(() => (props.role === 'user' ? ICONS.common.send : ICONS.common.sparkle))
const isErrorMessage = computed(() => props.meta?.isError || (props.role === 'model' && props.text.trimStart().startsWith('错误:')))

// ---- 相对时间（使用共享时钟，避免每个气泡都创建定时器） ----
import { useSharedNow } from '../composables/useSharedNow'
const { now } = useSharedNow()

const relativeTime = computed(() => {
  if (!props.timestamp) return ''
  const diff = now.value - props.timestamp
  if (diff < 60_000) return '刚刚'
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86400_000) {
    const d = new Date(props.timestamp)
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }
  const d = new Date(props.timestamp)
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
})

const metaSegments = computed<string[]>(() => {
  const m = props.meta
  if (!m || props.streaming) return []
  const segs: string[] = []
  if (m.modelName) segs.push(m.modelName)
  if (m.tokenIn != null) segs.push(`IN ${m.tokenIn.toLocaleString()}`)
  if (m.tokenOut != null) segs.push(`OUT ${m.tokenOut.toLocaleString()}`)
  if (m.durationMs != null) segs.push(m.durationMs < 1000 ? `${m.durationMs}ms` : `${(m.durationMs / 1000).toFixed(1)}s`)
  if (m.tokenOut != null && m.streamOutputDurationMs != null && m.streamOutputDurationMs > 0) {
    segs.push(`${(m.tokenOut / (m.streamOutputDurationMs / 1000)).toFixed(1)} t/s`)
  }
  return segs
})
const resolvedRetryButtonTitle = computed(() => {
  if (props.retryButtonTitle?.trim()) return props.retryButtonTitle
  return '重试这一轮对话'
})
const deleteButtonLabel = computed(() => {
  if (props.deleteState === 'deleting') return '删除中...'
  if (props.deleteState === 'armed') return '确认？'
  return '删除'
})
const deleteButtonIcon = computed(() => {
  return props.deleteState === 'deleting' ? ICONS.status.loading : ICONS.common.delete
})
const deleteButtonClass = computed(() => ({
  danger: true,
  armed: props.deleteState === 'armed',
  deleting: props.deleteState === 'deleting',
}))
const resolvedDeleteDisabled = computed(() => props.deleteState === 'deleting' || !!props.actionsLocked)
const deleteButtonTitle = computed(() => {
  if (props.deleteButtonTitle?.trim()) {
    return props.deleteButtonTitle
  }
  return props.deleteState === 'armed' ? '再次点击确认删除' : '删除消息'
})
const messageEl = ref<HTMLDivElement | null>(null)
const renderAsPlainText = computed(() => props.role === 'user' || !!props.streaming)

const { copyText: messageCopyText, copyStateClass: messageCopyStateClass, copy: copyMessageAction } = useCopyFeedback()
const codeCopyTimers = new Set<number>()
const renderedText = ref(renderPlainTextSync(props.text))

function copyMessage() {
  void copyMessageAction(props.text)
}

function resetCodeCopyButton(button: HTMLButtonElement) {
  button.textContent = '复制代码'
  button.classList.remove('copied', 'error')
  delete button.dataset.resetTimer
}

function scheduleCodeCopyReset(button: HTMLButtonElement) {
  const timerId = button.dataset.resetTimer
  if (timerId) {
    const timer = Number(timerId)
    window.clearTimeout(timer)
    codeCopyTimers.delete(timer)
  }

  const nextTimerId = window.setTimeout(() => {
    resetCodeCopyButton(button)
    codeCopyTimers.delete(nextTimerId)
  }, 1800)

  button.dataset.resetTimer = String(nextTimerId)
  codeCopyTimers.add(nextTimerId)
}

async function copyCodeBlock(codeText: string, button: HTMLButtonElement) {
  try {
    await copyTextToClipboard(codeText)
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

function handleRichContentClick(event: MouseEvent) {
  const target = event.target as HTMLElement | null

  if (target?.tagName === 'IMG') {
    const img = target as HTMLImageElement
    if (img.src) { openLightbox(img.src, img.alt); return }
  }

  const button = target?.closest<HTMLButtonElement>('.message-code-copy')
  if (!button || !messageEl.value?.contains(button)) return

  const codeShell = button.closest('.message-code-shell')
  const numberedLines = Array.from(codeShell?.querySelectorAll<HTMLElement>('.message-code-line-text') ?? [])
  const codeText = numberedLines.length > 0
    ? numberedLines.map((line) => line.textContent ?? '').join('\n')
    : codeShell?.querySelector('pre code')?.textContent ?? ''
  if (!codeText) return

  void copyCodeBlock(codeText, button)
}

function padTimeSegment(value: number): string {
  return String(value).padStart(2, '0')
}

function buildDownloadFilename(): string {
  const now = new Date()
  const timestamp = [
    now.getFullYear(),
    padTimeSegment(now.getMonth() + 1),
    padTimeSegment(now.getDate()),
  ].join('') + '-' + [
    padTimeSegment(now.getHours()),
    padTimeSegment(now.getMinutes()),
    padTimeSegment(now.getSeconds()),
  ].join('')

  const suffix = props.role === 'model' ? 'reply' : 'message'
  const ext = props.role === 'model' ? 'md' : 'txt'
  return `iris-${suffix}-${timestamp}.${ext}`
}

function downloadMessage() {
  const mimeType = props.role === 'model'
    ? 'text/markdown;charset=utf-8'
    : 'text/plain;charset=utf-8'

  const blob = new Blob([props.text], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = buildDownloadFilename()
  anchor.click()
  URL.revokeObjectURL(url)
}

let renderTaskVersion = 0
let disposed = false

async function updateRenderedText() {
  const taskVersion = ++renderTaskVersion

  if (renderAsPlainText.value) {
    renderedText.value = renderPlainTextSync(props.text)
    return
  }

  if (renderRichText) {
    renderedText.value = renderRichText(props.text)
    await nextTick()
    if (disposed || taskVersion !== renderTaskVersion) return
    void hydrateRenderedContent(messageEl.value)
    return
  }

  renderedText.value = renderPlainTextSync(props.text)

  try {
    const renderer = await ensureMarkdownRendererLoaded()
    if (disposed || taskVersion !== renderTaskVersion) return
    renderedText.value = renderer(props.text)
    await nextTick()
    if (disposed || taskVersion !== renderTaskVersion) return
    void hydrateRenderedContent(messageEl.value)
  } catch (error) {
    console.error('加载富文本渲染器失败:', error)
    if (disposed || taskVersion !== renderTaskVersion) return
    renderedText.value = renderPlainTextSync(props.text)
  }
}

watch(() => [props.role, props.text, props.streaming], () => {
  void updateRenderedText()
}, { immediate: true })

onBeforeUnmount(() => {
  disposed = true

  for (const timer of codeCopyTimers) {
    window.clearTimeout(timer)
  }
  codeCopyTimers.clear()
})
</script>
