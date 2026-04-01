/**
 * extension 统一加载测试。
 */

import * as fs from 'fs';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
// PluginManager 已从 src/plugins/ 迁移到 src/extension/，更新导入路径
import { PluginManager } from '../src/extension/manager.js';
import { PlatformRegistry } from '../src/core/platform-registry.js';
import { PromptAssembler } from '../src/prompt/assembler.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { ModeRegistry } from '../src/modes/registry.js';
import { discoverLocalExtensions, registerExtensionPlatforms, resolveLocalPluginSource } from '../src/extension/index.js';
import { workspaceExtensionsDir } from '../src/paths.js';

const createdDirs: string[] = [];
const SEEN_CONFIG_KEY = '__irisExtensionSeenConfig';

function createInternals() {
  const prompt = new PromptAssembler();
  prompt.setSystemPrompt('test');
  return {
    tools: new ToolRegistry(),
    modes: new ModeRegistry(),
    prompt,
    router: {} as any,
  };
}

function createWorkspaceExtension() {
  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const name = `vitest-extension-${suffix}`;
  const platformName = `vitest-platform-${suffix}`;
  const rootDir = path.join(workspaceExtensionsDir, name);

  fs.mkdirSync(rootDir, { recursive: true });
  createdDirs.push(rootDir);

  fs.writeFileSync(
    path.join(rootDir, 'manifest.json'),
    JSON.stringify({
      name,
      version: '0.1.0',
      plugin: {
        entry: 'plugin.mjs',
      },
      platforms: [
        {
          name: platformName,
          entry: 'platform.mjs',
        },
      ],
    }, null, 2),
    'utf-8',
  );

  fs.writeFileSync(
    path.join(rootDir, 'config.yaml'),
    'fromExtension: true\n',
    'utf-8',
  );

  fs.writeFileSync(
    path.join(rootDir, 'plugin.mjs'),
    `export default {
      name: ${JSON.stringify(name)},
      version: '0.1.0',
      activate(ctx) {
        globalThis[${JSON.stringify(SEEN_CONFIG_KEY)}] = ctx.getPluginConfig();
      },
    };
`,
    'utf-8',
  );

  fs.writeFileSync(
    path.join(rootDir, 'platform.mjs'),
    `export default async function () {
      return {
        name: ${JSON.stringify(platformName)},
        async start() {},
        async stop() {},
      };
    }
`,
    'utf-8',
  );

  return { name, platformName, rootDir };
}

afterEach(() => {
  for (const dir of createdDirs.splice(0, createdDirs.length)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  delete (globalThis as Record<string, unknown>)[SEEN_CONFIG_KEY];
});

describe('extension registry', () => {
  it('支持从 workspace extensions 目录加载插件，并自动注册平台贡献', async () => {
    const extension = createWorkspaceExtension();

    const localSource = resolveLocalPluginSource(extension.name);
    expect(localSource.type).toBe('extension-plugin');
    expect(localSource.entryFile).toBe(path.join(extension.rootDir, 'plugin.mjs'));
    expect(localSource.configPath).toBe(path.join(extension.rootDir, 'config.yaml'));

    const manager = new PluginManager();
    await manager.prepareAll([
      {
        name: extension.name,
        config: {
          fromConfig: 'yes',
        },
      },
    ], {} as any);
    await manager.activateAll(createInternals(), {} as any);

    expect(manager.listPlugins()).toHaveLength(1);
    expect(manager.listPlugins()[0].name).toBe(extension.name);
    expect((globalThis as Record<string, unknown>)[SEEN_CONFIG_KEY]).toEqual({
      fromExtension: true,
      fromConfig: 'yes',
    });

    const registry = new PlatformRegistry();
    const registered = registerExtensionPlatforms(registry);
    expect(registered).toContain(extension.platformName);

    const platform = await registry.create(extension.platformName, {} as any);
    expect((platform as { name: string }).name).toBe(extension.platformName);
  });

  it('被标记为 disabled 的 extension 不应再被发现、加载或注册平台', () => {
    const extension = createWorkspaceExtension();
    fs.writeFileSync(path.join(extension.rootDir, '.disabled'), 'disabled\n', 'utf8');

    const packages = discoverLocalExtensions();
    expect(packages.find((item) => item.manifest.name === extension.name)).toBeUndefined();
    expect(() => resolveLocalPluginSource(extension.name, packages)).toThrow(`未找到本地 extension: ${extension.name}`);

    const registry = new PlatformRegistry();
    const registered = registerExtensionPlatforms(registry, packages);
    expect(registered).not.toContain(extension.platformName);
  });
});
