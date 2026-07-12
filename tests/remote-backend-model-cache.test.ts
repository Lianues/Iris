import { describe, expect, it } from 'vitest';
import type { IPCClientLike } from '../src/ipc/client-like';
import { createRemoteApiProxy } from '../src/ipc/remote-api-proxy';
import { RemoteBackendHandle } from '../src/ipc/remote-backend-handle';
import { Events, Methods } from '../src/ipc/protocol';

class FakeIPCClient implements IPCClientLike {
  private handlers: Array<(method: string, params: unknown[]) => void> = [];
  readonly calls: Array<{ method: string; params?: unknown[] }> = [];

  constructor(private readonly responders: Record<string, unknown>) {}

  async call(method: string, params?: unknown[], _options?: { timeout?: number }): Promise<unknown> {
    this.calls.push({ method, params });
    return this.responders[method];
  }

  onNotification(handler: (method: string, params: unknown[]) => void): void {
    this.handlers.push(handler);
  }

  offNotification(handler: (method: string, params: unknown[]) => void): void {
    const index = this.handlers.indexOf(handler);
    if (index >= 0) this.handlers.splice(index, 1);
  }

  async subscribe(_sessions: string | string[]): Promise<void> {}

  disconnect(): void {}

  isConnected(): boolean {
    return true;
  }

  notify(method: string, params: unknown[]): void {
    for (const handler of this.handlers) {
      handler(method, params);
    }
  }
}

describe('RemoteBackendHandle 模型缓存同步', () => {
  it('switchModel 应优先返回缓存中的真实 modelId，而不是回退到模型别名', async () => {
    const models = [
      { modelName: 'gemini_flash', modelId: 'gemini-2.5-flash', provider: 'gemini', current: true },
      { modelName: 'claude_sonnet', modelId: 'claude-sonnet-4-6', provider: 'claude', current: false },
    ];
    const client = new FakeIPCClient({
      [Methods.LIST_MODELS]: models,
      [Methods.LIST_SKILLS]: [],
      [Methods.LIST_MODES]: [],
      [Methods.GET_TOOL_NAMES]: [],
      [Methods.GET_CURRENT_MODEL_INFO]: models[0],
      [Methods.GET_DISABLED_TOOLS]: undefined,
      [Methods.GET_CWD]: process.cwd(),
      [Methods.SWITCH_MODEL]: models[1],
    });
    const backend = new RemoteBackendHandle(client);

    await backend.initCaches();

    expect(backend.switchModel('claude_sonnet')).toEqual({
      modelName: 'claude_sonnet',
      modelId: 'claude-sonnet-4-6',
    });
  });

  it('收到 models:changed 事件后应刷新本地模型缓存', async () => {
    const initialModels = [
      { modelName: 'gemini_flash', modelId: 'gemini-2.5-flash', provider: 'gemini', current: true },
    ];
    const nextModels = [
      { modelName: 'gemini_flash', modelId: 'gemini-2.5-flash', provider: 'gemini', current: false },
      { modelName: 'claude_sonnet', modelId: 'claude-sonnet-4-6', provider: 'claude', current: true },
    ];
    const client = new FakeIPCClient({
      [Methods.LIST_MODELS]: initialModels,
      [Methods.LIST_SKILLS]: [],
      [Methods.LIST_MODES]: [],
      [Methods.GET_TOOL_NAMES]: [],
      [Methods.GET_CURRENT_MODEL_INFO]: initialModels[0],
      [Methods.GET_DISABLED_TOOLS]: undefined,
      [Methods.GET_CWD]: process.cwd(),
    });
    const backend = new RemoteBackendHandle(client);

    await backend.initCaches();
    client.notify(Events.MODELS_CHANGED, ['__global__', nextModels, nextModels[1]]);

    expect(backend.listModels()).toEqual(nextModels);
    expect(backend.getCurrentModelInfo()).toEqual(nextModels[1]);
  });

  it('指定 agentName 时应通过 AGENT_BACKEND_CALL 路由到远端目标 Agent', async () => {
    const client = new FakeIPCClient({});
    const backend = new RemoteBackendHandle(client, { agentName: 'worker' });

    await backend.chat('session-1', 'hello', undefined, undefined, 'console');

    expect(client.calls[0]).toEqual({
      method: Methods.AGENT_BACKEND_CALL,
      params: ['worker', Methods.CHAT, ['session-1', 'hello', undefined, undefined, 'console']],
    });
  });

  it('通过默认 IPC 方法读取恢复后的完整 session token', async () => {
    const client = new FakeIPCClient({
      [Methods.GET_LAST_SESSION_TOKENS]: 4321,
    });
    const backend = new RemoteBackendHandle(client);

    await expect(backend.getLastSessionTokens('session-1')).resolves.toBe(4321);
    expect(client.calls).toEqual([{
      method: Methods.GET_LAST_SESSION_TOKENS,
      params: ['session-1'],
    }]);
  });

  it('指定 agentName 时通过 AGENT_BACKEND_CALL 读取目标 Agent 的 session token', async () => {
    const client = new FakeIPCClient({
      [Methods.AGENT_BACKEND_CALL]: 9876,
    });
    const backend = new RemoteBackendHandle(client, { agentName: 'worker' });

    await expect(backend.getLastSessionTokens('session-worker')).resolves.toBe(9876);
    expect(client.calls).toEqual([{
      method: Methods.AGENT_BACKEND_CALL,
      params: [
        'worker',
        Methods.GET_LAST_SESSION_TOKENS,
        ['session-worker'],
      ],
    }]);
  });

  it('远程 API 的 getPeerBackendHandle 应返回按目标 Agent 路由的 RemoteBackendHandle', async () => {
    const client = new FakeIPCClient({});
    const api = createRemoteApiProxy(client, 'master');
    const workerBackend = api.agentNetwork.getPeerBackendHandle('worker') as RemoteBackendHandle;

    await workerBackend.clearSession('session-worker');

    expect(client.calls[0]).toEqual({
      method: Methods.AGENT_BACKEND_CALL,
      params: ['worker', Methods.CLEAR_SESSION, ['session-worker']],
    });
  });
});
