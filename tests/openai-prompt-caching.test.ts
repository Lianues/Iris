import { describe, expect, it } from 'vitest';
import { parseSingleLLMConfig } from '../src/config/llm';
import { OpenAICompatibleFormat } from '../src/llm/formats/openai-compatible';
import {
  buildOpenAIPromptCacheKey,
  supportsOpenAIPromptCacheOptions,
} from '../src/llm/formats/openai-prompt-cache';
import { OpenAIResponsesFormat } from '../src/llm/formats/openai-responses';
import type { LLMRequest } from '../src/types';

function request(systemText = 'Stable system prompt'): LLMRequest {
  return {
    systemInstruction: { parts: [{ text: systemText }] },
    contents: [{ role: 'user', parts: [{ text: 'Hello' }] }],
    tools: [{
      functionDeclarations: [{
        name: 'read_file',
        description: 'Read one file',
        parameters: {
          type: 'object',
          properties: { path: { type: 'string' } },
          required: ['path'],
        },
      }],
    }],
  };
}

describe('OpenAI GPT-5.6 Prompt Caching', () => {
  it('仅对 GPT-5.6 及后续模型启用新缓存参数', () => {
    expect(supportsOpenAIPromptCacheOptions('gpt-5.6')).toBe(true);
    expect(supportsOpenAIPromptCacheOptions('gpt-5.6-terra')).toBe(true);
    expect(supportsOpenAIPromptCacheOptions('openai/gpt-5.7')).toBe(true);
    expect(supportsOpenAIPromptCacheOptions('gpt-5.5')).toBe(false);
    expect(supportsOpenAIPromptCacheOptions('gpt-4o')).toBe(false);
  });

  it('Chat Completions 默认开启 implicit + 30m，并生成稳定 cache key', () => {
    const format = new OpenAICompatibleFormat('gpt-5.6');
    const first = format.encodeRequest(request()) as any;
    const second = format.encodeRequest(request()) as any;

    expect(first.prompt_cache_options).toEqual({ mode: 'implicit', ttl: '30m' });
    expect(first.prompt_cache_key).toMatch(/^iris:[a-z0-9]+$/);
    expect(second.prompt_cache_key).toBe(first.prompt_cache_key);
  });

  it('Responses API 使用相同策略，稳定前缀改变时 cache key 也改变', () => {
    const format = new OpenAIResponsesFormat('gpt-5.6-sol', true);
    const first = format.encodeRequest(request('System A')) as any;
    const second = format.encodeRequest(request('System B')) as any;

    expect(first.prompt_cache_options).toEqual({ mode: 'implicit', ttl: '30m' });
    expect(first.prompt_cache_key).not.toBe(second.prompt_cache_key);
  });

  it('关闭时使用 explicit 且不放置断点或 cache key', () => {
    const chatBody = new OpenAICompatibleFormat('gpt-5.6', false)
      .encodeRequest(request()) as any;
    const responsesBody = new OpenAIResponsesFormat('gpt-5.6-luna', false)
      .encodeRequest(request()) as any;

    for (const body of [chatBody, responsesBody]) {
      expect(body.prompt_cache_options).toEqual({ mode: 'explicit' });
      expect(body.prompt_cache_key).toBeUndefined();
      expect(JSON.stringify(body)).not.toContain('prompt_cache_breakpoint');
    }
  });

  it('不会向旧模型发送 GPT-5.6 专属参数', () => {
    const body = new OpenAIResponsesFormat('gpt-5.5', true)
      .encodeRequest(request()) as any;

    expect(body.prompt_cache_options).toBeUndefined();
    expect(body.prompt_cache_key).toBeUndefined();
  });

  it('配置解析保留显式 false，允许 TUI 真正关闭缓存', () => {
    expect(parseSingleLLMConfig({
      provider: 'openai-responses',
      model: 'gpt-5.6',
      promptCaching: false,
      autoCaching: false,
    })).toMatchObject({
      promptCaching: false,
      autoCaching: false,
    });
  });

  it('cache key 不直接包含系统提示词内容', () => {
    const key = buildOpenAIPromptCacheKey('gpt-5.6', {
      instructions: 'private stable instructions',
    });
    expect(key).toMatch(/^iris:[a-z0-9]+$/);
    expect(key).not.toContain('private');
  });
});
