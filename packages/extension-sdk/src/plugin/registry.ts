import type { Part } from '../message.js';
import type { FunctionDeclaration } from '../tool.js';
import type { LLMRequest, LLMResponse, LLMStreamChunk } from '../llm.js';
import type { ModeDefinition } from '../mode.js';
import type { IrisModelInfoLike } from '../platform.js';
import type { ToolDefinition } from '../tool.js';

export interface ToolRegistryLike {
  register(tool: ToolDefinition): void;
  registerAll(tools: ToolDefinition[]): void;
  unregister?(name: string): boolean;
  get?(name: string): ToolDefinition | undefined;
  /** 获取所有已注册工具的函数声明（供 LLM 使用） */
  getDeclarations?(): FunctionDeclaration[];
  /** 列出已注册的工具名称 */
  listTools?(): string[];
  /** 已注册工具数量 */
  readonly size?: number;
  /** 执行指定工具 */
  execute?(name: string, args: Record<string, unknown>, context?: unknown): Promise<unknown> | AsyncIterable<unknown>;
  /** 创建仅包含指定工具的子注册表 */
  createSubset?(names: string[]): ToolRegistryLike;
  /** 创建排除指定工具的子注册表 */
  createFiltered?(excludeNames: string[]): ToolRegistryLike;
}

export interface ModeRegistryLike {
  register(mode: ModeDefinition): void;
  registerAll?(modes: ModeDefinition[]): void;
}

export interface LLMRouterLike {
  getCurrentModelInfo?(): IrisModelInfoLike | undefined;
  listModels?(): IrisModelInfoLike[];
  resolve?(modelName: string): unknown;
  /** 非流式 LLM 调用（modelName 省略时使用当前模型） */
  chat?(request: LLMRequest, modelName?: string, signal?: AbortSignal): Promise<LLMResponse>;
  /** 流式 LLM 调用（modelName 省略时使用当前模型） */
  chatStream?(request: LLMRequest, modelName?: string, signal?: AbortSignal): AsyncGenerator<LLMStreamChunk>;
  /** 检查模型是否已注册 */
  hasModel?(modelName: string): boolean;
  /** 动态注册一个模型（modelName 不可重复） */
  registerModel?(entry: { modelName: string; provider: unknown; config: Record<string, unknown> }): void;
  /** 动态移除一个模型（至少需保留一个模型） */
  unregisterModel?(modelName: string): boolean;
  /** 切换当前活动模型 */
  setCurrentModel?(modelName: string): unknown;
  /** 获取当前活动模型名称 */
  getCurrentModelName?(): string;
  /** 获取指定模型的配置（不传参数时获取当前模型） */
  getModelConfig?(modelName?: string): Record<string, unknown>;
  /** 运行时浅合并当前模型的 requestBody 覆盖 */
  patchCurrentModelRequestBody?(patch: Record<string, unknown>): void;
  /** 运行时移除当前模型 requestBody 覆盖中的指定 key */
  removeCurrentModelRequestBodyKeys?(...keys: string[]): void;
  /** 运行时按点分路径删除当前模型 requestBody 覆盖中的嵌套 key（如 'thinking.type'） */
  removeCurrentModelRequestBodyPaths?(...paths: string[]): void;
}

export interface PromptAssemblerLike {
  addSystemPart(part: Part): void;
  removeSystemPart(part: Part): void;
  setSystemPrompt?(prompt: string): void;
}

export interface PluginEventBusLike {
  emit(event: string, ...args: unknown[]): void;
  on(event: string, listener: (...args: unknown[]) => void): void;
  off(event: string, listener: (...args: unknown[]) => void): void;
  /** 发射事件（emit 的别名，语义更清晰）。可选，未实现时可用 emit 代替。 */
  fire?(event: string, ...args: unknown[]): void;
}

/** 插件信息（查询用） */
export interface PluginInfoLike {
  name: string;
  version: string;
  description?: string;
  enabled: boolean;
  type: string;
  priority: number;
  hookCount: number;
}

export interface PluginManagerLike {
  /** 列出所有已加载的插件信息 */
  listPlugins?(): PluginInfoLike[];
  /** 根据名称查找指定插件 */
  getPlugin?(name: string): PluginInfoLike | undefined;
  /** 获取已加载插件数量 */
  readonly size?: number;
}
