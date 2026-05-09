export const PLAN_MODE_SERVICE_ID = 'plan-mode';

export interface PlanSessionState {
  sessionId: string;
  active: boolean;
  planFilePath: string;
  createdAt: number;
  updatedAt: number;
}

export interface PlanModeService {
  enter(sessionId: string): PlanSessionState;
  /** 用户手动离开 Plan Mode，不注入“计划已批准”提醒。 */
  leave(sessionId: string): PlanSessionState | null;
  exit(sessionId: string): PlanSessionState | null;
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
