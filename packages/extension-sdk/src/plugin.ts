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
  getCurrentModelInfo?(): Record<string, unknown>;
  listModels?(): Array<Record<string, unknown>>;
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
  storage: unknown;
  memory?: unknown;
  tools: ToolRegistryLike;
  modes: ModeRegistryLike;
  prompt: PromptAssemblerLike;
  config: Readonly<Record<string, unknown>>;
  mcpManager?: unknown;
  computerEnv?: unknown;
  ocrService?: unknown;
  extensions: BootstrapExtensionRegistryLike;
  pluginManager: PluginManagerLike;
  eventBus: PluginEventBusLike;
  patchMethod: PatchMethod;
  patchPrototype: PatchPrototype;
  registerWebRoute?: (method: string, path: string, handler: (req: any, res: any, params: Record<string, string>) => Promise<void>) => void;
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
