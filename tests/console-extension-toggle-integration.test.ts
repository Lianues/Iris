import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ensureExtensionRuntimeDependencies } from 'irises-extension-sdk/utils';
import { handleConsoleToggleExtension } from '../extensions/console/src/extension-toggle.js';

vi.mock('irises-extension-sdk/utils', () => ({
  ensureExtensionRuntimeDependencies: vi.fn(async () => ({ installed: false, missingDependencies: [] })),
}));

const ensureDepsMock = vi.mocked(ensureExtensionRuntimeDependencies);

function createHarness(initialRaw: Record<string, any>, packages: Array<{ manifest: { name: string; entry?: string; plugin?: any; platforms?: any[] }; source?: string; rootDir?: string }>) {
  let raw = structuredClone(initialRaw);
  const updateEditableConfig = vi.fn((updates: Record<string, unknown>) => {
    raw = { ...raw, ...structuredClone(updates) };
    return { mergedRaw: structuredClone(raw), sanitized: structuredClone(raw) };
  });
  const setWorkspaceDiscovery = vi.fn();
  const activate = vi.fn(async (_entry: unknown) => undefined);
  const deactivate = vi.fn(async (_name: string) => undefined);

  const api = {
    configManager: {
      readEditableConfig: () => structuredClone(raw),
      updateEditableConfig,
    },
    extensions: {
      discoverAll: () => packages,
      discover: () => packages,
      setWorkspaceDiscovery,
      activate,
      deactivate,
    },
    pluginManager: {
      listPlugins: () => [],
    },
  };

  return {
    api,
    getRaw: () => structuredClone(raw),
    updateEditableConfig,
    setWorkspaceDiscovery,
    activate,
    deactivate,
  };
}

describe('Console /extension toggle integration', () => {
  beforeEach(() => {
    ensureDepsMock.mockResolvedValue({ installed: false, missingDependencies: [] } as any);
  });

  it('启用插件时应把 plugins.yaml 中的完整 PluginEntry 传给运行时 activate', async () => {
    const extensionName = 'console-hotplug-demo';
    const harness = createHarness({
      plugins: {
        plugins: [
          {
            name: extensionName,
            enabled: false,
            priority: 42,
            config: { mood: 'gentle', nested: { enabled: true } },
          },
        ],
      },
    }, [
      {
        manifest: { name: extensionName, version: '1.0.0', plugin: { entry: 'index.mjs' } } as any,
        source: 'installed',
      },
    ]);

    const result = await handleConsoleToggleExtension(harness.api, extensionName, true);

    expect(result).toEqual({ ok: true, message: `已启用 "${extensionName}"` });
    expect(harness.activate).toHaveBeenCalledTimes(1);
    expect(harness.activate).toHaveBeenCalledWith({
      name: extensionName,
      enabled: true,
      priority: 42,
      config: { mood: 'gentle', nested: { enabled: true } },
    });
    expect(harness.getRaw().plugins.plugins[0]).toMatchObject({
      name: extensionName,
      enabled: true,
      priority: 42,
      config: { mood: 'gentle', nested: { enabled: true } },
    });
  });

  it('workspace 插件启用失败时应回滚 system.extensions discovery 配置', async () => {
    const extensionName = 'console-workspace-failing-demo';
    const harness = createHarness({
      system: {
        extensions: {
          loadWorkspaceExtensions: false,
          workspaceAllowlist: [],
        },
      },
      plugins: {
        plugins: [
          { name: extensionName, enabled: false, priority: 3, config: { from: 'yaml' } },
        ],
      },
    }, [
      {
        manifest: { name: extensionName, version: '1.0.0', plugin: { entry: 'index.mjs' } } as any,
        source: 'workspace',
      },
    ]);
    harness.activate.mockRejectedValueOnce(new Error('boom during activate'));

    const result = await handleConsoleToggleExtension(harness.api, extensionName, true);

    expect(result.ok).toBe(false);
    expect(result.message).toContain('boom during activate');
    expect(harness.setWorkspaceDiscovery).toHaveBeenNthCalledWith(1, { enabled: true, allowlist: [extensionName] });
    expect(harness.setWorkspaceDiscovery).toHaveBeenLastCalledWith({ enabled: false, allowlist: [] });
    expect(harness.getRaw().system.extensions).toEqual({
      loadWorkspaceExtensions: false,
      workspaceAllowlist: [],
    });
    expect(harness.getRaw().plugins.plugins[0]).toMatchObject({
      name: extensionName,
      enabled: false,
      priority: 3,
      config: { from: 'yaml' },
    });
  });

  it('禁用已激活插件时应先 deactivate 再持久化 enabled=false', async () => {
    const extensionName = 'console-disable-demo';
    const harness = createHarness({
      plugins: {
        plugins: [{ name: extensionName, enabled: true, priority: 5 }],
      },
    },
    [
      {
        manifest: { name: extensionName, version: '1.0.0', plugin: { entry: 'index.mjs' } } as any,
        source: 'installed',
      },
    ]);
    harness.api.pluginManager.listPlugins = () => [{ name: extensionName }];

    const result = await handleConsoleToggleExtension(harness.api, extensionName, false);

    expect(result).toEqual({ ok: true, message: `已禁用 "${extensionName}"` });


    expect(harness.deactivate).toHaveBeenCalledWith(extensionName);
    expect(harness.getRaw().plugins.plugins[0]).toMatchObject({
      name: extensionName,
      enabled: false,
      priority: 5,
    });
  });

  it('启用纯 workspace platform 扩展时也应先确保运行时依赖', async () => {
    const extensionName = 'console-platform-deps-demo';
    const rootDir = 'D:/tmp/console-platform-deps-demo';
    ensureDepsMock.mockResolvedValueOnce({ installed: true, missingDependencies: ['grammy@^1.0.0'] } as any);
    const harness = createHarness({
      system: {
        extensions: {
          loadWorkspaceExtensions: false,
          workspaceAllowlist: [],
        },
      },
      plugins: { plugins: [] },
    }, [
      {
        manifest: { name: extensionName, version: '1.0.0', platforms: [{ name: 'demo-platform', entry: 'index.mjs' }] } as any,
        source: 'workspace',
        rootDir,
      },
    ]);

    const result = await handleConsoleToggleExtension(harness.api, extensionName, true);

    expect(ensureDepsMock).toHaveBeenCalledWith(rootDir);
    expect(harness.activate).not.toHaveBeenCalled();
    expect(harness.setWorkspaceDiscovery).toHaveBeenCalledWith({ enabled: true, allowlist: [extensionName] });
    expect(result).toEqual({
      ok: true,
      message: `已安装依赖 grammy@^1.0.0 并启用可选平台扩展 "${extensionName}"；请在 platform.yaml 中选择该平台，必要时重启 Iris。`,
    });
  });

  it('依赖安装失败时不应改写 workspace discovery', async () => {
    const extensionName = 'console-deps-fail-demo';
    ensureDepsMock.mockRejectedValueOnce(new Error('npm install failed'));
    const harness = createHarness({
      system: {
        extensions: {
          loadWorkspaceExtensions: false,
          workspaceAllowlist: [],
        },
      },
      plugins: { plugins: [{ name: extensionName, enabled: false }] },
    }, [
      {
        manifest: { name: extensionName, version: '1.0.0', plugin: { entry: 'index.mjs' } } as any,
        source: 'workspace',
        rootDir: 'D:/tmp/console-deps-fail-demo',
      },
    ]);

    const result = await handleConsoleToggleExtension(harness.api, extensionName, true);

    expect(result.ok).toBe(false);
    expect(result.message).toContain('npm install failed');
    expect(harness.setWorkspaceDiscovery).not.toHaveBeenCalled();
    expect(harness.activate).not.toHaveBeenCalled();
    expect(harness.getRaw().system.extensions).toEqual({
      loadWorkspaceExtensions: false,
      workspaceAllowlist: [],
    });
  });

  it('启用远程 available extension 时应下载安装、安装依赖、激活并写入 plugins.yaml', async () => {
    const extensionName = 'remote-console-demo';
    const targetDir = '/tmp/remote-console-demo';
    let raw: Record<string, any> = { plugins: { plugins: [] } };
    const updateEditableConfig = vi.fn((updates: Record<string, unknown>) => {
      raw = { ...raw, ...structuredClone(updates) };
      return { mergedRaw: structuredClone(raw) };
    });
    const installRemote = vi.fn(async (requestedPath: string) => ({
      name: extensionName,
      version: '1.2.3',
      targetDir,
      requestedPath,
    }));
    const activate = vi.fn(async (_entry: unknown) => undefined);
    ensureDepsMock.mockResolvedValueOnce({ installed: true, missingDependencies: ['left-pad'] } as any);

    const api = {
      configManager: {
        readEditableConfig: () => structuredClone(raw),
        updateEditableConfig,
      },
      extensions: {
        discoverAll: () => [],
        discover: () => [
          {
            manifest: { name: extensionName, version: '1.2.3', plugin: { entry: 'index.mjs' } } as any,
            source: 'agent-installed',
            rootDir: targetDir,
          },
        ],
        getRemoteRequestPath: (name: string) => name === extensionName ? 'community/remote-console-demo' : undefined,
        installRemote,
        activate,
      },
      pluginManager: { listPlugins: () => [] },
    };

    const result = await handleConsoleToggleExtension(api, extensionName, true);

    expect(installRemote).toHaveBeenCalledWith('community/remote-console-demo');
    expect(ensureDepsMock).toHaveBeenCalledWith(targetDir);
    expect(activate).toHaveBeenCalledWith({ name: extensionName, type: 'local', enabled: true });
    expect(raw.plugins.plugins).toEqual([{ name: extensionName, type: 'local', enabled: true }]);
    expect(result).toEqual({ ok: true, message: `已安装依赖 left-pad，已下载安装并启用远程插件 "${extensionName}@1.2.3"` });
  });

});
