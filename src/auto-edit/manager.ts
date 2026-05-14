import type { AutoEditService, AutoEditSessionState } from './types';

function cloneState(state: AutoEditSessionState): AutoEditSessionState {
  return { ...state };
}

/**
 * 当前 Agent 内的 session-local Auto Edit 状态管理器。
 *
 * Auto Edit 是用户显式开启的运行时审批档位，不写入 tools.yaml，
 * 也不自动继承到其它 Agent 或后台委派 session。
 */
export class AutoEditManager implements AutoEditService {
  private states = new Map<string, AutoEditSessionState>();

  enable(sessionId: string): AutoEditSessionState {
    const existing = this.states.get(sessionId);
    const now = Date.now();
    const state: AutoEditSessionState = {
      sessionId,
      active: true,
      enabledBy: 'user',
      enabledAt: existing?.enabledAt ?? now,
      updatedAt: now,
    };
    this.states.set(sessionId, state);
    return cloneState(state);
  }

  disable(sessionId: string): AutoEditSessionState {
    const existing = this.states.get(sessionId);
    const now = Date.now();
    const state: AutoEditSessionState = {
      sessionId,
      active: false,
      enabledBy: 'user',
      enabledAt: existing?.enabledAt,
      updatedAt: now,
    };
    this.states.set(sessionId, state);
    return cloneState(state);
  }

  toggle(sessionId: string): AutoEditSessionState {
    return this.isActive(sessionId) ? this.disable(sessionId) : this.enable(sessionId);
  }

  isActive(sessionId: string | undefined): boolean {
    return !!sessionId && this.states.get(sessionId)?.active === true;
  }

  getState(sessionId: string | undefined): AutoEditSessionState | null {
    if (!sessionId) return null;
    const state = this.states.get(sessionId);
    return state ? cloneState(state) : null;
  }

  clear(sessionId: string): void {
    this.states.delete(sessionId);
  }
}
