<template>
  <Transition name="diff-dialog">
    <div v-if="pendingApplies.length > 0" class="diff-approval-overlay" @click.self="handleOverlayClick">
      <div class="diff-approval-dialog">
        <!-- 当前工具 -->
        <template v-if="currentTool">
          <!-- Header -->
          <header class="diff-header">
            <div class="diff-header-main">
              <span class="diff-header-tool">{{ currentTool.toolName }}</span>
              <span v-if="currentPreview" class="diff-header-file">{{ currentItem?.filePath || '' }}</span>
              <span v-if="currentItem?.diff" class="diff-header-stats">
                <span class="diff-stat-add">+{{ currentItem.added }}</span>
                <span class="diff-stat-del">-{{ currentItem.removed }}</span>
              </span>
            </div>
            <div v-if="currentPreview && currentPreview.items.length > 1" class="diff-file-nav">
              <button class="diff-nav-btn" type="button" :disabled="currentItemIndex <= 0" @click="currentItemIndex--">◀</button>
              <span class="diff-nav-label">{{ currentItemIndex + 1 }} / {{ currentPreview.items.length }}</span>
              <button class="diff-nav-btn" type="button" :disabled="currentItemIndex >= currentPreview.items.length - 1" @click="currentItemIndex++">▶</button>
            </div>
          </header>

          <!-- Summary -->
          <div v-if="currentPreview?.summary?.length" class="diff-summary">
            <span v-for="(s, i) in currentPreview.summary" :key="i">{{ s }}</span>
          </div>

          <!-- Toolbar -->
          <div class="diff-toolbar">
            <div class="diff-toolbar-group">
              <button
                class="diff-toolbar-btn"
                :class="{ active: viewMode === 'unified' }"
                type="button"
                @click="viewMode = 'unified'"
              >统一</button>
              <button
                class="diff-toolbar-btn"
                :class="{ active: viewMode === 'split' }"
                type="button"
                @click="viewMode = 'split'"
              >分栏</button>
            </div>
            <label class="diff-toolbar-check">
              <input type="checkbox" v-model="showLineNumbers" />
              <span>行号</span>
            </label>
          </div>

          <!-- Loading / Error -->
          <div v-if="previewLoading" class="diff-body diff-loading">加载预览中…</div>
          <div v-else-if="previewError" class="diff-body diff-error">{{ previewError }}</div>

          <!-- Message (no diff) -->
          <div v-else-if="currentItem?.message && !currentItem?.diff" class="diff-body diff-message">
            {{ currentItem.message }}
          </div>

          <!-- Diff Body -->
          <div v-else-if="currentItem?.diff" class="diff-body" :class="viewMode">
            <!-- Unified View -->
            <table v-if="viewMode === 'unified'" class="diff-table">
              <tbody>
                <tr
                  v-for="(line, idx) in parsedLines"
                  :key="idx"
                  class="diff-row"
                  :class="line.type"
                >
                  <td v-if="showLineNumbers" class="diff-gutter diff-gutter-old">{{ line.oldNum ?? '' }}</td>
                  <td v-if="showLineNumbers" class="diff-gutter diff-gutter-new">{{ line.newNum ?? '' }}</td>
                  <td class="diff-prefix">{{ line.prefix }}</td>
                  <td class="diff-content">{{ line.content }}</td>
                </tr>
              </tbody>
            </table>

            <!-- Split View -->
            <div v-else class="diff-split-layout">
              <table class="diff-table diff-table-left">
                <tbody>
                  <tr
                    v-for="(pair, idx) in splitPairs"
                    :key="`l-${idx}`"
                    class="diff-row"
                    :class="pair.left?.type ?? 'empty'"
                  >
                    <td v-if="showLineNumbers" class="diff-gutter">{{ pair.left?.oldNum ?? '' }}</td>
                    <td class="diff-prefix">{{ pair.left?.prefix ?? '' }}</td>
                    <td class="diff-content">{{ pair.left?.content ?? '' }}</td>
                  </tr>
                </tbody>
              </table>
              <table class="diff-table diff-table-right">
                <tbody>
                  <tr
                    v-for="(pair, idx) in splitPairs"
                    :key="`r-${idx}`"
                    class="diff-row"
                    :class="pair.right?.type ?? 'empty'"
                  >
                    <td v-if="showLineNumbers" class="diff-gutter">{{ pair.right?.newNum ?? '' }}</td>
                    <td class="diff-prefix">{{ pair.right?.prefix ?? '' }}</td>
                    <td class="diff-content">{{ pair.right?.content ?? '' }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <!-- Footer -->
          <div class="diff-actions">
            <button class="diff-approval-btn diff-approval-btn--reject" @click="apply(currentTool.id, false)">
              拒绝 <kbd>N</kbd>
            </button>
            <button class="diff-approval-btn diff-approval-btn--apply" @click="apply(currentTool.id, true)">
              应用 <kbd>Y</kbd>
            </button>
          </div>
        </template>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { computed, ref, watch, onMounted, onUnmounted } from 'vue'
import type { ToolInvocation } from '../api/types'
import type { DiffPreviewResponse, DiffPreviewItem } from '../api/client'
import { useToolApproval } from '../composables/useToolApproval'
import * as api from '../api/client'

const { pendingApplies, apply } = useToolApproval()

// ---- 状态 ----

const viewMode = ref<'unified' | 'split'>('unified')
const showLineNumbers = ref(true)
const currentItemIndex = ref(0)
const previewLoading = ref(false)
const previewError = ref('')
const previewCache = ref<Map<string, DiffPreviewResponse>>(new Map())

// ---- 计算属性 ----

const currentTool = computed<ToolInvocation | undefined>(() => pendingApplies.value[0])
const currentPreview = computed<DiffPreviewResponse | undefined>(() =>
  currentTool.value ? previewCache.value.get(currentTool.value.id) : undefined,
)
const currentItem = computed<DiffPreviewItem | undefined>(() => {
  const preview = currentPreview.value
  if (!preview || preview.items.length === 0) return undefined
  const idx = Math.min(currentItemIndex.value, preview.items.length - 1)
  return preview.items[idx]
})

// ---- diff 解析 ----

interface DiffLine {
  type: 'header' | 'hunk' | 'add' | 'del' | 'ctx'
  prefix: string
  content: string
  oldNum?: number
  newNum?: number
}

function parseDiffText(diffText: string): DiffLine[] {
  const lines: DiffLine[] = []
  let oldLine = 0
  let newLine = 0

  for (const raw of diffText.split('\n')) {
    if (raw.startsWith('---') || raw.startsWith('+++')) {
      lines.push({ type: 'header', prefix: '', content: raw })
    } else if (raw.startsWith('@@')) {
      const match = raw.match(/@@ -(\d+)/)
      if (match) {
        oldLine = parseInt(match[1], 10)
        const newMatch = raw.match(/\+(\d+)/)
        newLine = newMatch ? parseInt(newMatch[1], 10) : oldLine
      }
      lines.push({ type: 'hunk', prefix: '', content: raw })
    } else if (raw.startsWith('+')) {
      lines.push({ type: 'add', prefix: '+', content: raw.slice(1), newNum: newLine++ })
    } else if (raw.startsWith('-')) {
      lines.push({ type: 'del', prefix: '-', content: raw.slice(1), oldNum: oldLine++ })
    } else {
      lines.push({ type: 'ctx', prefix: ' ', content: raw.startsWith(' ') ? raw.slice(1) : raw, oldNum: oldLine++, newNum: newLine++ })
    }
  }

  return lines
}

const parsedLines = computed<DiffLine[]>(() => {
  const diff = currentItem.value?.diff
  return diff ? parseDiffText(diff) : []
})

// ---- split view 配对 ----

interface SplitPair {
  left?: DiffLine
  right?: DiffLine
}

const splitPairs = computed<SplitPair[]>(() => {
  const lines = parsedLines.value
  const pairs: SplitPair[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    if (line.type === 'header' || line.type === 'hunk') {
      pairs.push({ left: line, right: line })
      i++
    } else if (line.type === 'ctx') {
      pairs.push({ left: line, right: line })
      i++
    } else if (line.type === 'del') {
      // 收集连续 del，再收集紧跟的 add，配对
      const dels: DiffLine[] = []
      while (i < lines.length && lines[i].type === 'del') { dels.push(lines[i]); i++ }
      const adds: DiffLine[] = []
      while (i < lines.length && lines[i].type === 'add') { adds.push(lines[i]); i++ }
      const maxLen = Math.max(dels.length, adds.length)
      for (let j = 0; j < maxLen; j++) {
        pairs.push({ left: dels[j], right: adds[j] })
      }
    } else if (line.type === 'add') {
      pairs.push({ right: line })
      i++
    } else {
      i++
    }
  }

  return pairs
})

// ---- 加载预览 ----

watch(currentTool, async (tool) => {
  if (!tool) return
  currentItemIndex.value = 0
  if (previewCache.value.has(tool.id)) return

  previewLoading.value = true
  previewError.value = ''
  try {
    const preview = await api.getToolDiffPreview(tool.id)
    previewCache.value.set(tool.id, preview)
  } catch (err) {
    previewError.value = err instanceof Error ? err.message : '加载预览失败'
  } finally {
    previewLoading.value = false
  }
}, { immediate: true })

// ---- 键盘快捷键 ----

function handleKeydown(e: KeyboardEvent) {
  if (pendingApplies.value.length === 0) return
  const target = e.target as HTMLElement
  if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return

  const tool = currentTool.value
  if (!tool) return

  if (e.key === 'y' || e.key === 'Y') {
    e.preventDefault()
    e.stopImmediatePropagation() // 阻止 ToolApprovalBar 的 Y/N 处理器同时触发
    apply(tool.id, true)
  } else if (e.key === 'n' || e.key === 'N') {
    e.preventDefault()
    e.stopImmediatePropagation()
    apply(tool.id, false)
  }
}

// capture: true 确保在 ToolApprovalBar 的 handler 之前执行
onMounted(() => window.addEventListener('keydown', handleKeydown, true))
onUnmounted(() => window.removeEventListener('keydown', handleKeydown, true))

function handleOverlayClick() {
  // 点击 overlay 不关闭，防止误操作
}
</script>
