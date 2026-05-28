import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PlanModeManager } from '../src/plan-mode/manager';
import { planModePlugin } from '../src/plan-mode/plugin';
import { clearSessionCwd, initSessionCwd } from '../src/core/backend/session-context';
import type { Content } from '../src/types';

const cleanupDirs: string[] = [];
const cleanupSessionIds: string[] = [];
let seq = 0;

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iris-plan-mode-rewind-'));
  cleanupDirs.push(dir);
  return dir;
}

function makeSession(cwd = makeTempDir()): string {
  const sessionId = `plan-rewind-${Date.now()}-${seq++}`;
  initSessionCwd(sessionId, cwd);
  cleanupSessionIds.push(sessionId);
  return sessionId;
}

function fc(name: string, args: Record<string, unknown> = {}, callId = `${name}-${seq++}`): Content {
  return { role: 'model', parts: [{ functionCall: { name, args, callId } }] as any };
}

function fr(name: string, result: Record<string, unknown>, callId?: string): Content {
  return { role: 'user', parts: [{ functionResponse: { name, callId, response: { result } } }] as any };
}

function enterPair(callId = `enter-${seq++}`): Content[] {
  return [
    fc('EnterPlanMode', {}, callId),
    fr('EnterPlanMode', { entered: true, planFilePath: '/tmp/plan.md' }, callId),
  ];
}

function writePlanPair(content: string, callId = `write-${seq++}`): Content[] {
  return [
    fc('write_plan', { content }, callId),
    fr('write_plan', { success: true, planFilePath: '/tmp/plan.md', bytes: Buffer.byteLength(content, 'utf-8') }, callId),
  ];
}

function exitPair(approvedPlan: string, callId = `exit-${seq++}`): Content[] {
  return [
    fc('ExitPlanMode', {}, callId),
    fr('ExitPlanMode', { approved: true, planFilePath: '/tmp/plan.md', approvedPlan }, callId),
  ];
}

afterEach(() => {
  while (cleanupSessionIds.length > 0) clearSessionCwd(cleanupSessionIds.pop()!);
  while (cleanupDirs.length > 0) fs.rmSync(cleanupDirs.pop()!, { recursive: true, force: true });
});

describe('PlanModeManager history reconciliation', () => {
  it('rewind 到早期 write_plan 后会恢复 active 状态和对应计划内容', () => {
    const manager = new PlanModeManager();
    const sessionId = makeSession();

    manager.enter(sessionId, 'tool');
    manager.writePlan(sessionId, 'future plan');
    manager.exit(sessionId);

    const state = manager.reconcileWithHistory(sessionId, [
      ...enterPair(),
      ...writePlanPair('version 1'),
    ]);

    expect(state?.active).toBe(true);
    expect(state?.source).toBe('history');
    expect(manager.readPlan(sessionId)).toBe('version 1');
  });

  it('history 中有已批准 ExitPlanMode 时会恢复为 inactive 并保留批准计划', () => {
    const manager = new PlanModeManager();
    const sessionId = makeSession();
    const approvedPlan = '# Approved\n\n1. Do it';

    const state = manager.reconcileWithHistory(sessionId, [
      ...enterPair(),
      ...writePlanPair(approvedPlan),
      ...exitPair(approvedPlan),
    ]);

    expect(state?.active).toBe(false);
    expect(manager.readPlan(sessionId)).toBe(approvedPlan);
  });

  it('剩余 history 没有 Plan Mode 记录时会清理工具来源状态和 stale 计划', () => {
    const manager = new PlanModeManager();
    const sessionId = makeSession();

    manager.enter(sessionId, 'tool');
    manager.writePlan(sessionId, 'stale plan');

    const state = manager.reconcileWithHistory(sessionId, []);

    expect(state).toBeNull();
    expect(manager.getState(sessionId)).toBeNull();
    expect(manager.readPlan(sessionId)).toBe('');
  });

  it('read_plan 只恢复计划内容，不会用 active:false 关闭 Plan Mode', () => {
    const manager = new PlanModeManager();
    const sessionId = makeSession();

    const readCallId = `read-${seq++}`;
    const state = manager.reconcileWithHistory(sessionId, [
      ...enterPair(),
      fc('read_plan', {}, readCallId),
      fr('read_plan', { plan: 'observed plan', planFilePath: '/tmp/plan.md', active: false }, readCallId),
    ]);

    expect(state?.active).toBe(true);
    expect(manager.readPlan(sessionId)).toBe('observed plan');
  });

  it('剩余 history 没有 Plan Mode 记录时保留手动 /plan 的 active 状态，但清空 stale 计划', () => {
    const manager = new PlanModeManager();
    const sessionId = makeSession();

    manager.enter(sessionId); // manual source
    manager.writePlan(sessionId, 'manual stale plan');

    const state = manager.reconcileWithHistory(sessionId, []);

    expect(state?.active).toBe(true);
    expect(state?.source).toBe('manual');
    expect(manager.readPlan(sessionId)).toBe('');
  });
});

describe('Plan Mode plugin history mutation wrapping', () => {
  it('rewind 移除 Plan Mode 工具记录后会按最新 history 重建状态', async () => {
    let service: PlanModeManager | undefined;
    const readyCallbacks: Array<(api: any) => void | Promise<void>> = [];
    const context = {
      registerTools() {},
      getServiceRegistry() {
        return {
          register(_id: string, value: PlanModeManager) {
            service = value;
            return { dispose() {} };
          },
        };
      },
      addHook() {},
      trackDisposable() {},
      onReady(callback: (api: any) => void | Promise<void>) {
        readyCallbacks.push(callback);
      },
    };

    planModePlugin.activate(context as any);
    expect(service).toBeDefined();

    const sessionId = makeSession();
    service!.enter(sessionId, 'tool');
    service!.writePlan(sessionId, 'future plan');
    service!.exit(sessionId);

    const historyAfterRewind = [
      ...enterPair(),
      ...writePlanPair('version after rewind'),
    ];
    const removed = exitPair('future plan');

    const backend = {
      getHistory: async () => historyAfterRewind,
      rewind: async (_sessionId?: string, _checkpointId?: string, _mode?: string) => ({
        checkpoint: { id: 'rw:0:1', sessionId, historyIndex: 0, userText: '', preview: '', hasAttachments: false, messageCountAfter: 0 },
        mode: 'conversation',
        keepCount: historyAfterRewind.length,
        removed,
        removedCount: removed.length,
        restoredInputText: '',
      }),
    };
    const api = {
      backend,
      storage: { getHistory: async () => historyAfterRewind },
    };

    for (const callback of readyCallbacks) await callback(api);
    await backend.rewind(sessionId, 'rw:0:1', 'conversation');

    expect(service!.isActive(sessionId)).toBe(true);
    expect(service!.readPlan(sessionId)).toBe('version after rewind');
  });
});
