export const CHAT_ATTACHMENT_LIMITS = {
  maxImages: 4,
  maxImageBytes: 4 * 1024 * 1024,
  maxDocuments: 3,
  maxDocumentBytes: 10 * 1024 * 1024,
  maxTotalBytes: 20 * 1024 * 1024,
  maxMultipartBodyBytes: 24 * 1024 * 1024,
} as const

export function formatAttachmentBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B'
  }

  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unitIndex = 0

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }

  const fractionDigits = value >= 100 || unitIndex === 0
    ? 0
    : value >= 10
      ? 1
      : 2

  return `${value.toFixed(fractionDigits)} ${units[unitIndex]}`
}
