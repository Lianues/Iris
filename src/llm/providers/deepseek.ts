/**
 * DeepSeek Provider
 *
 * DeepSeek 使用 OpenAI Chat Completions 兼容请求/响应格式，但官方 SDK 示例
 * 的 API 端点应走 https://api.deepseek.com/v1/chat/completions。
 */

import { LLMProvider } from './base';
import type { LLMConfig } from '../../config/types';
import { OpenAICompatibleFormat } from '../formats/openai-compatible';

const DEEPSEEK_BASE_URL = 'https://api.deepseek.com/v1';
const DEEPSEEK_DEFAULT_MODEL = 'deepseek-v4-flash';
const DEEPSEEK_ALLOWED_MODELS = new Set(['deepseek-v4-flash', 'deepseek-v4-pro']);

function normalizeDeepSeekModel(model: unknown): string {
  const value = typeof model === 'string' ? model.trim() : '';
  return DEEPSEEK_ALLOWED_MODELS.has(value)
    ? value
    : DEEPSEEK_DEFAULT_MODEL;
}

/** 创建 DeepSeek Provider。 */
export function createDeepSeekProvider(config: LLMConfig): LLMProvider {
  const model = normalizeDeepSeekModel(config.model);

  return new LLMProvider(
    new OpenAICompatibleFormat(model),
    {
      // DeepSeek 官方 API baseURL 固定为 https://api.deepseek.com/v1；
      // 用户配置中的 baseUrl 在 deepseek provider 下会被忽略，避免误填或代理地址。
      url: `${DEEPSEEK_BASE_URL}/chat/completions`,
      headers: { Authorization: `Bearer ${config.apiKey}`, ...config.headers },
    },
    'DeepSeek',
    config.requestBody,
  );
}
