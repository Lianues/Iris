import { computed, onBeforeUnmount, ref, type Ref } from 'vue'
import type { ChatDocumentAttachment, ChatImageAttachment } from '../api/types'
import { CHAT_ATTACHMENT_LIMITS, formatAttachmentBytes } from '@web-shared/chat-attachments'

const SUPPORTED_DOC_EXTENSIONS = ['.pdf', '.docx', '.pptx', '.xlsx', '.xls']
const SUPPORTED_TEXT_EXTENSIONS = [
  '.txt', '.md', '.markdown',
  '.json', '.jsonc',
  '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf', '.env',
  '.xml', '.svg', '.html', '.htm', '.csv', '.tsv', '.log',
  '.py', '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs',
  '.java', '.c', '.h', '.cpp', '.hpp', '.cc', '.cs', '.go', '.rs', '.php', '.rb',
  '.sh', '.bash', '.zsh', '.ps1',
  '.sql', '.css', '.scss', '.less', '.vue',
]
const SUPPORTED_DOC_MIMES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
])
const SUPPORTED_TEXT_MIMES = new Set([
  'text/markdown',
  'text/x-markdown',
  'application/json',
  'application/ld+json',
  'application/xml',
  'image/svg+xml',
  'application/x-yaml',
  'text/yaml',
  'text/x-yaml',
  'application/toml',
  'text/x-toml',
  'application/javascript',
  'application/x-javascript',
  'application/x-sh',
  'application/x-shellscript',
  'application/sql',
])

export const SUPPORTED_UPLOAD_ACCEPT = Array.from(new Set(['image/*', ...SUPPORTED_DOC_EXTENSIONS, ...SUPPORTED_TEXT_EXTENSIONS])).join(',')

interface UseChatAttachmentsOptions {
  disabled: Ref<boolean>
  fileInputEl: Ref<HTMLInputElement | null>
}

interface DraftImageAttachment extends ChatImageAttachment {
  file: File
  previewUrl: string
  size: number
}

interface DraftDocumentAttachment extends ChatDocumentAttachment {
  file: File
  size: number
}

function normalizeMimeType(mimeType: string): string {
  return mimeType.split(';', 1)[0].trim().toLowerCase()
}

function isDocumentFile(file: File): boolean {
  const normalizedMimeType = normalizeMimeType(file.type)
  if (SUPPORTED_DOC_MIMES.has(normalizedMimeType)) return true
  if (normalizedMimeType.startsWith('text/')) return true
  if (SUPPORTED_TEXT_MIMES.has(normalizedMimeType)) return true

  const ext = file.name.toLowerCase().match(/\.[^.]+$/)?.[0]
  return ext ? (SUPPORTED_DOC_EXTENSIONS.includes(ext) || SUPPORTED_TEXT_EXTENSIONS.includes(ext)) : false
}

function revokeObjectUrl(url?: string) {
  if (!url?.startsWith('blob:')) return
  URL.revokeObjectURL(url)
}

export function useChatAttachments(options: UseChatAttachmentsOptions) {
  const images = ref<DraftImageAttachment[]>([])
  const documents = ref<DraftDocumentAttachment[]>([])
  const errorMessage = ref('')
  const attachmentsProcessing = ref(false)
  const dragActive = ref(false)

  let dragDepth = 0

  const totalAttachmentBytes = computed(() => {
    const imageBytes = images.value.reduce((sum, image) => sum + image.size, 0)
    const documentBytes = documents.value.reduce((sum, doc) => sum + doc.size, 0)
    return imageBytes + documentBytes
  })
  const remainingAttachmentBytes = computed(() => {
    return Math.max(0, CHAT_ATTACHMENT_LIMITS.maxTotalBytes - totalAttachmentBytes.value)
  })
  const interactionDisabled = computed(() => options.disabled.value || attachmentsProcessing.value)
  const hasAttachments = computed(() => images.value.length > 0 || documents.value.length > 0)
  const canAddMoreFiles = computed(() => {
    const hasSlot = images.value.length < CHAT_ATTACHMENT_LIMITS.maxImages
      || documents.value.length < CHAT_ATTACHMENT_LIMITS.maxDocuments
    return hasSlot && remainingAttachmentBytes.value > 0
  })
  const attachButtonLabel = computed(() => (hasAttachments.value ? '继续添加' : '上传文件'))
  const uploadHintText = computed(() => {
    if (options.disabled.value) return '当前回答完成前，附件与输入将暂时锁定。'
    if (attachmentsProcessing.value) return '正在整理附件，请稍候后再发送或继续上传。'

    return [
      `支持拖拽 / 粘贴上传`,
      `图片最多 ${CHAT_ATTACHMENT_LIMITS.maxImages} 张(${formatAttachmentBytes(CHAT_ATTACHMENT_LIMITS.maxImageBytes)}/张)`,
      `文档/文本代码文件最多 ${CHAT_ATTACHMENT_LIMITS.maxDocuments} 个(${formatAttachmentBytes(CHAT_ATTACHMENT_LIMITS.maxDocumentBytes)}/个)`,
      `总量 ${formatAttachmentBytes(CHAT_ATTACHMENT_LIMITS.maxTotalBytes)}`,
    ].join(' · ')
  })
  const attachmentSummary = computed(() => {
    const parts: string[] = []
    if (images.value.length > 0) parts.push(`${images.value.length} 张图片`)
    if (documents.value.length > 0) parts.push(`${documents.value.length} 个文档`)
    parts.push(`${formatAttachmentBytes(totalAttachmentBytes.value)} / ${formatAttachmentBytes(CHAT_ATTACHMENT_LIMITS.maxTotalBytes)}`)
    return parts.join(' · ')
  })

  function setError(message: string) {
    errorMessage.value = message
  }

  function clearError() {
    errorMessage.value = ''
  }

  function toImageSrc(image: DraftImageAttachment): string {
    return image.previewUrl
  }

  function openFilePicker() {
    if (interactionDisabled.value || !canAddMoreFiles.value) return
    options.fileInputEl.value?.click()
  }

  function releaseComposerPreviews() {
    for (const image of images.value) {
      revokeObjectUrl(image.previewUrl)
    }
  }

  function clearAttachments() {
    if (interactionDisabled.value) return
    releaseComposerPreviews()
    images.value = []
    documents.value = []
    clearError()
  }

  function resetAttachments() {
    releaseComposerPreviews()
    images.value = []
    documents.value = []
    clearError()
  }

  function removeImage(index: number) {
    if (interactionDisabled.value) return
    const [removed] = images.value.splice(index, 1)
    if (removed) {
      revokeObjectUrl(removed.previewUrl)
    }
    clearError()
  }

  function removeDocument(index: number) {
    if (interactionDisabled.value) return
    documents.value.splice(index, 1)
    clearError()
  }

  async function appendFiles(files: File[]) {
    if (interactionDisabled.value || files.length === 0) return

    attachmentsProcessing.value = true

    try {
      const errors: string[] = []
      const nextImages = [...images.value]
      const nextDocuments = [...documents.value]
      let nextTotalBytes = totalAttachmentBytes.value

      for (const file of files) {
        if (file.type.startsWith('image/')) {
          if (nextImages.length >= CHAT_ATTACHMENT_LIMITS.maxImages) {
            errors.push(`图片最多上传 ${CHAT_ATTACHMENT_LIMITS.maxImages} 张`)
            continue
          }
          if (file.size > CHAT_ATTACHMENT_LIMITS.maxImageBytes) {
            errors.push(`${file.name} 超过 ${formatAttachmentBytes(CHAT_ATTACHMENT_LIMITS.maxImageBytes)} 限制`)
            continue
          }
          if (nextTotalBytes + file.size > CHAT_ATTACHMENT_LIMITS.maxTotalBytes) {
            errors.push(`附件总量不能超过 ${formatAttachmentBytes(CHAT_ATTACHMENT_LIMITS.maxTotalBytes)}`)
            continue
          }

          nextImages.push({
            mimeType: file.type || 'image/png',
            file,
            previewUrl: URL.createObjectURL(file),
            size: file.size,
            fileName: file.name,
          })
          nextTotalBytes += file.size
          continue
        }

        if (isDocumentFile(file)) {
          if (nextDocuments.length >= CHAT_ATTACHMENT_LIMITS.maxDocuments) {
            errors.push(`文档最多上传 ${CHAT_ATTACHMENT_LIMITS.maxDocuments} 个`)
            continue
          }
          if (file.size > CHAT_ATTACHMENT_LIMITS.maxDocumentBytes) {
            errors.push(`${file.name} 超过 ${formatAttachmentBytes(CHAT_ATTACHMENT_LIMITS.maxDocumentBytes)} 限制`)
            continue
          }
          if (nextTotalBytes + file.size > CHAT_ATTACHMENT_LIMITS.maxTotalBytes) {
            errors.push(`附件总量不能超过 ${formatAttachmentBytes(CHAT_ATTACHMENT_LIMITS.maxTotalBytes)}`)
            continue
          }

          nextDocuments.push({
            fileName: file.name,
            mimeType: file.type || 'application/octet-stream',
            file,
            size: file.size,
          })
          nextTotalBytes += file.size
          continue
        }

        errors.push(`${file.name}: 不支持的文件类型`)
      }

      if (nextImages.length === images.value.length && nextDocuments.length === documents.value.length) {
        setError(errors[0] ?? '没有可用的文件')
        return
      }

      images.value = nextImages
      documents.value = nextDocuments
      if (errors.length > 0) {
        setError(errors.join('；'))
      } else {
        clearError()
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

  function buildOutgoingImages(): ChatImageAttachment[] {
    return images.value.map((image) => ({
      mimeType: image.mimeType,
      file: image.file,
      size: image.size,
      fileName: image.fileName,
      previewUrl: URL.createObjectURL(image.file),
    }))
  }

  function buildOutgoingDocuments(): ChatDocumentAttachment[] {
    return documents.value.map((doc) => ({
      fileName: doc.fileName,
      mimeType: doc.mimeType,
      file: doc.file,
      size: doc.size,
    }))
  }

  onBeforeUnmount(() => {
    releaseComposerPreviews()
  })

  return {
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
  }
}
