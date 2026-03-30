/**
 * 配置管理 API 处理器
 *
 * GET /api/config — 读取配置（敏感字段脱敏）
 * PUT /api/config — 更新配置并尝试热重载
 * POST /api/config/models — 使用当前 provider/baseUrl/apiKey 拉取模型列表
 *
 * 通过注入的 ConfigManagerLike 接口访问配置，不直接引用 src/ 内部模块。
 */

import * as http from 'http';
import { readBody, sendJSON } from '../router';
import type { ConfigManagerLike, IrisAPI } from '@irises/extension-sdk';

const SUPPORTED_PROVIDERS = new Set([
  'gemini',
  'openai-compatible',
  'openai-responses',
  'claude',
]);

function isMasked(value: string): boolean {
  return typeof value === 'string' && value.startsWith('****');
}

function resolveStoredModelConfig(rawLLM: any, modelName?: string): any {
  if (rawLLM?.models && typeof rawLLM.models === 'object' && !Array.isArray(rawLLM.models)) {
    const requestedModelName = typeof modelName === 'string' && modelName.trim()
      ? modelName.trim()
      : typeof rawLLM.defaultModel === 'string' && rawLLM.defaultModel.trim()
        ? rawLLM.defaultModel.trim()
        : undefined;

    if (requestedModelName && rawLLM.models[requestedModelName] && typeof rawLLM.models[requestedModelName] === 'object') {
      return rawLLM.models[requestedModelName];
    }

    for (const value of Object.values(rawLLM.models) as any[]) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        return value;
      }
    }
  }

  return {};
}

function resolveModelLookupInput(cm: ConfigManagerLike, body: any): {
  provider: string;
  apiKey: string;
  baseUrl: string;
  usedStoredApiKey: boolean;
} {
  const requestedModelName = typeof body?.modelName === 'string' && body.modelName.trim()
    ? body.modelName.trim()
    : undefined;
  const rawConfig = cm.readEditableConfig();
  const rawLLM = (rawConfig as any).llm ?? {};
  const storedModel = resolveStoredModelConfig(rawLLM, requestedModelName);

  const providerValue = typeof body?.provider === 'string' && body.provider.trim()
    ? body.provider.trim()
    : String(storedModel?.provider ?? 'gemini').trim();

  if (!SUPPORTED_PROVIDERS.has(providerValue)) {
    throw new Error(`不支持的提供商: ${providerValue || '(空)'}`);
  }

  const baseUrl = typeof body?.baseUrl === 'string' && body.baseUrl.trim()
    ? body.baseUrl.trim()
    : String(storedModel?.baseUrl ?? '').trim();

  const requestApiKey = typeof body?.apiKey === 'string' ? body.apiKey.trim() : '';
  const usedStoredApiKey = !requestApiKey || isMasked(requestApiKey);
  const apiKey = usedStoredApiKey
    ? String(storedModel?.apiKey ?? '').trim()
    : requestApiKey;

  if (!apiKey) {
    throw new Error('请先填写 API Key，或先保存配置后再拉取模型列表');
  }

  return {
    provider: providerValue,
    apiKey,
    baseUrl,
    usedStoredApiKey,
  };
}

export function createConfigHandlers(api: IrisAPI, onReload?: (mergedConfig: any) => void | Promise<void>) {
  const cm = api.configManager!;
  return {
    /** GET /api/config */
    async get(_req: http.IncomingMessage, res: http.ServerResponse) {
      try {
        sendJSON(res, 200, cm.readEditableConfig());
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        sendJSON(res, 500, { error: `读取配置失败: ${msg}` });
      }
    },

    /** PUT /api/config */
    async update(req: http.IncomingMessage, res: http.ServerResponse) {
      try {
        const updates = await readBody(req);
        const { mergedRaw } = cm.updateEditableConfig(updates);

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
        const input = resolveModelLookupInput(cm, body);
        if (!api.fetchAvailableModels) {
          sendJSON(res, 501, { error: '模型列表拉取未实现' });
          return;
        }
        const result = await api.fetchAvailableModels(input);
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
