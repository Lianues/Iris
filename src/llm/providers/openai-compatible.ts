/**
 * OpenAI Compatible Provider
 *
 * 适用于所有 OpenAI 兼容接口（OpenAI、DeepSeek、本地模型等）。
 */

import { LLMProvider } from './base';
import type { LLMConfig } from '../../config/types';
import { OpenAICompatibleFormat } from '../formats/openai-compatible';

/**
 * 创建 OpenAI 兼容 Provider。
 * 修改原因：直接接收 LLMConfig，消除手动字段映射，实现单一信息源。
 */
export function createOpenAICompatibleProvider(config: LLMConfig): LLMProvider {
  const model = config.model || 'gpt-4o';
  const baseUrl = (config.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');

  return new LLMProvider(
    new OpenAICompatibleFormat(model),
    {
      url: `${baseUrl}/chat/completions`,
      headers: { 'Authorization': `Bearer ${config.apiKey}`, ...config.headers },
    },
    'OpenAICompatible',
    config.requestBody,
  );
}
