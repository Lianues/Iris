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
        <div>
          <div class="input-title">继续当前工作流</div>
          <div class="input-hint">Enter 发送 · Shift + Enter 换行</div>
        </div>
        <div class="input-status-badge" :class="{ busy: interactionDisabled }">
          {{ statusBadgeText }}
        </div>
      </div>

      <div v-if="showQuickPromptBar" class="input-quick-actions">
        <div class="input-quick-prompt-list" :class="{ disabled: !quickPromptsEnabled }">
          <button
            v-for="prompt in quickPrompts"
            :key="prompt.text"
            class="input-quick-chip"
            :class="{ disabled: !quickPromptsEnabled }"
            type="button"
            :disabled="!quickPromptsEnabled"
            :aria-disabled="!quickPromptsEnabled"
            @click="applyQuickPrompt(prompt.text)"
          >
            {{ prompt.label }}
          </button>
        </div>
        <span
          v-if="quickPromptsEnabled && quickPromptsLoading"
          class="input-quick-status"
          aria-live="polite"
        >
          <span class="input-quick-status-dot" aria-hidden="true"></span>
          正在生成建议...
        </span>
        <button
          class="input-quick-switch"
          :class="{ active: quickPromptsEnabled }"
          type="button"
          role="switch"
          :aria-checked="quickPromptsEnabled"
          @click="toggleQuickPrompts"
        >
          <span class="input-quick-switch-track" aria-hidden="true">
            <span class="input-quick-switch-thumb"></span>
          </span>
          <span class="input-quick-switch-label">{{ quickPromptsEnabled ? '建议已开' : '建议已关' }}</span>
        </button>
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

      <CommandAutocomplete
        ref="autocompleteRef"
        :input="text"
        :visible="showAutocomplete"
        @select="handleAutocompleteSelect"
      />

      <div class="input-box">
        <textarea
          ref="inputEl"
          v-model="text"
          placeholder="给 Iris 发送消息..."
          rows="1"
          :disabled="interactionDisabled"
          @keydown.enter.exact="handleEnterKey"
          @keydown.up="handleArrowKey($event, -1)"
          @keydown.down="handleArrowKey($event, 1)"
          @keydown.tab="handleTabKey"
          @keydown.escape="autocompleteDismissed = true"
          @input="onInput"
          @paste="handlePaste"
        ></textarea>

        <div class="input-actions">
          <button
            class="btn-attach"
            type="button"
            :disabled="interactionDisabled || !canAddMoreFiles"
            @click="openFilePicker"
          >
            <AppIcon :name="ICONS.common.attach" class="btn-attach-icon" />
            <span>{{ attachButtonLabel }}</span>
          </button>

          <button
            class="btn-send"
            :class="{ sending: interactionDisabled }"
            :disabled="interactionDisabled || !canSend"
            @click="handleSend"
          >
            <span class="btn-send-label">{{ sendButtonText }}</span>
            <span v-if="interactionDisabled" class="btn-send-spinner" aria-hidden="true">
              <span></span>
              <span></span>
              <span></span>
            </span>
            <AppIcon v-else :name="ICONS.common.send" class="btn-send-icon" />
          </button>
        </div>
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
import { useChatQuickPrompts } from '../composables/useChatQuickPrompts'

const props = defineProps<{ disabled: boolean }>()
const emit = defineEmits<{ send: [text: string, images?: ChatImageAttachment[], documents?: ChatDocumentAttachment[]] }>()

const { currentSessionId } = useSessions()

const disabled = computed(() => props.disabled)
const text = ref('')
const inputEl = ref<HTMLTextAreaElement | null>(null)
const fileInputEl = ref<HTMLInputElement | null>(null)
const autocompleteRef = ref<InstanceType<typeof CommandAutocomplete> | null>(null)
/** ESC 强制隐藏补全，输入变化时自动重置 */
const autocompleteDismissed = ref(false)
const showAutocomplete = computed(() =>
  !autocompleteDismissed.value && text.value.trimStart().startsWith('/') && !disabled.value,
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
  disabled,
  fileInputEl,
})

const {
  quickPromptsLoading,
  quickPromptsEnabled,
  quickPrompts,
  showQuickPromptBar,
  applyQuickPrompt,
  toggleQuickPrompts,
} = useChatQuickPrompts({
  currentSessionId,
  disabled,
  interactionDisabled,
  text,
  hasAttachments,
  clearError,
  focusComposer,
})

const canSend = computed(() => {
  return !attachmentsProcessing.value
    && (text.value.trim().length > 0 || images.value.length > 0 || documents.value.length > 0)
})

const sendButtonText = computed(() => {
  if (disabled.value) return '生成中...'
  if (attachmentsProcessing.value) return '处理中...'
  return '发送'
})

const statusBadgeText = computed(() => {
  if (disabled.value) return 'Iris 正在整理回复'
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
  if (!canSend.value || interactionDisabled.value) return

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
    inputEl.value.style.height = 'auto'
    inputEl.value.style.height = Math.min(inputEl.value.scrollHeight, 200) + 'px'
  }
}
</script>
