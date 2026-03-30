import { createExtensionLogger, type ExtensionLogger } from './logger.js';
import type { LLMRequest } from './llm.js';
import type { Content, Part } from './message.js';
import type { ModeDefinition } from './mode.js';
import type { IrisBackendLike, IrisPlatformFactoryContextLike, PlatformAdapter } from './platform.js';
import type { ToolDefinition, ToolHandler } from './tool.js';

export type PatchDisposer = () => void;
export type PatchMethod = (...args: any[]) => PatchDisposer;
export type PatchPrototype = (...args: any[]) => PatchDisposer;

export interface NamedFactoryRegistryLike<TFactory> {
  register(name: string, factory: TFactory): void;
  unregister?(name: string): boolean;
  get?(name: string): TFactory | undefined;
  has?(name: string): boolean;
  list?(): string[];
}

export type LLMProviderFactory = (config: Record<string, unknown>) => unknown;
export type StorageFactory = (config: Record<string, unknown>) => Promise<unknown> | unknown;
export type MemoryFactory = (config: Record<string, unknown>) => Promise<unknown> | unknown;
export type OCRFactory = (config: Record<string, unknown>) => Promise<unknown> | unknown;
export type PlatformFactory = (context: IrisPlatformFactoryContextLike) => Promise<unknown> | unknown;

export interface BootstrapExtensionRegistryLike {
  llmProviders: NamedFactoryRegistryLike<LLMProviderFactory>;
  storageProviders: NamedFactoryRegistryLike<StorageFactory>;
  memoryProviders: NamedFactoryRegistryLike<MemoryFactory>;
  ocrProviders: NamedFactoryRegistryLike<OCRFactory>;
  platforms: NamedFactoryRegistryLike<PlatformFactory>;
}

export interface ToolRegistryLike {
  register(tool: ToolDefinition): void;
  registerAll(tools: ToolDefinition[]): void;
  unregister?(name: string): boolean;
  get?(name: string): ToolDefinition | undefined;
}

export interface ModeRegistryLike {
  register(mode: ModeDefinition): void;
  registerAll?(modes: ModeDefinition[]): void;
}

export interface LLMRouterLike {
  getCurrentModelInfo?(): unknown;
  listModels?(): unknown[];
  resolve?(modelName: string): unknown;
}

export interface PromptAssemblerLike {
  addSystemPart(part: Part): void;
  removeSystemPart(part: Part): void;
  setSystemPrompt?(prompt: string): void;
}

export interface PluginEventBusLike {
  emit?(event: string, ...args: unknown[]): void;
  on?(event: string, listener: (...args: unknown[]) => void): void;
  off?(event: string, listener: (...args: unknown[]) => void): void;
}

export interface PluginManagerLike {
  listPlugins?(): Array<Record<string, unknown>>;
}

export interface IrisAPI {
  backend: IrisBackendLike;
  router: LLMRouterLike;
  storage: StorageLike;
  memory?: unknown;
  tools: ToolRegistryLike;
  modes: ModeRegistryLike;
  prompt: PromptAssemblerLike;
  config: Readonly<Record<string, unknown>>;
  mcpManager?: MCPManagerLike;
  ocrService?: unknown;
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
}

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

// ── Host-level interfaces (for advanced platforms like Console) ──

export enum LogLevel { DEBUG = 0, INFO = 1, WARN = 2, ERROR = 3, SILENT = 4 }

export interface MCPServerInfoLike {
  name: string;
  status: string;
  toolCount: number;
  error?: string;
}

export interface MCPManagerLike {
  getServerInfo?(...args: unknown[]): unknown;
  listServers?(): unknown[];
  getConfig?(): Record<string, unknown>;
  connectAll?(): Promise<void>;
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

// ── Web 平台迁移所需的额外接口 ──

/** Session 信息（StorageLike.listSessions 返回） */
export interface SessionInfoLike {
  id: string;
  title?: string;
  cwd?: string;
  updatedAt?: string | number;
  createdAt?: string | number;
  platforms?: string[];
}

/** 类型化存储接口（替代 IrisAPI.storage 的 unknown） */
export interface StorageLike {
  getHistory(sessionId: string): Promise<unknown[]>;
  clearHistory(sessionId: string): Promise<void>;
  truncateHistory(sessionId: string, keepCount: number): Promise<void>;
  listSessions(): Promise<string[]>;
  listSessionMetas(): Promise<SessionInfoLike[]>;
}

/** 可用模型信息 */
export interface ModelCatalogResultLike {
  provider: string;
  baseUrl: string;
  models: { id: string; displayName?: string }[];
}

/** 扩展管理接口（安装/启用/禁用/删除） */
export interface ExtensionManagerLike {
  listInstalled(): unknown[];
  listRemote(): Promise<unknown[]>;
  install(url: string, options?: Record<string, unknown>): Promise<unknown>;
  enable(name: string): Promise<unknown>;
  disable(name: string): Promise<unknown>;
  remove(name: string): Promise<unknown>;
  collectPasswordFields?(): string[];
  listPlatformCatalog?(): unknown[];
}

/** Agent 管理接口（CRUD 操作 agents.yaml） */
export interface AgentManagerLike {
  getStatus(): { exists: boolean; enabled: boolean; agents: AgentDefinitionLike[]; manifestPath: string };
  setEnabled(enabled: boolean): { success: boolean; message: string };
  createManifest(): { success: boolean; message: string };
  create(name: string, description?: string): { success: boolean; message: string };
  update(name: string, fields: { description?: string; dataDir?: string }): { success: boolean; message: string };
  delete(name: string): { success: boolean; message: string };
  resetCache(): void;
}


export interface ParsedUnifiedDiffLike {
  oldFile?: string;
  newFile?: string;
  hunks: UnifiedDiffHunkLike[];
}

export interface UnifiedDiffHunkLike {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  header: string;
  lines: UnifiedDiffLineLike[];
}

export interface UnifiedDiffLineLike {
  type: 'context' | 'add' | 'del';
  content: string;
  raw: string;
}

export interface WriteEntryLike { path: string; content: string }
export interface InsertEntryLike { path: string; line: number; content: string }
export interface DeleteCodeEntryLike { path: string; start_line: number; end_line: number }

export interface ToolPreviewUtilsLike {
  parseUnifiedDiff(patch: string): ParsedUnifiedDiffLike;
  normalizeWriteArgs(args: Record<string, unknown>): WriteEntryLike[] | undefined;
  normalizeInsertArgs(args: Record<string, unknown>): InsertEntryLike[] | undefined;
  normalizeDeleteCodeArgs(args: Record<string, unknown>): DeleteCodeEntryLike[] | undefined;
  resolveProjectPath(inputPath: string): string;
  walkFiles(rootAbs: string, onFile: (fileAbs: string, relPosix: string) => void, shouldStop: () => boolean): void;
  buildSearchRegex(query: string, isRegex: boolean): RegExp;
  decodeText(buf: Buffer): { text: string; encoding: string; hasBom: boolean; hasCRLF: boolean };
  globToRegExp(glob: string): RegExp;
  isLikelyBinary(buf: Buffer): boolean;
  toPosix(p: string): string;
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
  onBeforeToolExec?(params: { toolName: string; args: Record<string, unknown> }): Promise<ToolExecInterception | undefined> | ToolExecInterception | undefined;
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
