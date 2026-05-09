/**
 * 通知 WebSocket composable
 *
 * 管理持久化 WebSocket 连接，用于接收异步子代理任务通知
 * 和空闲时 notification turn 的流式事件。
 */

import { ref, onMounted, onUnmounted, type Ref } from 'vue'
import type { AgentTaskInfo, MilestoneSnapshot, NotificationCallbacks } from '../api/types'
import { loadAuthToken } from '../utils/authToken'

export interface UseNotificationsReturn {
  /** 当前会话正在运行的后台任务 */
  runningTasks: Ref<AgentTaskInfo[]>
  /** 已完成/失败/中止的任务历史 */
  taskHistory: Ref<AgentTaskInfo[]>
  /** WebSocket 连接状态 */
  connected: Ref<boolean>
  /** 订阅指定 session 的事件 */
  subscribe(sessionIds: string[]): void
  /** 订阅全部 session 的事件 */
  subscribeAll(): void
}

export function useNotifications(callbacks?: NotificationCallbacks): UseNotificationsReturn {
  const runningTasks = ref<AgentTaskInfo[]>([])
  const taskHistory = ref<AgentTaskInfo[]>([])
  const connected = ref(false)

  let ws: WebSocket | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let disposed = false

  function getWsUrl(): string {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const token = loadAuthToken().trim()
    const params = token ? `?token=${encodeURIComponent(token)}` : ''
    return `${proto}//${location.host}/ws/notifications${params}`
  }

  function connect(): void {
    if (disposed) return
    try {
      ws = new WebSocket(getWsUrl())
    } catch {
      scheduleReconnect()
      return
    }

    ws.onopen = () => {
      connected.value = true
      // 重连后清空可能过时的 running 状态（断开期间完成的任务无法追踪）
      runningTasks.value = []
      // 默认订阅全部 session
      ws?.send(JSON.stringify({ type: 'subscribe_all' }))
    }

    ws.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data)
        handleEvent(data)
      } catch {
        // 忽略无法解析的消息
      }
    }

    ws.onclose = () => {
      connected.value = false
      ws = null
      scheduleReconnect()
    }

    ws.onerror = () => {
      // onclose 会紧随其后触发
    }
  }

  function handleEvent(event: Record<string, unknown>): void {
    const sessionId = event.sessionId as string | undefined

    if (event.type === 'agent_notification' && sessionId) {
      const taskId = event.taskId as string
      const status = event.status as string
      const summary = event.summary as string

      callbacks?.onAgentNotification?.(sessionId, taskId, status, summary)

      if (status === 'registered') {
        const task: AgentTaskInfo = {
          taskId,
          sessionId,
          description: summary,
          status: 'running',
          startTime: Date.now(),
        }
        runningTasks.value = [...runningTasks.value, task]
      } else {
        // 任务结束（completed/failed/killed）
        runningTasks.value = runningTasks.value.filter(t => t.taskId !== taskId)
        const history = [...taskHistory.value, {
          taskId,
          sessionId,
          description: summary,
          status: status as AgentTaskInfo['status'],
          startTime: 0, // 精确值需要从 REST 查询
          endTime: Date.now(),
        }]
        // 限制历史条目数量，防止长会话内存膨胀
        taskHistory.value = history.length > 100 ? history.slice(-100) : history
      }
    } else if (event.type === 'turn_start' && sessionId) {
      callbacks?.onTurnStart?.(sessionId, event.turnId as string, event.mode as 'chat' | 'task-notification')
    } else if (event.type === 'milestones_update' && sessionId) {
      callbacks?.onMilestonesUpdate?.(sessionId, event.snapshot as MilestoneSnapshot)
    } else if (sessionId) {
      // 标准聊天事件通过 WS 回退接收
      callbacks?.onChatEvent?.(sessionId, event)
    }
  }

  function scheduleReconnect(): void {
    if (disposed || reconnectTimer) return
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      connect()
    }, 3000)
  }

  function subscribe(sessionIds: string[]): void {
    ws?.send(JSON.stringify({ type: 'subscribe', sessionIds }))
  }

  function subscribeAll(): void {
    ws?.send(JSON.stringify({ type: 'subscribe_all' }))
  }

  onMounted(() => {
    connect()
  })

  onUnmounted(() => {
    disposed = true
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    ws?.close()
    ws = null
  })

  return {
    runningTasks,
    taskHistory,
    connected,
    subscribe,
    subscribeAll,
  }
}
