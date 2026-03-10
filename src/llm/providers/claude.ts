/**
 * Claude/Anthropic Provider
 */

import { LLMProvider } from './base';
import { ClaudeFormat } from '../formats/claude';

export interface ClaudeProviderConfig {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  headers?: Record<string, string>;
  requestBody?: Record<string, unknown>;
}

export function createClaudeProvider(config: ClaudeProviderConfig): LLMProvider {
  const model = config.model || 'claude-sonnet-4-6';
  const baseUrl = config.baseUrl || 'https://api.anthropic.com';

  return new LLMProvider(
    new ClaudeFormat(model),
    {
      url: `${baseUrl}/v1/messages`,
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
