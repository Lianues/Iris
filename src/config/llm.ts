/**
 * LLM 配置解析
 */

import { LLMConfig, TieredLLMConfig } from './types';

export const DEFAULTS: Record<string, Partial<LLMConfig> & { contextWindow?: number }> = {
  'gemini': {
    model: 'gemini-2.0-flash',
    baseUrl: 'https://generativelanguage.googleapis.com',
    contextWindow: 1048576,
  },
  'openai-compatible': {
    model: 'gpt-4o',
    baseUrl: 'https://api.openai.com',
    contextWindow: 128000,
  },
  'claude': {
    model: 'claude-sonnet-4-6',
    baseUrl: 'https://api.anthropic.com',
    contextWindow: 200000,
  },
};

/** 解析单个 LLM 提供商配置 */
export function parseSingleLLMConfig(raw: any = {}): LLMConfig {
  const provider = (raw.provider ?? 'gemini') as LLMConfig['provider'];
  const defaults = DEFAULTS[provider] ?? {};

  return {
    provider,
    apiKey: raw.apiKey ?? '',
    model: raw.model || defaults.model || '',
    baseUrl: raw.baseUrl || defaults.baseUrl || '',
    contextWindow: typeof raw.contextWindow === 'number' ? raw.contextWindow : defaults.contextWindow,
    headers: raw.headers && typeof raw.headers === 'object' && !Array.isArray(raw.headers) ? raw.headers : undefined,
    requestBody: raw.requestBody && typeof raw.requestBody === 'object' && !Array.isArray(raw.requestBody) ? raw.requestBody : undefined,
  };
}

/** 解析三层 LLM 配置 */
export function parseTieredLLMConfig(raw: any = {}): TieredLLMConfig {
  // 新格式优先（有 primary 字段），再兼容旧扁平格式
  if (raw.primary) {
    // 迁移兼容：旧格式的 apiKey 在顶层，deepMerge 后残留；若 primary 内无 apiKey 则继承
    const primaryRaw = !raw.primary.apiKey && raw.apiKey
      ? { ...raw.primary, apiKey: raw.apiKey }
      : raw.primary;
    const result: TieredLLMConfig = {
      primary: parseSingleLLMConfig(primaryRaw),
    };
    if (raw.secondary) {
      result.secondary = parseSingleLLMConfig(raw.secondary);
    }
    if (raw.light) {
      result.light = parseSingleLLMConfig(raw.light);
    }
    return result;
  }

  // 旧扁平格式（直接有 provider 字段）
  return { primary: parseSingleLLMConfig(raw) };
}
