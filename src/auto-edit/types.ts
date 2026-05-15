export const AUTO_EDIT_SERVICE_ID = 'auto-edit';

export interface AutoEditSessionState {
  sessionId: string;
  active: boolean;
  enabledBy: 'user';
  enabledAt?: number;
  updatedAt: number;
}

export interface AutoEditService {
  enable(sessionId: string): AutoEditSessionState;
  disable(sessionId: string): AutoEditSessionState;
  toggle(sessionId: string): AutoEditSessionState;
  isActive(sessionId: string | undefined): boolean;
  getState(sessionId: string | undefined): AutoEditSessionState | null;
  clear(sessionId: string): void;
}

export type AutoEditOperation = 'write' | 'patch' | 'insert' | 'delete_lines';

export interface AutoEditTarget {
  path: string;
  operation: AutoEditOperation;
}

export type AutoEditSafetyCategory =
  | 'outside_workspace'
  | 'symlink_escape'
  | 'sensitive_path'
  | 'windows_special_path'
  | 'unc_path'
  | 'invalid_path';

export type AutoEditPathSafetyResult =
  | {
      ok: true;
      inputPath: string;
      resolvedPath: string;
    }
  | {
      ok: false;
      inputPath: string;
      reason: string;
      category: AutoEditSafetyCategory;
    };

export interface RuntimeApprovalContext {
  sessionId?: string;
  cwd?: string;
  autoEditActive?: boolean;
  planModeActive?: boolean;
  /** 可选动态查询：允许用户在模型生成/工具执行进行中开关 Auto Edit 后立即影响后续工具。 */
  isAutoEditActive?: (sessionId: string | undefined) => boolean;
  /** 可选动态查询：Plan Mode 中 Auto Edit 必须暂停。 */
  isPlanModeActive?: (sessionId: string | undefined) => boolean;
}

export interface AutoEditEvaluation {
  allowed: boolean;
  reason: string;
  targets?: AutoEditTarget[];
}
