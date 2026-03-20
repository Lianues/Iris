<template>
  <Transition name="diff-dialog">
    <div v-if="pendingApplies.length > 0" class="diff-approval-overlay" @click.self="handleOverlayClick">
      <div class="diff-approval-dialog">
        <div
          v-for="tool in pendingApplies"
          :key="tool.id"
          class="diff-approval-item"
        >
          <header class="diff-approval-header">
            <span class="diff-approval-tool-name">{{ tool.toolName }}</span>
            <span v-if="targetFile(tool)" class="diff-approval-file">{{ targetFile(tool) }}</span>
          </header>

          <pre class="diff-approval-content"><code>{{ formatDiffContent(tool) }}</code></pre>

          <div class="diff-approval-actions">
            <button
              class="diff-approval-btn diff-approval-btn--reject"
              @click="apply(tool.id, false)"
            >
              拒绝
            </button>
            <button
              class="diff-approval-btn diff-approval-btn--apply"
              @click="apply(tool.id, true)"
            >
              应用
            </button>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import type { ToolInvocation } from '../api/types'
import { useToolApproval } from '../composables/useToolApproval'

const { pendingApplies, apply } = useToolApproval()

function targetFile(tool: ToolInvocation): string {
  return (tool.args.file_path ?? tool.args.filePath ?? tool.args.path ?? '') as string
}

function formatDiffContent(tool: ToolInvocation): string {
  const parts: string[] = []
  if (tool.args.old_string != null) {
    parts.push(`--- old\n${tool.args.old_string}`)
    parts.push(`+++ new\n${tool.args.new_string ?? ''}`)
  } else if (tool.args.content != null) {
    const content = String(tool.args.content)
    parts.push(content.length > 2000 ? content.slice(0, 2000) + '\n…(truncated)' : content)
  } else {
    parts.push(JSON.stringify(tool.args, null, 2))
  }
  return parts.join('\n\n')
}

function handleOverlayClick() {
  // 点击 overlay 不关闭，防止误操作
}
</script>
