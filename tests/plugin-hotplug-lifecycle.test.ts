import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IrisPlugin, ToolDefinition } from 'irises-extension-sdk';
import { PluginManager } from '../src/extension/manager.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { ModeRegistry } from '../src/modes/registry.js';
import { PromptAssembler } from '../src/prompt/assembler.js';
import { workspaceExtensionsDir } from '../src/paths.js';
import { Router } from '../extensions/web/src/router.js';

const createdExtensionDirs: string[] = [];
const HOTPLUG_CONFIG_KEY = '__irisHotplugSeenConfig';
const HOTPLUG_PLATFORMS_KEY = '__irisHotplugSeenPlatforms';

afterEach(() => {
  for (const dir of createdExtensionDirs.splice(0, createdExtensionDirs.length)) {
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  }
  delete (globalThis as Record<string, unknown>)[HOTPLUG_CONFIG_KEY];
  delete (globalThis as Record<string, unknown>)[HOTPLUG_PLATFORMS_KEY];
});

function createWorkspacePluginExtension(pluginSource: string): { name: string; rootDir: string } {
  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const name = `hotplug-extension-${suffix}`;
  const rootDir = path.join(workspaceExtensionsDir, name);
  fs.mkdirSync(rootDir, { recursive: true });
  fs.writeFileSync(path.join(rootDir, 'manifest.json'), JSON.stringify({
    name,
    version: '1.0.0',
    plugin: { entry: 'plugin.mjs' },
  }, null, 2), 'utf8');
  fs.writeFileSync(path.join(rootDir, 'plugin.mjs'), pluginSource.replace(/__PLUGIN_NAME__/g, JSON.stringify(name)), 'utf8');
  createdExtensionDirs.push(rootDir);
  return { name, rootDir };
}

function makeTool(name: string, handler: ToolDefinition['handler'] = async () => ({ ok: true, name })): ToolDefinition {
  return {
    declaration: {
      name,
      description: `${name} test tool`,
    },
    handler,
  };
}

function createInternals() {
  const prompt = new PromptAssembler();
  prompt.setSystemPrompt('base-system');
  return {
    tools: new ToolRegistry(),
    modes: new ModeRegistry(),
    prompt,
    router: {} as any,
  };
}

describe('plugin hotplug lifecycle cleanup', () => {
  it('deactivateAll 自动清理 registerTool/registerTools 和 system prompt part', async () => {
    const internals = createInternals();
    const extraPart = { text: 'plugin-system-part' };

    const plugin: IrisPlugin = {
      name: 'cleanup-demo',
      version: '1.0.0',
      activate(ctx) {
        ctx.registerTool(makeTool('single_tool'));
        ctx.registerTools([makeTool('batch_tool_a'), makeTool('batch_tool_b')]);
        ctx.addSystemPromptPart(extraPart);
      },
    };

    const manager = new PluginManager();
    await manager.prepareAll([], {} as any, [{ plugin }]);
    await manager.activateAll(internals, {} as any);

    expect(internals.tools.listTools().sort()).toEqual(['batch_tool_a', 'batch_tool_b', 'single_tool']);
    expect(internals.prompt.assemble([]).systemInstruction?.parts).toEqual([
      { text: 'base-system' },
      extraPart,
    ]);

    await manager.deactivateAll();

    expect(internals.tools.listTools()).toEqual([]);
    expect(internals.prompt.assemble([]).systemInstruction?.parts).toEqual([{ text: 'base-system' }]);
  });

  it('插件 deactivate 抛错时仍会执行 PluginContext 自动清理', async () => {
    const internals = createInternals();
    const extraPart = { text: 'throwing-plugin-part' };

    const plugin: IrisPlugin = {
      name: 'throwing-deactivate',
      version: '1.0.0',
      activate(ctx) {
        ctx.registerTools([makeTool('throwing_tool')]);
        ctx.addSystemPromptPart(extraPart);
      },
      deactivate() {
        throw new Error('deactivate failed intentionally');
      },
    };

    const manager = new PluginManager();
    await manager.prepareAll([], {} as any, [{ plugin }]);
    await manager.activateAll(internals, {} as any);

    expect(internals.tools.get('throwing_tool')).toBeDefined();

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await manager.deactivateAll();
    } finally {
      errorSpy.mockRestore();
    }

    expect(internals.tools.get('throwing_tool')).toBeUndefined();
    expect(internals.prompt.assemble([]).systemInstruction?.parts).toEqual([{ text: 'base-system' }]);
  });

  it('插件 activate 抛错时回滚已经注册的工具和 system prompt part', async () => {
    const internals = createInternals();
    const extraPart = { text: 'activation-failed-part' };

    const plugin: IrisPlugin = {
      name: 'throwing-activate',
      version: '1.0.0',
      activate(ctx) {
        ctx.registerTool(makeTool('activation_failed_tool'));
        ctx.addSystemPromptPart(extraPart);
        throw new Error('activate failed intentionally');
      },
    };

    const manager = new PluginManager();
    await manager.prepareAll([], {} as any, [{ plugin }]);

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await manager.activateAll(internals, {} as any);
    } finally {
      errorSpy.mockRestore();
    }

    expect(manager.getPlugin('throwing-activate')).toBeUndefined();
    expect(internals.tools.get('activation_failed_tool')).toBeUndefined();
    expect(internals.prompt.assemble([]).systemInstruction?.parts).toEqual([{ text: 'base-system' }]);
  });


  it('wrapTool 在插件卸载时恢复原 handler', async () => {
    const internals = createInternals();
    internals.tools.register(makeTool('base_tool', async (args) => ({ original: args.value })));

    const plugin: IrisPlugin = {
      name: 'wrap-demo',
      version: '1.0.0',
      activate(ctx) {
        ctx.wrapTool('base_tool', async (original, args) => {
          const result = await original(args);
          return { wrapped: result };
        });
      },
    };

    const manager = new PluginManager();
    await manager.prepareAll([], {} as any, [{ plugin }]);
    await manager.activateAll(internals, {} as any);

    await expect(internals.tools.execute('base_tool', { value: 1 }) as Promise<unknown>)
      .resolves.toEqual({ wrapped: { original: 1 } });

    await manager.deactivateAll();

    await expect(internals.tools.execute('base_tool', { value: 2 }) as Promise<unknown>)
      .resolves.toEqual({ original: 2 });
  });

  it('热卸载后重新启用应保留 plugins.yaml 的 config 和 priority', async () => {
    const extension = createWorkspacePluginExtension(`
export default {
  name: __PLUGIN_NAME__,
  version: '1.0.0',
  activate(ctx) {
    globalThis[${JSON.stringify(HOTPLUG_CONFIG_KEY)}] = ctx.getPluginConfig();
  },
};
`);
    const internals = createInternals();
    const manager = new PluginManager();
    manager.setExtensionDiscoveryOptions({ workspace: { enabled: true, allowlist: [extension.name] } });

    await manager.prepareAll([
      { name: extension.name, priority: 42, config: { mood: 'gentle' } },
    ], {} as any);
    await manager.activateAll(internals, {} as any);

    expect((globalThis as Record<string, unknown>)[HOTPLUG_CONFIG_KEY]).toEqual({ mood: 'gentle' });
    expect(manager.getPlugin(extension.name)?.priority).toBe(42);

    await manager.deactivatePlugin(extension.name);
    delete (globalThis as Record<string, unknown>)[HOTPLUG_CONFIG_KEY];

    await manager.activatePlugin(extension.name);

    expect((globalThis as Record<string, unknown>)[HOTPLUG_CONFIG_KEY]).toEqual({ mood: 'gentle' });
    expect(manager.getPlugin(extension.name)?.priority).toBe(42);
  });

  it('运行时启用启动期未 prepared 的插件时应使用调用方传入的完整 PluginEntry', async () => {
    const extension = createWorkspacePluginExtension(`
export default {
  name: __PLUGIN_NAME__,
  version: '1.0.0',
  activate(ctx) {
    globalThis[${JSON.stringify(HOTPLUG_CONFIG_KEY)}] = ctx.getPluginConfig();
  },
};
`);
    const internals = createInternals();
    const manager = new PluginManager();
    manager.setExtensionDiscoveryOptions({ workspace: { enabled: true, allowlist: [extension.name] } });
    await manager.prepareAll([], {} as any);
    await manager.activateAll(internals, {} as any);

    await manager.activatePlugin(extension.name, {
      name: extension.name,
      type: 'local',
      priority: 7,
      config: { source: 'runtime-entry' },
    });

    expect((globalThis as Record<string, unknown>)[HOTPLUG_CONFIG_KEY]).toEqual({ source: 'runtime-entry' });
    expect(manager.getPlugin(extension.name)?.priority).toBe(7);
  });

  it('运行时启用插件时应在平台已就绪后补触发 onPlatformsReady', async () => {
    const extension = createWorkspacePluginExtension(`
export default {
  name: __PLUGIN_NAME__,
  version: '1.0.0',
  activate(ctx) {
    ctx.onPlatformsReady((platforms) => {
      globalThis[${JSON.stringify(HOTPLUG_PLATFORMS_KEY)}] = Array.from(platforms.keys());
    });
  },
};
`);
    const internals = createInternals();
    const manager = new PluginManager();
    manager.setExtensionDiscoveryOptions({ workspace: { enabled: true, allowlist: [extension.name] } });
    await manager.prepareAll([], {} as any);
    await manager.activateAll(internals, {} as any);
    await manager.notifyReady({ eventBus: {}, pluginManager: manager } as any);
    await manager.notifyPlatformsReady(new Map([['web', {} as any]]));

    await manager.activatePlugin(extension.name, { name: extension.name, type: 'local' });

    expect((globalThis as Record<string, unknown>)[HOTPLUG_PLATFORMS_KEY]).toEqual(['web']);
  });
});

describe('web router disposable routes', () => {
  it('dispose 后已注册 route 不再匹配', async () => {
    const router = new Router();
    let seenId: string | undefined;
    const disposable = router.get('/api/items/:id', async (_req, _res, params) => {
      seenId = params.id;
    });

    const req = { method: 'GET', url: '/api/items/42', headers: { host: 'localhost' } } as any;
    const res = {} as any;

    await expect(router.handle(req, res)).resolves.toBe(true);
    expect(seenId).toBe('42');

    disposable.dispose();
    seenId = undefined;

    await expect(router.handle(req, res)).resolves.toBe(false);
    expect(seenId).toBeUndefined();
  });

  it('相同路径重复注册时，释放旧 route 后新 route 可接管', async () => {
    const router = new Router();
    const calls: string[] = [];
    const first = router.get('/api/hotplug', async () => { calls.push('first'); });
    router.get('/api/hotplug', async () => { calls.push('second'); });

    const req = { method: 'GET', url: '/api/hotplug', headers: { host: 'localhost' } } as any;
    const res = {} as any;

    await expect(router.handle(req, res)).resolves.toBe(true);
    expect(calls).toEqual(['first']);

    first.dispose();

    await expect(router.handle(req, res)).resolves.toBe(true);
    expect(calls).toEqual(['first', 'second']);
  });
});
