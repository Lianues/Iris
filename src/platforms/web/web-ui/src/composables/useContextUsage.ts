/**
 * 上下文窗口用量追踪
 *
 * 模块级 ref 管理 token 用量，派生百分比和标签。
 */

import { computed, ref } from 'vue'
import type { UsageMetadata } from '../api/types'

/** 当前累计 token 数 */
const totalTokenCount = ref(0)

/** 模型上下文窗口大小 */
const contextWindow = ref(0)

/** 用量百分比 (0-100) */
const usagePercent = computed(() => {
  if (contextWindow.value <= 0) return 0
  return Math.min(100, Math.round((totalTokenCount.value / contextWindow.value) * 1000) / 10)
})

/** 格式化的用量标签 */
const usageLabel = computed(() => {
  const fmt = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
  if (contextWindow.value <= 0) return `ctx ${fmt(totalTokenCount.value)}`
  return `ctx ${fmt(totalTokenCount.value)} / ${fmt(contextWindow.value)} (${usagePercent.value}%)`
})

function setUsage(usage: UsageMetadata) {
  if (usage && typeof usage.totalTokenCount === 'number') {
    totalTokenCount.value = usage.totalTokenCount
  }
}

function setContextWindow(size: number) {
  contextWindow.value = size
}

export function useContextUsage() {
  return {
    totalTokenCount,
    contextWindow,
    usagePercent,
    usageLabel,
    setUsage,
    setContextWindow,
  }
}
