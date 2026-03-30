<template>
  <div class="input-area">
    <input
      ref="fileInputEl"
      class="sr-only"
      type="file"
      :accept="SUPPORTED_UPLOAD_ACCEPT"
      multiple
      :disabled="interactionDisabled"
      @change="handleFileSelection"
    />

    <CommandAutocomplete
      ref="autocompleteRef"
      :input="text"
      :visible="showAutocomplete"
      @select="handleAutocompleteSelect"
    />

    <div
      class="input-shell"
      :class="{ 'drag-active': dragActive, 'input-shell-busy': interactionDisabled }"
      @dragenter.prevent="handleDragEnter"
      @dragover.prevent="handleDragOver"
      @dragleave.prevent="handleDragLeave"
      @drop.prevent="handleDrop"
    >
      <div v-if="dragActive" class="input-drag-mask">
        <div class="input-drag-mask-card">
          <AppIcon :name="ICONS.common.attach" class="input-drag-mask-icon" />
          <strong>释放即可附加到当前对话</strong>
          <span>支持图片、PDF、Office，以及 Markdown / JSON / XML / Python 等文本代码文件</span>
        </div>
      </div>

      <div class="input-meta">
        <div class="input-meta-left">
          <AppIcon :name="ICONS.common.bolt" class="input-meta-icon" />
          <span class="input-title">{{ isBusy ? '排队发送模式' : '继续当前工作流' }}</span>
          <span class="input-meta-sep">•</span>
          <span class="input-hint">Enter {{ isBusy ? '排队' : '发送' }} · Shift + Enter 换行</span>
        </div>
        <button
          class="btn-compact"
          type="button"
          title="压缩上下文 (/compact)"
          :disabled="!currentSessionId || isBusy"
          @click="$emit('compact')"
        >
          <AppIcon :name="ICONS.common.compress" class="btn-compact-icon" />
          <span>Compact</span>
        </button>
        <div class="input-status-badge" :class="{ busy: isBusy }">
          {{ statusBadgeText }}
        </div>
      </div>

      <div v-if="hasAttachments" class="input-attachment-summary">
        <span>{{ attachmentSummary }}</span>
        <button class="input-clear-attachments" type="button" :disabled="interactionDisabled" @click="clearAttachments">
          清空附件
        </button>
      </div>

      <div v-if="hasAttachments" class="image-preview-strip">
        <div
          v-for="(image, index) in images"
          :key="`img-${index}`"
          class="image-preview-item"
        >
          <img :src="toImageSrc(image)" :alt="`待发送图片 ${index + 1}`" />
          <button
            class="image-preview-remove"
            type="button"
            :disabled="interactionDisabled"
            @click="removeImage(index)"
          >
            <AppIcon :name="ICONS.common.close" />
          </button>
        </div>

        <div
          v-for="(doc, index) in documents"
          :key="`doc-${index}`"
          class="image-preview-item doc-preview-item"
        >
          <div class="doc-preview-content">
            <AppIcon :name="ICONS.common.document" class="doc-preview-icon" />
            <span class="doc-preview-name">{{ doc.fileName }}</span>
          </div>
          <button
            class="image-preview-remove"
            type="button"
            :disabled="interactionDisabled"
            @click="removeDocument(index)"
          >
            <AppIcon :name="ICONS.common.close" />
          </button>
        </div>
      </div>

      <div class="input-box">
        <div class="input-textarea-wrap" :class="{ expanded }">
          <textarea
            ref="inputEl"
            v-model="text"
            :placeholder="isBusy ? '输入消息排队发送...' : '给 Iris 发送消息...'"
            rows="1"
            :disabled="attachmentsProcessing"
            @keydown="handleKeydown"
            @keydown.enter.exact="handleEnterKey"
            @keydown.up="handleArrowKey($event, -1)"
            @keydown.down="handleArrowKey($event, 1)"
            @keydown.tab="handleTabKey"
            @keydown.escape="autocompleteDismissed = true"
            @input="onInput"
            @paste="handlePaste"
          ></textarea>
          <button
            class="btn-expand-toggle"
            type="button"
            title="展开/收起 (Ctrl+Shift+E)"
            @click="toggleExpand"
          >
            <AppIcon :name="expanded ? ICONS.common.collapseDown : ICONS.common.expandUp" />
          </button>
          <button
            class="btn-attach-inline"
            type="button"
            :disabled="interactionDisabled || !canAddMoreFiles"
            @click="openFilePicker"
          >
            <AppIcon :name="ICONS.common.attach" />
          </button>
        </div>

        <button
          class="btn-send"
          :class="{ sending: attachmentsProcessing, enqueue: isBusy && canSend }"
          :disabled="attachmentsProcessing || !canSend"
          @click="handleSend"
        >
          <AppIcon :name="isBusy ? ICONS.common.schedule : ICONS.common.send" class="btn-send-icon" />
        </button>
      </div>

      <div class="input-upload-hint">
        <span>{{ uploadHintText }}</span>
        <span v-if="errorMessage" class="input-error">{{ errorMessage }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import type { ChatDocumentAttachment, ChatImageAttachment } from '../api/types'
import type { SlashCommand } from '../composables/useSlashCommands'
import AppIcon from './AppIcon.vue'
import CommandAutocomplete from './CommandAutocomplete.vue'
import { ICONS } from '../constants/icons'
import { useSessions } from '../composables/useSessions'
import { SUPPORTED_UPLOAD_ACCEPT, useChatAttachments } from '../composables/useChatAttachments'

const props = defineProps<{
  disabled: boolean
  queueSize?: number
}>()
const emit = defineEmits<{
  send: [text: string, images?: ChatImageAttachment[], documents?: ChatDocumentAttachment[]]
  enqueue: [text: string]
  compact: []
}>()

const { currentSessionId } = useSessions()

/** AI 正在生成中（sending=true），但不应阻止用户输入 */
const isBusy = computed(() => props.disabled)
const text = ref('')
const expanded = ref(false)
const inputEl = ref<HTMLTextAreaElement | null>(null)
const fileInputEl = ref<HTMLInputElement | null>(null)
const autocompleteRef = ref<InstanceType<typeof CommandAutocomplete> | null>(null)
/** ESC 强制隐藏补全，输入变化时自动重置 */
const autocompleteDismissed = ref(false)
const showAutocomplete = computed(() =>
  !autocompleteDismissed.value && text.value.trimStart().startsWith('/') && !attachmentsProcessing.value,
)

const {
  images,
  documents,
  errorMessage,
  attachmentsProcessing,
  dragActive,
  interactionDisabled,
  hasAttachments,
  canAddMoreFiles,
  attachButtonLabel,
  uploadHintText,
  attachmentSummary,
  clearError,
  toImageSrc,
  openFilePicker,
  clearAttachments,
  resetAttachments,
  removeImage,
  removeDocument,
  handleFileSelection,
  handleDragEnter,
  handleDragOver,
  handleDragLeave,
  handleDrop,
  handlePaste,
  buildOutgoingImages,
  buildOutgoingDocuments,
} = useChatAttachments({
  disabled: isBusy,
  fileInputEl,
})

const canSend = computed(() => {
  return !attachmentsProcessing.value
    && (text.value.trim().length > 0 || images.value.length > 0 || documents.value.length > 0)
})

const sendButtonText = computed(() => {
  if (isBusy.value) return '排队'
  if (attachmentsProcessing.value) return '处理中...'
  return '发送'
})

const statusBadgeText = computed(() => {
  if (isBusy.value) return 'Iris 正在整理回复'
  if (attachmentsProcessing.value) return '正在处理附件'
  return '已连接工作流上下文'
})

function focusComposer() {
  nextTick(() => {
    inputEl.value?.focus()
    autoResize()
  })
}

function resetComposer() {
  text.value = ''
  resetAttachments()
  nextTick(() => {
    if (inputEl.value) inputEl.value.style.height = 'auto'
  })
}

function toggleExpand() {
  const ta = inputEl.value
  if (!ta) { expanded.value = !expanded.value; return }

  const collapsing = expanded.value // true = we are about to collapse
  const from = ta.offsetHeight

  // When collapsing, temporarily override max-height so CSS doesn't clamp mid-animation
  if (collapsing) {
    ta.style.maxHeight = from + 'px'
  }

  expanded.value = !expanded.value

  nextTick(() => {
    const maxH = expanded.value ? window.innerHeight * 0.5 - 40 : 200
    // Measure target: briefly set auto to get natural scroll height
    const savedMax = ta.style.maxHeight
    ta.style.transition = 'none'
    ta.style.height = 'auto'
    ta.style.maxHeight = 'none'
    const natural = ta.scrollHeight
    const to = Math.min(natural, maxH)

    // Set starting position
    ta.style.height = from + 'px'
    ta.style.maxHeight = savedMax || ''
    // Force reflow
    void ta.offsetHeight

    // Start animation
    ta.style.transition = 'height 0.28s cubic-bezier(0.22, 1, 0.36, 1)'
    ta.style.maxHeight = 'none'
    ta.style.height = to + 'px'

    const onEnd = () => {
      ta.style.transition = ''
      ta.style.maxHeight = ''
      ta.removeEventListener('transitionend', onEnd)
    }
    ta.addEventListener('transitionend', onEnd)
  })
}

function handleKeydown(e: KeyboardEvent) {
  if (e.ctrlKey && e.shiftKey && (e.key === 'e' || e.key === 'E')) {
    e.preventDefault()
    toggleExpand()
  }
}

function handleEnterKey(event: KeyboardEvent) {
  if (event.isComposing) {
    return
  }
  event.preventDefault()

  // 自动补全可见且有匹配项时，Enter 确认选项而不是发送
  if (showAutocomplete.value && autocompleteRef.value) {
    if (autocompleteRef.value.confirmSelection()) return
  }

  handleSend()
}

function handleSend() {
  if (!canSend.value || attachmentsProcessing.value) return

  // 生成期间：斜杠命令仍立即执行，普通文本入队
  if (isBusy.value) {
    const trimmed = text.value.trim()
    if (!trimmed) return
    // 斜杠命令不排队，直接发送给 ChatView 立即处理
    if (trimmed.startsWith('/')) {
      emit('send', trimmed)
      text.value = ''
      nextTick(() => { if (inputEl.value) inputEl.value.style.height = 'auto' })
      return
    }
    emit('enqueue', trimmed)
    text.value = ''
    nextTick(() => { if (inputEl.value) inputEl.value.style.height = 'auto' })
    return
  }

  // 正常发送（可含附件）
  const outgoingImages = buildOutgoingImages()
  const outgoingDocs = buildOutgoingDocuments()

  emit(
    'send',
    text.value,
    outgoingImages.length > 0 ? outgoingImages : undefined,
    outgoingDocs.length > 0 ? outgoingDocs : undefined,
  )
  resetComposer()
}

function handleArrowKey(e: KeyboardEvent, delta: number) {
  if (showAutocomplete.value && autocompleteRef.value?.hasItems()) {
    e.preventDefault()
    autocompleteRef.value.moveSelection(delta)
  }
}

function handleTabKey(e: KeyboardEvent) {
  if (showAutocomplete.value && autocompleteRef.value?.hasItems()) {
    e.preventDefault()
    autocompleteRef.value.confirmSelection()
  }
}

function handleAutocompleteSelect(cmd: SlashCommand) {
  text.value = cmd.hasArg ? cmd.name + ' ' : cmd.name
  autocompleteDismissed.value = true
  nextTick(() => inputEl.value?.focus())
}

/** @input 只在用户实际输入时触发，不在程序赋值时触发 */
function onInput() {
  autocompleteDismissed.value = false
  autoResize()
}

function autoResize() {
  if (inputEl.value) {
    const maxH = expanded.value ? window.innerHeight * 0.5 - 40 : 200
    inputEl.value.style.height = 'auto'
    inputEl.value.style.height = Math.min(inputEl.value.scrollHeight, maxH) + 'px'
  }
}
</script>
