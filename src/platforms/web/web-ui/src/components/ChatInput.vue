<template>
  <div class="input-area">
    <input
      ref="fileInputEl"
      class="sr-only"
      type="file"
      accept="image/*,.pdf,.docx,.pptx,.xlsx,.xls"
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
          <span>支持图片、PDF 与 Office 文档</span>
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
        <button
          v-if="showQuickPrompts"
          v-for="prompt in quickPrompts"
          :key="prompt.text"
          class="input-quick-chip"
          type="button"
          @click="applyQuickPrompt(prompt.text)"
        >
          {{ prompt.label }}
        </button>
        <span
          v-if="quickPromptsEnabled && quickPromptsLoading"
          class="input-quick-status"
          aria-live="polite"
        >
          <span class="input-quick-status-dot" aria-hidden="true"></span>
          正在生成建议...
        </span>
        <button
          class="input-quick-chip input-quick-toggle"
          :class="{ active: quickPromptsEnabled }"
          type="button"
          :aria-pressed="quickPromptsEnabled"
          @click="toggleQuickPrompts"
        >{{ quickPromptsEnabled ? '关闭建议' : '开启建议' }}</button>
      </div>

      <div v-if="images.length > 0 || documents.length > 0" class="input-attachment-summary">
        <span>{{ attachmentSummary }}</span>
        <button class="input-clear-attachments" type="button" :disabled="interactionDisabled" @click="clearAttachments">
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
        <textarea
          ref="inputEl"
          v-model="text"
          placeholder="给 Iris 发送消息..."
          rows="1"
          :disabled="interactionDisabled"
          @keydown.enter.exact="handleEnterKey"
          @input="autoResize"
          @paste="handlePaste"
        ></textarea>

        <div class="input-actions">
          <button
            class="btn-attach"
            type="button"
            :disabled="interactionDisabled || (images.length >= MAX_IMAGES && documents.length >= MAX_DOCUMENTS)"
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
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import * as api from '../api/client'
import type { ChatSuggestion, ImageInput, DocumentInput } from '../api/types'
import AppIcon from './AppIcon.vue'
import { ICONS } from '../constants/icons'
import { useSessions } from '../composables/useSessions'

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

const fallbackQuickPrompts: ChatSuggestion[] = [
  { label: '继续推进', text: '请基于刚才的内容继续推进，并告诉我下一步最值得做什么。' },
  { label: '梳理关键点', text: '请先帮我梳理当前问题的关键点、风险和建议方案。' },
  { label: '校验结果', text: '请检查当前结论是否有遗漏，并给出我应该优先补充的内容。' },
]

const QUICK_PROMPTS_ENABLED_STORAGE_KEY = 'iris-chat-quick-prompts-enabled'

const props = defineProps<{ disabled: boolean }>()
const emit = defineEmits<{ send: [text: string, images?: ImageInput[], documents?: DocumentInput[]] }>()
const { currentSessionId } = useSessions()

const disabled = computed(() => props.disabled)
const text = ref('')
const images = ref<ImageInput[]>([])
const documents = ref<DocumentInput[]>([])
const errorMessage = ref('')
const attachmentsProcessing = ref(false)
const dragActive = ref(false)
const quickPromptsLoading = ref(false)
const quickPromptsEnabled = ref(loadQuickPromptsEnabled())
const quickPrompts = ref<ChatSuggestion[]>(fallbackQuickPrompts.map((prompt) => ({ ...prompt })))
const inputEl = ref<HTMLTextAreaElement | null>(null)
const fileInputEl = ref<HTMLInputElement | null>(null)
let dragDepth = 0
let quickPromptLoadVersion = 0

const interactionDisabled = computed(() => disabled.value || attachmentsProcessing.value)
const canSend = computed(() => !attachmentsProcessing.value && (text.value.trim().length > 0 || images.value.length > 0 || documents.value.length > 0))
const showQuickPromptBar = computed(() => !interactionDisabled.value && !text.value.trim() && images.value.length === 0 && documents.value.length === 0)
const showQuickPrompts = computed(() => showQuickPromptBar.value && quickPromptsEnabled.value)
const sendButtonText = computed(() => {
  if (disabled.value) return '生成中...'
  if (attachmentsProcessing.value) return '处理中...'
  return '发送'
})
const attachButtonLabel = computed(() => (images.value.length > 0 || documents.value.length > 0 ? '继续添加' : '上传文件'))
const statusBadgeText = computed(() => {
  if (disabled.value) return 'Iris 正在整理回复'
  if (attachmentsProcessing.value) return '正在处理附件'
  return '已连接工作流上下文'
})
const uploadHintText = computed(() => {
  if (disabled.value) return '当前回答完成前，附件与输入将暂时锁定。'
  if (attachmentsProcessing.value) return '正在处理附件，请稍候后再发送或继续上传。'
  return `支持拖拽 / 粘贴上传 · 图片最多 ${MAX_IMAGES} 张(5MB) · 文档最多 ${MAX_DOCUMENTS} 个(50MB)`
})
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

function loadQuickPromptsEnabled(): boolean {
  try {
    return window.localStorage.getItem(QUICK_PROMPTS_ENABLED_STORAGE_KEY) !== '0'
  } catch {
    return true
  }
}

function cloneFallbackQuickPrompts(): ChatSuggestion[] {
  return fallbackQuickPrompts.map((prompt) => ({ ...prompt }))
}

function normalizeQuickPromptLabel(text: string, fallbackText = ''): string {
  const normalized = `${text} ${fallbackText}`.replace(/\s+/g, ' ').replace(/[。！？!?；;：:、,，]+$/g, '').trim()
  if (!normalized) return ''

  const labelRules: Array<{ pattern: RegExp; label: string }> = [
    { pattern: /(附件|文档|图片|资料|文件)/, label: '分析附件' },
    { pattern: /(继续|推进|下一步|优先)/, label: '继续推进' },
    { pattern: /(梳理|思路|关键点|脉络)/, label: '梳理思路' },
    { pattern: /(定位|排查|报错|异常|bug|问题)/i, label: '定位问题' },
    { pattern: /(遗漏|漏项|缺口)/, label: '检查遗漏' },
    { pattern: /(检查|校验|核对|验证)/, label: '校验结果' },
    { pattern: /(风险|隐患)/, label: '检查风险' },
    { pattern: /(方案|建议|实现|做法)/, label: '给出方案' },
    { pattern: /(总结|结论|提炼|归纳)/, label: '总结结论' },
  ]

  for (const rule of labelRules) {
    if (rule.pattern.test(normalized)) return rule.label
  }

  const compact = normalized
    .replace(/^(请先|请帮我先|请帮我|请你先|请你|请|先|帮我|麻烦你|麻烦|可以帮我|可以|能否)/, '')
    .replace(/^(基于刚才的内容|基于当前内容|基于上面的内容|围绕当前问题|针对当前问题)/, '')
    .replace(/(并告诉我.*|并给出.*|并说明.*|并列出.*)$/u, '')
    .trim()

  if (!compact) return ''
  return compact.length > 10 ? `${compact.slice(0, 10).trim()}…` : compact
}

function normalizeQuickPrompts(prompts: ChatSuggestion[] | undefined): ChatSuggestion[] {
  const result: ChatSuggestion[] = []
  const seen = new Set<string>()

  for (const prompt of [...(prompts ?? []), ...cloneFallbackQuickPrompts()]) {
    const textValue = typeof prompt?.text === 'string' ? prompt.text.replace(/\s+/g, ' ').trim() : ''
    const labelSource = typeof prompt?.label === 'string' && prompt.label.trim() ? prompt.label : textValue
    const labelValue = normalizeQuickPromptLabel(labelSource, textValue)
    if (!textValue || !labelValue || seen.has(textValue)) continue
    seen.add(textValue)
    result.push({ label: labelValue, text: textValue })
    if (result.length >= 3) break
  }

  return result
}

function persistQuickPromptsEnabled(value: boolean) {
  try {
    window.localStorage.setItem(QUICK_PROMPTS_ENABLED_STORAGE_KEY, value ? '1' : '0')
  } catch {
    // 忽略存储失败，回退为当前会话内生效
  }
}

async function loadQuickPrompts() {
  if (!quickPromptsEnabled.value) {
    quickPromptLoadVersion += 1
    quickPromptsLoading.value = false
    quickPrompts.value = cloneFallbackQuickPrompts()
    return
  }

  const requestVersion = ++quickPromptLoadVersion
  quickPromptsLoading.value = true

  try {
    const data = await api.getChatSuggestions(currentSessionId.value)
    if (requestVersion !== quickPromptLoadVersion) return
    quickPrompts.value = normalizeQuickPrompts(data.suggestions)
  } catch {
    if (requestVersion !== quickPromptLoadVersion) return
    quickPrompts.value = normalizeQuickPrompts([])
  } finally {
    if (requestVersion === quickPromptLoadVersion) {
      quickPromptsLoading.value = false
    }
  }
}

function applyQuickPrompt(prompt: string) {
  text.value = prompt
  clearError()
  focusComposer()
}

function toggleQuickPrompts() {
  quickPromptsEnabled.value = !quickPromptsEnabled.value
}

onMounted(() => {
  if (quickPromptsEnabled.value) {
    void loadQuickPrompts()
  }
})

watch(currentSessionId, () => {
  if (quickPromptsEnabled.value) {
    void loadQuickPrompts()
  }
})

watch(disabled, (value, oldValue) => {
  if (!value && oldValue && quickPromptsEnabled.value) {
    void loadQuickPrompts()
  }
})

watch(quickPromptsEnabled, (value) => {
  persistQuickPromptsEnabled(value)
  if (value) {
    void loadQuickPrompts()
  } else {
    quickPromptLoadVersion += 1
    quickPromptsLoading.value = false
  }
})

function openFilePicker() {
  if (interactionDisabled.value || (images.value.length >= MAX_IMAGES && documents.value.length >= MAX_DOCUMENTS)) return
  fileInputEl.value?.click()
}

function clearAttachments() {
  if (interactionDisabled.value) return
  images.value = []
  documents.value = []
  clearError()
}

function removeImage(index: number) {
  if (interactionDisabled.value) return
  images.value.splice(index, 1)
  clearError()
}

function removeDocument(index: number) {
  if (interactionDisabled.value) return
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
  if (interactionDisabled.value || files.length === 0) return

  attachmentsProcessing.value = true

  try {
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
    } else {
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
  } finally {
    attachmentsProcessing.value = false
  }
}

async function handleFileSelection(event: Event) {
  const target = event.target as HTMLInputElement
  const files = Array.from(target.files ?? [])
  await appendFiles(files)
  target.value = ''
}

function handleDragEnter(event: DragEvent) {
  if (interactionDisabled.value || !event.dataTransfer?.types.includes('Files')) return
  dragDepth += 1
  dragActive.value = true
}

function handleDragOver(event: DragEvent) {
  if (interactionDisabled.value || !event.dataTransfer?.types.includes('Files')) return
  dragActive.value = true
}

function handleDragLeave(event: DragEvent) {
  if (interactionDisabled.value || !event.dataTransfer?.types.includes('Files')) return
  dragDepth = Math.max(0, dragDepth - 1)
  if (dragDepth === 0) {
    dragActive.value = false
  }
}

async function handleDrop(event: DragEvent) {
  dragDepth = 0
  dragActive.value = false
  if (interactionDisabled.value) return
  const files = Array.from(event.dataTransfer?.files ?? [])
  await appendFiles(files)
}

async function handlePaste(event: ClipboardEvent) {
  if (interactionDisabled.value) return
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
  if (!canSend.value || interactionDisabled.value) return

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
