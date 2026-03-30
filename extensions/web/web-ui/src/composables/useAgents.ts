/**
 * 多 Agent 状态管理
 *
 * 管理 Agent 列表、当前选中的 Agent，并同步到 API Client 的 header 注入。
 * 单 Agent 模式下 agents 为空数组，UI 不显示选择器。
 *
 * 注意：不在模块加载时注入 header，而是在 loadAgents() 验证后才激活，
 * 避免 localStorage 中的过期 agent 名污染早期请求（如 getAgents 本身）。
 */

import { ref, computed } from 'vue'
import { getAgents, setCurrentAgentName } from '../api/client'

export interface AgentInfo {
  name: string
  description?: string
}

const STORAGE_KEY = 'iris-current-agent'

// 模块级响应式状态（单例）
const agents = ref<AgentInfo[]>([])
const currentAgent = ref<string | null>(null)
const multiAgentEnabled = computed(() => agents.value.length > 0)

// 从 localStorage 恢复偏好（仅记录值，不立即注入 header）
const _storedPreference = typeof localStorage !== 'undefined'
  ? localStorage.getItem(STORAGE_KEY)
  : null

export function useAgents() {
  /** 从后端加载 Agent 列表并激活 header 注入 */
  async function loadAgents(): Promise<void> {
    try {
      // 不带 X-Agent-Name 请求 agent 列表（此时 header 尚未激活）
      const { agents: list } = await getAgents()
      agents.value = list

      if (list.length === 0) {
        // 单 Agent 模式
        currentAgent.value = null
        setCurrentAgentName(null)
        localStorage.removeItem(STORAGE_KEY)
        return
      }

      // 验证 stored preference 是否仍然有效
      let preferred = _storedPreference
      if (preferred && !list.some(a => a.name === preferred)) {
        preferred = null
      }

      // 如果没有有效偏好，默认选第一个
      currentAgent.value = preferred ?? list[0].name

      // 验证通过后才激活 header 注入
      setCurrentAgentName(currentAgent.value)
      if (currentAgent.value) {
        localStorage.setItem(STORAGE_KEY, currentAgent.value)
      }
    } catch {
      // 可能是旧版后端不支持 /api/agents
      agents.value = []
      setCurrentAgentName(null)
    }
  }

  /** 切换当前 Agent */
  function switchAgent(name: string): void {
    if (!agents.value.some(a => a.name === name)) return
    currentAgent.value = name
    setCurrentAgentName(name)
    localStorage.setItem(STORAGE_KEY, name)
  }

  return {
    agents,
    currentAgent,
    multiAgentEnabled,
    loadAgents,
    switchAgent,
  }
}
