<template>
  <Teleport to="body">
    <Transition name="lightbox">
      <div v-if="lightboxOpen" class="lightbox-overlay" @click.self="close" @wheel.prevent="handleWheel">
        <img
          v-if="!imgError"
          class="lightbox-img"
          :src="lightboxSrc"
          :alt="lightboxAlt"
          :style="imgTransform"
          @click.stop
          @error="imgError = true"
        />
        <div v-else class="lightbox-error" @click.stop>图片加载失败</div>

        <div class="lightbox-toolbar" @click.stop>
          <button type="button" title="缩小" @click="zoomOut">
            <span class="material-symbols-outlined">zoom_out</span>
          </button>
          <button type="button" title="放大" @click="zoomIn">
            <span class="material-symbols-outlined">zoom_in</span>
          </button>
          <button type="button" title="重置" @click="reset">
            <span class="material-symbols-outlined">restart_alt</span>
          </button>
          <span class="lightbox-toolbar-divider"></span>
          <button type="button" title="向左旋转" @click="rotateLeft">
            <span class="material-symbols-outlined">rotate_left</span>
          </button>
          <button type="button" title="向右旋转" @click="rotateRight">
            <span class="material-symbols-outlined">rotate_right</span>
          </button>
          <button type="button" title="水平翻转" @click="flipH">
            <span class="material-symbols-outlined">flip</span>
          </button>
          <button type="button" title="垂直翻转" @click="flipV">
            <span class="material-symbols-outlined" style="transform:rotate(90deg)">flip</span>
          </button>
          <span class="lightbox-toolbar-divider"></span>
          <button type="button" title="下载" @click="download">
            <span class="material-symbols-outlined">download</span>
          </button>
        </div>

        <button class="lightbox-close" type="button" aria-label="关闭" @click="close">
          <span class="material-symbols-outlined">close</span>
        </button>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { onBeforeUnmount, ref, computed, watch } from 'vue'
import { lightboxOpen, lightboxSrc, lightboxAlt, closeLightbox } from '../composables/useLightbox'

const imgError = ref(false)
const scale = ref(1)
const rotate = ref(0)
const scaleX = ref(1)
const scaleY = ref(1)

const imgTransform = computed(() => ({
  transform: `scale(${scale.value}) rotate(${rotate.value}deg) scaleX(${scaleX.value}) scaleY(${scaleY.value})`,
}))

function zoomIn() { scale.value = Math.min(5, scale.value + 0.25) }
function zoomOut() { scale.value = Math.max(0.25, scale.value - 0.25) }
function rotateLeft() { rotate.value -= 90 }
function rotateRight() { rotate.value += 90 }
function flipH() { scaleX.value *= -1 }
function flipV() { scaleY.value *= -1 }

function reset() {
  scale.value = 1
  rotate.value = 0
  scaleX.value = 1
  scaleY.value = 1
}

function close() {
  closeLightbox()
}

function download() {
  const src = lightboxSrc.value
  if (!src) return

  try {
    let blobUrl: string
    let ext = 'png'

    if (src.startsWith('data:')) {
      // data URI → Blob
      const match = src.match(/^data:image\/(\w+);base64,/)
      if (match) ext = match[1] === 'jpeg' ? 'jpg' : match[1]
      const byteString = atob(src.split(',')[1])
      const bytes = new Uint8Array(byteString.length)
      for (let i = 0; i < byteString.length; i++) bytes[i] = byteString.charCodeAt(i)
      const blob = new Blob([bytes], { type: `image/${ext}` })
      blobUrl = URL.createObjectURL(blob)
    } else {
      blobUrl = src
    }

    const a = document.createElement('a')
    a.href = blobUrl
    a.download = (lightboxAlt.value || 'image') + `.${ext}`
    a.click()

    if (src.startsWith('data:')) URL.revokeObjectURL(blobUrl)
  } catch {
    // 兜底：直接打开
    window.open(src, '_blank')
  }
}

function handleWheel(e: WheelEvent) {
  if (e.deltaY < 0) zoomIn()
  else zoomOut()
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') close()
}

// 打开时重置变换状态并监听键盘
watch(lightboxOpen, (open) => {
  if (open) {
    reset()
    imgError.value = false
    document.addEventListener('keydown', handleKeydown)
  } else {
    document.removeEventListener('keydown', handleKeydown)
  }
})

onBeforeUnmount(() => document.removeEventListener('keydown', handleKeydown))
</script>
