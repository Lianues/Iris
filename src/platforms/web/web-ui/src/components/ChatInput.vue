<template>
  <div class="input-area">
    <input
      ref="fileInputEl"
      class="sr-only"
      type="file"
      accept="image/*,.pdf,.docx,.pptx,.xlsx,.xls"
      multiple
      :disabled="disabled"
      @change="handleFileSelection"
    />

    <div
      class="input-shell"
      :class="{ 'drag-active': dragActive, 'input-shell-busy': disabled }"
      @dragenter.prevent="handleDragEnter"
      @dragover.prevent="handleDragOver"
      @dragleave.prevent="handleDragLeave"
      @drop.prevent="handleDrop"
    >
      <div v-if="dragActive" class="input-drag-mask">
        <div class="input-drag-mask-card">
          <AppIcon :name="ICONS.common.attach" class="input-drag-mask-icon" />
          <strong>释放即可附加到当前对话</strong>
          <span>支持图片、PDF 与 Office 文档</span>
        </div>
      </div>

      <div class="input-meta">
        <div>
          <div class="input-title">继续当前工作流</div>
          <div class="input-hint">Enter 发送 · Shift + Enter 换行</div>
        </div>
        <div class="input-status-badge" :class="{ busy: disabled }">
          {{ disabled ? 'Iris 正在整理回复' : '已连接工作流上下文' }}
        </div>
      </div>

      <div v-if="showQuickPrompts" class="input-quick-actions">
        <button
          v-for="prompt in quickPrompts"
          :key="prompt.label"
          class="input-quick-chip"
          type="button"
          @click="applyQuickPrompt(prompt.text)"
        >
          {{ prompt.label }}
        </button>
      </div>

      <div v-if="images.length > 0 || documents.length > 0" class="input-attachment-summary">
        <span>{{ attachmentSummary }}</span>
        <button class="input-clear-attachments" type="button" :disabled="disabled" @click="clearAttachments">
          清空附件
        </button>
      </div>

      <div v-if="images.length > 0 || documents.length > 0" class="image-preview-strip">
        <div
          v-for="(image, index) in images"
          :key="`img-${index}`"
          class="image-preview-item"
        >
          <img :src="toImageSrc(image)" :alt="`待发送图片 ${index + 1}`" />
          <button
            class="image-preview-remove"
            type="button"
            :disabled="disabled"
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
            :disabled="disabled"
            @click="removeDocument(index)"
          >
            <AppIcon :name="ICONS.common.close" />
          </button>
        </div>
      </div>

      <div class="input-box">
        <textarea
          ref="inputEl"
          v-model="text"
          placeholder="给 Iris 发送消息..."
          rows="1"
          :disabled="disabled"
          @keydown.enter.exact="handleEnterKey"
          @input="autoResize"
          @paste="handlePaste"
        ></textarea>

        <div class="input-actions">
          <button
            class="btn-attach"
            type="button"
            :disabled="disabled || (images.length >= MAX_IMAGES && documents.length >= MAX_DOCUMENTS)"
            @click="openFilePicker"
          >
            <AppIcon :name="ICONS.common.attach" class="btn-attach-icon" />
            <span>{{ attachButtonLabel }}</span>
          </button>

          <button
            class="btn-send"
            :class="{ sending: disabled }"
            :disabled="disabled || !canSend"
            @click="handleSend"
          >
            <span class="btn-send-label">{{ sendButtonText }}</span>
            <span v-if="disabled" class="btn-send-spinner" aria-hidden="true">
              <span></span>
              <span></span>
              <span></span>
            </span>
            <AppIcon v-else :name="ICONS.common.send" class="btn-send-icon" />
          </button>
        </div>
      </div>

      <div class="input-upload-hint">
        <span>{{ disabled ? '当前回答完成前，附件与输入将暂时锁定。' : '支持拖拽 / 粘贴上传 · 图片最多 ' + MAX_IMAGES + ' 张(5MB) · 文档最多 ' + MAX_DOCUMENTS + ' 个(50MB)' }}</span>
        <span v-if="errorMessage" class="input-error">{{ errorMessage }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import type { ImageInput, DocumentInput } from '../api/types'
import AppIcon from './AppIcon.vue'
import { ICONS } from '../constants/icons'

const MAX_IMAGES = 5
const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const MAX_DOCUMENTS = 10
const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024
const SUPPORTED_DOC_EXTENSIONS = ['.pdf', '.docx', '.pptx', '.xlsx', '.xls']
const SUPPORTED_DOC_MIMES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
])

const quickPrompts = [
  { label: '继续推进上一步', text: '继续推进上一步，并告诉我下一步最值得做什么。' },
  { label: '帮我梳理思路', text: '请先帮我梳理这个问题的关键点、风险和建议方案。' },
  { label: '分析附件内容', text: '请先分析我上传的附件，提炼重点并给出可执行结论。' },
] as const

const props = defineProps<{ disabled: boolean }>()
const emit = defineEmits<{ send: [text: string, images?: ImageInput[], documents?: DocumentInput[]] }>()

const disabled = computed(() => props.disabled)
const text = ref('')
const images = ref<ImageInput[]>([])
const documents = ref<DocumentInput[]>([])
const errorMessage = ref('')
const dragActive = ref(false)
const inputEl = ref<HTMLTextAreaElement | null>(null)
const fileInputEl = ref<HTMLInputElement | null>(null)
let dragDepth = 0

const canSend = computed(() => text.value.trim().length > 0 || images.value.length > 0 || documents.value.length > 0)
const showQuickPrompts = computed(() => !disabled.value && !text.value.trim() && images.value.length === 0 && documents.value.length === 0)
const sendButtonText = computed(() => (disabled.value ? '生成中...' : '发送'))
const attachButtonLabel = computed(() => (images.value.length > 0 || documents.value.length > 0 ? '继续添加' : '上传文件'))
const attachmentSummary = computed(() => {
  const parts: string[] = []
  if (images.value.length > 0) parts.push(`${images.value.length} 张图片`)
  if (documents.value.length > 0) parts.push(`${documents.value.length} 个文档`)
  return parts.join(' · ')
})

function setError(message: string) {
  errorMessage.value = message
}

function clearError() {
  errorMessage.value = ''
}

function toImageSrc(image: ImageInput): string {
  return `data:${image.mimeType};base64,${image.data}`
}

function isDocumentFile(file: File): boolean {
  if (SUPPORTED_DOC_MIMES.has(file.type)) return true
  const ext = file.name.toLowerCase().match(/\.[^.]+$/)?.[0]
  return ext ? SUPPORTED_DOC_EXTENSIONS.includes(ext) : false
}

function focusComposer() {
  nextTick(() => {
    inputEl.value?.focus()
    autoResize()
  })
}

function applyQuickPrompt(prompt: string) {
  text.value = prompt
  clearError()
  focusComposer()
}

function openFilePicker() {
  if (props.disabled || (images.value.length >= MAX_IMAGES && documents.value.length >= MAX_DOCUMENTS)) return
  fileInputEl.value?.click()
}

function clearAttachments() {
  images.value = []
  documents.value = []
  clearError()
}

function removeImage(index: number) {
  images.value.splice(index, 1)
  clearError()
}

function removeDocument(index: number) {
  documents.value.splice(index, 1)
  clearError()
}

function readFileAsImageInput(file: File): Promise<ImageInput> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error(`无法读取图片 ${file.name}`))
        return
      }
      const [, data = ''] = reader.result.split(',', 2)
      if (!data) {
        reject(new Error(`图片 ${file.name} 转码失败`))
        return
      }
      resolve({
        mimeType: file.type || 'image/png',
        data,
      })
    }
    reader.onerror = () => reject(new Error(`图片 ${file.name} 读取失败`))
    reader.readAsDataURL(file)
  })
}

function readFileAsDocumentInput(file: File): Promise<DocumentInput> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error(`无法读取文档 ${file.name}`))
        return
      }
      const [, data = ''] = reader.result.split(',', 2)
      if (!data) {
        reject(new Error(`文档 ${file.name} 转码失败`))
        return
      }
      resolve({
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        data,
      })
    }
    reader.onerror = () => reject(new Error(`文档 ${file.name} 读取失败`))
    reader.readAsDataURL(file)
  })
}

async function appendFiles(files: File[]) {
  if (props.disabled || files.length === 0) return

  const errors: string[] = []
  const imageFiles: File[] = []
  const docFiles: File[] = []

  for (const file of files) {
    if (file.type.startsWith('image/')) {
      imageFiles.push(file)
    } else if (isDocumentFile(file)) {
      docFiles.push(file)
    } else {
      errors.push(`${file.name}: 不支持的文件类型`)
    }
  }

  // 处理图片
  const remainingImageSlots = MAX_IMAGES - images.value.length
  if (imageFiles.length > 0 && remainingImageSlots <= 0) {
    errors.push(`图片已达上限 ${MAX_IMAGES} 张`)
  }
  const candidateImages = imageFiles.slice(0, Math.max(0, remainingImageSlots))
  if (imageFiles.length > remainingImageSlots && remainingImageSlots > 0) {
    errors.push(`图片最多上传 ${MAX_IMAGES} 张`)
  }
  const validImages = candidateImages.filter((file) => {
    if (file.size > MAX_IMAGE_BYTES) {
      errors.push(`${file.name} 超过 5MB 限制`)
      return false
    }
    return true
  })

  // 处理文档
  const remainingDocSlots = MAX_DOCUMENTS - documents.value.length
  if (docFiles.length > 0 && remainingDocSlots <= 0) {
    errors.push(`文档已达上限 ${MAX_DOCUMENTS} 个`)
  }
  const candidateDocs = docFiles.slice(0, Math.max(0, remainingDocSlots))
  if (docFiles.length > remainingDocSlots && remainingDocSlots > 0) {
    errors.push(`文档最多上传 ${MAX_DOCUMENTS} 个`)
  }
  const validDocs = candidateDocs.filter((file) => {
    if (file.size > MAX_DOCUMENT_BYTES) {
      errors.push(`${file.name} 超过 50MB 限制`)
      return false
    }
    return true
  })

  if (validImages.length === 0 && validDocs.length === 0) {
    setError(errors[0] ?? '没有可用的文件')
    return
  }

  try {
    const [newImages, newDocs] = await Promise.all([
      Promise.all(validImages.map(readFileAsImageInput)),
      Promise.all(validDocs.map(readFileAsDocumentInput)),
    ])
    images.value = [...images.value, ...newImages]
    documents.value = [...documents.value, ...newDocs]
    if (errors.length > 0) {
      setError(errors.join('；'))
    } else {
      clearError()
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    setError(detail)
  }
}

async function handleFileSelection(event: Event) {
  const target = event.target as HTMLInputElement
  const files = Array.from(target.files ?? [])
  await appendFiles(files)
  target.value = ''
}

function handleDragEnter(event: DragEvent) {
  if (props.disabled || !event.dataTransfer?.types.includes('Files')) return
  dragDepth += 1
  dragActive.value = true
}

function handleDragOver(event: DragEvent) {
  if (props.disabled || !event.dataTransfer?.types.includes('Files')) return
  dragActive.value = true
}

function handleDragLeave(event: DragEvent) {
  if (props.disabled || !event.dataTransfer?.types.includes('Files')) return
  dragDepth = Math.max(0, dragDepth - 1)
  if (dragDepth === 0) {
    dragActive.value = false
  }
}

async function handleDrop(event: DragEvent) {
  dragDepth = 0
  dragActive.value = false
  if (props.disabled) return
  const files = Array.from(event.dataTransfer?.files ?? [])
  await appendFiles(files)
}

async function handlePaste(event: ClipboardEvent) {
  if (props.disabled) return
  const imageFiles = Array.from(event.clipboardData?.items ?? [])
    .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
    .map((item) => item.getAsFile())
    .filter((file): file is File => file instanceof File)

  if (imageFiles.length === 0) return

  event.preventDefault()
  await appendFiles(imageFiles)
}

function resetComposer() {
  text.value = ''
  images.value = []
  documents.value = []
  clearError()
  nextTick(() => {
    if (inputEl.value) inputEl.value.style.height = 'auto'
  })
}

function handleEnterKey(event: KeyboardEvent) {
  if (event.isComposing) {
    return
  }
  event.preventDefault()

  handleSend()
}

function handleSend() {
  if (!canSend.value || props.disabled) return

  const outgoingImages = images.value.map((image) => ({
    mimeType: image.mimeType,
    data: image.data,
  }))
  const outgoingDocs = documents.value.map((doc) => ({
    fileName: doc.fileName,
    mimeType: doc.mimeType,
    data: doc.data,
  }))

  emit(
    'send',
    text.value,
    outgoingImages.length > 0 ? outgoingImages : undefined,
    outgoingDocs.length > 0 ? outgoingDocs : undefined,
  )
  resetComposer()
}

function autoResize() {
  if (inputEl.value) {
    inputEl.value.style.height = 'auto'
    inputEl.value.style.height = Math.min(inputEl.value.scrollHeight, 200) + 'px'
  }
}
</script>
