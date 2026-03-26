/**
 * LLM 工厂函数
 *
 * 根据配置创建对应的 LLMProvider 实例或 LLMRouter。
 * 供启动和热重载时复用。
 */

import type { LLMProviderLike } from './providers/base';
import { createGeminiProvider } from './providers/gemini';
import { createOpenAICompatibleProvider } from './providers/openai-compatible';
import { createClaudeProvider } from './providers/claude';
import { createOpenAIResponsesProvider } from './providers/openai-responses';
import { LLMRouter } from './router';
import { LLMConfig, LLMRegistryConfig } from '../config/types';
import type { LLMProviderFactoryRegistry } from '../bootstrap/extensions';

//
// ⚠️  注意：此 switch-case 仅为 fallback。
//    运行时优先使用 bootstrap/extensions.ts 中注册的工厂函数
//    （下方 registeredFactory 判断会先行 return）。
//    新增配置字段时，必须同步更新 extensions.ts。
//
export function createLLMFromConfig(config: LLMConfig, registry?: Pick<LLMProviderFactoryRegistry, 'get'>): LLMProviderLike {
  const registeredFactory = registry?.get(config.provider);
  if (registeredFactory) return registeredFactory(config);
  switch (config.provider) {
    case 'openai-compatible':
      return createOpenAICompatibleProvider({
        apiKey: config.apiKey,
        model: config.model,
        baseUrl: config.baseUrl,
        headers: config.headers,
        requestBody: config.requestBody,
      });
    case 'claude':
      return createClaudeProvider({
        apiKey: config.apiKey,
        model: config.model,
        baseUrl: config.baseUrl,
        headers: config.headers,
        requestBody: config.requestBody,
        promptCaching: config.promptCaching === true,
        autoCaching: config.autoCaching === true,
      });
    case 'openai-responses':
      return createOpenAIResponsesProvider({
        apiKey: config.apiKey,
        model: config.model,
        baseUrl: config.baseUrl,
        headers: config.headers,
        requestBody: config.requestBody,
      });
    case 'gemini':
      return createGeminiProvider({
        apiKey: config.apiKey,
        model: config.model,
        baseUrl: config.baseUrl,
        headers: config.headers,
        requestBody: config.requestBody,
      });
    default:
      throw new Error(`未注册的 LLM provider: ${config.provider}`);
  }
}

/** 根据模型池配置创建路由器 */
export function createLLMRouter(config: LLMRegistryConfig, currentModelName?: string, registry?: Pick<LLMProviderFactoryRegistry, 'get'>): LLMRouter {
  const router = new LLMRouter({
    defaultModelName: config.defaultModelName,
    models: config.models.map(model => ({
      modelName: model.modelName,
      provider: createLLMFromConfig(model, registry),
      config: model,
    })),
  });

  if (currentModelName && router.hasModel(currentModelName)) {
    router.setCurrentModel(currentModelName);
  }

  return router;
}
