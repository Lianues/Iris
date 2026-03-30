/**
 * 主题管理组合式函数
 *
 * 支持暗色、浅色、跟随系统三种模式。
 * 使用 localStorage 持久化用户选择，通过 data-theme 属性切换 CSS 变量。
 */

import { ref, computed, watch } from 'vue'

export type ThemeMode = 'dark' | 'light' | 'system'

const STORAGE_KEY = 'iris-theme'

const mediaQuery = window.matchMedia('(prefers-color-scheme: light)')

/** 系统是否偏好浅色（响应式，确保 computed 能感知变化） */
const systemPrefersLight = ref(mediaQuery.matches)

mediaQuery.addEventListener('change', (e) => {
  systemPrefersLight.value = e.matches
})

/** 用户选择的主题模式 */
const theme = ref<ThemeMode>(loadTheme())

/** 实际生效的主题（system 解析为 dark 或 light） */
const resolvedTheme = computed<'dark' | 'light'>(() => {
  if (theme.value === 'system') {
    return systemPrefersLight.value ? 'light' : 'dark'
  }
  return theme.value
})

function loadTheme(): ThemeMode {
  const saved = localStorage.getItem(STORAGE_KEY)
  if (saved === 'dark' || saved === 'light' || saved === 'system') return saved
  return 'light'
}

function applyTheme() {
  document.documentElement.dataset.theme = resolvedTheme.value
}

function setTheme(mode: ThemeMode) {
  theme.value = mode
  localStorage.setItem(STORAGE_KEY, mode)
}

// 监听 resolvedTheme 变化自动应用（systemPrefersLight 变化时 computed 自动重算）
watch(resolvedTheme, applyTheme)

// 立即应用，防止闪屏
applyTheme()

export function useTheme() {
  return { theme, resolvedTheme, setTheme }
}
