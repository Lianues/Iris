/**
 * Claude/Anthropic Provider
 */

import { LLMProvider } from './base';
import type { LLMConfig } from '../../config/types';
import { ClaudeFormat } from '../formats/claude';

/**
 * 创建 Claude/Anthropic Provider。
 * 修改原因：直接接收 LLMConfig，消除手动字段映射，实现单一信息源。
 */
export function createClaudeProvider(config: LLMConfig): LLMProvider {
  const model = config.model || 'claude-sonnet-4-6';
  const baseUrl = (config.baseUrl || 'https://api.anthropic.com/v1').replace(/\/+$/, '');

  return new LLMProvider(
    new ClaudeFormat(model, config.promptCaching, config.autoCaching),
    {
      url: `${baseUrl}/messages`,
      headers: {
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01',
        ...config.headers,
      },
    },
    'Claude',
    config.requestBody,
  );
}
