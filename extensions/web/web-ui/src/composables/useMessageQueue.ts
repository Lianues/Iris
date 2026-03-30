/**
 * 消息队列组合式函数
 *
 * 模块级 ref 管理队列状态，所有组件共享同一份数据。
 * 参考 TUI 的 src/platforms/console/hooks/use-message-queue.ts，
 * 但使用 Vue 响应式 API。
 *
 * 在 AI 生成回复期间，用户的新消息入队；
 * 回复完成后（useChat.onDone），自动出队发送下一条。
 */

import { computed, ref } from 'vue'

export interface QueuedMessage {
  id: string
  text: string
  createdAt: number
}

let _idCounter = 0

/** 模块级队列状态，所有 useMessageQueue() 调用共享 */
const queue = ref<QueuedMessage[]>([])

export function useMessageQueue() {
  /** 入队到末尾 */
  function enqueue(text: string): QueuedMessage {
    const msg: QueuedMessage = {
      id: `q-${++_idCounter}`,
      text,
      createdAt: Date.now(),
    }
    queue.value = [...queue.value, msg]
    return msg
  }

  /** 出队（FIFO），队列空时返回 undefined */
  function dequeue(): QueuedMessage | undefined {
    if (queue.value.length === 0) return undefined
    const [first, ...rest] = queue.value
    queue.value = rest
    return first
  }

  /** 移除指定消息 */
  function remove(id: string): boolean {
    const before = queue.value.length
    queue.value = queue.value.filter(m => m.id !== id)
    return queue.value.length < before
  }

  /** 清空队列 */
  function clear() {
    queue.value = []
  }

  /** 重排序：将 fromIndex 位置的消息移动到 toIndex */
  function reorder(fromIndex: number, toIndex: number) {
    const list = [...queue.value]
    if (fromIndex < 0 || fromIndex >= list.length) return
    if (toIndex < 0 || toIndex >= list.length) return
    if (fromIndex === toIndex) return
    const [moved] = list.splice(fromIndex, 1)
    list.splice(toIndex, 0, moved)
    queue.value = list
  }

  /** 更新指定消息的文本 */
  function update(id: string, newText: string): boolean {
    const idx = queue.value.findIndex(m => m.id === id)
    if (idx === -1) return false
    const list = [...queue.value]
    list[idx] = { ...list[idx], text: newText }
    queue.value = list
    return true
  }

  /** 队列长度（computed） */
  const size = computed(() => queue.value.length)

  return { queue, enqueue, dequeue, remove, clear, reorder, update, size }
}
