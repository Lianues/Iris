/**
 * 工具审批状态管理
 *
 * 模块级 ref 管理工具调用状态，派生待审批/待应用列表。
 */

import { computed, ref } from 'vue'
import type { ToolInvocation } from '../api/types'
import * as api from '../api/client'

/** 当前所有工具调用 */
const toolInvocations = ref<ToolInvocation[]>([])

/** 待审批（awaiting_approval）的工具调用 */
const pendingApprovals = computed(() =>
  toolInvocations.value.filter(t => t.status === 'awaiting_approval'),
)

/** 待应用（awaiting_apply）的工具调用 */
const pendingApplies = computed(() =>
  toolInvocations.value.filter(t => t.status === 'awaiting_apply'),
)

function setToolInvocations(invocations: ToolInvocation[]) {
  toolInvocations.value = Array.isArray(invocations) ? invocations : []
}

function clearToolState() {
  toolInvocations.value = []
}

/** 正在处理中的审批/应用请求 ID，防止重复提交 */
const inflightIds = new Set<string>()

async function approve(id: string, approved: boolean) {
  if (inflightIds.has(id)) return
  inflightIds.add(id)
  try {
    await api.approveTool(id, approved)
  } catch (err) {
    console.error('[useToolApproval] approve failed:', err)
  } finally {
    inflightIds.delete(id)
  }
}

async function apply(id: string, applied: boolean) {
  if (inflightIds.has(id)) return
  inflightIds.add(id)
  try {
    await api.applyTool(id, applied)
  } catch (err) {
    console.error('[useToolApproval] apply failed:', err)
  } finally {
    inflightIds.delete(id)
  }
}

async function abort(id: string) {
  if (inflightIds.has(id)) return
  inflightIds.add(id)
  try {
    await api.abortTool(id)
  } catch (err) {
    console.error('[useToolApproval] abort failed:', err)
  } finally {
    inflightIds.delete(id)
  }
}

export function useToolApproval() {
  return {
    toolInvocations,
    pendingApprovals,
    pendingApplies,
    setToolInvocations,
    clearToolState,
    approve, apply, abort,
  }
}
