/**
 * 浏览器本地管理令牌存储
 *
 * 仅保存在当前浏览器 localStorage，用于访问受保护的管理接口。
 */

const STORAGE_KEY = 'iris.managementToken'
const CHANGE_EVENT = 'iris:management-token-changed'

/** 触发本页管理令牌变更事件 */
function emitTokenChanged(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT))
}

/** 读取本地管理令牌 */
export function loadManagementToken(): string {
  if (typeof window === 'undefined') return ''
  try {
    return window.localStorage.getItem(STORAGE_KEY) || ''
  } catch {
    return ''
  }
}

/** 保存本地管理令牌 */
export function saveManagementToken(token: string): void {
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

/** 清除本地管理令牌 */
export function clearManagementToken(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(STORAGE_KEY)
    emitTokenChanged()
  } catch {
    // 忽略存储失败
  }
}

/** 订阅管理令牌变化（含跨 tab 的 storage 事件） */
export function subscribeManagementTokenChange(listener: () => void): () => void {
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
