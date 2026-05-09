import { classifyCommand as classifyPowerShellCommand } from '../tools/internal/shell/whitelist';
import { classifyCommand as classifyBashCommand } from '../tools/internal/bash/whitelist';

export interface GuardDecision {
  allowed: boolean;
  reason?: string;
}

const READ_ONLY_TOOLS = new Set([
  'read_file',
  'find_files',
  'list_files',
  'read_skill',
  'history_search',
  'memory_search',
]);

const PLAN_TOOLS = new Set([
  'EnterPlanMode',
  'ExitPlanMode',
  'read_plan',
  'write_plan',
  'AskQuestionFirst',
]);

const BLOCKED_IN_PLAN = new Set([
  'write_file',
  'apply_diff',
  'insert_code',
  'delete_code',
  'delete_file',
  'create_directory',
  'manage_variables',
  'invoke_skill',
  'delegate_to_agent',
  'query_delegated_task',
  'sub_agent',
  'memory_add',
  'memory_update',
  'memory_delete',
]);

export function isAllowedPlanModeTool(toolName: string, args: Record<string, unknown>): GuardDecision {
  if (PLAN_TOOLS.has(toolName)) return { allowed: true };
  if (READ_ONLY_TOOLS.has(toolName)) return { allowed: true };

  if (toolName === 'search_in_files') {
    const mode = typeof args.mode === 'string' ? args.mode : 'search';
    if (mode === 'replace') {
      return { allowed: false, reason: 'Plan Mode 下禁止使用 search_in_files.replace 修改业务文件，请使用 write_plan 更新计划。' };
    }
    return { allowed: true };
  }

  if (toolName === 'shell' || toolName === 'bash') {
    const command = typeof args.command === 'string' ? args.command : '';
    const classification = toolName === 'shell'
      ? classifyPowerShellCommand(command)
      : classifyBashCommand(command);
    if (classification === 'allow') return { allowed: true };
    return {
      allowed: false,
      reason: 'Plan Mode 下只允许静态白名单判定为只读安全的 shell/bash 命令；请改用 read_file/search/list 等只读工具，或退出 Plan Mode 后执行。',
    };
  }

  if (toolName === 'memory_add' || toolName === 'memory_update' || toolName === 'memory_delete') {
    return {
      allowed: false,
      reason: 'Plan Mode 下只允许读取长期记忆（memory_search），禁止新增、更新或删除记忆。',
    };
  }

  if (BLOCKED_IN_PLAN.has(toolName)) {
    return { allowed: false, reason: `Plan Mode 下禁止调用 ${toolName} 修改业务或跨 Agent 执行；请先完善计划并调用 ExitPlanMode。` };
  }

  return { allowed: false, reason: `Plan Mode 下默认只允许只读工具和计划工具；${toolName} 未在允许列表中。` };
}

export function filterToolDeclarationsForPlanMode<T extends { name: string }>(declarations: T[]): T[] {
  return declarations.filter((decl) => {
    const name = decl.name;
    return PLAN_TOOLS.has(name)
      || READ_ONLY_TOOLS.has(name)
      || name === 'search_in_files'
      || name === 'shell'
      || name === 'bash';
  });
}
