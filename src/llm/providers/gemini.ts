/**
 * Gemini Provider
 */

import { LLMProvider } from './base';
import type { LLMConfig } from '../../config/types';
import { GeminiFormat } from '../formats/gemini';

/**
 * 创建 Gemini Provider。
 * 修改原因：直接接收 LLMConfig，消除手动字段映射，实现单一信息源。
 */
export function createGeminiProvider(config: LLMConfig): LLMProvider {
  const model = config.model || 'gemini-2.0-flash';
  const baseUrl = (config.baseUrl || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, '');
  const key = config.apiKey;

  return new LLMProvider(
    new GeminiFormat(),
    {
      url: `${baseUrl}/models/${model}:generateContent`,
      streamUrl: `${baseUrl}/models/${model}:streamGenerateContent?alt=sse`,
      headers: { 'x-goog-api-key': key, ...config.headers },
    },
    'Gemini',
    config.requestBody,
  );
}
