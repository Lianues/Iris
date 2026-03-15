/**
 * LLM 模型路由器
 *
 * 管理一组按 modelName 注册的模型，并维护当前活动模型。
 */

import { LLMProvider } from './providers/base';
import { LLMRequest, LLMResponse, LLMStreamChunk } from '../types';
import { LLMConfig } from '../config/types';

export type LLMModelName = string;

export interface LLMRouterModel {
  modelName: LLMModelName;
  provider: LLMProvider;
  config: LLMConfig;
}

export interface LLMModelInfo {
  modelName: LLMModelName;
  provider: LLMConfig['provider'];
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
  private providers = new Map<LLMModelName, LLMProvider>();
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

  resolve(modelName?: LLMModelName): LLMProvider {
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

  /** 返回当前活动模型名称（用于日志和状态展示） */
  get name(): string {
    return this.getCurrentModelInfo().modelName;
  }
}
