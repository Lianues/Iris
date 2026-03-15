<template>
  <div class="message-stack" :class="`message-stack-${role}`">
    <div class="message-meta-row">
      <div class="message-meta">{{ roleLabel }}</div>
    </div>

    <div class="image-bubble" :class="`image-bubble-${role}`">
      <img class="image-bubble-img" :src="imageSrc" :alt="altText" loading="lazy" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount } from 'vue'
import { getRoleLabel } from '../utils/role'

const props = defineProps<{
  role: 'user' | 'model'
  mimeType: string
  data?: string
  previewUrl?: string
  revokePreviewOnUnmount?: boolean
}>()

const roleLabel = computed(() => getRoleLabel(props.role))
const imageSrc = computed(() => {
  if (props.previewUrl?.trim()) return props.previewUrl
  return `data:${props.mimeType};base64,${props.data ?? ''}`
})
const altText = computed(() => (props.role === 'user' ? '用户上传的图片' : '模型返回的图片'))

onBeforeUnmount(() => {
  if (props.revokePreviewOnUnmount && props.previewUrl?.startsWith('blob:')) {
    URL.revokeObjectURL(props.previewUrl)
  }
})
</script>
