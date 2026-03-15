import { ref, computed, onBeforeUnmount } from 'vue'
import { copyTextToClipboard } from '../utils/clipboard'

export function useCopyFeedback(idleLabel = '复制', resetMs = 1800) {
  const copyText = ref(idleLabel)
  const copyState = ref<'idle' | 'success' | 'error'>('idle')
  let timer: number | null = null

  const copyStateClass = computed(() => {
    if (copyState.value === 'success') return 'copied'
    if (copyState.value === 'error') return 'error'
    return ''
  })

  function scheduleReset() {
    if (timer !== null) {
      window.clearTimeout(timer)
    }
    timer = window.setTimeout(() => {
      copyText.value = idleLabel
      copyState.value = 'idle'
      timer = null
    }, resetMs)
  }

  async function copy(text: string) {
    try {
      await copyTextToClipboard(text)
      copyText.value = '已复制'
      copyState.value = 'success'
    } catch {
      copyText.value = '复制失败'
      copyState.value = 'error'
    }
    scheduleReset()
  }

  function cleanup() {
    if (timer !== null) {
      window.clearTimeout(timer)
      timer = null
    }
  }

  onBeforeUnmount(cleanup)

  return { copyText, copyState, copyStateClass, copy, cleanup }
}
