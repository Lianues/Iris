/**
 * 插件管理器
 *
 * 负责插件的发现、预加载、预启动、激活和停用。
 * 支持统一 extension 目录（~/.iris/extensions/、./extensions/）和 npm 包插件（iris-plugin-*）。
 */

import * as fs from 'fs';
import { parse as parseYAML } from 'yaml';
import { createLogger } from '../logger';
import type { ToolRegistry } from '../tools/registry';
import type { ModeRegistry } from '../modes/registry';
import type { PromptAssembler } from '../prompt/assembler';
import type { AppConfig } from '../config/types';
import type { LLMRouter } from '../llm/router';
import type { BootstrapExtensionRegistry } from '../bootstrap/extensions';
import type { IrisPlugin, PluginEntry, InlinePluginEntry, PluginHook, IrisAPI } from '@irises/extension-sdk';
import type { PluginInfo, LoadedPlugin } from './types';
import { PluginContextImpl } from './context';
import { PreBootstrapContextImpl } from './prebootstrap-context';
import type { PlatformAdapter } from '@irises/extension-sdk';
import {
  importLocalExtensionModule,
  resolveLocalPluginSource,
} from './registry';
import type { ResolvedLocalPlugin } from '@irises/extension-sdk';

const logger = createLogger('PluginManager');

interface PreparedPlugin {
  entry: PluginEntry;
  plugin: IrisPlugin;
  extensionRootDir?: string;
  pluginConfig?: Record<string, unknown>;
}

function byPriorityDesc<T extends { priority?: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
}

export class PluginManager {
  private plugins = new Map<string, LoadedPlugin>();
  private prepared: PreparedPlugin[] = [];
  /** 在 notifyReady 中缓存 IrisAPI 引用，供 notifyPlatformsReady 使用 */
  private _api?: IrisAPI;
  /** 宿主配置目录（由 bootstrap 设置） */
  private _configDir?: string;
  /** 开发模式：源码加载的扩展白名单 */
  private _devSourceExtensions?: string[];

  /** 设置宿主配置目录（供 bootstrap 调用） */
  setConfigDir(dir: string): void { this._configDir = dir; }

  /** 设置源码加载白名单（供 bootstrap 调用） */
  setDevSourceExtensions(list?: string[]): void { this._devSourceExtensions = list; }

  /**
   * 预加载所有配置中启用的插件。
   * 在 bootstrap 中调用，位于配置解析之后、核心对象创建之前。
   */
  async prepareAll(entries: PluginEntry[], _appConfig: AppConfig, inlineEntries: InlinePluginEntry[] = []): Promise<void> {
    this.prepared = [];

    for (const entry of byPriorityDesc(entries)) {
      if (entry.enabled === false) {
        logger.info(`插件 "${entry.name}" 已禁用，跳过`);
        continue;
      }

      try {
        const resolved = await this.resolvePlugin(entry);
        const pluginConfig = this.loadPluginConfig(entry, resolved.localSource);
        const extensionRootDir = resolved.localSource?.rootDir;
        this.prepared.push({ entry, plugin: resolved.plugin, pluginConfig, extensionRootDir });
      } catch (err) {
        logger.error(`插件 "${entry.name}" 预加载失败:`, err);
      }
    }

    for (const inlineEntry of byPriorityDesc(inlineEntries)) {
      const pluginName = inlineEntry.plugin?.name || '<inline>';
      if (inlineEntry.enabled === false) {
        logger.info(`内联插件 "${pluginName}" 已禁用，跳过`);
        continue;
      }

      try {
        this.validatePlugin(inlineEntry.plugin, pluginName);
        this.prepared.push({
          entry: { name: inlineEntry.plugin.name, type: 'inline', enabled: true, priority: inlineEntry.priority, config: inlineEntry.config },
          plugin: inlineEntry.plugin,
          pluginConfig: inlineEntry.config,
        });
      } catch (err) {
        logger.error(`内联插件 "${pluginName}" 预加载失败:`, err);
      }
    }

    this.prepared.sort((a, b) => (b.entry.priority ?? 0) - (a.entry.priority ?? 0));

    const loaded = this.prepared.length;
    if (loaded > 0) {
      logger.info(`已预加载 ${loaded} 个插件`);
    }
  }

  /**
   * 执行 PreBootstrap 阶段。
   * 插件可在此阶段修改配置并注册 Provider / Platform 工厂。
   */
  async runPreBootstrap(appConfig: AppConfig, extensions: BootstrapExtensionRegistry): Promise<void> {
    for (const prepared of this.prepared) {
      if (typeof prepared.plugin.preBootstrap !== 'function') continue;

      try {
        const context = new PreBootstrapContextImpl(
          prepared.entry.name,
          appConfig,
          extensions,
          prepared.pluginConfig,
          this._configDir,
        );
        await prepared.plugin.preBootstrap(context as any);
        logger.info(`插件 "${prepared.plugin.name}@${prepared.plugin.version}" 已完成 preBootstrap`);
      } catch (err) {
        logger.error(`插件 "${prepared.entry.name}" preBootstrap 执行失败:`, err);
      }
    }
  }

  /**
   * 激活全部已预加载插件。
   * 在 bootstrap 中调用，位于 ToolRegistry/ModeRegistry/PromptAssembler 创建之后、Backend 创建之前。
   */
  async activateAll(
    internals: { tools: ToolRegistry; modes: ModeRegistry; prompt: PromptAssembler; router: LLMRouter },
    appConfig: AppConfig,
  ): Promise<void> {
    for (const prepared of this.prepared) {
      try {
        await this.activatePrepared(prepared, internals, appConfig);
      } catch (err) {
        logger.error(`插件 "${prepared.entry.name}" 激活失败:`, err);
      }
    }

    const loaded = this.plugins.size;
    if (loaded > 0) {
      logger.info(`已激活 ${loaded} 个插件`);
    }
  }

  /**
   * 兼容旧调用：一次性完成预加载与激活。
   * 建议新代码使用 prepareAll + runPreBootstrap + activateAll。
   */
  async loadAll(
    entries: PluginEntry[],
    internals: { tools: ToolRegistry; modes: ModeRegistry; prompt: PromptAssembler; router: LLMRouter },
    appConfig: AppConfig,
    inlineEntries: InlinePluginEntry[] = [],
  ): Promise<void> {
    await this.prepareAll(entries, appConfig, inlineEntries);
    await this.activateAll(internals, appConfig);
  }

  /**
   * 通知所有插件 Backend 已创建完成。
   * 依次调用各插件通过 ctx.onReady() 注册的回调，传递完整的内部 API。
   */
  async notifyReady(api: IrisAPI): Promise<void> {
    this._api = api;

    // 注入插件间协作引用（eventBus + pluginManager）
    for (const loaded of this.plugins.values()) {
      loaded.context.setInteropRefs(api.eventBus, api.pluginManager);
    }

    for (const loaded of byPriorityDesc(Array.from(this.plugins.values()).map(item => item.entry)).map(entry => this.plugins.get(entry.name)!).filter(Boolean)) {
      for (const callback of loaded.readyCallbacks) {
        try {
          await callback(api);
        } catch (err) {
          logger.error(`插件 "${loaded.entry.name}" onReady 回调执行失败:`, err);
        }
      }
    }
  }

  /**
   * 通知所有插件平台已创建完成。
   * 在 createPlatforms() 之后调用，传递已创建的平台 Map。
   */
  async notifyPlatformsReady(platforms: ReadonlyMap<string, PlatformAdapter>): Promise<void> {
    if (!this._api) return;
    for (const loaded of byPriorityDesc(
      Array.from(this.plugins.values()).map(item => item.entry),
    ).map(entry => this.plugins.get(entry.name)!).filter(Boolean)) {
      for (const callback of loaded.platformReadyCallbacks) {
        try {
          await callback(platforms, this._api);
        } catch (err) {
          logger.error(`插件 "${loaded.entry.name}" onPlatformsReady 回调执行失败:`, err);
        }
      }
    }
  }

  /** 停用所有插件并清空 */
  async unloadAll(): Promise<void> {
    for (const [name, loaded] of this.plugins) {
      try {
        await loaded.plugin.deactivate?.();
        logger.info(`插件 "${name}" 已停用`);
      } catch (err) {
        logger.error(`插件 "${name}" 停用失败:`, err);
      }
    }
    this.plugins.clear();
    this.prepared = [];
  }

  /** 获取所有已加载插件注册的钩子 */
  getHooks(): PluginHook[] {
    const hooks: PluginHook[] = [];
    for (const loaded of this.plugins.values()) {
      hooks.push(...loaded.hooks);
    }
    return hooks.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  }

  /** 列出已加载的插件信息 */
  listPlugins(): PluginInfo[] {
    return Array.from(this.plugins.values()).map(({ entry, plugin, hooks }) => ({
      name: plugin.name,
      version: plugin.version,
      description: plugin.description,
      enabled: true,
      type: entry.type ?? 'local',
      priority: entry.priority ?? 0,
      hookCount: hooks.length,
    }));
  }

  /** 根据名称查找指定插件 */
  getPlugin(name: string): PluginInfo | undefined {
    return this.listPlugins().find(p => p.name === name);
  }

  /** 已加载插件数量 */
  get size(): number {
    return this.plugins.size;
  }

  /**
   * 触发所有已注册的 onConfigReload 钩子。
   * 在 applyRuntimeConfigReload 末尾调用。
   */
  async invokeConfigReloadHooks(appConfig: Readonly<AppConfig>, rawMergedConfig: Record<string, unknown>): Promise<void> {
    const hooks = this.getHooks();
    for (const hook of hooks) {
      if (typeof hook.onConfigReload !== 'function') continue;
      try {
        await hook.onConfigReload({ config: appConfig, rawMergedConfig });
      } catch (err) {
        logger.error(`插件钩子 "${hook.name}" onConfigReload 执行失败:`, err);
      }
    }
  }

  // ============ 私有方法 ============

  private async activatePrepared(
    prepared: PreparedPlugin,
    internals: { tools: ToolRegistry; modes: ModeRegistry; prompt: PromptAssembler; router: LLMRouter },
    appConfig: AppConfig,
  ): Promise<void> {
    if (this.plugins.has(prepared.entry.name)) {
      logger.warn(`插件 "${prepared.entry.name}" 已激活，跳过重复注册`);
      return;
    }

    const context = new PluginContextImpl(
      prepared.entry.name,
      internals.tools,
      internals.modes,
      internals.router,
      appConfig,
      internals.prompt,
      prepared.pluginConfig,
      prepared.extensionRootDir,
      this._configDir,
    );

    await prepared.plugin.activate(context);

    this.plugins.set(prepared.entry.name, {
      entry: prepared.entry,
      plugin: prepared.plugin,
      context,
      hooks: context.getHooks(),
      readyCallbacks: context.getReadyCallbacks(),
      platformReadyCallbacks: context.getPlatformReadyCallbacks(),
    });

    logger.info(`插件 "${prepared.plugin.name}@${prepared.plugin.version}" 已激活`);
  }

  private async resolvePlugin(entry: PluginEntry): Promise<{ plugin: IrisPlugin; localSource?: ResolvedLocalPlugin }> {
    const type = entry.type ?? 'local';
    if (type === 'npm') {
      return { plugin: await this.loadNpmPlugin(entry.name) };
    }
    return this.loadLocalPlugin(entry.name);
  }

  private async loadLocalPlugin(name: string): Promise<{ plugin: IrisPlugin; localSource: ResolvedLocalPlugin }> {
    const localSource = resolveLocalPluginSource(name, undefined, this._devSourceExtensions);
    const mod = await importLocalExtensionModule(localSource.entryFile);
    const plugin = mod.default ?? mod;
    this.validatePlugin(plugin, name);
    return { plugin: plugin as IrisPlugin, localSource };
  }

  private async loadNpmPlugin(name: string): Promise<IrisPlugin> {
    const packageName = `iris-plugin-${name}`;
    try {
      const mod = await import(packageName);
      const plugin = mod.default ?? mod;
      this.validatePlugin(plugin, name);
      return plugin as IrisPlugin;
    } catch (err) {
      throw new Error(`npm 插件 "${packageName}" 加载失败。请确认已安装该包。原始错误: ${err}`);
    }
  }

  private validatePlugin(plugin: unknown, name: string): void {
    if (!plugin || typeof plugin !== 'object') {
      throw new Error(`插件 "${name}" 导出格式无效：应导出一个对象`);
    }
    const p = plugin as Record<string, unknown>;
    if (typeof p.name !== 'string' || !p.name) throw new Error(`插件 "${name}" 缺少 name 字段`);
    if (typeof p.version !== 'string' || !p.version) throw new Error(`插件 "${name}" 缺少 version 字段`);
    if (typeof p.activate !== 'function') throw new Error(`插件 "${name}" 缺少 activate 方法`);
  }

  private loadPluginConfig(entry: PluginEntry, localSource?: ResolvedLocalPlugin): Record<string, unknown> | undefined {
    let baseConfig: Record<string, unknown> | undefined;

    if (localSource?.configPath && fs.existsSync(localSource.configPath)) {
      try {
        const raw = fs.readFileSync(localSource.configPath, 'utf-8');
        const parsed = parseYAML(raw);
        if (parsed && typeof parsed === 'object') {
          baseConfig = parsed as Record<string, unknown>;
        }
      } catch {
        logger.warn(`插件 "${entry.name}" 的 config.yaml 解析失败`);
      }
    }

    if (entry.config) {
      return { ...(baseConfig ?? {}), ...entry.config };
    }
    return baseConfig;
  }
}
