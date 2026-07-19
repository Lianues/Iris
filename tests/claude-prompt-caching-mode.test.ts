import { describe, expect, it } from 'vitest';
import { ClaudeFormat } from '../src/llm/formats/claude';
import type { LLMRequest } from '../src/types';

function request(): LLMRequest {
  return {
    systemInstruction: { parts: [{ text: 'Stable system prompt' }] },
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

describe('Claude Prompt Cache 策略', () => {
  it('自动策略只发送顶层 cache_control', () => {
    const body = new ClaudeFormat('claude-sonnet-4-6', false, true)
      .encodeRequest(request()) as any;

    expect(body.cache_control).toEqual({ type: 'ephemeral' });
    expect(body.tools.at(-1).cache_control).toBeUndefined();
    expect(body.system).toBe('Stable system prompt');
    expect(body.messages.at(-1).content).toBe('Hello');
  });

  it('显式策略注入块级断点且不发送顶层自动标记', () => {
    const body = new ClaudeFormat('claude-sonnet-4-6', true, false)
      .encodeRequest(request()) as any;

    expect(body.cache_control).toBeUndefined();
    expect(body.tools.at(-1).cache_control).toEqual({ type: 'ephemeral' });
    expect(body.system.at(-1).cache_control).toEqual({ type: 'ephemeral' });
    expect(body.messages.at(-1).content.at(-1).cache_control).toEqual({ type: 'ephemeral' });
  });

  it('兼容旧配置：两者同时为 true 时显式策略优先', () => {
    const body = new ClaudeFormat('claude-sonnet-4-6', true, true)
      .encodeRequest(request()) as any;

    expect(body.cache_control).toBeUndefined();
    expect(body.tools.at(-1).cache_control).toEqual({ type: 'ephemeral' });
    expect(body.messages.at(-1).content.at(-1).cache_control).toEqual({ type: 'ephemeral' });
  });
});
