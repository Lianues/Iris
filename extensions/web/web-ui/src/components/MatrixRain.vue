<template>
  <canvas
    ref="canvas"
    class="matrix-rain"
    aria-hidden="true"
    @click="skip"
    @keydown.escape="skip"
  ></canvas>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue'
import { startMatrixRain } from '../utils/matrixRainEngine'

const props = withDefaults(defineProps<{
  active: boolean
  /** 动画总持续时间（毫秒） */
  duration?: number
}>(), {
  duration: 1200,
})

const emit = defineEmits<{
  (e: 'complete'): void
}>()

const canvas = ref<HTMLCanvasElement | null>(null)
let dispose: (() => void) | null = null
let completed = false

function finish() {
  if (completed) return
  completed = true
  stop()
  emit('complete')
}

function skip() {
  finish()
}

function start() {
  stop()
  completed = false
  if (!canvas.value) return
  dispose = startMatrixRain(
    canvas.value,
    { duration: props.duration },
    finish,
  )
}

function stop() {
  dispose?.()
  dispose = null
}

watch(() => props.active, (val) => {
  if (val) start()
  else stop()
})

onMounted(() => {
  if (props.active) start()
})

onUnmounted(stop)
</script>

<style scoped>
.matrix-rain {
  position: fixed;
  inset: 0;
  z-index: 9999;
  pointer-events: auto;
  cursor: pointer;
}
</style>
