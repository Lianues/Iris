import type { ExtensionLogger } from '../logger.js';
import { createExtensionLogger } from '../logger.js';
import type { LLMRequest } from '../llm.js';
import type { Content, Part } from '../message.js';
import type { ModeDefinition } from '../mode.js';
import type { PlatformAdapter } from '../platform.js';
import type { ToolDefinition, ToolHandler } from '../tool.js';
import type { IrisAPI } from './api.js';
import type {
  LLMRouterLike,
  ModeRegistryLike,
  PluginEventBusLike,
  PluginManagerLike,
  ToolRegistryLike,
} from './registry.js';
import type {
  BootstrapExtensionRegistryLike,
  LLMProviderFactory,
  MemoryFactory,
  OCRFactory,
  PlatformFactory,
  StorageFactory,
} from './types.js';
import type { Disposable, ServiceRegistryLike } from './service.js';
import type { ConfigContributionRegistryLike } from './config-contribution.js';

export type ToolWrapper = (
  original: ToolHandler,
  args: Record<string, unknown>,
  toolName: string,
) => Promise<unknown>;

export type ToolExecInterception =
  | { blocked: true; reason: string }
  | { blocked: false; args?: Record<string, unknown> };

export interface PluginHook {
  name: string;
  priority?: number;
  onBeforeChat?(params: { sessionId: string; text: string }): Promise<{ text: string } | undefined> | { text: string } | undefined;
  onAfterChat?(params: { sessionId: string; content: string }): Promise<{ content: string } | undefined> | { content: string } | undefined;
  onBeforeToolExec?(params: {
    toolName: string;
    args: Record<string, unknown>;
    /** Platform type that triggered this action (e.g., 'telegram', 'discord', 'web', 'console') */
    platformType?: string;
    /** Platform-specific user identifier */
    platformUserId?: string;
  }): Promise<ToolExecInterception | undefined> | ToolExecInterception | undefined;
  onAfterToolExec?(params: { toolName: string; args: Record<string, unknown>; result: unknown; durationMs: number }): Promise<{ result: unknown } | undefined> | { result: unknown } | undefined;
  onBeforeLLMCall?(params: { request: LLMRequest; round: number }): Promise<{ request: LLMRequest } | undefined> | { request: LLMRequest } | undefined;
  onAfterLLMCall?(params: { content: Content; round: number }): Promise<{ content: Content } | undefined> | { content: Content } | undefined;
  onSessionCreate?(params: { sessionId: string }): Promise<void> | void;
  onSessionClear?(params: { sessionId: string }): Promise<void> | void;

  /**
   * 配置文件变化时调用。
   * 插件可在此钩子中读取新配置并重新初始化资源。
   * @param params.config 重载后的最新 AppConfig
   * @param params.rawMergedConfig 合并后的原始配置数据（未经类型解析）
   */
  onConfigReload?(params: { config: Readonly<Record<string, unknown>>; rawMergedConfig: Record<string, unknown> }): Promise<void> | void;
}

/**
 * 插件程序化 Skill 定义。
 *
 * 插件可通过 `PluginContext.registerSkill()` 注册 Skill，
 * 优先级低于文件系统 Skill（用户可通过同名文件覆盖）。
 */
export interface PluginSkillDefinition {
  /** Skill 名称（需匹配 ^[a-zA-Z0-9_-]{1,64}$） */
  name: string;
  /** Skill 描述 */
  description: string;
  /** 模型触发条件描述（写入工具声明帮助模型判断何时使用） */
  whenToUse?: string;
  /** 激活时自动放行的工具名称列表 */
  allowedTools?: string[];
  /** 模型覆盖（使用此 skill 时切换到指定模型） */
  model?: string;
  /** 执行模式：'inline'（注入对话，默认）或 'fork'（独立子代理） */
  context?: 'inline' | 'fork';
  /** Skill 内容（markdown body） */
  content: string;
  /** 来源插件名称（自动填充，无需手动设置） */
  pluginName?: string;
}

export interface PreBootstrapContext {
  getConfig(): Readonly<Record<string, unknown>>;
  mutateConfig(mutator: (config: Record<string, unknown>) => void): void;
  registerLLMProvider(name: string, factory: LLMProviderFactory): void;
  registerStorageProvider(type: string, factory: StorageFactory): void;
  registerMemoryProvider(type: string, factory: MemoryFactory): void;
  registerOCRProvider(name: string, factory: OCRFactory): void;
  registerPlatform(name: string, factory: PlatformFactory): void;
  getExtensions(): BootstrapExtensionRegistryLike;
  getLogger(tag?: string): PluginLogger;
  getPluginConfig<T = Record<string, unknown>>(): T | undefined;

  /**
   * 获取宿主配置目录的绝对路径。
   * 例如 ~/.iris/configs/ 或 Agent 专属的配置目录。
   */
  getConfigDir(): string;

  /**
   * 确保一个配置文件存在于宿主配置目录中。
   * 文件已存在时不做任何修改，返回 false。
   * 文件不存在时写入提供的内容，返回 true。
   * 用于扩展在首次运行时安装默认配置模板。
   * @param filename 文件名（含扩展名），如 'computer_use.yaml'
   * @param content 默认 YAML 内容字符串
   */
  ensureConfigFile(filename: string, content: string): boolean;

  /**
   * 从宿主配置目录读取指定 YAML 配置段。
   * @param section 配置段名称（不含 .yaml 后缀），如 'computer_use'
   * @returns 解析后的对象，文件不存在时返回 undefined
   */
  readConfigSection(section: string): Record<string, unknown> | undefined;
}

export interface PluginContext {
  registerTool(tool: ToolDefinition): void;
  registerTools(tools: ToolDefinition[]): void;
  registerMode(mode: ModeDefinition): void;
  addHook(hook: PluginHook): void;
  getToolRegistry(): ToolRegistryLike;
  getModeRegistry(): ModeRegistryLike;
  getRouter(): LLMRouterLike;
  wrapTool(toolName: string, wrapper: ToolWrapper): void;
  addSystemPromptPart(part: Part): void;
  removeSystemPromptPart(part: Part): void;
  onReady(callback: (api: IrisAPI) => void | Promise<void>): void;
  onPlatformsReady(callback: (platforms: ReadonlyMap<string, PlatformAdapter>, api: IrisAPI) => void | Promise<void>): void;
  getConfig(): Readonly<Record<string, unknown>>;
  getLogger(tag?: string): PluginLogger;
  getPluginConfig<T = Record<string, unknown>>(): T | undefined;
  /** 获取当前扩展的根目录绝对路径（仅扩展插件有效，内联插件返回 undefined） */
  getExtensionRootDir(): string | undefined;
  /** 获取宿主配置目录的绝对路径 */
  getConfigDir(): string;
  /**
   * 确保一个配置文件存在于宿主配置目录中。
   * 文件已存在时返回 false；文件不存在时写入内容并返回 true。
   */
  ensureConfigFile(filename: string, content: string): boolean;
  /** 从宿主配置目录读取指定 YAML 配置段（不含 .yaml 后缀） */
  readConfigSection(section: string): Record<string, unknown> | undefined;

  // ── Skill 注册 ──

  /**
   * 程序化注册 Skill（优先级低于文件系统 Skill，用户可通过同名文件覆盖）。
   * 返回 Disposable，调用 dispose() 可注销该 Skill。
   */
  registerSkill(definition: PluginSkillDefinition): Disposable;

  // ── 插件间协作 ──

  /** 获取插件间事件总线（插件间通信通道） */
  getEventBus?(): PluginEventBusLike;
  /** 获取插件管理器（查询其他已加载插件） */
  getPluginManager?(): PluginManagerLike;
  /** 更新当前插件已注册 Hook 的优先级 */
  setHookPriority?(hookName: string, priority: number): boolean;
  /** 获取服务注册中心（插件间 API 注册与发现） */
  getServiceRegistry(): ServiceRegistryLike;
  /** 获取配置贡献注册中心（统一配置 schema 注册与查询） */
  getConfigContributions(): ConfigContributionRegistryLike;
}

export interface IrisPlugin {
  name: string;
  version: string;
  description?: string;
  preBootstrap?(context: PreBootstrapContext): Promise<void> | void;
  activate(context: PluginContext): Promise<void> | void;
  deactivate?(): Promise<void> | void;
}

export interface PluginEntry {
  name: string;
  type?: 'local' | 'npm' | 'inline';
  enabled?: boolean;
  priority?: number;
  config?: Record<string, unknown>;
}

export interface InlinePluginEntry {
  plugin: IrisPlugin;
  enabled?: boolean;
  priority?: number;
  config?: Record<string, unknown>;
}

export type PluginLogger = ExtensionLogger;

export function createPluginLogger(pluginName: string, tag?: string): PluginLogger {
  const scope = tag ? `Plugin:${pluginName}:${tag}` : `Plugin:${pluginName}`;
  return createExtensionLogger(scope);
}

export function definePlugin<T extends IrisPlugin>(plugin: T): T {
  return plugin;
}
