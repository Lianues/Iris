/**
 * 插件系统类型定义
 *
 * 插件拥有对 Iris 内部组件的完整访问权限。
 * 由于插件与 Iris 在同一进程中运行，可以直接操作内部对象。
 */

import type { ToolDefinition, ToolHandler, Part, Content, LLMRequest } from '../types';
import type { ModeDefinition } from '../modes/types';
import type { AppConfig } from '../config/types';
import type { PatchDisposer } from './patch';
import type { PluginEventBus } from './event-bus';
import type { PluginManager } from './manager';
import type { ToolRegistry } from '../tools/registry';
import type { PlatformAdapter } from '../platforms/base';
import type { ModeRegistry } from '../modes/registry';
import type { PromptAssembler } from '../prompt/assembler';
import type { StorageProvider } from '../storage/base';
import type { MemoryProvider } from '../memory/base';
import type { LLMRouter } from '../llm/router';
import type { Backend } from '../core/backend';
import type { MCPManager } from '../mcp/manager';
import type { Computer } from '../computer-use/types';
import type { OCRProvider } from '../ocr';
import type {
  BootstrapExtensionRegistry,
  LLMProviderFactory,
  StorageFactory,
  MemoryFactory,
  OCRFactory,
} from '../bootstrap/extensions';
import type { PlatformFactory } from '../platforms/registry';

// ============ 插件定义 ============

/** Iris 插件接口 */
export interface IrisPlugin {
  /** 插件唯一标识 */
  name: string;
  /** 版本号 */
  version: string;
  /** 插件描述 */
  description?: string;

  /**
   * 插件预启动阶段。
   * 在 Router / Storage / Memory / OCR / 平台创建前调用。
   * 插件可在此阶段修改配置、注册 Provider 工厂、注册平台工厂。
   */
  preBootstrap?(context: PreBootstrapContext): Promise<void> | void;

  /**
   * 插件激活。
   * 在 bootstrap 流程中、Backend 创建之前调用。
   * 插件在此方法中注册工具、模式、钩子等。
   */
  activate(context: PluginContext): Promise<void> | void;

  /**
   * 插件停用（可选）。
   * 在应用关闭时调用，用于释放资源。
   */
  deactivate?(): Promise<void> | void;
}

// ============ 内部 API ============

/**
 * Iris 内部 API
 *
 * 在 Backend 创建完成后通过 onReady 回调传递给插件。
 * 提供对所有核心组件的直接访问，不做任何限制。
 */
export interface IrisAPI {
  /** Backend 实例（EventEmitter，可监听所有内部事件、调用所有方法） */
  backend: Backend;
  /** LLM 路由器（切换模型、获取模型信息、动态注册/移除模型） */
  router: LLMRouter;
  /** 存储层（会话历史、元数据） */
  storage: StorageProvider;
  /** 记忆层（可选） */
  memory?: MemoryProvider;
  /** 工具注册表 */
  tools: ToolRegistry;
  /** 模式注册表 */
  modes: ModeRegistry;
  /** 提示词装配器（可直接修改系统提示词） */
  prompt: PromptAssembler;
  /** 当前应用配置（只读） */
  config: Readonly<AppConfig>;
  /** MCP 管理器（可选，未配置 MCP 时为 undefined） */
  mcpManager?: MCPManager;
  /** Computer Use 环境实例（可选，未启用时为 undefined） */
  computerEnv?: Computer;
  /** OCR 服务（可选，未配置时为 undefined） */
  ocrService?: OCRProvider;
  /** 启动扩展注册表（Provider / Platform 工厂） */
  extensions: BootstrapExtensionRegistry;

  // ---- 插件高级能力 ----

  /** 插件管理器（可查询其他插件信息） */
  pluginManager: PluginManager;
  /** 插件间共享事件总线 */
  eventBus: PluginEventBus;

  /**
   * 安全地替换任意对象上的方法。返回 dispose 函数，调用后恢复原始方法。
   * 支持链式叠加，多个插件可以对同一方法依次 patch。
   *
   * @example
   *   const dispose = api.patchMethod(api.backend, 'chat', async (original, sid, text) => {
   *     console.log('before chat');
   *     return original(sid, text);
   *   });
   */
  patchMethod: typeof import('./patch').patchMethod;
  /** 替换类原型上的方法，影响所有实例 */
  patchPrototype: typeof import('./patch').patchPrototype;
  /** 向 Web 平台注册自定义 HTTP 路由。若 Web 平台尚未创建，将在绑定后自动补注册。 */
  registerWebRoute?: (method: string, path: string, handler: (req: any, res: any, params: Record<string, string>) => Promise<void>) => void;
}

// ============ 预启动上下文 ============

/**
 * 预启动阶段上下文。
 *
 * 该阶段发生在核心依赖创建前。插件可在此阶段直接参与系统装配。
 */
export interface PreBootstrapContext {
  /** 获取当前应用配置（只读视图；实际修改请使用 mutateConfig） */
  getConfig(): Readonly<AppConfig>;
  /** 直接修改最终生效的配置对象 */
  mutateConfig(mutator: (config: AppConfig) => void): void;

  /** 注册新的 LLM Provider 工厂 */
  registerLLMProvider(name: string, factory: LLMProviderFactory): void;
  /** 注册新的存储提供商工厂 */
  registerStorageProvider(type: string, factory: StorageFactory): void;
  /** 注册新的记忆提供商工厂 */
  registerMemoryProvider(type: string, factory: MemoryFactory): void;
  /** 注册新的 OCR Provider 工厂 */
  registerOCRProvider(name: string, factory: OCRFactory): void;
  /** 注册新的平台工厂 */
  registerPlatform(name: string, factory: PlatformFactory): void;

  /** 获取完整扩展注册表 */
  getExtensions(): BootstrapExtensionRegistry;
  /** 获取插件专属日志器 */
  getLogger(tag?: string): PluginLogger;
  /** 读取插件配置 */
  getPluginConfig<T = Record<string, unknown>>(): T | undefined;

  /** 获取宿主配置目录的绝对路径 */
  getConfigDir(): string;
  /**
   * 确保一个配置文件存在于宿主配置目录中。
   * 文件已存在时返回 false；文件不存在时写入内容并返回 true。
   */
  ensureConfigFile(filename: string, content: string): boolean;
  /** 从宿主配置目录读取指定 YAML 配置段（不含 .yaml 后缀） */
  readConfigSection(section: string): Record<string, unknown> | undefined;
}

// ============ 插件上下文 ============

/**
 * 插件上下文
 *
 * 插件通过此对象与 Iris 交互。
 * 提供便捷 API 和对内部对象的直接访问。
 */
export interface PluginContext {
  // ---- 工具扩展 ----

  /** 注册一个工具 */
  registerTool(tool: ToolDefinition): void;
  /** 批量注册工具 */
  registerTools(tools: ToolDefinition[]): void;

  // ---- 模式扩展 ----

  /** 注册一个自定义模式 */
  registerMode(mode: ModeDefinition): void;

  // ---- 事件钩子 ----

  /** 注册钩子 */
  addHook(hook: PluginHook): void;

  // ---- 直接访问内部注册表 ----

  /** 获取 ToolRegistry 实例（可直接调用 register/unregister/get/createSubset 等方法） */
  getToolRegistry(): ToolRegistry;
  /** 获取 ModeRegistry 实例 */
  getModeRegistry(): ModeRegistry;
  /** 获取 LLMRouter 实例（可切换模型、动态注册/移除模型） */
  getRouter(): LLMRouter;

  // ---- 工具拦截 ----

  /**
   * 包装已注册工具的 handler。
   * wrapper 接收原始 handler、参数和工具名，返回执行结果。
   * 可多次包装同一个工具，形成洋葱式调用链。
   */
  wrapTool(toolName: string, wrapper: ToolWrapper): void;

  // ---- 提示词操作 ----

  /** 向系统提示词追加一个片段（持久生效，所有请求可见） */
  addSystemPromptPart(part: Part): void;
  /** 移除之前追加的系统提示词片段（按引用匹配） */
  removeSystemPromptPart(part: Part): void;

  // ---- 延迟初始化 ----

  /**
   * 注册 Backend 创建完成后的回调。
   * 回调接收 IrisAPI 参数，包含所有核心组件的引用。
   * 可通过 api.backend.on(...) 监听事件，调用任意方法。
   */
  onReady(callback: (api: IrisAPI) => void | Promise<void>): void;

  // ---- 工具方法 ----

  /**
   * 注册平台创建完成后的回调。
   * 回调接收已创建的平台 Map（platformType → PlatformAdapter）和 IrisAPI。
   * 可通过 api.patchMethod 修改任意平台实例的行为。
   */
  onPlatformsReady(callback: (platforms: ReadonlyMap<string, PlatformAdapter>, api: IrisAPI) => void | Promise<void>): void;

  /** 获取当前应用配置（只读） */
  getConfig(): Readonly<AppConfig>;
  /** 获取插件专属的日志器 */
  getLogger(tag?: string): PluginLogger;
  /** 读取插件配置（插件目录 config.yaml + plugins.yaml 中 config 字段的合并结果） */
  getPluginConfig<T = Record<string, unknown>>(): T | undefined;
  /** 获取当前扩展的根目录绝对路径（仅扩展插件有效，内联插件返回 undefined） */
  getExtensionRootDir(): string | undefined;
  /** 获取宿主配置目录的绝对路径 */
  getConfigDir(): string;
  /** 确保一个配置文件存在于宿主配置目录中 */
  ensureConfigFile(filename: string, content: string): boolean;
  /** 从宿主配置目录读取指定 YAML 配置段 */
  readConfigSection(section: string): Record<string, unknown> | undefined;
}

// ============ 工具拦截 ============

/** 工具包装器类型 */
export type ToolWrapper = (
  original: ToolHandler,
  args: Record<string, unknown>,
  toolName: string,
) => Promise<unknown>;

// ============ 钩子系统 ============

/** 插件钩子 */
export interface PluginHook {
  /** 钩子名称（用于日志标识） */
  name: string;
  /** 钩子优先级。数值越大越先执行。默认 0。 */
  priority?: number;

  /**
   * 消息预处理：在用户消息发给 LLM 前调用。
   * 返回 { text } 替换消息文本，返回 undefined 不修改。
   */
  onBeforeChat?(params: {
    sessionId: string;
    text: string;
  }): Promise<{ text: string } | undefined> | { text: string } | undefined;

  /**
   * 响应后处理：在 LLM 返回最终内容后调用。
   * 返回 { content } 替换响应文本，返回 undefined 不修改。
   */
  onAfterChat?(params: {
    sessionId: string;
    content: string;
  }): Promise<{ content: string } | undefined> | { content: string } | undefined;

  /**
   * 工具执行前拦截：可阻止执行或修改参数。
   * 返回 { blocked: true, reason } 阻止执行。
   * 返回 { blocked: false, args } 修改参数。
   * 返回 undefined 不干预。
   */
  onBeforeToolExec?(params: {
    toolName: string;
    args: Record<string, unknown>;
  }): Promise<ToolExecInterception | undefined> | ToolExecInterception | undefined;

  /**
   * 工具执行后处理：在工具 handler 返回结果后调用。
   * 返回 { result } 替换工具结果，返回 undefined 不修改。
   */
  onAfterToolExec?(params: {
    toolName: string;
    args: Record<string, unknown>;
    result: unknown;
    durationMs: number;
  }): Promise<{ result: unknown } | undefined> | { result: unknown } | undefined;

  /**
   * LLM 请求发出前拦截：可修改完整的 LLM 请求体。
   * 返回 { request } 替换请求，返回 undefined 不修改。
   */
  onBeforeLLMCall?(params: {
    request: LLMRequest;
    round: number;
  }): Promise<{ request: LLMRequest } | undefined> | { request: LLMRequest } | undefined;

  /**
   * LLM 响应返回后拦截：在响应写入历史前调用。
   * 返回 { content } 替换响应，返回 undefined 不修改。
   */
  onAfterLLMCall?(params: {
    content: Content;
    round: number;
  }): Promise<{ content: Content } | undefined> | { content: Content } | undefined;

  /**
   * 会话创建时调用（首条消息到达新 session 时触发）。
   * 仅通知，不可阻止。
   */
  onSessionCreate?(params: {
    sessionId: string;
  }): Promise<void> | void;

  /**
   * 会话清空时调用（clearSession / /clear 命令触发）。
   * 仅通知，不可阻止。
   */
  onSessionClear?(params: {
    sessionId: string;
  }): Promise<void> | void;

  /**
   * 配置文件变化时调用。
   * 插件可在此钩子中读取新配置并重新初始化资源。
   * @param params.config 重载后的最新 AppConfig（只读）
   * @param params.rawMergedConfig 合并后的原始配置数据（未经类型解析）
   */
  onConfigReload?(params: { config: Readonly<AppConfig>; rawMergedConfig: Record<string, unknown> }): Promise<void> | void;
}

/** 工具执行拦截结果 */
export type ToolExecInterception =
  | { blocked: true; reason: string }
  | { blocked: false; args?: Record<string, unknown> };

/**
 * 工具执行前拦截器（内部使用）
 *
 * 由 Backend 从 PluginHook[] 组合生成，注入到 ToolLoopConfig。
 */
export type BeforeToolExecInterceptor = (
  toolName: string,
  args: Record<string, unknown>,
) => Promise<ToolExecInterception | undefined>;

/**
 * 工具执行后拦截器（内部使用）
 *
 * 由 Backend 从 PluginHook[] 组合生成，注入到 ToolLoopConfig。
 * 返回 { result } 替换结果；返回 undefined 表示不修改。
 */
export type AfterToolExecInterceptor = (
  toolName: string,
  args: Record<string, unknown>,
  result: unknown,
  durationMs: number,
) => Promise<{ result: unknown } | undefined>;

/**
 * LLM 请求前拦截器（内部使用）
 *
 * 由 Backend 从 PluginHook[] 组合生成，注入到 ToolLoopConfig。
 * 返回 { request } 替换请求；返回 undefined 表示不修改。
 */
export type BeforeLLMCallInterceptor = (
  request: LLMRequest,
  round: number,
) => Promise<{ request: LLMRequest } | undefined>;

/**
 * LLM 响应后拦截器（内部使用）
 *
 * 由 Backend 从 PluginHook[] 组合生成，注入到 ToolLoopConfig。
 * 返回 { content } 替换内容；返回 undefined 表示不修改。
 */
export type AfterLLMCallInterceptor = (
  content: Content,
  round: number,
) => Promise<{ content: Content } | undefined>;

// ============ 日志 ============

/** 插件日志器接口 */
export interface PluginLogger {
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
  debug(msg: string, ...args: unknown[]): void;
}

// ============ 配置 ============

/** 插件配置条目（对应 plugins.yaml 中的一项） */
export interface PluginEntry {
  name: string;
  type?: 'local' | 'npm' | 'inline';
  enabled?: boolean;
  /** 插件优先级。数值越大越先加载、越先执行。默认 0。 */
  priority?: number;
  config?: Record<string, unknown>;
}

/** 运行时直接注入的内联插件 */
export interface InlinePluginEntry {
  /** 插件对象本身 */
  plugin: IrisPlugin;
  /** 是否启用，默认 true */
  enabled?: boolean;
  /** 优先级。数值越大越先执行。默认 0。 */
  priority?: number;
  /** 运行时传入的插件配置 */
  config?: Record<string, unknown>;
}

// ============ 内部类型 ============

/** 已加载的插件实例 */
export interface LoadedPlugin {
  entry: PluginEntry;
  plugin: IrisPlugin;
  hooks: PluginHook[];
  readyCallbacks: Array<(api: IrisAPI) => void | Promise<void>>;
  platformReadyCallbacks: Array<(platforms: ReadonlyMap<string, PlatformAdapter>, api: IrisAPI) => void | Promise<void>>;
}

/** 插件信息（公开查询用） */
export interface PluginInfo {
  name: string;
  version: string;
  description?: string;
  enabled: boolean;
  type: 'local' | 'npm' | 'inline';
  priority: number;
  hookCount: number;
}

export type { PatchDisposer } from './patch';
