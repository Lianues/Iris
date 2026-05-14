import { getSessionCwd } from '../core/backend/session-context';
import { checkAutoEditPathSafety } from './safety';
import { AUTO_EDIT_SUPPORTED_TOOLS, getAutoEditTargets } from './targets';
import type { AutoEditEvaluation, RuntimeApprovalContext } from './types';

export function evaluateAutoEditApproval(
  toolName: string,
  args: Record<string, unknown>,
  context?: RuntimeApprovalContext,
): AutoEditEvaluation {
  const autoEditActive = context?.isAutoEditActive?.(context.sessionId) ?? context?.autoEditActive;
  const planModeActive = context?.isPlanModeActive?.(context.sessionId) ?? context?.planModeActive;

  if (autoEditActive !== true) {
    return { allowed: false, reason: 'Auto Edit 未开启。' };
  }

  if (planModeActive === true) {
    return { allowed: false, reason: '当前处于 Plan Mode，Auto Edit 暂停生效。' };
  }

  if (!AUTO_EDIT_SUPPORTED_TOOLS.has(toolName)) {
    return { allowed: false, reason: `工具 ${toolName} 不属于 Auto Edit V1 支持范围。` };
  }

  const targets = getAutoEditTargets(toolName, args);
  if (!targets || targets.length === 0) {
    return { allowed: false, reason: '无法识别可自动应用的编辑目标。' };
  }

  const cwd = context?.cwd ?? getSessionCwd();
  for (const target of targets) {
    const safety = checkAutoEditPathSafety(target.path, cwd);
    if (!safety.ok) {
      return { allowed: false, reason: safety.reason, targets };
    }
  }

  return { allowed: true, reason: 'Auto Edit 已确认所有目标均为安全的项目内结构化编辑。', targets };
}
