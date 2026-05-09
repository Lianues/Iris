import { describe, expect, it, vi } from 'vitest';
import { Backend } from '../src/core/backend/backend.js';
import { SessionMilestoneManager } from '../src/core/session-milestones.js';
import { StorageProvider, type SessionMeta } from '../src/storage/base.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { ToolStateManager } from '../src/tools/state.js';
import { createMilestoneTools } from '../src/tools/internal/milestones.js';
import { PromptAssembler } from '../src/prompt/assembler.js';
import type { Content, LLMRequest, Part } from '../src/types/index.js';

const LONG_TASK_STEPS = 16;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

class InMemoryStorage extends StorageProvider {
  private histories = new Map<string, Content[]>();
  private metas = new Map<string, SessionMeta>();

  async getHistory(sessionId: string): Promise<Content[]> {
    return clone(this.histories.get(sessionId) ?? []);
  }

  async addMessage(sessionId: string, content: Content): Promise<void> {
    const history = this.histories.get(sessionId) ?? [];
    history.push(clone(content));
    this.histories.set(sessionId, history);
  }

  async clearHistory(sessionId: string): Promise<void> {
    this.histories.delete(sessionId);
    this.metas.delete(sessionId);
  }

  async updateLastMessage(sessionId: string, updater: (content: Content) => Content): Promise<void> {
    const history = this.histories.get(sessionId) ?? [];
    if (history.length === 0) return;
    history[history.length - 1] = clone(updater(clone(history[history.length - 1])));
    this.histories.set(sessionId, history);
  }

  async truncateHistory(sessionId: string, keepCount: number): Promise<void> {
    const history = this.histories.get(sessionId) ?? [];
    this.histories.set(sessionId, history.slice(0, keepCount));
  }

  async listSessions(): Promise<string[]> {
    return [...this.histories.keys()];
  }

  async getMeta(sessionId: string): Promise<SessionMeta | null> {
    const meta = this.metas.get(sessionId);
    return meta ? clone(meta) : null;
  }

  async saveMeta(meta: SessionMeta): Promise<void> {
    this.metas.set(meta.id, clone(meta));
  }

  async listSessionMetas(): Promise<SessionMeta[]> {
    return [...this.metas.values()].map(meta => clone(meta));
  }
}

function systemText(request: LLMRequest): string {
  return request.systemInstruction?.parts
    .map((part: Part) => 'text' in part && typeof part.text === 'string' ? part.text : '')
    .join('\n') ?? '';
}

describe('Milestone lifecycle stress', () => {
  it('长任务顺序推进时同 owner 只保留一个 in_progress，其他 owner 不受影响', () => {
    const manager = new SessionMilestoneManager();
    const steps = 40;
    manager.update('stress-session', [
      ...Array.from({ length: steps }, (_, index) => ({
        id: `m${index + 1}`,
        title: `主线步骤 ${index + 1}`,
        status: 'pending' as const,
        owner: 'master',
      })),
      { id: 'worker-active', title: 'Worker 并行步骤', status: 'in_progress' as const, owner: 'worker' },
    ], { sourceAgent: 'master', routeAgent: 'master', replaceAll: true });

    for (let index = 1; index <= steps; index++) {
      const started = manager.update('stress-session', [
        { id: `m${index}`, status: 'in_progress' },
      ], { sourceAgent: 'master', routeAgent: 'master' });
      const masterActive = started.items.filter(item => item.owner === 'master' && item.status === 'in_progress');
      expect(masterActive.map(item => item.id)).toEqual([`m${index}`]);
      expect(started.items.find(item => item.id === 'worker-active')?.status).toBe('in_progress');

      const activeVersion = started.items.find(item => item.id === `m${index}`)!.version;
      const completed = manager.update('stress-session', [
        { id: `m${index}`, status: 'completed', expectedVersion: activeVersion },
      ], { sourceAgent: 'master', routeAgent: 'master' });
      expect(completed.items.find(item => item.id === `m${index}`)?.status).toBe('completed');
      expect(completed.items.filter(item => item.owner === 'master' && item.status === 'in_progress')).toHaveLength(0);
    }

    const finalSnapshot = manager.getSnapshot('stress-session');
    expect(finalSnapshot.stats.total).toBe(steps + 1);
    expect(finalSnapshot.stats.completed).toBe(steps);
    expect(finalSnapshot.items.find(item => item.id === 'worker-active')?.status).toBe('in_progress');
  });

  it('Backend 长任务多轮 update_milestones 后持续刷新生命周期守卫并完成全部步骤', async () => {
    const storage = new InMemoryStorage();
    const milestoneManager = new SessionMilestoneManager();
    const tools = new ToolRegistry();
    const toolState = new ToolStateManager();
    const prompt = new PromptAssembler();
    prompt.setSystemPrompt('stress system');

    const requests: LLMRequest[] = [];
    const router = {
      chat: vi.fn(async (request: LLMRequest) => {
        const callIndex = requests.length;
        requests.push(request);
        const guard = systemText(request);
        expect(guard).toContain('【Iris 进度守卫】');

        if (callIndex === 0) {
          expect(guard).toContain('当前 owner 没有 in_progress');
          expect(guard).toContain('#m1 [pending]');
          return {
            content: {
              role: 'model' as const,
              parts: [{
                functionCall: {
                  name: 'update_milestones',
                  callId: 'start-m1',
                  args: { items: [{ id: 'm1', status: 'in_progress', expectedVersion: 1 }] },
                },
              }],
              createdAt: Date.now(),
            },
            usageMetadata: { totalTokenCount: 100 + callIndex },
          };
        }

        if (callIndex < LONG_TASK_STEPS) {
          const currentStep = callIndex;
          const nextStep = callIndex + 1;
          expect(guard).toContain(`#m${currentStep} [in_progress]`);
          return {
            content: {
              role: 'model' as const,
              parts: [{
                functionCall: {
                  name: 'update_milestones',
                  callId: `complete-m${currentStep}-start-m${nextStep}`,
                  args: {
                    items: [
                      { id: `m${currentStep}`, status: 'completed', expectedVersion: 2 },
                      { id: `m${nextStep}`, status: 'in_progress', expectedVersion: 1 },
                    ],
                  },
                },
              }],
              createdAt: Date.now(),
            },
            usageMetadata: { totalTokenCount: 100 + callIndex },
          };
        }

        if (callIndex === LONG_TASK_STEPS) {
          expect(guard).toContain(`#m${LONG_TASK_STEPS} [in_progress]`);
          return {
            content: {
              role: 'model' as const,
              parts: [{
                functionCall: {
                  name: 'update_milestones',
                  callId: `complete-m${LONG_TASK_STEPS}`,
                  args: { items: [{ id: `m${LONG_TASK_STEPS}`, status: 'completed', expectedVersion: 2 }] },
                },
              }],
              createdAt: Date.now(),
            },
            usageMetadata: { totalTokenCount: 100 + callIndex },
          };
        }

        expect(guard).toContain('当前 owner 没有 in_progress，也没有 pending');
        return {
          content: {
            role: 'model' as const,
            parts: [{ text: '全部步骤已完成' }],
            createdAt: Date.now(),
          },
          usageMetadata: { totalTokenCount: 100 + callIndex },
        };
      }),
      getCurrentModelName: vi.fn(() => 'stress-model'),
      getModelInfo: vi.fn(() => ({})),
    } as any;

    const backend = new Backend(router, storage, tools, toolState, prompt, {
      stream: false,
      maxToolRounds: LONG_TASK_STEPS + 4,
      milestoneManager,
      milestoneRouteAgent: 'master',
      toolsConfig: { permissions: {} },
    });
    backend.on('error', () => {});
    tools.registerAll(createMilestoneTools({
      manager: milestoneManager,
      getSessionId: () => backend.getActiveSessionId(),
      getAgentName: () => 'master',
    }));

    milestoneManager.update('stress-session', Array.from({ length: LONG_TASK_STEPS }, (_, index) => ({
      id: `m${index + 1}`,
      title: `长任务步骤 ${index + 1}`,
      status: 'pending' as const,
      owner: 'master',
    })), { sourceAgent: 'master', routeAgent: 'master', replaceAll: true });

    await backend.chat('stress-session', '执行长任务');

    expect(router.chat).toHaveBeenCalledTimes(LONG_TASK_STEPS + 2);
    const snapshot = milestoneManager.getSnapshot('stress-session');
    expect(snapshot.stats.completed).toBe(LONG_TASK_STEPS);
    expect(snapshot.stats.open).toBe(0);
    expect(snapshot.items.every(item => item.status === 'completed')).toBe(true);
  });
});
