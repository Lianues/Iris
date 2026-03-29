/**
 * OpenAI Responses Provider
 * 
 * 组装 OpenAI Responses 格式适配器与 HTTP 传输逻辑。
 */

import { LLMProvider } from './base';
import type { LLMConfig } from '../../config/types';
import { OpenAIResponsesFormat } from '../formats/openai-responses';

/**
 * 创建 OpenAI Responses Provider。
 * 修改原因：直接接收 LLMConfig，消除手动字段映射，实现单一信息源。
 */
export function createOpenAIResponsesProvider(config: LLMConfig): LLMProvider {
  const baseUrl = (config.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
  // OpenAI Responses API 路径
  const url = `${baseUrl}/responses`;

  return new LLMProvider(
    new OpenAIResponsesFormat(config.model),
    {
      url,
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
        ...config.headers,
      },
    },
    `OpenAIResponses(${config.model})`,
    config.requestBody,
  );
}
