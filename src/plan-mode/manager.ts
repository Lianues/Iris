import * as fs from 'fs';
import * as path from 'path';
import { getRememberedCwd } from '../core/backend/session-context';
import type { PlanModeService, PlanSessionState } from './types';

function sanitizeSessionId(sessionId: string): string {
  return sessionId.replace(/[^a-zA-Z0-9_-]/g, '_') || 'session';
}

function cloneState(state: PlanSessionState): PlanSessionState {
  return { ...state };
}

/**
 * Agent-local Plan Mode 状态管理器。
 *
 * 一个 IrisCore/Agent 拥有一个实例，计划文件保存在该 Agent 的插件数据目录中，
 * 不污染项目目录，也不与其它 Agent 共享状态。
 */
export class PlanModeManager implements PlanModeService {
  private states = new Map<string, PlanSessionState>();

  constructor() {}

  enter(sessionId: string): PlanSessionState {
    const existing = this.states.get(sessionId);
    const now = Date.now();
    const planFilePath = this.getPlanFilePath(sessionId);
    fs.mkdirSync(path.dirname(planFilePath), { recursive: true });
    if (!fs.existsSync(planFilePath)) {
      fs.writeFileSync(planFilePath, '', 'utf-8');
    }

    const state: PlanSessionState = existing
      ? {
          ...existing,
          active: true,
          updatedAt: now,
        }
      : {
          sessionId,
          active: true,
          planFilePath,
          createdAt: now,
          updatedAt: now,
        };

    this.states.set(sessionId, state);
    return cloneState(state);
  }

  leave(sessionId: string): PlanSessionState | null {
    const existing = this.states.get(sessionId);
    if (!existing) return null;
    const state: PlanSessionState = {
      ...existing,
      active: false,
      updatedAt: Date.now(),
    };
    this.states.set(sessionId, state);
    return cloneState(state);
  }

  exit(sessionId: string): PlanSessionState | null {
    const existing = this.states.get(sessionId);
    if (!existing) return null;
    const state: PlanSessionState = {
      ...existing,
      active: false,
      updatedAt: Date.now(),
    };
    this.states.set(sessionId, state);
    return cloneState(state);
  }

  isActive(sessionId: string | undefined): boolean {
    return !!sessionId && this.states.get(sessionId)?.active === true;
  }

  getState(sessionId: string | undefined): PlanSessionState | null {
    if (!sessionId) return null;
    const state = this.states.get(sessionId);
    return state ? cloneState(state) : null;
  }

  readPlan(sessionId: string): string | null {
    const state = this.states.get(sessionId);
    const filePath = state?.planFilePath ?? this.getPlanFilePath(sessionId);
    try {
      return fs.readFileSync(filePath, 'utf-8');
    } catch {
      return null;
    }
  }

  writePlan(sessionId: string, content: string): PlanSessionState {
    const state = this.states.get(sessionId) ?? this.enter(sessionId);
    fs.mkdirSync(path.dirname(state.planFilePath), { recursive: true });
    fs.writeFileSync(state.planFilePath, content, 'utf-8');
    const updated = {
      ...state,
      updatedAt: Date.now(),
    };
    this.states.set(sessionId, updated);
    return cloneState(updated);
  }

  getPlanFilePath(sessionId: string): string {
    const projectRoot = getRememberedCwd(sessionId);
    return path.join(projectRoot, '.iris', 'plans', `${sanitizeSessionId(sessionId)}.md`);
  }
}
