import { describe, expect, it } from 'vitest';
import { parseSingleLLMConfig } from '../src/config/llm.js';
import {
  estimateLLMRequestTokens,
  findLastPersistedTotalTokens,
  getConfiguredMaxOutputTokens,
  hasCompleteToolBoundary,
  resolveAutoSummaryThreshold,
  resolveRequestCompactThreshold,
} from '../src/core/backend/compaction.js';
import type { Content, LLMRequest } from '../src/types/index.js';
import type { LLMConfig } from '../src/config/types.js';

function config(overrides: Partial<LLMConfig> = {}): LLMConfig {
  return {
    provider: 'openai-compatible',
    apiKey: '',
    model: 'test-model',
    baseUrl: 'https://example.test/v1',
    contextWindow: 100_000,
    ...overrides,
  };
}

describe('compact configuration defaults', () => {
  it('enables auto compact at 90% when the field is omitted', () => {
    const parsed = parseSingleLLMConfig({ provider: 'claude' });
    expect(parsed.autoSummaryThreshold).toBe('90%');
    expect(resolveAutoSummaryThreshold(parsed)).toBe(180_000);
  });

  it('supports explicit false and absolute thresholds', () => {
    expect(resolveAutoSummaryThreshold(config({ autoSummaryThreshold: false }))).toBeUndefined();
    expect(resolveAutoSummaryThreshold(config({ autoSummaryThreshold: 42_000 }))).toBe(42_000);
    expect(resolveAutoSummaryThreshold(config({ autoSummaryThreshold: '42000' }))).toBe(42_000);
  });

  it('does not interpret a percentage as absolute tokens without contextWindow', () => {
    expect(resolveAutoSummaryThreshold(config({ contextWindow: undefined, autoSummaryThreshold: '90%' }))).toBeUndefined();
    expect(resolveAutoSummaryThreshold(config({ contextWindow: undefined, autoSummaryThreshold: '90%%' }))).toBeUndefined();
  });

  it('reserves explicitly configured output tokens', () => {
    const cfg = config({
      autoSummaryThreshold: '90%',
      requestBody: { max_output_tokens: 25_000 },
    });
    expect(getConfiguredMaxOutputTokens(cfg)).toBe(25_000);
    expect(resolveAutoSummaryThreshold(cfg)).toBe(75_000);
  });

  it('reads Gemini maxOutputTokens from generationConfig', () => {
    const cfg = config({ requestBody: { generationConfig: { maxOutputTokens: 12_345 } } });
    expect(getConfiguredMaxOutputTokens(cfg)).toBe(12_345);
  });

  it('reserves default output and estimation margin for final request preflight', () => {
    const cfg = config({ contextWindow: 400_000, autoSummaryThreshold: '90%' });
    const request: LLMRequest = { contents: [{ role: 'user', parts: [{ text: 'hello' }] }] };
    expect(resolveRequestCompactThreshold(cfg, request)).toBe(352_000);
    expect(estimateLLMRequestTokens(request)).toBeGreaterThan(0);
  });

  it('recognizes only complete adjacent function call/response boundaries', () => {
    const complete: Content[] = [
      { role: 'user', parts: [{ text: 'run' }] },
      {
        role: 'model',
        parts: [
          { functionCall: { name: 'a', args: {}, callId: '1' } },
          { functionCall: { name: 'b', args: {}, callId: '2' } },
        ],
      },
      {
        role: 'user',
        parts: [
          { functionResponse: { name: 'a', response: { ok: true }, callId: '1' } },
          { functionResponse: { name: 'b', response: { ok: true }, callId: '2' } },
        ],
      },
    ];
    expect(hasCompleteToolBoundary(complete)).toBe(true);
    expect(hasCompleteToolBoundary(complete.slice(0, -1))).toBe(false);
    expect(hasCompleteToolBoundary([...complete.slice(0, -1), { role: 'user', parts: [{ text: 'not a tool response' }] }])).toBe(false);
  });
});

describe('persisted compact token recovery', () => {
  it('finds the latest persisted totalTokenCount', () => {
    const history: Content[] = [
      { role: 'model', parts: [{ text: 'old' }], usageMetadata: { totalTokenCount: 100 } },
      { role: 'user', parts: [{ text: 'next' }] },
      { role: 'model', parts: [{ text: 'new' }], usageMetadata: { totalTokenCount: 900 } },
    ];
    expect(findLastPersistedTotalTokens(history)).toBe(900);
  });
});
