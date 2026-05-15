export const PLAN_MODE_SERVICE_ID = 'plan-mode';

export interface PlanSessionState {
  sessionId: string;
  active: boolean;
  planFilePath: string;
  createdAt: number;
  updatedAt: number;
  /** 是否曾通过 ExitPlanMode 获得用户批准并退出。 */
  hasExited?: boolean;
  /** true 时下一次非 Plan Mode LLM 请求收到一次性退出提醒。 */
  needsExitReminder?: boolean;
}

export interface PlanModeService {
  enter(sessionId: string): PlanSessionState;
  /** 用户手动离开 Plan Mode，不注入“计划已批准”提醒。 */
  leave(sessionId: string): PlanSessionState | null;
  exit(sessionId: string): PlanSessionState | null;
  consumeExitReminder?(sessionId: string): PlanSessionState | null;
  isActive(sessionId: string | undefined): boolean;
  getState(sessionId: string | undefined): PlanSessionState | null;
  readPlan(sessionId: string): string | null;
  writePlan(sessionId: string, content: string): PlanSessionState;
  getPlanFilePath(sessionId: string): string;
}

export interface PlanApprovalProgress {
  kind: 'plan_approval';
  plan: string;
  planFilePath: string;
}
