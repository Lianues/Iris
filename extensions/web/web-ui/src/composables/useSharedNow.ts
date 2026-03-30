/**
 * 共享时钟
 *
 * 所有组件共用同一个 ref<number> 和同一个 setInterval，
 * 避免每个 MessageBubble 各自创建定时器。
 * 引用计数归零时自动停止。
 */

import { onUnmounted, ref } from 'vue'

const now = ref(Date.now())
let refCount = 0
let timer: ReturnType<typeof setInterval> | undefined

function start() {
  if (!timer) {
    now.value = Date.now()
    timer = setInterval(() => { now.value = Date.now() }, 30_000)
  }
}

function stop() {
  if (timer) {
    clearInterval(timer)
    timer = undefined
  }
}

export function useSharedNow() {
  refCount++
  if (refCount === 1) start()

  onUnmounted(() => {
    refCount--
    if (refCount <= 0) {
      refCount = 0
      stop()
    }
  })

  return { now }
}
