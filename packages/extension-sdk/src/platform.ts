import type { Content } from './message.js';
import type { ToolExecutionHandleLike } from './tool.js';

export type ImageInput = {
  mimeType: string;
  data: string;
};

export type DocumentInput = {
  fileName: string;
  mimeType: string;
  data: string;
};

export interface ToolAttachment {
  type: string;
  mimeType?: string;
  data: Buffer;
  caption?: string;
  fileName?: string;
  /** @deprecated 请使用 fileName */
  filename?: string;
}

export interface IrisModelInfoLike {
  current?: boolean;
  modelName: string;
  modelId: string;
  provider?: string;
  contextWindow?: number;
  supportsVision?: boolean;
}

export interface IrisModeInfoLike {
  name: string;
  description?: string;
  current?: boolean;
}

export interface IrisSkillInfoLike {
  name: string;
  description?: string;
  path: string;
}

export interface IrisSessionMetaLike {
  id: string;
  title?: string;
  updatedAt?: string | number | Date;
  cwd?: string;
  createdAt?: string | number | Date;
  platforms?: string[];
}

export interface IrisToolInvocationLike {
  id: string;
  toolName: string;
  status: string;
  args: Record<string, unknown>;
  createdAt: number;
}

// ── 异步子代理任务可观测性 ──

/** 异步子代理任务的只读快照（供平台层查询和展示） */
export interface AgentTaskInfoLike {
  taskId: string;
  sessionId: string;
  description: string;
  status: 'running' | 'completed' | 'failed' | 'killed';
  startTime: number;
  endTime?: number;
}

/** Backend 事件签名（供 SDK 消费者使用，核心类型用 unknown 代替以保持解耦） */
export interface BackendEventMap {
  'response':           (sessionId: string, text: string) => void;
  'stream:start':       (sessionId: string) => void;
  'stream:chunk':       (sessionId: string, chunk: string) => void;
  'stream:end':         (sessionId: string, usage?: unknown) => void;
  'stream:parts':       (sessionId: string, parts: unknown[]) => void;
  'tool:execute':       (sessionId: string, handle: ToolExecutionHandleLike) => void;
  'error':              (sessionId: string, error: string) => void;
  'usage':              (sessionId: string, usage: unknown) => void;
  'done':               (sessionId: string, durationMs: number, turnId?: string) => void;
  'assistant:content':  (sessionId: string, content: unknown) => void;
  'turn:start':         (sessionId: string, turnId: string, mode: string) => void;
  'retry':              (sessionId: string, attempt: number, maxRetries: number, error: string) => void;
  'user:token':         (sessionId: string, tokenCount: number) => void;
  'auto-compact':       (sessionId: string, summaryText: string) => void;
  'attachments':        (sessionId: string, attachments: unknown[]) => void;
  'agent:notification': (sessionId: string, taskId: string, status: string, summary: string, taskType?: string, silent?: boolean) => void;
  'task:result':        (sessionId: string, taskId: string, status: string, description: string, taskType?: string, silent?: boolean, result?: string) => void;
  'notification:payloads': (sessionId: string, payloads: unknown[]) => void;
}

export interface IrisBackendLike {
  /** 监听已知事件（强类型） */
  on<K extends keyof BackendEventMap>(event: K, listener: BackendEventMap[K]): this;
  /** 监听未知/自定义事件（兼容） */
  on(event: string, listener: (...args: any[]) => void): this;
  once?<K extends keyof BackendEventMap>(event: K, listener: BackendEventMap[K]): this;
  once?(event: string, listener: (...args: any[]) => void): this;
  off<K extends keyof BackendEventMap>(event: K, listener: BackendEventMap[K]): this;
  off(event: string, listener: (...args: any[]) => void): this;
  chat(
    sessionId: string,
    text: string,
    images?: ImageInput[],
    documents?: DocumentInput[],
    platform?: string,
  ): Promise<unknown>;
  isStreamEnabled(): boolean;
  clearSession(sessionId: string): Promise<void>;
  switchModel(modelName: string, platform?: string): { modelName: string; modelId: string };
  listModels(): IrisModelInfoLike[];
  listSessionMetas(): Promise<IrisSessionMetaLike[]>;
  abortChat(sessionId: string): void;
  undo?(sessionId: string, scope?: string): Promise<{ assistantText?: string } | null>;
  redo?(sessionId: string): Promise<{ assistantText?: string } | null>;
  listSkills?(): IrisSkillInfoLike[];
  listModes?(): IrisModeInfoLike[];
  switchMode?(modeName: string): boolean;
  clearRedo?(sessionId: string): void;
  getHistory?(sessionId: string): Promise<Content[]>;
  runCommand?(cmd: string): unknown;
  summarize?(sessionId: string): Promise<unknown>;
  resetConfigToDefaults?(): unknown;
  getToolNames?(): string[];
  /** 获取指定工具的双向通道 Handle */
  getToolHandle(toolId: string): ToolExecutionHandleLike | undefined;
  /** 获取指定会话的所有工具 Handle */
  getToolHandles(sessionId: string): ToolExecutionHandleLike[];
  /** 查询指定 session 的所有异步子代理任务（只读） */
  getAgentTasks?(sessionId: string): AgentTaskInfoLike[];
  /** 查询指定 session 中正在运行的异步子代理任务（只读） */
  getRunningAgentTasks?(sessionId: string): AgentTaskInfoLike[];
  /** 按 taskId 查询单个异步子代理任务（只读） */
  getAgentTask?(taskId: string): AgentTaskInfoLike | undefined;

  // ── 补全：消除各平台的 as any 访问 ──

  /** 获取工具权限策略 */
  getToolPolicies?(): Record<string, unknown> | undefined;
  /** 获取当前活跃模型信息 */
  getCurrentModelInfo?(): IrisModelInfoLike | undefined;
  /** 获取被禁用的工具名称列表 */
  getDisabledTools?(): string[] | undefined;
  /** 获取当前活跃会话 ID */
  getActiveSessionId?(): string | undefined;
}

// ── BackendHandle：稳定代理层 ──

/**
 * Backend 的稳定代理。
 *
 * Platform 持有 BackendHandle 而非直接持有 Backend 实例。
 * 当 Core 被热重载/重建时，Host 调用 `handle.swap(newBackend)` 将底层 Backend
 * 替换为新实例，同时自动迁移所有已注册的事件监听器。Platform 侧零感知。
 */
export class BackendHandle implements IrisBackendLike {
  private _backend: IrisBackendLike;
  private _listeners = new Map<string, Set<(...args: any[]) => void>>();

  constructor(backend: IrisBackendLike) {
    this._backend = backend;
  }

  /**
   * 热替换底层 Backend。
   * 自动将所有已注册的事件监听器从旧 Backend 迁移到新 Backend。
   */
  swap(newBackend: IrisBackendLike): void {
    // 从旧 Backend 移除所有监听器
    for (const [event, listeners] of this._listeners) {
      for (const fn of listeners) {
        this._backend.off(event, fn);
      }
    }
    this._backend = newBackend;
    // 在新 Backend 上重新注册所有监听器
    for (const [event, listeners] of this._listeners) {
      for (const fn of listeners) {
        this._backend.on(event, fn);
      }
    }
  }

  // ── EventEmitter 代理（追踪监听器） ──

  on(event: string, listener: (...args: any[]) => void): this {
    if (!this._listeners.has(event)) this._listeners.set(event, new Set());
    this._listeners.get(event)!.add(listener);
    this._backend.on(event, listener);
    return this;
  }

  off(event: string, listener: (...args: any[]) => void): this {
    this._listeners.get(event)?.delete(listener);
    this._backend.off(event, listener);
    return this;
  }

  once(event: string, listener: (...args: any[]) => void): this {
    const wrapper = (...args: any[]) => {
      this._listeners.get(event)?.delete(wrapper);
      listener(...args);
    };
    return this.on(event, wrapper);
  }

  // ── 方法代理 ──

  chat(
    sessionId: string,
    text: string,
    images?: ImageInput[],
    documents?: DocumentInput[],
    platform?: string,
  ): Promise<unknown> {
    return this._backend.chat(sessionId, text, images, documents, platform);
  }

  isStreamEnabled(): boolean { return this._backend.isStreamEnabled(); }
  clearSession(sessionId: string): Promise<void> { return this._backend.clearSession(sessionId); }

  switchModel(modelName: string, platform?: string): { modelName: string; modelId: string } {
    return this._backend.switchModel(modelName, platform);
  }

  listModels(): IrisModelInfoLike[] { return this._backend.listModels(); }
  listSessionMetas(): Promise<IrisSessionMetaLike[]> { return this._backend.listSessionMetas(); }
  abortChat(sessionId: string): void { return this._backend.abortChat(sessionId); }

  getToolHandle(toolId: string): ToolExecutionHandleLike | undefined {
    return this._backend.getToolHandle(toolId);
  }

  getToolHandles(sessionId: string): ToolExecutionHandleLike[] {
    return this._backend.getToolHandles(sessionId);
  }

  // ── 可选方法代理 ──

  undo(sessionId: string, scope?: string): Promise<{ assistantText?: string } | null> {
    return this._backend.undo?.(sessionId, scope) ?? Promise.resolve(null);
  }

  redo(sessionId: string): Promise<{ assistantText?: string } | null> {
    return this._backend.redo?.(sessionId) ?? Promise.resolve(null);
  }

  listSkills(): IrisSkillInfoLike[] { return this._backend.listSkills?.() ?? []; }
  listModes(): IrisModeInfoLike[] { return this._backend.listModes?.() ?? []; }
  switchMode(modeName: string): boolean { return this._backend.switchMode?.(modeName) ?? false; }
  clearRedo(sessionId: string): void { return this._backend.clearRedo?.(sessionId); }

  getHistory(sessionId: string): Promise<Content[]> {
    return this._backend.getHistory?.(sessionId) ?? Promise.resolve([]);
  }

  runCommand(cmd: string): unknown { return this._backend.runCommand?.(cmd); }

  summarize(sessionId: string): Promise<unknown> {
    return this._backend.summarize?.(sessionId) ?? Promise.resolve(undefined);
  }

  resetConfigToDefaults(): unknown { return this._backend.resetConfigToDefaults?.(); }
  getToolNames(): string[] { return this._backend.getToolNames?.() ?? []; }

  getAgentTasks(sessionId: string): AgentTaskInfoLike[] {
    return this._backend.getAgentTasks?.(sessionId) ?? [];
  }

  getRunningAgentTasks(sessionId: string): AgentTaskInfoLike[] {
    return this._backend.getRunningAgentTasks?.(sessionId) ?? [];
  }

  getAgentTask(taskId: string): AgentTaskInfoLike | undefined {
    return this._backend.getAgentTask?.(taskId);
  }

  // ── 补全方法代理 ──

  getToolPolicies(): Record<string, unknown> | undefined {
    return this._backend.getToolPolicies?.();
  }

  getCurrentModelInfo(): IrisModelInfoLike | undefined {
    return this._backend.getCurrentModelInfo?.();
  }

  getDisabledTools(): string[] | undefined {
    return this._backend.getDisabledTools?.();
  }

  getActiveSessionId(): string | undefined {
    return this._backend.getActiveSessionId?.();
  }
}

// ── 平台工厂 ──

/**
 * 平台工厂创建上下文。
 *
 * 部分字段类型为 `unknown`，这是为了避免 SDK 内部的循环引用
 * （`platform.ts` ↔ `plugin/api.ts`）。扩展如需访问强类型 API，
 * 请在 `definePlatformFactory.create()` 回调中使用 `context.api as IrisAPI`。
 *
 * 索引签名 `[key: string]: unknown` 允许宿主传递额外的平台特定参数。
 */
export interface IrisPlatformFactoryContextLike {
  backend: BackendHandle;
  config?: {
    platform?: Record<string, unknown>;
    [key: string]: unknown;
  };
  configDir?: string;
  agentName?: string;
  initWarnings?: string[];
  /** 插件事件总线。类型为 unknown 以避免循环引用，实际为 PluginEventBusLike。 */
  eventBus?: unknown;
  projectRoot?: string;
  dataDir?: string;
  isCompiledBinary?: boolean;
  /** 完整的 IrisAPI 对象。类型为 unknown 以避免循环引用，实际为 IrisAPI。 */
  api?: unknown;
  /** 获取 MCP 管理器。类型为 unknown 以避免循环引用，实际为 MCPManagerLike。 */
  getMCPManager?: () => unknown;
  /** 设置 MCP 管理器。 */
  setMCPManager?: (mgr?: unknown) => void;
  [key: string]: unknown;
}

export function getPlatformConfig<T extends Record<string, unknown>>(
  context: IrisPlatformFactoryContextLike,
  platformName: string,
): Partial<T> {
  const platform = context.config?.platform;
  if (!platform || typeof platform !== 'object') {
    return {};
  }

  const value = platform[platformName];
  if (!value || typeof value !== 'object') {
    return {};
  }

  return value as Partial<T>;
}

export interface PlatformFactoryHelperOptions<TConfig extends Record<string, unknown>, TPlatform> {
  platformName: string;
  resolveConfig: (raw: Partial<TConfig>, context: IrisPlatformFactoryContextLike) => TConfig;
  create: (
    backend: BackendHandle,
    config: TConfig,
    context: IrisPlatformFactoryContextLike,
  ) => Promise<TPlatform> | TPlatform;
}

export function definePlatformFactory<TConfig extends Record<string, unknown>, TPlatform>(
  options: PlatformFactoryHelperOptions<TConfig, TPlatform>,
): (context: IrisPlatformFactoryContextLike) => Promise<TPlatform> {
  return async (context: IrisPlatformFactoryContextLike): Promise<TPlatform> => {
    const raw = getPlatformConfig<TConfig>(context, options.platformName);
    const config = options.resolveConfig(raw, context);
    return await options.create(context.backend, config, context);
  };
}

/** 将文本按最大长度分段，优先在换行处切分 */
export function splitText(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];

  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }
    let splitAt = remaining.lastIndexOf('\n', maxLen);
    if (splitAt <= 0) splitAt = maxLen;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).replace(/^\n/, '');
  }
  return chunks;
}

export abstract class PlatformAdapter {
  abstract start(): Promise<void>;
  abstract stop(): Promise<void>;

  get name(): string {
    return this.constructor.name;
  }
}

// ── 能力接口 ──

/**
 * 前台交互式平台。
 *
 * 实现此接口的平台（如 Console TUI）会阻塞主流程直到用户退出或切换 Agent。
 * 核心层通过 `isForegroundPlatform()` 类型守卫检测，不通过平台名称硬编码。
 */
export interface ForegroundPlatform {
  /** 等待用户退出。返回退出意图。 */
  waitForExit(): Promise<'exit' | 'switch-agent'>;
}

/** 检测平台是否实现了 ForegroundPlatform 接口 */
export function isForegroundPlatform(
  platform: PlatformAdapter,
): platform is PlatformAdapter & ForegroundPlatform {
  return typeof (platform as any).waitForExit === 'function';
}

/**
 * 支持 HTTP 路由注册的平台。
 *
 * 插件通过 IrisAPI.registerRoute 注册路由，Core 层缓存后推送给实现此接口的平台。
 * 核心层通过 `isRoutableHttpPlatform()` 类型守卫检测。
 */
export interface RoutableHttpPlatform {
  /** 注册外部路由到此平台的 HTTP 服务器 */
  registerRoute(method: string, path: string, handler: (...args: unknown[]) => Promise<void>): void;
}

/** 检测平台是否实现了 RoutableHttpPlatform 接口 */
export function isRoutableHttpPlatform(
  platform: PlatformAdapter,
): platform is PlatformAdapter & RoutableHttpPlatform {
  return typeof (platform as any).registerRoute === 'function';
}

// ── Multi-Agent 支持 ──

/** Agent 上下文（由核心层创建，传递给支持多 Agent 的平台） */
export interface AgentContextLike {
  name: string;
  description?: string;
  backend: BackendHandle;
  config: Record<string, unknown>;
  getMCPManager?: () => unknown;
  setMCPManager?: (mgr?: unknown) => void;
  dataDir?: string;
  extensions?: Record<string, unknown>;
}

/**
 * 支持多 Agent 管理的平台适配器接口。
 * 核心层在多 Agent 模式下，检测平台是否实现此接口来决定共享策略。
 */
export interface MultiAgentCapable {
  /** 添加 Agent 上下文 */
  addAgent(name: string, backend: BackendHandle, config: Record<string, unknown>, description?: string, getMCPManager?: () => unknown, setMCPManager?: (mgr?: unknown) => void, extensions?: Record<string, unknown>): void;
  /** 热重载 Agent 列表 */
  reloadAgents?(): Promise<unknown>;
  /** 设置 Agent 热重载回调 */
  setReloadHandler?(handler: (...args: unknown[]) => Promise<unknown>): void;
  /** 设置平台配置热重载回调 */
  setPlatformReloadHandler?(handler: (...args: unknown[]) => Promise<void>): void;
  /** 获取 MCP 管理器 */
  getMCPManager?(agentName?: string): unknown;
}

/** 检测平台是否实现了 MultiAgentCapable 接口 */
export function isMultiAgentCapable(platform: PlatformAdapter): platform is PlatformAdapter & MultiAgentCapable {
  return typeof (platform as any).addAgent === 'function';
}
