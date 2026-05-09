import { describe, expect, it, vi } from 'vitest';
import { Backend } from '../src/core/backend/backend.js';
import { SessionMilestoneManager } from '../src/core/session-milestones.js';
import { StorageProvider, type SessionMeta } from '../src/storage/base.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { ToolStateManager } from '../src/tools/state.js';
import { createMilestoneTools } from '../src/tools/internal/milestones.js';
import { PromptAssembler } from '../src/prompt/assembler.js';
import type { Content, LLMRequest, Part } from '../src/types/index.js';

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

function createBackend(storage: InMemoryStorage, milestoneManager: SessionMilestoneManager, router: any): { backend: Backend; tools: ToolRegistry } {
  const tools = new ToolRegistry();
  const prompt = new PromptAssembler();
  prompt.setSystemPrompt('final guard system');
  const backend = new Backend(
    router,
    storage,
    tools,
    new ToolStateManager(),
    prompt,
    {
      stream: false,
      maxToolRounds: 8,
      milestoneManager,
      milestoneRouteAgent: 'master',
      toolsConfig: { permissions: {} },
    },
  );
  backend.on('error', () => {});
  tools.registerAll(createMilestoneTools({
    manager: milestoneManager,
    getSessionId: () => backend.getActiveSessionId(),
    getAgentName: () => 'master',
  }));
  return { backend, tools };
}

describe('Milestone final guard', () => {
  it('最终回复前有 open milestone 时追加强检查并给模型一次修正机会', async () => {
    const storage = new InMemoryStorage();
    const milestoneManager = new SessionMilestoneManager();
    const requests: LLMRequest[] = [];
    const router = {
      chat: vi.fn(async (request: LLMRequest) => {
        const callIndex = requests.length;
        requests.push(request);
        const guard = systemText(request);

        if (callIndex === 0) {
          expect(guard).toContain('【Iris 进度守卫】');
          expect(guard).not.toContain('【Iris 最终进度检查】');
          return {
            content: {
              role: 'model' as const,
              parts: [{ text: '我已经全部完成了。' }],
              createdAt: Date.now(),
            },
            usageMetadata: { totalTokenCount: 101 },
          };
        }

        if (callIndex === 1) {
        expect(guard).toContain('【Iris 最终进度检查】');
        expect(guard).toContain('#m1 [in_progress]');
        return {
          content: {
            role: 'model' as const,
            parts: [{
              functionCall: {
                name: 'update_milestones',
                callId: 'complete-m1',
                args: { items: [{ id: 'm1', status: 'completed', expectedVersion: 1 }] },
              },
            }],
            createdAt: Date.now(),
          },
          usageMetadata: { totalTokenCount: 102 },
        };
        }

        return {
          content: {
            role: 'model' as const,
            parts: [{ text: '已更新进度，全部完成。' }],
            createdAt: Date.now(),
          },
          usageMetadata: { totalTokenCount: 103 },
        };
      }),
      getCurrentModelName: vi.fn(() => 'final-guard-model'),
      getModelInfo: vi.fn(() => ({})),
    } as any;
    const { backend } = createBackend(storage, milestoneManager, router);

    milestoneManager.update('s1', [
      { id: 'm1', title: '实现最终检查', status: 'in_progress', owner: 'master' },
    ], { sourceAgent: 'master', routeAgent: 'master', replaceAll: true });

    await backend.chat('s1', '收尾');

    expect(router.chat).toHaveBeenCalledTimes(3);
    const history = await storage.getHistory('s1');
    const visibleModelTexts = history
      .filter(item => item.role === 'model')
      .flatMap(item => item.parts)
      .filter((part): part is { text: string } => 'text' in part && typeof part.text === 'string')
      .map(part => part.text);
    expect(visibleModelTexts).not.toContain('我已经全部完成了。');
    expect(visibleModelTexts.at(-1)).toBe('已更新进度，全部完成。');
    expect(milestoneManager.getSnapshot('s1').stats.open).toBe(0);
  });

  it('如果模型在强检查后选择说明剩余项而不更新状态，只额外提醒一次避免死循环', async () => {
    const storage = new InMemoryStorage();
    const milestoneManager = new SessionMilestoneManager();
    const requests: LLMRequest[] = [];
    const router = {
      chat: vi.fn(async (request: LLMRequest) => {
        const callIndex = requests.length;
        requests.push(request);
        const guard = systemText(request);
        if (callIndex === 0) {
          return {
            content: {
              role: 'model' as const,
              parts: [{ text: '全部完成。' }],
              createdAt: Date.now(),
            },
            usageMetadata: { totalTokenCount: 201 },
          };
        }
        expect(guard).toContain('【Iris 最终进度检查】');
        return {
          content: {
            role: 'model' as const,
            parts: [{ text: '还有 #m1 未完成，我会在后续继续处理。' }],
            createdAt: Date.now(),
          },
          usageMetadata: { totalTokenCount: 202 },
        };
      }),
      getCurrentModelName: vi.fn(() => 'final-guard-model'),
      getModelInfo: vi.fn(() => ({})),
    } as any;
    const { backend } = createBackend(storage, milestoneManager, router);

    milestoneManager.update('s1', [
      { id: 'm1', title: '剩余工作', status: 'pending', owner: 'master' },
    ], { sourceAgent: 'master', routeAgent: 'master', replaceAll: true });

    await backend.chat('s1', '收尾');

    expect(router.chat).toHaveBeenCalledTimes(2);
    expect(milestoneManager.getSnapshot('s1').stats.open).toBe(1);
    const history = await storage.getHistory('s1');
    const finalText = history
      .filter(item => item.role === 'model')
      .flatMap(item => item.parts)
      .findLast((part): part is { text: string } => 'text' in part && typeof part.text === 'string')?.text;
    expect(finalText).toContain('未完成');
  });
});
