import { describe, expect, it, vi } from 'vitest';
import { Backend } from '../src/core/backend/backend.js';
import { SessionMilestoneManager } from '../src/core/session-milestones.js';
import { StorageProvider, type SessionMeta } from '../src/storage/base.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { ToolStateManager } from '../src/tools/state.js';
import { PromptAssembler } from '../src/prompt/assembler.js';
import type { Content, LLMRequest } from '../src/types/index.js';

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

function createBackend(storage: InMemoryStorage, milestoneManager: SessionMilestoneManager): Backend {
  const router = {
    chat: vi.fn(async (_request: LLMRequest) => ({
      content: {
        role: 'model' as const,
        parts: [{ text: 'ok' }],
        createdAt: Date.now(),
      },
      usageMetadata: { totalTokenCount: 12 },
    })),
    getCurrentModelName: vi.fn(() => 'mock-model'),
    getModelInfo: vi.fn(() => ({})),
  } as any;
  const prompt = new PromptAssembler();
  prompt.setSystemPrompt('test system');
  const backend = new Backend(
    router,
    storage,
    new ToolRegistry(),
    new ToolStateManager(),
    prompt,
    {
      stream: false,
      maxToolRounds: 5,
      milestoneManager,
      milestoneRouteAgent: 'master',
    },
  );
  backend.on('error', () => {});
  return backend;
}

describe('Backend milestone persistence', () => {
  it('创建 session meta 时保留已在内存中的 milestone 快照', async () => {
    const storage = new InMemoryStorage();
    const milestoneManager = new SessionMilestoneManager();
    const backend = createBackend(storage, milestoneManager);

    milestoneManager.update('s1', [
      { id: 'm1', title: '实现 milestone 持久化', status: 'in_progress' },
    ], { sourceAgent: 'master', routeAgent: 'master', replaceAll: true });

    await backend.chat('s1', '开始修复', undefined, undefined, 'console');

    const meta = await storage.getMeta('s1');
    expect(meta?.platforms).toContain('console');
    expect(meta?.milestones?.items.map(item => item.id)).toEqual(['m1']);
    expect(meta?.milestones?.items[0].status).toBe('in_progress');
  });

  it('会在已有 milestone 的 turn 中注入生命周期守卫提示', async () => {
    const storage = new InMemoryStorage();
    const milestoneManager = new SessionMilestoneManager();
    const requests: LLMRequest[] = [];
    const router = {
      chat: vi.fn(async (request: LLMRequest) => {
        requests.push(request);
        return {
          content: {
            role: 'model' as const,
            parts: [{ text: '继续处理' }],
            createdAt: Date.now(),
          },
          usageMetadata: { totalTokenCount: 12 },
        };
      }),
      getCurrentModelName: vi.fn(() => 'mock-model'),
      getModelInfo: vi.fn(() => ({})),
    } as any;
    const prompt = new PromptAssembler();
    prompt.setSystemPrompt('test system');
    const backend = new Backend(
      router,
      storage,
      new ToolRegistry(),
      new ToolStateManager(),
      prompt,
      {
        stream: false,
        maxToolRounds: 5,
        milestoneManager,
        milestoneRouteAgent: 'master',
      },
    );
    backend.on('error', () => {});

    milestoneManager.update('s1', [
      { id: 'm1', title: '下一步实现', status: 'pending', owner: 'master' },
    ], { sourceAgent: 'master', routeAgent: 'master', replaceAll: true });

    await backend.chat('s1', '继续');

    const systemText = requests[0].systemInstruction?.parts.map((part: any) => part.text ?? '').join('\n') ?? '';
    expect(systemText).toContain('【Iris 进度守卫】');
    expect(systemText).toContain('当前 owner 没有 in_progress');
    expect(systemText).toContain('#m1 [pending]');
  });



  it('loadMilestones 不用旧持久化快照覆盖更新的内存状态', async () => {
    const storage = new InMemoryStorage();
    const milestoneManager = new SessionMilestoneManager();

    const oldManager = new SessionMilestoneManager();
    const oldSnapshot = oldManager.update('s1', [
      { id: 'm1', title: '旧状态', status: 'pending' },
    ], { sourceAgent: 'master', routeAgent: 'master', replaceAll: true });
    oldSnapshot.updatedAt = 1;
    oldSnapshot.items = oldSnapshot.items.map(item => ({ ...item, updatedAt: 1 }));
    await storage.saveMeta({
      id: 's1',
      title: '旧会话',
      cwd: process.cwd(),
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      milestones: oldSnapshot,
    });

    milestoneManager.update('s1', [
      { id: 'm1', title: '新状态', status: 'completed' },
    ], { sourceAgent: 'master', routeAgent: 'master', replaceAll: true });
    const backend = createBackend(storage, milestoneManager);

    const loaded = await backend.loadMilestones('s1');
    expect(loaded?.items[0].title).toBe('新状态');
    expect(loaded?.items[0].status).toBe('completed');
    expect(milestoneManager.getSnapshot('s1').items[0].status).toBe('completed');
  });

  it('完成态 milestone 会归档到 session meta，并记录历史插入位置', async () => {
    const storage = new InMemoryStorage();
    const milestoneManager = new SessionMilestoneManager();
    createBackend(storage, milestoneManager);

    await storage.saveMeta({
      id: 's1',
      title: '归档测试',
      cwd: process.cwd(),
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });
    await storage.addMessage('s1', { role: 'user', parts: [{ text: '开始' }] });

    const snapshot = milestoneManager.update('s1', [
      { id: 'm1', title: '完成一组任务', status: 'completed', owner: 'master' },
    ], { sourceAgent: 'master', routeAgent: 'master', replaceAll: true });
    await new Promise(resolve => setTimeout(resolve, 0));

    const meta = await storage.getMeta('s1');
    expect(meta?.milestones?.updatedAt).toBe(snapshot.updatedAt);
    expect(meta?.milestoneArchives).toHaveLength(1);
    expect(meta?.milestoneArchives?.[0].snapshot.updatedAt).toBe(snapshot.updatedAt);
    expect(meta?.milestoneArchives?.[0].afterHistoryIndex).toBe(1);
    expect(meta?.milestoneUiState?.expanded).toBe(true);
    expect(meta?.milestoneUiState?.snapshotUpdatedAt).toBe(snapshot.updatedAt);
  });

  it('可在 session meta 中保存并读取最新 milestone 展开状态', async () => {
    const storage = new InMemoryStorage();
    const milestoneManager = new SessionMilestoneManager();
    const backend = createBackend(storage, milestoneManager);
    await storage.saveMeta({
      id: 's1',
      title: '展开状态测试',
      cwd: process.cwd(),
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });

    await backend.setMilestoneUiState('s1', { expanded: false, snapshotUpdatedAt: 123 });

    const state = await backend.loadMilestoneUiState('s1');
    expect(state?.expanded).toBe(false);
    expect(state?.snapshotUpdatedAt).toBe(123);
    expect((await storage.getMeta('s1'))?.milestoneUiState?.expanded).toBe(false);
  });

  it('完成态 milestone 会把最新展开状态强制恢复为展开', async () => {
    const storage = new InMemoryStorage();
    const milestoneManager = new SessionMilestoneManager();
    const backend = createBackend(storage, milestoneManager);
    await storage.saveMeta({
      id: 's1',
      title: '完成态展开测试',
      cwd: process.cwd(),
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });
    await backend.setMilestoneUiState('s1', { expanded: false, snapshotUpdatedAt: 1 });

    const snapshot = milestoneManager.update('s1', [
      { id: 'm1', title: '完成后应展开', status: 'completed', owner: 'master' },
    ], { sourceAgent: 'master', routeAgent: 'master', replaceAll: true });
    await new Promise(resolve => setTimeout(resolve, 0));

    expect((await storage.getMeta('s1'))?.milestoneUiState).toMatchObject({ expanded: true, snapshotUpdatedAt: snapshot.updatedAt });
  });

  it('loadMilestoneArchives 兼容只有 latest completed snapshot 的旧元数据', async () => {
    const storage = new InMemoryStorage();
    const milestoneManager = new SessionMilestoneManager();
    const oldManager = new SessionMilestoneManager();
    const completedSnapshot = oldManager.update('s1', [
      { id: 'm1', title: '旧版已完成任务', status: 'completed', owner: 'master' },
    ], { sourceAgent: 'master', routeAgent: 'master', replaceAll: true });

    await storage.addMessage('s1', { role: 'user', parts: [{ text: '开始' }] });
    await storage.addMessage('s1', { role: 'model', parts: [{ text: '完成' }] });
    await storage.saveMeta({
      id: 's1',
      title: '旧会话',
      cwd: process.cwd(),
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      milestones: completedSnapshot,
    });
    const backend = createBackend(storage, milestoneManager);

    const archives = await backend.loadMilestoneArchives('s1');
    expect(archives).toHaveLength(1);
    expect(archives[0].snapshot.items[0].title).toBe('旧版已完成任务');
    expect(archives[0].afterHistoryIndex).toBe(2);
    expect((await storage.getMeta('s1'))?.milestoneArchives).toHaveLength(1);
  });

  it('clearSession 后不会把 milestone 重新写回已删除的 meta', async () => {
    const storage = new InMemoryStorage();
    const milestoneManager = new SessionMilestoneManager();
    const backend = createBackend(storage, milestoneManager);

    await storage.saveMeta({
      id: 's1',
      title: '待清空会话',
      cwd: process.cwd(),
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });
    milestoneManager.update('s1', [
      { id: 'm1', title: '待清空 milestone', status: 'in_progress' },
    ], { sourceAgent: 'master', routeAgent: 'master', replaceAll: true });

    await backend.clearSession('s1');
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(await storage.getMeta('s1')).toBeNull();
  });
});
