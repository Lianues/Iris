/**
 * LLM 工厂函数
 *
 * 根据配置创建对应的 LLMProvider 实例或 LLMRouter。
 * 供启动和热重载时复用。
 */

import { LLMProvider } from './providers/base';
import { createGeminiProvider } from './providers/gemini';
import { createOpenAICompatibleProvider } from './providers/openai-compatible';
import { createClaudeProvider } from './providers/claude';
import { LLMRouter } from './router';
import { LLMConfig, TieredLLMConfig } from '../config/types';

export function createLLMFromConfig(config: LLMConfig): LLMProvider {
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
      });
    case 'gemini':
    default:
      return createGeminiProvider({
        apiKey: config.apiKey,
        model: config.model,
        baseUrl: config.baseUrl,
        headers: config.headers,
        requestBody: config.requestBody,
      });
  }
}

/** 根据三层配置创建路由器 */
export function createLLMRouter(config: TieredLLMConfig): LLMRouter {
  return new LLMRouter({
    primary: createLLMFromConfig(config.primary),
    secondary: config.secondary ? createLLMFromConfig(config.secondary) : undefined,
    light: config.light ? createLLMFromConfig(config.light) : undefined,
  });
}
