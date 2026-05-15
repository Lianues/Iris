import { afterEach, describe, expect, it, vi } from 'vitest';

import { createBootstrapExtensionRegistry } from '../src/bootstrap/extensions.js';
import { DEFAULTS } from '../src/config/llm.js';
import { createDeepSeekProvider } from '../src/llm/providers/deepseek.js';
import { listAvailableModels } from '../src/llm/model-catalog.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  vi.restoreAllMocks();
  globalThis.fetch = originalFetch;
});

describe('DeepSeek Provider', () => {
  it('注册为内置 LLM provider', () => {
    const registry = createBootstrapExtensionRegistry();
    expect(registry.llmProviders.has('deepseek')).toBe(true);
  });

  it('默认上下文窗口为 1000000', () => {
    expect(DEFAULTS.deepseek.contextWindow).toBe(1000000);
  });

  it('使用 DeepSeek 默认 Chat Completions 端点和模型', async () => {
    const calls: Array<{ url: string; body: any; headers: Record<string, string> }> = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        url: String(input),
        body: JSON.parse(String(init?.body)),
        headers: init?.headers as Record<string, string>,
      });
      return new Response(JSON.stringify({
        choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as any;

    const provider = createDeepSeekProvider({
      provider: 'deepseek',
      apiKey: 'test-key',
      model: '',
      baseUrl: 'https://example.invalid/v1',
    });

    const response = await provider.chat({
      contents: [{ role: 'user', parts: [{ text: 'hello' }] }],
    });

    expect(response.content.parts).toEqual([{ text: 'ok' }]);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.deepseek.com/v1/chat/completions');
    expect(calls[0].headers.Authorization).toBe('Bearer test-key');
    expect(calls[0].body.model).toBe('deepseek-v4-flash');
    expect(calls[0].body.messages).toEqual([{ role: 'user', content: 'hello' }]);
  });

  it('非法 DeepSeek 模型 ID 会回退为 flash', async () => {
    let requestBody: any;
    globalThis.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({
        choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as any;

    const provider = createDeepSeekProvider({
      provider: 'deepseek',
      apiKey: 'test-key',
      model: 'deepseek-v4-custom',
      baseUrl: 'https://example.invalid/v1',
    });

    await provider.chat({ contents: [{ role: 'user', parts: [{ text: 'hello' }] }] });

    expect(requestBody.model).toBe('deepseek-v4-flash');
  });

  it('模型列表固定为 DeepSeek flash/pro 二选一，且不访问网络', async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as any;
    const result = await listAvailableModels({
      provider: 'deepseek',
      apiKey: '',
      baseUrl: 'https://example.invalid/v1',
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.baseUrl).toBe('https://api.deepseek.com/v1');
    expect(result.models.map(model => model.id)).toEqual(['deepseek-v4-flash', 'deepseek-v4-pro']);
  });
});
