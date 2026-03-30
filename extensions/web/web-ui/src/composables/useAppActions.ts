/**
 * 应用级动作总线
 *
 * 允许任意组件触发 App.vue 级别的动作（如打开设置面板），
 * 无需 provide/inject 或 prop drilling。
 */

type Listener = (section?: string) => void

const settingsListeners = new Set<Listener>()

/** 请求打开设置面板，可选指定滚动到的 section id */
export function requestOpenSettings(section?: string) {
  settingsListeners.forEach(fn => fn(section))
}

/** App.vue 中调用，注册监听 */
export function onOpenSettingsRequest(fn: Listener): () => void {
  settingsListeners.add(fn)
  return () => settingsListeners.delete(fn)
}
