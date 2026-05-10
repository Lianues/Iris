/**
 * LLM 模型路由器
 *
 * 管理一组按 modelName 注册的模型，并维护当前活动模型。
 */

import type { LLMProviderLike } from './providers/base';
import { LLMRequest, LLMResponse, LLMStreamChunk } from '../types';
import { LLMConfig } from '../config/types';

export type LLMModelName = string;

export interface LLMRouterModel {
  modelName: LLMModelName;
  provider: LLMProviderLike;
  config: LLMConfig;
}

export interface LLMModelInfo {
  modelName: LLMModelName;
  provider: LLMConfig['provider'];
  thinkingControl?: boolean;
  /** 提供商真实模型 ID，对应 LLMConfig.model */
  modelId: string;
  contextWindow?: number;
  supportsVision?: boolean;
  current: boolean;
}

export interface LLMRouterConfig {
  defaultModelName: LLMModelName;
  models: LLMRouterModel[];
}

export class LLMRouter {
  private providers = new Map<LLMModelName, LLMProviderLike>();
  private configs = new Map<LLMModelName, LLMConfig>();
  private order: LLMModelName[] = [];
  private currentModelName: LLMModelName;

  constructor(config: LLMRouterConfig) {
    if (!Array.isArray(config.models) || config.models.length === 0) {
      throw new Error('LLMRouter 至少需要一个模型');
    }

    for (const entry of config.models) {
      if (this.providers.has(entry.modelName)) {
        throw new Error(`LLM 模型名称重复: ${entry.modelName}`);
      }
      this.providers.set(entry.modelName, entry.provider);
      this.configs.set(entry.modelName, entry.config);
      this.order.push(entry.modelName);
    }

    this.currentModelName = this.providers.has(config.defaultModelName)
      ? config.defaultModelName
      : this.order[0];
  }

  hasModel(modelName: LLMModelName): boolean {
    return this.providers.has(modelName);
  }

  /** 动态注册一个模型（供插件使用） */
  registerModel(entry: LLMRouterModel): void {
    if (this.providers.has(entry.modelName)) {
      throw new Error(`LLM 模型名称重复: ${entry.modelName}`);
    }
    this.providers.set(entry.modelName, entry.provider);
    this.configs.set(entry.modelName, entry.config);
    this.order.push(entry.modelName);
  }

  /** 动态移除一个模型（供插件使用） */
  unregisterModel(modelName: LLMModelName): boolean {
    if (!this.providers.has(modelName)) {
      return false;
    }
    if (this.providers.size <= 1) {
      throw new Error('LLMRouter 至少需要保留一个模型');
    }

    this.providers.delete(modelName);
    this.configs.delete(modelName);
    this.order = this.order.filter(name => name !== modelName);

    if (this.currentModelName === modelName) {
      this.currentModelName = this.order[0];
    }
    return true;
  }

  resolve(modelName?: LLMModelName): LLMProviderLike {
    const targetName = modelName ?? this.currentModelName;
    const provider = this.providers.get(targetName);
    if (!provider) {
      throw new Error(`LLM 模型未找到: ${targetName}`);
    }
    return provider;
  }

  getModelConfig(modelName?: LLMModelName): LLMConfig {
    const targetName = modelName ?? this.currentModelName;
    const config = this.configs.get(targetName);
    if (!config) {
      throw new Error(`LLM 模型未找到: ${targetName}`);
    }
    return config;
  }

  getCurrentModelName(): LLMModelName {
    return this.currentModelName;
  }

  setCurrentModel(modelName: LLMModelName): LLMModelInfo {
    if (!this.providers.has(modelName)) {
      throw new Error(`LLM 模型未找到: ${modelName}`);
    }
    this.currentModelName = modelName;
    return this.getCurrentModelInfo();
  }

  getCurrentConfig(): LLMConfig {
    return this.getModelConfig(this.currentModelName);
  }

  getCurrentModelInfo(): LLMModelInfo {
    return this.getModelInfo(this.currentModelName);
  }

  getModelInfo(modelName: LLMModelName): LLMModelInfo {
    const config = this.getModelConfig(modelName);
    return {
      modelName,
      thinkingControl: config.thinkingControl,
      provider: config.provider,
      modelId: config.model,
      contextWindow: config.contextWindow,
      supportsVision: config.supportsVision,
      current: modelName === this.currentModelName,
    };
  }

  listModels(): LLMModelInfo[] {
    return this.order.map(modelName => this.getModelInfo(modelName));
  }

  /** 非流式调用（按模型名称，可省略以使用当前模型） */
  async chat(request: LLMRequest, modelName?: LLMModelName, signal?: AbortSignal): Promise<LLMResponse> {
    return this.resolve(modelName).chat(request, signal);
  }

  /** 流式调用（按模型名称，可省略以使用当前模型） */
  async *chatStream(request: LLMRequest, modelName?: LLMModelName, signal?: AbortSignal): AsyncGenerator<LLMStreamChunk> {
    yield* this.resolve(modelName).chatStream(request, signal);
  }

  /** 运行时浅合并当前模型的 requestBody 覆盖 */
  patchCurrentModelRequestBody(patch: Record<string, unknown>): void {
    this.resolve().patchRequestBodyOverrides?.(patch);
  }

  /** 运行时移除当前模型 requestBody 覆盖中的指定 key */
  removeCurrentModelRequestBodyKeys(...keys: string[]): void {
    this.resolve().removeRequestBodyOverrideKeys?.(...keys);
  }

  /** 运行时按点分路径删除当前模型 requestBody 覆盖中的嵌套 key */
  removeCurrentModelRequestBodyPaths(...paths: string[]): void {
    this.resolve().removeRequestBodyOverridePaths?.(...paths);
  }

  /** 返回当前活动模型名称（用于日志和状态展示） */
  get name(): string {
    return this.getCurrentModelInfo().modelName;
  }
}
