/**
 * 浏览器剪贴板复制工具。
 *
 * 优先使用 Clipboard API；若页面不在安全上下文或浏览器拒绝访问，
 * 则回退到 textarea + execCommand('copy')。
 */

function buildClipboardError(): Error {
  if (typeof window !== 'undefined' && !window.isSecureContext) {
    return new Error('当前页面不是安全上下文，浏览器可能限制剪贴板访问；请改用 HTTPS / localhost，或手动复制。')
  }

  return new Error('浏览器不支持自动复制，请手动复制。')
}

function tryLegacyCopy(text: string): boolean {
  if (typeof document === 'undefined') return false

  const textarea = document.createElement('textarea')
  const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null

  textarea.value = text
  textarea.setAttribute('readonly', 'true')
  textarea.setAttribute('aria-hidden', 'true')
  textarea.style.position = 'fixed'
  textarea.style.top = '0'
  textarea.style.left = '-9999px'
  textarea.style.opacity = '0'
  textarea.style.pointerEvents = 'none'

  document.body.appendChild(textarea)

  try {
    textarea.focus()
    textarea.select()
    textarea.setSelectionRange(0, textarea.value.length)
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    textarea.remove()
    activeElement?.focus()
  }
}

export async function copyTextToClipboard(text: string): Promise<void> {
  let clipboardError: unknown = null

  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return
    } catch (error) {
      clipboardError = error
    }
  }

  if (tryLegacyCopy(text)) {
    return
  }

  if (clipboardError instanceof Error) {
    throw clipboardError
  }

  throw buildClipboardError()
}
