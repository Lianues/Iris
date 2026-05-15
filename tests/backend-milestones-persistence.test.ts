import { describe, expect, it, vi } from 'vitest';
import { Backend } from '../src/core/backend/backend.js';
import { SessionMilestoneManager } from '../extensions/milestone/src/session.js';
import { StorageProvider, type SessionMeta } from '../src/storage/base.js';
import { CrossAgentTaskBoard } from '../src/core/cross-agent-task-board.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { ToolStateManager } from '../src/tools/state.js';
import { PromptAssembler } from '../src/prompt/assembler.js';
import type { Content, LLMRequest } from '../src/types/index.js';
import { createMilestoneServiceForApi, createMilestoneToolsForApi, MILESTONE_EXTENSION_SERVICE_ID } from '../extensions/milestone/src/index.js';

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
    await this.withMetaUpdateLock(sessionId, async () => {
      this.histories.delete(sessionId);
      this.metas.delete(sessionId);
    });
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

function createMilestoneService(storage: InMemoryStorage) {
  const api = { storage } as any;
  return createMilestoneServiceForApi(api);
}

function getPersisted(meta: SessionMeta | null | undefined): any {
  return meta?.extensionState?.milestone as any;
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

    await backend.chat('s1', '开始修复', undefined, undefined, 'console');

    const service = createMilestoneService(storage);
    service.update('s1', [
      { title: '实现 milestone 持久化', status: 'in_progress' },
    ], { replaceAll: true });
    await new Promise(resolve => setTimeout(resolve, 0));

    const meta = await storage.getMeta('s1');
    expect(meta?.platforms).toContain('console');
    expect(getPersisted(meta)?.latest?.items.map((item: any) => item.title)).toEqual(['实现 milestone 持久化']);
    expect(getPersisted(meta)?.latest?.items[0].status).toBe('in_progress');
  });

  it('已有 milestone 的普通 turn 不注入动态生命周期守卫提示', async () => {
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
      { title: '下一步实现', status: 'pending' },
    ], { replaceAll: true });

    await backend.chat('s1', '继续');

    const systemText = requests[0].systemInstruction?.parts.map((part: any) => part.text ?? '').join('\n') ?? '';
    expect(systemText).toContain('test system');
    expect(systemText).not.toMatch(/Iris\s*进度\s*守卫/);
    expect(systemText).not.toContain('#m1 [pending]');
  });



  it('loadMilestones 不用旧持久化快照覆盖更新的内存状态', async () => {
    const storage = new InMemoryStorage();
    const milestoneManager = new SessionMilestoneManager();

    const oldManager = new SessionMilestoneManager();
    const oldSnapshot = oldManager.update('s1', [
      { title: '旧状态', status: 'pending' },
    ], { replaceAll: true });
    oldSnapshot.updatedAt = 1;
    oldSnapshot.items = oldSnapshot.items.map(item => ({ ...item, updatedAt: 1 }));
    await storage.saveMeta({
      id: 's1',
      title: '旧会话',
      cwd: process.cwd(),
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      extensionState: { milestone: { latest: oldSnapshot } },
    });

    const service = createMilestoneService(storage);
    service.update('s1', [
      { title: '新状态', status: 'completed' },
    ], { replaceAll: true });

    const loaded = await service.loadLatest('s1');
    expect(loaded?.items[0].title).toBe('新状态');
    expect(loaded?.items[0].status).toBe('completed');
    expect(service.getSnapshot('s1').items[0].status).toBe('completed');
  });

  it('完成态 milestone 会归档到 session meta，并记录历史插入位置', async () => {
    const storage = new InMemoryStorage();
    const service = createMilestoneService(storage);

    await storage.saveMeta({
      id: 's1',
      title: '归档测试',
      cwd: process.cwd(),
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });
    await storage.addMessage('s1', { role: 'user', parts: [{ text: '开始' }] });

    const snapshot = service.update('s1', [
      { title: '完成一组任务', status: 'completed' },
    ], { replaceAll: true });
    await new Promise(resolve => setTimeout(resolve, 0));

    const meta = await storage.getMeta('s1');
    expect(getPersisted(meta)?.latest?.updatedAt).toBe(snapshot.updatedAt);
    expect(getPersisted(meta)?.archives).toHaveLength(1);
    expect(getPersisted(meta)?.archives?.[0].snapshot.updatedAt).toBe(snapshot.updatedAt);
    expect(getPersisted(meta)?.archives?.[0].afterHistoryIndex).toBe(1);
    expect(getPersisted(meta)?.ui?.expanded).toBe(true);
    expect(getPersisted(meta)?.ui?.snapshotUpdatedAt).toBe(snapshot.updatedAt);
  });

  it('可在 session meta 中保存并读取最新 milestone 展开状态', async () => {
    const storage = new InMemoryStorage();
    const service = createMilestoneService(storage);
    await storage.saveMeta({
      id: 's1',
      title: '展开状态测试',
      cwd: process.cwd(),
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });

    await service.setUiState('s1', { expanded: false, snapshotUpdatedAt: 123 });

    const state = await service.loadUiState('s1');
    expect(state?.expanded).toBe(false);
    expect(state?.snapshotUpdatedAt).toBe(123);
    expect(getPersisted(await storage.getMeta('s1'))?.ui?.expanded).toBe(false);
  });

  it('连续 milestone 更新最终持久化为最新快照，并保留 meta 其他字段', async () => {
    const storage = new InMemoryStorage();
    const service = createMilestoneService(storage);
    await storage.saveMeta({
      id: 's1',
      title: '连续更新测试',
      cwd: '/tmp/old',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      platforms: ['console'],
      remoteExecEnvironment: 'server-a',
      extensionState: { other: { keep: true } },
    } as SessionMeta);

    service.update('s1', [{ title: '旧快照', status: 'pending' }], { replaceAll: true });
    const latest = service.update('s1', [{ title: '新快照', status: 'completed' }], { replaceAll: true });
    await new Promise(resolve => setTimeout(resolve, 0));

    const meta = await storage.getMeta('s1');
    expect(getPersisted(meta)?.latest?.updatedAt).toBe(latest.updatedAt);
    expect(getPersisted(meta)?.latest?.items[0].title).toBe('新快照');
    expect(meta?.platforms).toEqual(['console']);
    expect((meta as any)?.remoteExecEnvironment).toBe('server-a');
    expect(meta?.extensionState?.other).toEqual({ keep: true });
  });

  it('不同 milestone service 使用相同 sessionId 时内存与持久化互相隔离', async () => {
    const storageA = new InMemoryStorage();
    const storageB = new InMemoryStorage();
    await storageA.saveMeta({ id: 'same-session', title: 'A', cwd: process.cwd(), createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z' });
    await storageB.saveMeta({ id: 'same-session', title: 'B', cwd: process.cwd(), createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z' });
    const serviceA = createMilestoneService(storageA);
    const serviceB = createMilestoneService(storageB);

    serviceA.update('same-session', [{ title: 'Agent A 任务', status: 'in_progress' }], { replaceAll: true });
    serviceB.update('same-session', [{ title: 'Agent B 任务', status: 'completed' }], { replaceAll: true });
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(serviceA.getSnapshot('same-session').items[0].title).toBe('Agent A 任务');
    expect(serviceB.getSnapshot('same-session').items[0].title).toBe('Agent B 任务');
    expect(getPersisted(await storageA.getMeta('same-session'))?.latest?.items[0].title).toBe('Agent A 任务');
    expect(getPersisted(await storageB.getMeta('same-session'))?.latest?.items[0].title).toBe('Agent B 任务');
  });

  it('delegated task 中的 milestone 更新路由到 source Agent service/storage', async () => {
    const sourceStorage = new InMemoryStorage();
    const targetStorage = new InMemoryStorage();
    await sourceStorage.saveMeta({ id: 'source-session', title: 'source', cwd: process.cwd(), createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z' });

    const sourceApi: any = { storage: sourceStorage, agentName: 'master' };
    const targetApi: any = { storage: targetStorage, agentName: 'worker' };
    const sourceService = createMilestoneServiceForApi(sourceApi);
    const targetService = createMilestoneServiceForApi(targetApi);
    sourceApi.services = { get: (id: string) => id === MILESTONE_EXTENSION_SERVICE_ID ? sourceService : undefined };
    targetApi.services = { get: (id: string) => id === MILESTONE_EXTENSION_SERVICE_ID ? targetService : undefined };
    targetApi.backend = { getActiveSessionId: () => 'cross-agent:master:task-1' };
    targetApi.agentNetwork = { getPeerAPI: (name: string) => name === 'master' ? sourceApi : undefined };
    const taskBoard = new CrossAgentTaskBoard();
    targetApi.taskBoard = taskBoard;
    taskBoard.register({
      taskId: 'task-1',
      sourceAgent: 'master',
      sourceSessionId: 'source-session',
      targetAgent: 'worker',
      type: 'delegate',
      description: 'delegate milestone route test',
    });
    const [updateTool] = createMilestoneToolsForApi(targetApi);

    await updateTool.handler({
      replaceAll: true,
      items: [{ title: '写回 source', status: 'completed' }],
    }, { sessionId: 'cross-agent:master:task-1' } as any);
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(sourceService.getSnapshot('source-session').items[0].title).toBe('写回 source');
    expect(targetService.getSnapshot('source-session').items).toHaveLength(0);
    expect(getPersisted(await sourceStorage.getMeta('source-session'))?.latest?.items[0].title).toBe('写回 source');
    expect(await targetStorage.getMeta('source-session')).toBeNull();
  });

  it('完成态 milestone 会把最新展开状态强制恢复为展开', async () => {
    const storage = new InMemoryStorage();
    const service = createMilestoneService(storage);
    await storage.saveMeta({
      id: 's1',
      title: '完成态展开测试',
      cwd: process.cwd(),
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });
    await service.setUiState('s1', { expanded: false, snapshotUpdatedAt: 1 });

    const snapshot = service.update('s1', [
      { title: '完成后应展开', status: 'completed' },
    ], { replaceAll: true });
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(getPersisted(await storage.getMeta('s1'))?.ui).toMatchObject({ expanded: true, snapshotUpdatedAt: snapshot.updatedAt });
  });

  it('loadMilestoneArchives 兼容只有 latest completed snapshot 的旧元数据', async () => {
    const storage = new InMemoryStorage();
    const oldManager = new SessionMilestoneManager();
    const completedSnapshot = oldManager.update('s1', [
      { title: '旧版已完成任务', status: 'completed' },
    ], { replaceAll: true });

    await storage.addMessage('s1', { role: 'user', parts: [{ text: '开始' }] });
    await storage.addMessage('s1', { role: 'model', parts: [{ text: '完成' }] });
    await storage.saveMeta({
      id: 's1',
      title: '旧会话',
      cwd: process.cwd(),
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      extensionState: { milestone: { latest: completedSnapshot } },
    });
    const service = createMilestoneService(storage);

    const archives = await service.loadArchives('s1');
    expect(archives).toHaveLength(1);
    expect(archives[0].snapshot.items[0].title).toBe('旧版已完成任务');
    expect(archives[0].afterHistoryIndex).toBe(2);
    expect(getPersisted(await storage.getMeta('s1'))?.archives).toHaveLength(1);
  });

  it('clearSession 后不会把 milestone 重新写回已删除的 meta', async () => {
    const storage = new InMemoryStorage();
    const milestoneManager = new SessionMilestoneManager();
    const backend = createBackend(storage, milestoneManager);
    const service = createMilestoneService(storage);

    await storage.saveMeta({
      id: 's1',
      title: '待清空会话',
      cwd: process.cwd(),
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });
    service.update('s1', [
      { title: '待清空 milestone', status: 'in_progress' },
    ], { replaceAll: true });

    await backend.clearSession('s1');
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(await storage.getMeta('s1')).toBeNull();
  });
});
