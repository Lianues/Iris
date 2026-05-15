import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PluginHook } from 'irises-extension-sdk';

interface MockMCPManagerInstance {
  config: any;
  connectAll: ReturnType<typeof vi.fn>;
  reload: ReturnType<typeof vi.fn>;
  disconnectAll: ReturnType<typeof vi.fn>;
  getTools: ReturnType<typeof vi.fn>;
  listServers: ReturnType<typeof vi.fn>;
  getServerInfo: ReturnType<typeof vi.fn>;
}

function installManagerMock(): MockMCPManagerInstance[] {
  const instances: MockMCPManagerInstance[] = [];

  vi.doMock('../extensions/mcp/src/manager.js', () => ({
    MCPManager: vi.fn().mockImplementation((config: any) => {
      const instance: MockMCPManagerInstance = {
        config,
        connectAll: vi.fn().mockResolvedValue(undefined),
        reload: vi.fn().mockResolvedValue(undefined),
        disconnectAll: vi.fn().mockResolvedValue(undefined),
        getTools: vi.fn(() => [{ declaration: { name: 'mcp__mock' }, handler: vi.fn() }]),
        listServers: vi.fn(() => []),
        getServerInfo: vi.fn(() => []),
      };
      instances.push(instance);
      return instance;
    }),
  }));

  return instances;
}

function createPluginContext() {
  const hooks: PluginHook[] = [];
  const readyCallbacks: Array<(api: any) => Promise<void> | void> = [];
  const registry = {
    listTools: vi.fn(() => []),
    unregister: vi.fn(),
  };
  const serviceDisposer = { dispose: vi.fn() };
  const serviceRegistry = {
    register: vi.fn(() => serviceDisposer),
  };

  const ctx = {
    ensureConfigFile: vi.fn(),
    readConfigSection: vi.fn(() => undefined),
    addHook: vi.fn((hook: PluginHook) => hooks.push(hook)),
    onReady: vi.fn((callback: (api: any) => Promise<void> | void) => readyCallbacks.push(callback)),
    getToolRegistry: vi.fn(() => registry),
    registerTools: vi.fn(),
    getServiceRegistry: vi.fn(() => serviceRegistry),
  };

  return { ctx: ctx as any, hooks, readyCallbacks, registry, serviceRegistry, serviceDisposer };
}

async function loadMcpPlugin() {
  const mod = await import('../extensions/mcp/src/index.ts');
  return mod.default;
}

beforeEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
});

describe('mcp extension config layering', () => {
  it('reads merged global + agent MCP config during initial onReady activation', async () => {
    const instances = installManagerMock();
    const plugin = await loadMcpPlugin();
    const { ctx, readyCallbacks } = createPluginContext();
    const readEditableConfig = vi.fn(() => ({
      mcp: {
        servers: {
          global_server: { transport: 'stdio', command: 'node' },
        },
      },
    }));

    plugin.activate(ctx);

    expect(ctx.addHook).toHaveBeenCalledTimes(1);
    expect(readyCallbacks).toHaveLength(1);
    expect(ctx.readConfigSection).not.toHaveBeenCalled();

    await readyCallbacks[0]!({ configManager: { readEditableConfig } });

    expect(readEditableConfig).toHaveBeenCalledTimes(1);
    expect(ctx.readConfigSection).not.toHaveBeenCalled();
    expect(instances).toHaveLength(1);
    expect(instances[0]!.config.servers.global_server.command).toBe('node');
    expect(ctx.registerTools).toHaveBeenCalledTimes(1);
  });

  it('registers reload hook even when initial MCP config is empty', async () => {
    const instances = installManagerMock();
    const plugin = await loadMcpPlugin();
    const { ctx, hooks, readyCallbacks } = createPluginContext();

    plugin.activate(ctx);
    await readyCallbacks[0]!({ configManager: { readEditableConfig: vi.fn(() => ({})) } });

    expect(hooks).toHaveLength(1);
    expect(instances).toHaveLength(0);

    await hooks[0]!.onConfigReload?.({
      config: {},
      rawMergedConfig: {
        mcp: {
          servers: {
            later_server: { transport: 'stdio', command: 'node' },
          },
        },
      },
    });

    expect(instances).toHaveLength(1);
    expect(instances[0]!.config.servers.later_server.command).toBe('node');
    expect(ctx.registerTools).toHaveBeenCalledTimes(1);
  });

  it('keeps MCP runtime state isolated across plugin contexts', async () => {
    const instances = installManagerMock();
    const plugin = await loadMcpPlugin();
    const first = createPluginContext();
    const second = createPluginContext();

    plugin.activate(first.ctx);
    plugin.activate(second.ctx);

    await first.readyCallbacks[0]!({
      configManager: {
        readEditableConfig: vi.fn(() => ({
          mcp: { servers: { first_server: { transport: 'stdio', command: 'node' } } },
        })),
      },
    });
    await second.readyCallbacks[0]!({
      configManager: {
        readEditableConfig: vi.fn(() => ({
          mcp: { servers: { second_server: { transport: 'stdio', command: 'python' } } },
        })),
      },
    });

    expect(instances).toHaveLength(2);
    expect(instances[0]!.config.servers.first_server.command).toBe('node');
    expect(instances[1]!.config.servers.second_server.command).toBe('python');
    expect(first.serviceRegistry.register).toHaveBeenCalledTimes(1);
    expect(second.serviceRegistry.register).toHaveBeenCalledTimes(1);

    // 第二个 context 注册服务不应释放第一个 context 的服务。
    expect(first.serviceDisposer.dispose).not.toHaveBeenCalled();

    await plugin.deactivate?.(first.ctx);

    expect(first.serviceDisposer.dispose).toHaveBeenCalledTimes(1);
    expect(instances[0]!.disconnectAll).toHaveBeenCalledTimes(1);
    expect(second.serviceDisposer.dispose).not.toHaveBeenCalled();
    expect(instances[1]!.disconnectAll).not.toHaveBeenCalled();
  });
});
