/**
 * 插件上下文实现
 *
 * 每个插件在激活时获得一个独立的 PluginContext 实例。
 * 提供便捷 API 和对内部对象的直接访问。
 */

import type { ToolDefinition, Part } from '../types';
import type { ModeDefinition } from '../modes/types';
import type { AppConfig, SkillDefinition, SkillContextModifier } from '../config/types';
import type { ToolRegistry } from '../tools/registry';
import * as fs from 'fs';
import * as path from 'path';
import { parse as parseYAML } from 'yaml';
import type { ModeRegistry } from '../modes/registry';
import type { PromptAssembler } from '../prompt/assembler';
import type { LLMRouter } from '../llm/router';
import type { PluginContext, PluginHook, PluginLogger, PluginSkillDefinition, ToolWrapper, IrisAPI, PluginEventBusLike, PluginManagerLike, Disposable, ServiceRegistryLike, ConfigContributionRegistryLike } from '@irises/extension-sdk';
import { createLogger } from '../logger';
import type { PlatformAdapter } from '@irises/extension-sdk';

export class PluginContextImpl {
  private hooks: PluginHook[] = [];
  private readyCallbacks: Array<(api: IrisAPI) => void | Promise<void>> = [];
  private _platformReadyCallbacks: Array<(platforms: ReadonlyMap<string, PlatformAdapter>, api: IrisAPI) => void | Promise<void>> = [];
  /** 插件程序化注册的 Skill（name → SkillDefinition） */
  private _pluginSkills = new Map<string, SkillDefinition>();
  /** Skill 变化回调（由外部设置，注册/注销时通知 Backend 刷新） */
  private _onPluginSkillsChanged?: () => void;

  constructor(
    private pluginName: string,
    private toolRegistry: ToolRegistry,
    private modeRegistry: ModeRegistry,
    private router: LLMRouter,
    private appConfig: AppConfig,
    private promptAssembler: PromptAssembler,
    private _serviceRegistry: ServiceRegistryLike,
    private _configContributions: ConfigContributionRegistryLike,
    private pluginConfig?: Record<string, unknown>,
    private extensionRootDir?: string,
    private configDir?: string,
  ) {}

  // ---- 工具扩展 ----

  registerTool(tool: ToolDefinition): void {
    this.toolRegistry.register(tool);
  }

  registerTools(tools: ToolDefinition[]): void {
    this.toolRegistry.registerAll(tools);
  }

  // ---- 模式扩展 ----

  registerMode(mode: ModeDefinition): void {
    this.modeRegistry.register(mode);
  }

  // ---- 事件钩子 ----

  addHook(hook: PluginHook): void {
    this.hooks.push(hook);
  }

  // ---- 直接访问内部注册表 ----

  getToolRegistry(): ToolRegistry {
    return this.toolRegistry;
  }

  getModeRegistry(): ModeRegistry {
    return this.modeRegistry;
  }

  getRouter(): LLMRouter {
    return this.router;
  }

  // ---- 工具拦截 ----

  wrapTool(toolName: string, wrapper: ToolWrapper): void {
    const tool = this.toolRegistry.get(toolName);
    if (!tool) {
      throw new Error(`wrapTool: 工具 "${toolName}" 未注册`);
    }
    const originalHandler = tool.handler;
    tool.handler = (args) => wrapper(originalHandler, args, toolName);
  }

  // ---- 提示词操作 ----

  addSystemPromptPart(part: Part): void {
    this.promptAssembler.addSystemPart(part);
  }

  removeSystemPromptPart(part: Part): void {
    this.promptAssembler.removeSystemPart(part);
  }

  // ---- Skill 注册 ----

  registerSkill(definition: PluginSkillDefinition): Disposable {
    const name = definition.name;

    // 校验名称格式
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(name)) {
      throw new Error(`registerSkill: Skill 名称 "${name}" 不合法（需匹配 ^[a-zA-Z0-9_-]{1,64}$）`);
    }

    // 将 PluginSkillDefinition 转换为内部 SkillDefinition
    const mode = definition.context === 'fork' ? 'fork' as const : 'inline' as const;
    const contextModifier: SkillContextModifier | undefined =
      (definition.allowedTools || definition.model) ? {
        autoApproveTools: definition.allowedTools,
        modelOverride: definition.model,
      } : undefined;

    const skillDef: SkillDefinition = {
      name,
      description: definition.description,
      content: definition.content,
      path: `plugin:${definition.pluginName ?? this.pluginName}:${name}`,
      allowedTools: definition.allowedTools,
      model: definition.model,
      mode,
      whenToUse: definition.whenToUse,
      userInvocable: true,
      contextModifier,
    };

    this._pluginSkills.set(name, skillDef);
    this._onPluginSkillsChanged?.();

    return {
      dispose: () => {
        this._pluginSkills.delete(name);
        this._onPluginSkillsChanged?.();
      },
    };
  }

  // ---- 延迟初始化 ----

  onReady(callback: (api: IrisAPI) => void | Promise<void>): void {
    this.readyCallbacks.push(callback);
  }

  onPlatformsReady(callback: (platforms: ReadonlyMap<string, PlatformAdapter>, api: IrisAPI) => void | Promise<void>): void {
    this._platformReadyCallbacks.push(callback);
  }

  // ---- 工具方法 ----

  getConfig(): Readonly<AppConfig> {
    return this.appConfig;
  }

  getLogger(tag?: string): PluginLogger {
    const prefix = tag
      ? `Plugin:${this.pluginName}:${tag}`
      : `Plugin:${this.pluginName}`;
    return createLogger(prefix);
  }

  getPluginConfig<T = Record<string, unknown>>(): T | undefined {
    return this.pluginConfig as T | undefined;
  }

  getExtensionRootDir(): string | undefined {
    return this.extensionRootDir;
  }

  // ---- 配置文件管理 ----

  getConfigDir(): string {
    if (!this.configDir) throw new Error('configDir 未设置');
    return this.configDir;
  }

  ensureConfigFile(filename: string, content: string): boolean {
    if (!this.configDir) throw new Error('configDir 未设置');
    const filePath = path.join(this.configDir, filename);
    if (fs.existsSync(filePath)) return false;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf-8');
    return true;
  }

  readConfigSection(section: string): Record<string, unknown> | undefined {
    if (!this.configDir) return undefined;
    const filePath = path.join(this.configDir, `${section}.yaml`);
    if (!fs.existsSync(filePath)) return undefined;
    const raw = fs.readFileSync(filePath, 'utf-8');
    return (parseYAML(raw) as Record<string, unknown>) ?? undefined;
  }

  // ---- 插件间协作 ----

  private _eventBus?: PluginEventBusLike;
  private _pluginManager?: PluginManagerLike;

  /** 注入事件总线和插件管理器引用（由 PluginManager 在 activate 后调用） */
  setInteropRefs(eventBus: PluginEventBusLike, pluginManager: PluginManagerLike): void {
    this._eventBus = eventBus;
    this._pluginManager = pluginManager;
  }

  getEventBus(): PluginEventBusLike {
    if (!this._eventBus) throw new Error('EventBus 尚未就绪，请在 onReady 回调中访问');
    return this._eventBus;
  }

  getPluginManager(): PluginManagerLike {
    if (!this._pluginManager) throw new Error('PluginManager 尚未就绪，请在 onReady 回调中访问');
    return this._pluginManager;
  }

  setHookPriority(hookName: string, priority: number): boolean {
    const hook = this.hooks.find(h => h.name === hookName);
    if (!hook) return false;
    hook.priority = priority;
    return true;
  }

  // ---- 服务与配置注册中心 ----

  getServiceRegistry(): ServiceRegistryLike {
    return this._serviceRegistry;
  }

  getConfigContributions(): ConfigContributionRegistryLike {
    return this._configContributions;
  }

  // ---- 内部方法（供 PluginManager 使用） ----

  /** 获取插件注册的所有钩子 */
  getHooks(): PluginHook[] {
    return this.hooks;
  }

  /** 获取插件注册的 onReady 回调 */
  getReadyCallbacks(): Array<(api: IrisAPI) => void | Promise<void>> {
    return this.readyCallbacks;
  }

  /** 获取插件注册的 onPlatformsReady 回调 */
  getPlatformReadyCallbacks(): Array<(platforms: ReadonlyMap<string, PlatformAdapter>, api: IrisAPI) => void | Promise<void>> {
    return this._platformReadyCallbacks;
  }

  /** 获取插件程序化注册的所有 Skill */
  getPluginSkills(): Map<string, SkillDefinition> {
    return this._pluginSkills;
  }

  /** 设置 Skill 变化回调（由 PluginManager / IrisCore 在 ready 阶段注入） */
  setOnPluginSkillsChanged(callback: () => void): void {
    this._onPluginSkillsChanged = callback;
  }
}
