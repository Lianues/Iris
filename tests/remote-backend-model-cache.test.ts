import { describe, expect, it } from 'vitest';
import type { IPCClientLike } from '../src/ipc/client-like';
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
});
