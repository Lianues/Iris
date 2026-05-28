import type { Content } from '../types';

export const PLAN_MODE_SERVICE_ID = 'plan-mode';

export type PlanModeStateSource = 'manual' | 'tool' | 'history';

export interface PlanSessionState {
  sessionId: string;
  active: boolean;
  planFilePath: string;
  createdAt: number;
  updatedAt: number;
  source?: PlanModeStateSource;
}

export interface PlanModeService {
  enter(sessionId: string, source?: PlanModeStateSource): PlanSessionState;
  /** 用户手动离开 Plan Mode。 */
  leave(sessionId: string): PlanSessionState | null;
  exit(sessionId: string): PlanSessionState | null;
  isActive(sessionId: string | undefined): boolean;
  getState(sessionId: string | undefined): PlanSessionState | null;
  readPlan(sessionId: string): string | null;
  writePlan(sessionId: string, content: string): PlanSessionState;
  getPlanFilePath(sessionId: string): string;
  reconcileWithHistory(sessionId: string, history: Content[]): PlanSessionState | null;
}

export interface PlanApprovalProgress {
  kind: 'plan_approval';
  plan: string;
  planFilePath: string;
}
