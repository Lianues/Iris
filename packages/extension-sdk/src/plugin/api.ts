import type { IrisBackendLike } from '../platform.js';
import { LogLevel } from '../logger.js';
import type { MediaServiceLike, OCRProviderLike } from '../media.js';
import type {
  BootstrapExtensionRegistryLike,
  PatchMethod,
  PatchPrototype,
} from './types.js';
import type {
  LLMRouterLike,
  ModeRegistryLike,
  PluginEventBusLike,
  PluginManagerLike,
  PromptAssemblerLike,
  ToolRegistryLike,
} from './registry.js';
import type { StorageLike } from './storage.js';
import type { ToolPreviewUtilsLike } from './tool-preview.js';

/** 扩展面板定义（由插件通过 registerWebPanel 注册，宿主 Web UI 动态渲染） */
export interface WebPanelDefinition {
  /** 面板唯一标识 */
  id: string;
  /** 面板显示标题 */
  title: string;
  /** 面板图标名称（Material Symbols 图标名，如 'mouse'），缺省使用 'extension' */
  icon?: string;
  /** 面板内容 URL 路径（由扩展通过 registerWebRoute 提供，宿主用 iframe 加载） */
  contentPath: string;
}

/* ────────────────────────────────────────────────────────────
 * Console Settings Tab 注入机制
 *
 * 插件通过 registerConsoleSettingsTab 注册声明式表单 schema，
 * Console TUI 的 SettingsView 动态渲染这些 tab。
 * 数据流与内置 snapshot 完全解耦——插件自带 onLoad / onSave。
 * ──────────────────────────────────────────────────────────── */

/** Console Settings Tab 中的单个表单字段 */
export interface ConsoleSettingsField {
  /** 字段唯一标识（在该 tab 内唯一） */
  key: string;
  /** 显示标签 */
  label: string;
  /** 字段类型 */
  type: 'toggle' | 'number' | 'text' | 'select' | 'readonly';
  /** select 类型的可选项 */
  options?: { label: string; value: string }[];
  /** 默认值 */
  defaultValue?: unknown;
  /** 字段说明（显示为 info 行） */
  description?: string;
  /** 分组标题（非空时在该字段前插入 section 头行） */
  group?: string;
}

/** 插件注册的 Console Settings Tab 页定义 */
export interface ConsoleSettingsTabDefinition {
  /** tab 唯一标识 */
  id: string;
  /** tab 显示标签 */
  label: string;
  /** tab 序号图标（如 '04'），缺省按内置 tab 数量自动递增 */
  icon?: string;
  /** 表单字段列表 */
  fields: ConsoleSettingsField[];
  /** 加载当前值（Settings 页面打开时调用） */
  onLoad: () => Promise<Record<string, unknown>>;
  /** 保存修改后的值（用户按 S 保存时调用） */
  onSave: (values: Record<string, unknown>) => Promise<{ success: boolean; error?: string }>;
}

export { LogLevel };
export interface MCPServerInfoLike {
  name: string;
  status: string;
  toolCount: number;
  error?: string;
}

export interface MCPManagerLike {
  getServerInfo?(name: string): MCPServerInfoLike | undefined;
  listServers?(): MCPServerInfoLike[];
  getConfig?(): Record<string, unknown>;
  connectAll?(): Promise<void>;
  /** 断开所有 MCP 服务器连接 */
  disconnectAll?(): Promise<void>;
  /** 热重载：断开旧连接，用新配置重新连接 */
  reload?(config: Record<string, unknown>): Promise<void>;
  /** 获取所有已连接服务器提供的工具列表 */
  getTools?(): unknown[];
}

export interface ConfigManagerLike {
  getConfigDir(): string;
  readEditableConfig(): Record<string, unknown>;
  updateEditableConfig(updates: Record<string, unknown>): { mergedRaw: Record<string, unknown>; sanitized?: Record<string, unknown> };
  applyRuntimeConfigReload(mergedConfig: Record<string, unknown>): Promise<{ success: boolean; error?: string }>;
  getLLMDefaults(): Record<string, Record<string, unknown>>;
  parseLLMConfig(raw?: Record<string, unknown>): Record<string, unknown>;
  parseSystemConfig(raw?: Record<string, unknown>): Record<string, unknown>;
  parseToolsConfig(raw?: Record<string, unknown>): Record<string, unknown>;
}

export interface AgentDefinitionLike {
  name: string;
  description?: string;
  dataDir?: string;
}

/** 可用模型信息 */
export interface ModelCatalogResultLike {
  provider: string;
  baseUrl: string;
  models: { id: string; displayName?: string }[];
}

/** 扩展管理接口（安装/启用/禁用/删除） */
export interface ExtensionManagerLike {
  listInstalled(): Array<{ name: string; version?: string; enabled?: boolean }>;
  listRemote(): Promise<Array<{ name: string; description?: string }>>;
  install(url: string, options?: Record<string, unknown>): Promise<{ success: boolean; error?: string }>;
  enable(name: string): Promise<{ success: boolean; error?: string }>;
  disable(name: string): Promise<{ success: boolean; error?: string }>;
  remove(name: string): Promise<{ success: boolean; error?: string }>;
  collectPasswordFields?(): string[];
  listPlatformCatalog?(): unknown[];
}

/** Agent 管理接口（CRUD 操作 agents.yaml + 运行时状态查询） */
export interface AgentManagerLike {
  getStatus(): { exists: boolean; enabled: boolean; agents: AgentDefinitionLike[]; manifestPath: string };
  setEnabled(enabled: boolean): { success: boolean; message: string };
  createManifest(): { success: boolean; message: string };
  create(name: string, description?: string): { success: boolean; message: string };
  update(name: string, fields: { description?: string; dataDir?: string }): { success: boolean; message: string };
  delete(name: string): { success: boolean; message: string };
  resetCache(): void;
  /** 获取当前活跃会话 ID */
  getActiveSessionId?(): string | undefined;
  /** 获取指定会话最近一次 LLM 调用的 Token 用量 */
  getLastSessionTokens?(sessionId: string): number | undefined;
  /** 获取所有会话的 Token 用量映射 */
  getAllSessionTokens?(): Record<string, number>;
}

/** 跨 Agent 通信网络接口（多 Agent 模式下由 bootstrap 注入） */
export interface AgentNetworkLike {
  /** 当前 Agent 自身名称 */
  selfName: string;
  /** 列出所有可委派的 peer Agent 名称 */
  listPeers(): string[];
  /** 获取指定 peer Agent 的描述信息 */
  getPeerDescription(name: string): string | undefined;
  /** 获取指定 peer Agent 的 backend 实例引用 */
  getPeerBackend(name: string): IrisBackendLike | undefined;
}

export interface IrisAPI {
  backend: IrisBackendLike;
  router: LLMRouterLike;
  storage: StorageLike;
  /** @deprecated 由 memory 扩展插件通过 monkey-patch 设置，勿直接依赖 */
  memory?: unknown;
  tools: ToolRegistryLike;
  modes: ModeRegistryLike;
  prompt: PromptAssemblerLike;
  config: Readonly<Record<string, unknown>>;
  mcpManager?: MCPManagerLike;
  /** OCR 服务（当主模型不支持 vision 时回退使用）。未配置 OCR 时为 undefined。 */
  ocrService?: OCRProviderLike;
  /** 媒体处理服务：图片缩放、文档提取、Office→PDF 转换 */
  media?: MediaServiceLike;
  extensions: BootstrapExtensionRegistryLike;
  pluginManager: PluginManagerLike;
  eventBus: PluginEventBusLike;
  patchMethod: PatchMethod;
  patchPrototype: PatchPrototype;
  registerWebRoute?: (method: string, path: string, handler: (req: any, res: any, params: Record<string, string>) => Promise<void>) => void;
  /** 向 Web 平台注册扩展面板页面。宿主侧边栏会动态展示已注册的面板。 */
  registerWebPanel?: (panel: WebPanelDefinition) => void;
  configManager?: ConfigManagerLike;
  toolPreviewUtils?: ToolPreviewUtilsLike;
  /** @deprecated 未实现，预留接口 */
  estimateTokenCount?(text: string): number;
  isCompiledBinary?: boolean;
  setLogLevel?(level: LogLevel): void;
  getLogLevel?(): LogLevel;
  listAgents?(): AgentDefinitionLike[];
  projectRoot?: string;
  dataDir?: string;
  fetchAvailableModels?(config: { provider: string; apiKey: string; baseUrl?: string }): Promise<ModelCatalogResultLike>;
  extensionManager?: ExtensionManagerLike;
  agentManager?: AgentManagerLike;
  /** 检查指定模型是否支持 vision（不传参数时检查当前模型） */
  supportsVision?(modelName?: string): boolean;
  /** 检查指定模型是否支持原生 PDF 输入（不传参数时检查当前模型） */
  supportsNativePDF?(modelName?: string): boolean;
  /** 检查指定模型是否支持原生 Office 文档输入（不传参数时检查当前模型） */
  supportsNativeOffice?(modelName?: string): boolean;
  /** 检查 MIME 类型是否为文档类型（PDF / DOCX / PPTX / XLSX） */
  isDocumentMimeType?(mimeType: string): boolean;
  /** 向 Console 平台 Settings 界面注册插件 Tab 页（声明式表单 schema） */
  registerConsoleSettingsTab?: (tab: ConsoleSettingsTabDefinition) => void;
  /** 获取所有已注册的 Console Settings 插件 Tab */
  getConsoleSettingsTabs?: () => ConsoleSettingsTabDefinition[];

  /**
   * 全局任务板（可选）。
   * 供插件（如 cron）注册后台任务，统一管理生命周期和通知路由。
   * 类型为最小接口，避免引入核心模块的循环依赖。
   *
   * [cron 重构] 替换原 agentTaskRegistry?: unknown，
   * 使用 CrossAgentTaskBoard 的最小接口代替 per-Agent 的 AgentTaskRegistry。
   */
  taskBoard?: {
    register(input: {
      taskId: string;
      sourceAgent: string;
      sourceSessionId: string;
      targetAgent: string;
      type: string;
      description: string;
      silent?: boolean;
    }): { taskId: string; abortController?: AbortController };
    complete(taskId: string, result?: string): void;
    fail(taskId: string, error: string): void;
    kill(taskId: string): void;
    getRunningByTargetAgent(agentName: string): Array<{ taskId: string; type: string }>;
    emitChunkHeartbeat(taskId: string): void;
    updateTokens(taskId: string, tokens: number): void;
  };

  /**
   * 当前 Agent 名称。
   * 多 Agent 模式下由 bootstrap 注入，单 Agent 模式下为 '__global__'。
   * 供插件（如 cron）在注册任务时标识 sourceAgent / targetAgent。
   *
   * [cron 重构] 新增字段，替代 cron 之前硬编码虚拟 sessionId 的做法。
   */
  agentName?: string;

  /** 跨 Agent 通信网络（多 Agent 模式下由 bootstrap 注入） */
  agentNetwork?: AgentNetworkLike;

  /**
   * 创建一个 ToolLoop 实例，用于插件后台执行带工具调用的 LLM 循环。
   *
   * 这是核心 ToolLoop 类的工厂方法，避免插件直接依赖核心模块。
   * 返回的对象具有 run() 方法，签名参见 ToolLoopRunnerLike。
   *
   * @param options.tools - 工具注册表（可用 api.tools 或其过滤版本）
   * @param options.systemPrompt - 系统提示词文本
   * @param options.maxRounds - 最大工具轮次
   */
  createToolLoop?(options: {
    tools: ToolRegistryLike;
    systemPrompt: string;
    maxRounds?: number;
  }): ToolLoopRunnerLike;
}

/**
 * ToolLoop 运行器的最小接口（面向插件侧使用）。
 *
 * 由 IrisAPI.createToolLoop() 返回，插件无需了解 ToolLoop 的内部实现。
 */
export interface ToolLoopRunnerLike {
  run(
    history: unknown[],
    callLLM: (request: unknown, modelName?: string, signal?: AbortSignal) => Promise<unknown>,
    options?: { signal?: AbortSignal; modelName?: string },
  ): Promise<{ text: string; error?: string; history: unknown[]; aborted?: boolean }>;
}
