/**
 * 浏览器本地 API 访问令牌存储
 *
 * 仅保存在当前浏览器 localStorage，用于访问受 Bearer Token 保护的 Web API。
 */

const STORAGE_KEY = 'iris.authToken'
const CHANGE_EVENT = 'iris:auth-token-changed'

function emitTokenChanged(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT))
}

export function loadAuthToken(): string {
  if (typeof window === 'undefined') return ''
  try {
    return window.localStorage.getItem(STORAGE_KEY) || ''
  } catch {
    return ''
  }
}

export function saveAuthToken(token: string): void {
  if (typeof window === 'undefined') return
  const normalized = token.trim()
  try {
    if (normalized) {
      window.localStorage.setItem(STORAGE_KEY, normalized)
    } else {
      window.localStorage.removeItem(STORAGE_KEY)
    }
    emitTokenChanged()
  } catch {
    // 忽略存储失败
  }
}

export function clearAuthToken(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(STORAGE_KEY)
    emitTokenChanged()
  } catch {
    // 忽略存储失败
  }
}

export function subscribeAuthTokenChange(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {}

  const onCustom = () => listener()
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) {
      listener()
    }
  }

  window.addEventListener(CHANGE_EVENT, onCustom)
  window.addEventListener('storage', onStorage)

  return () => {
    window.removeEventListener(CHANGE_EVENT, onCustom)
    window.removeEventListener('storage', onStorage)
  }
}
