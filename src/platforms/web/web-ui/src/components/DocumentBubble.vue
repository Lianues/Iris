<template>
  <div class="message-stack" :class="`message-stack-${role}`">
    <div class="message-meta-row">
      <div class="message-meta">{{ roleLabel }}</div>
    </div>

    <div class="doc-bubble" :class="`doc-bubble-${role}`">
      <AppIcon :name="ICONS.common.document" class="doc-bubble-icon" />
      <div class="doc-bubble-info">
        <span class="doc-bubble-name">{{ displayName }}</span>
        <span class="doc-bubble-type">{{ typeLabel }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import AppIcon from './AppIcon.vue'
import { ICONS } from '../constants/icons'
import { getRoleLabel } from '../utils/role'

const props = defineProps<{
  role: 'user' | 'model'
  mimeType: string
  data?: string
  fileName?: string
}>()

const roleLabel = computed(() => getRoleLabel(props.role))

const MIME_LABELS: Record<string, string> = {
  'application/pdf': 'PDF 文档',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word 文档',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'PowerPoint 演示文稿',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'Excel 表格',
  'application/vnd.ms-excel': 'Excel 表格',
}

const typeLabel = computed(() => MIME_LABELS[props.mimeType] ?? '文档')

const EXT_MAP: Record<string, string> = {
  'application/pdf': '.pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.ms-excel': '.xls',
}

const displayName = computed(() => {
  if (props.fileName) return props.fileName
  const ext = EXT_MAP[props.mimeType] ?? ''
  return `文档${ext}`
})
</script>
