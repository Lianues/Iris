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
      <AppIcon :name="ICONS.common.chevronRight" class="tool-icon" />
      <div class="tool-header-main">
        <span class="tool-label">{{ type === 'call' ? '工具调用' : '工具结果' }}</span>
        <strong class="tool-name">{{ name }}</strong>
      </div>
      <div class="tool-header-side">
        <span class="tool-state">{{ summary }}</span>
        <span class="tool-toggle-text">{{ open ? '收起' : '展开' }}</span>
      </div>
    </button>

    <div class="tool-body-wrap">
      <div class="tool-body">
        <div class="tool-body-actions">
          <span class="tool-body-label">结构化内容</span>
          <button class="tool-copy-btn" :class="copyStateClass" type="button" @click.stop="copyToolData">
            <AppIcon :name="ICONS.common.copy" class="tool-copy-icon" />
            <span>{{ copyText }}</span>
          </button>
        </div>
        <pre class="tool-pre"><code>{{ formatted }}</code></pre>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import AppIcon from './AppIcon.vue'
import { ICONS } from '../constants/icons'

const props = defineProps<{
  type: 'call' | 'response'
  name: string
  data: unknown
  collapsed?: boolean
}>()

const open = ref(false)
const copyText = ref('复制内容')
const copyState = ref<'idle' | 'success' | 'error'>('idle')
let copyTimer: number | null = null

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
const copyStateClass = computed(() => {
  if (copyState.value === 'success') return 'copied'
  if (copyState.value === 'error') return 'error'
  return ''
})

function scheduleCopyReset() {
  if (copyTimer !== null) {
    window.clearTimeout(copyTimer)
  }
  copyTimer = window.setTimeout(() => {
    copyText.value = '复制内容'
    copyState.value = 'idle'
    copyTimer = null
  }, 1800)
}

async function copyToolData() {
  try {
    await navigator.clipboard.writeText(formatted.value)
    copyText.value = '已复制'
    copyState.value = 'success'
  } catch {
    copyText.value = '复制失败'
    copyState.value = 'error'
  }
  scheduleCopyReset()
}

onBeforeUnmount(() => {
  if (copyTimer !== null) {
    window.clearTimeout(copyTimer)
  }
})
</script>
