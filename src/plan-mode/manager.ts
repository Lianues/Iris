import * as fs from 'fs';
import * as path from 'path';
import { getRememberedCwd } from '../core/backend/session-context';
import type { Content, FunctionCallPart, FunctionResponsePart } from '../types';
import { isFunctionCallPart, isFunctionResponsePart } from '../types';
import type { PlanModeService, PlanModeStateSource, PlanSessionState } from './types';

const PLAN_TOOL_NAMES = new Set([
  'EnterPlanMode',
  'ExitPlanMode',
  'read_plan',
  'write_plan',
]);

interface PendingPlanToolCall {
  name: string;
  args: Record<string, unknown>;
  callId?: string;
}

interface ReconstructedPlanState {
  sawPlanRecord: boolean;
  active?: boolean;
  planContentKnown: boolean;
  planContent: string;
}

function sanitizeSessionId(sessionId: string): string {
  return sessionId.replace(/[^a-zA-Z0-9_-]/g, '_') || 'session';
}

function cloneState(state: PlanSessionState): PlanSessionState {
  return { ...state };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function unwrapFunctionResponseResult(part: FunctionResponsePart): { result?: Record<string, unknown>; isError: boolean } {
  const response = asRecord(part.functionResponse.response);
  if (!response) return { isError: false };
  const isError = response.error != null;
  const nested = asRecord(response.result);
  return { result: nested ?? response, isError };
}

/**
 * Agent-local Plan Mode 状态管理器。
 *
 * 一个 IrisCore/Agent 拥有一个实例，计划文件保存在当前 session 的项目目录下，
 * 不与其它 Agent 共享状态。
 */
export class PlanModeManager implements PlanModeService {
  private states = new Map<string, PlanSessionState>();

  constructor() {}

  enter(sessionId: string, source: PlanModeStateSource = 'manual'): PlanSessionState {
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
          planFilePath,
          source,
          updatedAt: now,
        }
      : {
          sessionId,
          active: true,
          planFilePath,
          source,
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
    const state = this.states.get(sessionId) ?? this.enter(sessionId, 'tool');
    this.writePlanFile(state.planFilePath, content);
    const updated = {
      ...state,
      updatedAt: Date.now(),
    };
    this.states.set(sessionId, updated);
    return cloneState(updated);
  }

  reconcileWithHistory(sessionId: string, history: Content[]): PlanSessionState | null {
    const reconstructed = this.reconstructFromHistory(history);
    const existing = this.states.get(sessionId);
    const planFilePath = this.getPlanFilePath(sessionId);

    if (!reconstructed.sawPlanRecord) {
      this.writePlanFile(planFilePath, '');
      if (existing?.active === true && existing.source === 'manual') {
        const now = Date.now();
        const state: PlanSessionState = {
          ...existing,
          active: true,
          planFilePath,
          updatedAt: now,
        };
        this.states.set(sessionId, state);
        return cloneState(state);
      }
      this.states.delete(sessionId);
      return null;
    }

    this.writePlanFile(planFilePath, reconstructed.planContentKnown ? reconstructed.planContent : '');
    const now = Date.now();
    const state: PlanSessionState = {
      sessionId,
      active: reconstructed.active === true,
      planFilePath,
      source: 'history',
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.states.set(sessionId, state);
    return cloneState(state);
  }

  getPlanFilePath(sessionId: string): string {
    const projectRoot = getRememberedCwd(sessionId);
    return path.join(projectRoot, '.iris', 'plans', `${sanitizeSessionId(sessionId)}.md`);
  }

  private writePlanFile(planFilePath: string, content: string): void {
    fs.mkdirSync(path.dirname(planFilePath), { recursive: true });
    fs.writeFileSync(planFilePath, content, 'utf-8');
  }

  private reconstructFromHistory(history: Content[]): ReconstructedPlanState {
    const pendingByCallId = new Map<string, PendingPlanToolCall>();
    const pendingByName = new Map<string, PendingPlanToolCall[]>();
    const state: ReconstructedPlanState = {
      sawPlanRecord: false,
      planContentKnown: false,
      planContent: '',
    };

    const rememberCall = (part: FunctionCallPart) => {
      const { name, args, callId } = part.functionCall;
      if (!PLAN_TOOL_NAMES.has(name)) return;
      state.sawPlanRecord = true;
      const call: PendingPlanToolCall = { name, args: args ?? {}, callId };
      if (callId) pendingByCallId.set(callId, call);
      const queue = pendingByName.get(name) ?? [];
      queue.push(call);
      pendingByName.set(name, queue);
    };

    const consumeCall = (part: FunctionResponsePart): PendingPlanToolCall | undefined => {
      const { name, callId } = part.functionResponse;
      if (callId) {
        const matched = pendingByCallId.get(callId);
        if (matched) {
          pendingByCallId.delete(callId);
          const queue = pendingByName.get(matched.name);
          const index = queue?.indexOf(matched) ?? -1;
          if (queue && index >= 0) queue.splice(index, 1);
          return matched;
        }
      }
      const queue = pendingByName.get(name);
      return queue?.shift();
    };

    const applyResponse = (part: FunctionResponsePart) => {
      const name = part.functionResponse.name;
      if (!PLAN_TOOL_NAMES.has(name)) return;
      state.sawPlanRecord = true;
      const call = consumeCall(part);
      const { result, isError } = unwrapFunctionResponseResult(part);
      if (isError || !result) return;

      if (name === 'EnterPlanMode') {
        if (result.entered === true) {
          state.active = true;
        }
        return;
      }

      if (name === 'read_plan') {
        if (typeof result.plan === 'string') {
          state.planContent = result.plan;
          state.planContentKnown = true;
        }
        return;
      }

      if (name === 'write_plan') {
        if (result.success !== true) return;
        state.active = true;
        const content = typeof call?.args.content === 'string' ? call.args.content : undefined;
        if (content !== undefined) {
          state.planContent = content;
          state.planContentKnown = true;
        }
        return;
      }

      if (name === 'ExitPlanMode') {
        if (result.approved === true) {
          state.active = false;
          if (typeof result.approvedPlan === 'string') {
            state.planContent = result.approvedPlan;
            state.planContentKnown = true;
          }
        } else if (result.approved === false) {
          state.active = true;
        }
      }
    };

    for (const content of history) {
      for (const part of content.parts) {
        if (isFunctionCallPart(part)) rememberCall(part);
        if (isFunctionResponsePart(part)) applyResponse(part);
      }
    }

    return state;
  }
}
