<template>
  <div v-if="collapsed" class="tool-block collapsed" :class="type">
    <span class="tool-compact">
      <AppIcon :name="compactIconName" class="tool-compact-icon" />
      <span class="tool-compact-copy">{{ name }}</span>
      <span class="tool-compact-meta">{{ summary }}</span>
    </span>
  </div>
  <div v-else class="tool-block" :class="[type, { open }]">
    <button
      class="tool-header"
      type="button"
      :aria-expanded="open"
      @click="open = !open"
    >
      <span class="tool-leading" :class="type">
        <AppIcon :name="compactIconName" class="tool-leading-icon" />
      </span>
      <div class="tool-header-main">
        <div class="tool-header-topline">
          <span class="tool-kind-chip">{{ type === 'call' ? '工具调用' : '工具结果' }}</span>
          <strong class="tool-name">{{ name }}</strong>
        </div>
        <span class="tool-summary">{{ summary }}</span>
      </div>
      <AppIcon :name="ICONS.common.chevronRight" class="tool-icon" />
    </button>

    <div class="tool-body-wrap">
      <div v-if="open" class="tool-body">
        <div class="tool-body-actions">
          <span class="tool-body-label">结构化内容</span>
          <button class="tool-copy-btn" :class="copyStateClass" type="button" @click.stop="copyToolData">
            <AppIcon :name="ICONS.common.copy" class="tool-copy-icon" />
            <span>{{ copyText }}</span>
          </button>
        </div>
        <div class="tool-pre" role="presentation">
          <div v-for="line in formattedLines" :key="line.index" class="tool-pre-line">
            <span class="tool-pre-line-number">{{ line.number }}</span>
            <span class="tool-pre-line-content">{{ line.content || '\u200B' }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import AppIcon from './AppIcon.vue'
import { ICONS } from '../constants/icons'
import { useCopyFeedback } from '../composables/useCopyFeedback'

const props = defineProps<{
  type: 'call' | 'response'
  name: string
  data: unknown
  collapsed?: boolean
}>()

const open = ref(false)
const { copyText, copyStateClass, copy } = useCopyFeedback('复制内容')

const compactIconName = computed(() => (props.type === 'call' ? ICONS.tool.call : ICONS.tool.response))

function formatToolData(value: unknown): string {
  if (typeof value === 'string') return value
  return JSON.stringify(value ?? null, null, 2)
}

function summarizeToolData(value: unknown): string {
  if (Array.isArray(value)) {
    return `${value.length} 项`
  }
  if (value && typeof value === 'object') {
    return `${Object.keys(value as Record<string, unknown>).length} 个字段`
  }
  if (typeof value === 'string') {
    return `${value.length} 字符`
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return '标量结果'
  }
  return '空结果'
}

const formatted = computed(() => formatToolData(props.data))
const summary = computed(() => summarizeToolData(props.data))

const formattedLines = computed(() => {
  const lines = formatted.value.replace(/\r\n?/g, '\n').split('\n')
  const totalLines = Math.max(1, lines.length)
  const width = String(totalLines).length

  return (lines.length > 0 ? lines : ['']).map((content, index) => ({
    index,
    number: String(index + 1).padStart(width, ' '),
    content,
  }))
})

async function copyToolData() {
  await copy(formatted.value)
}
</script>
