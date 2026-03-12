/**
 * 配置管理 API 处理器
 *
 * GET /api/config — 读取配置（敏感字段脱敏）
 * PUT /api/config — 更新配置并尝试热重载
 * POST /api/config/models — 使用当前 provider/baseUrl/apiKey 拉取模型列表
 */

import * as http from 'http';
import { readBody, sendJSON } from '../router';
import { isMasked, readEditableConfig, updateEditableConfig } from '../../../config/manage';
import { loadRawConfigDir } from '../../../config/raw';
import { listAvailableModels } from '../../../llm/model-catalog';
import type { LLMConfig } from '../../../config/types';

const SUPPORTED_PROVIDERS = new Set<LLMConfig['provider']>([
  'gemini',
  'openai-compatible',
  'openai-responses',
  'claude',
]);

type TierName = 'primary' | 'secondary' | 'light';

function isTierName(value: unknown): value is TierName {
  return value === 'primary' || value === 'secondary' || value === 'light';
}

function resolveStoredTierConfig(rawLLM: any, tier: TierName): any {
  if (rawLLM?.[tier] && typeof rawLLM[tier] === 'object') {
    return rawLLM[tier];
  }
  if (tier === 'primary' && rawLLM && typeof rawLLM === 'object') {
    return rawLLM;
  }
  return {};
}

function resolveModelLookupInput(configDir: string, body: any): {
  provider: LLMConfig['provider'];
  apiKey: string;
  baseUrl: string;
  usedStoredApiKey: boolean;
} {
  const tier = isTierName(body?.tier) ? body.tier : 'primary';
  const rawConfig = loadRawConfigDir(configDir);
  const rawLLM = rawConfig.llm ?? {};
  const storedTier = resolveStoredTierConfig(rawLLM, tier);

  const providerValue = typeof body?.provider === 'string' && body.provider.trim()
    ? body.provider.trim()
    : String(storedTier?.provider ?? rawLLM?.provider ?? 'gemini').trim();

  if (!SUPPORTED_PROVIDERS.has(providerValue as LLMConfig['provider'])) {
    throw new Error(`不支持的提供商: ${providerValue || '(空)'}`);
  }

  const baseUrl = typeof body?.baseUrl === 'string' && body.baseUrl.trim()
    ? body.baseUrl.trim()
    : String(storedTier?.baseUrl ?? rawLLM?.baseUrl ?? '').trim();

  const requestApiKey = typeof body?.apiKey === 'string' ? body.apiKey.trim() : '';
  const usedStoredApiKey = !requestApiKey || isMasked(requestApiKey);
  const apiKey = usedStoredApiKey
    ? String(storedTier?.apiKey ?? (tier === 'primary' ? rawLLM?.apiKey ?? '' : '')).trim()
    : requestApiKey;

  if (!apiKey) {
    throw new Error('请先填写 API Key，或先保存配置后再拉取模型列表');
  }

  return {
    provider: providerValue as LLMConfig['provider'],
    apiKey,
    baseUrl,
    usedStoredApiKey,
  };
}

export function createConfigHandlers(configDir: string, onReload?: (mergedConfig: any) => void | Promise<void>) {
  return {
    /** GET /api/config */
    async get(_req: http.IncomingMessage, res: http.ServerResponse) {
      try {
        sendJSON(res, 200, readEditableConfig(configDir));
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        sendJSON(res, 500, { error: `读取配置失败: ${msg}` });
      }
    },

    /** PUT /api/config */
    async update(req: http.IncomingMessage, res: http.ServerResponse) {
      try {
        const updates = await readBody(req);
        const { mergedRaw } = updateEditableConfig(configDir, updates);

        let reloaded = false;
        if (onReload) {
          try {
            await onReload(mergedRaw);
            reloaded = true;
          } catch {
            // 热重载失败时回退为需要重启
          }
        }

        sendJSON(res, 200, { ok: true, restartRequired: !reloaded });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        sendJSON(res, 500, { error: `更新配置失败: ${msg}` });
      }
    },

    /** POST /api/config/models */
    async listModels(req: http.IncomingMessage, res: http.ServerResponse) {
      try {
        const body = await readBody(req);
        const input = resolveModelLookupInput(configDir, body);
        const result = await listAvailableModels(input);
        sendJSON(res, 200, {
          provider: result.provider,
          baseUrl: result.baseUrl,
          usedStoredApiKey: input.usedStoredApiKey,
          models: result.models,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        sendJSON(res, 500, { error: `拉取模型列表失败: ${msg}` });
      }
    },
  };
}
