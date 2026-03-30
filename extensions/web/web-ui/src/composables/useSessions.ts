/**
 * 会话管理组合式函数
 *
 * 模块级响应式状态，所有组件共享同一份数据。
 */

import { ref, watch } from 'vue'
import * as api from '../api/client'
import type { SessionSummary } from '../api/types'

/** 会话摘要列表 */
const sessions = ref<SessionSummary[]>([])

export type SessionActivityState = 'streaming' | 'completed'

/** 会话列表中的生成/完成提示状态 */
const sessionActivity = ref<Record<string, SessionActivityState>>({})
const acknowledgedCompletedSessions = new Set<string>()

/** 当前选中的会话 */
const currentSessionId = ref<string | null>(null)

/** 是否正在加载会话列表 */
const sessionsLoading = ref(false)

/** 会话列表加载错误 */
const sessionsError = ref('')

/** 当前会话列表请求版本号，用于丢弃过期响应 */
let loadVersion = 0

/** 当前进行中的会话列表请求控制器 */
let currentLoadController: AbortController | null = null

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === 'AbortError'
    : error instanceof Error && error.name === 'AbortError'
}

function abortCurrentLoad() {
  if (currentLoadController) {
    currentLoadController.abort()
    currentLoadController = null
  }
}

function setSessionActivity(id: string, state: SessionActivityState) {
  sessionActivity.value = {
    ...sessionActivity.value,
    [id]: state,
  }
}

function clearSessionActivity(id: string) {
  if (!sessionActivity.value[id]) return
  const next = { ...sessionActivity.value }
  delete next[id]
  sessionActivity.value = next
  acknowledgedCompletedSessions.delete(id)
}

function cleanupSessionActivity(sessionIds: string[]) {
  const known = new Set(sessionIds)
  const next: Record<string, SessionActivityState> = {}
  let changed = false

  for (const [id, state] of Object.entries(sessionActivity.value)) {
    if (known.has(id)) {
      next[id] = state
      continue
    }
    acknowledgedCompletedSessions.delete(id)
    changed = true
  }

  if (changed) {
    sessionActivity.value = next
  }
}

watch(currentSessionId, (nextId, previousId) => {
  if (previousId && acknowledgedCompletedSessions.has(previousId)) {
    clearSessionActivity(previousId)
  }

  if (nextId && sessionActivity.value[nextId] === 'completed') {
    acknowledgedCompletedSessions.add(nextId)
  }
})

export function useSessions() {
  async function loadSessions() {
    const version = ++loadVersion
    abortCurrentLoad()

    const controller = new AbortController()
    currentLoadController = controller
    sessionsLoading.value = true
    sessionsError.value = ''

    try {
      const data = await api.getSessions(controller.signal)
      if (version !== loadVersion || controller.signal.aborted) return
      const nextSessions = data.sessions || []
      sessions.value = nextSessions
      cleanupSessionActivity(nextSessions.map(session => session.id))
    } catch (err) {
      if (version !== loadVersion || isAbortError(err)) return
      cleanupSessionActivity(sessions.value.map(session => session.id))
      sessionsError.value = err instanceof Error ? err.message : '加载会话列表失败'
    } finally {
      if (version === loadVersion) {
        sessionsLoading.value = false
        if (currentLoadController === controller) {
          currentLoadController = null
        }
      }
    }
  }

  function newChat() {
    currentSessionId.value = null
  }

  function switchSession(id: string) {
    currentSessionId.value = id
  }

  function markSessionStreaming(id: string) {
    if (!id) return
    acknowledgedCompletedSessions.delete(id)
    setSessionActivity(id, 'streaming')
  }

  function markSessionCompleted(id: string, shouldKeepBadge: boolean) {
    if (!id) return
    if (!shouldKeepBadge) {
      clearSessionActivity(id)
      return
    }

    acknowledgedCompletedSessions.delete(id)
    setSessionActivity(id, 'completed')
  }

  async function removeSession(id: string) {
    await api.deleteSession(id)
    clearSessionActivity(id)
    if (currentSessionId.value === id) {
      currentSessionId.value = null
    }
    await loadSessions()
  }

  return {
    sessions,
    sessionActivity,
    currentSessionId,
    sessionsLoading,
    sessionsError,
    loadSessions,
    newChat,
    switchSession,
    removeSession,
    markSessionStreaming,
    markSessionCompleted,
    clearSessionActivity,
  }
}
