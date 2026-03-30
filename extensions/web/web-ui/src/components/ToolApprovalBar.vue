<template>
  <Transition name="approval-bar">
    <div v-if="pendingApprovals.length > 0" class="tool-approval-bar">
      <div
        v-for="tool in pendingApprovals"
        :key="tool.id"
        class="tool-approval-item"
      >
        <div class="tool-approval-info">
          <span class="tool-approval-name">{{ tool.toolName }}</span>
          <span class="tool-approval-args">{{ summarizeArgs(tool.args) }}</span>
        </div>
        <div class="tool-approval-actions">
          <button
            class="tool-approval-btn tool-approval-btn--reject"
            @click="approve(tool.id, false)"
          >
            拒绝 <kbd>N</kbd>
          </button>
          <button
            class="tool-approval-btn tool-approval-btn--approve"
            @click="approve(tool.id, true)"
          >
            批准 <kbd>Y</kbd>
          </button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import { useToolApproval } from '../composables/useToolApproval'

const { pendingApprovals, approve } = useToolApproval()

function summarizeArgs(args: Record<string, unknown>): string {
  const entries = Object.entries(args)
  if (entries.length === 0) return ''
  const parts = entries.slice(0, 3).map(([k, v]) => {
    const val = typeof v === 'string' ? (v.length > 60 ? v.slice(0, 60) + '…' : v) : JSON.stringify(v)
    return `${k}: ${val}`
  })
  if (entries.length > 3) parts.push(`+${entries.length - 3} more`)
  return parts.join(', ')
}

function handleKeydown(e: KeyboardEvent) {
  if (pendingApprovals.value.length === 0) return
  const target = e.target as HTMLElement
  if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return

  const first = pendingApprovals.value[0]
  if (e.key === 'y' || e.key === 'Y') {
    e.preventDefault()
    approve(first.id, true)
  } else if (e.key === 'n' || e.key === 'N') {
    e.preventDefault()
    approve(first.id, false)
  }
}

onMounted(() => window.addEventListener('keydown', handleKeydown))
onUnmounted(() => window.removeEventListener('keydown', handleKeydown))
</script>
