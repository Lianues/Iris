import { describe, it, expect, vi } from 'vitest';
import { Backend } from '../src/core/backend/backend.js';
import {
  groupHistoryByCompactUnit,
  prepareHistoryForSummary,
  summarizeHistory,
} from '../src/core/summarizer.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { ToolStateManager } from '../src/tools/state.js';
import { PromptAssembler } from '../src/prompt/assembler.js';
import { DEFAULT_MAX_OUTPUT_TOKENS, DEFAULT_SYSTEM_PROMPT, DEFAULT_USER_PROMPT, parseSummaryConfig } from '../src/config/summary.js';
import { estimateLLMRequestTokens } from '../src/core/backend/compaction.js';
import { prepareHistoryForLLM } from '../src/core/backend/history.js';
import type { Content, LLMRequest, LLMStreamChunk } from '../src/types/index.js';
import { estimateTokenCount } from 'tokenx';

const history: Content[] = [
  { role: 'user', parts: [{ text: 'hello' }] },
  { role: 'model', parts: [{ text: 'hi' }] },
];

function streamFrom(chunks: LLMStreamChunk[]): AsyncGenerator<LLMStreamChunk> {
  return (async function* () {
    for (const chunk of chunks) yield chunk;
  })();
}

describe('parseSummaryConfig defaults', () => {
  it('uses the configured default compact prompts', () => {
    const config = parseSummaryConfig({});

    expect(config.systemPrompt).toBe(DEFAULT_SYSTEM_PROMPT);
    expect(config.userPrompt).toBe(DEFAULT_USER_PROMPT);
    expect(config.maxOutputTokens).toBe(DEFAULT_MAX_OUTPUT_TOKENS);
    expect(config.systemPrompt).toBe('Please summarize the above conversation, keeping key information and context points while removing redundant content.');
    expect(config.userPrompt).toContain('## User Requirements');
    expect(config.userPrompt).toContain('Output content directly without any prefix.');
  });
});

describe('summarizeHistory stream option', () => {
  it('uses non-stream chat when stream is disabled', async () => {
    const router = {
      chat: vi.fn(async (_request: LLMRequest, _modelName?: string, _signal?: AbortSignal) => ({
        content: { role: 'model' as const, parts: [{ text: ' non-stream summary ' }] },
      })),
      chatStream: vi.fn(),
    } as any;

    const result = await summarizeHistory(router, history, 'summary-model', undefined, { stream: false });

    expect(result).toBe('non-stream summary');
    expect(router.chat).toHaveBeenCalledTimes(1);
    expect(router.chat).toHaveBeenCalledWith(
      expect.any(Object), 'summary-model', undefined,
      { maxOutputTokensCeiling: DEFAULT_MAX_OUTPUT_TOKENS },
    );
    const request = router.chat.mock.calls[0][0] as LLMRequest;
    expect(request.contents.at(-1)?.role).toBe('user');
    expect((request.contents.at(-1)?.parts[0] as { text?: string }).text).toContain(DEFAULT_USER_PROMPT);
    expect((request.contents.at(-1)?.parts[0] as { text?: string }).text).toContain('approximately 12288 tokens');
    expect(request.systemInstruction?.parts).toEqual([{ text: DEFAULT_SYSTEM_PROMPT }]);
    expect(request.generationConfig?.maxOutputTokens).toBe(DEFAULT_MAX_OUTPUT_TOKENS);
    expect(router.chatStream).not.toHaveBeenCalled();
  });

  it('uses chatStream and collects visible text when stream is enabled', async () => {
    const signal = new AbortController().signal;
    const router = {
      chat: vi.fn(),
      chatStream: vi.fn((_request: LLMRequest, _modelName?: string, _signal?: AbortSignal) => streamFrom([
        { textDelta: 'stream ' },
        { partsDelta: [{ text: 'summary' }, { text: ' hidden thought ', thought: true }] },
        { textDelta: ' done' },
      ])),
    } as any;

    const result = await summarizeHistory(router, history, 'summary-model', undefined, { stream: true, signal });

    expect(result).toBe('stream summary done');
    expect(router.chat).not.toHaveBeenCalled();
    expect(router.chatStream).toHaveBeenCalledTimes(1);
    expect(router.chatStream).toHaveBeenCalledWith(
      expect.any(Object), 'summary-model', signal,
      { maxOutputTokensCeiling: DEFAULT_MAX_OUTPUT_TOKENS },
    );
  });
});

describe('compact history hardening', () => {
  it('removes thought text and truncates oversized tool payloads', () => {
    const prepared = prepareHistoryForSummary([
      {
        role: 'model',
        parts: [
          { text: 'private reasoning', thought: true, thoughtSignatures: { gemini: 'sig' } },
          { text: 'visible result' },
        ],
      },
      {
        role: 'user',
        parts: [{ functionResponse: { name: 'shell', response: { output: 'x'.repeat(20_000) } } }],
      },
    ]);

    expect(JSON.stringify(prepared)).not.toContain('private reasoning');
    expect(JSON.stringify(prepared)).not.toContain('sig');
    expect(JSON.stringify(prepared)).toContain('visible result');
    expect(JSON.stringify(prepared)).toContain('truncated');
    expect(JSON.stringify(prepared).length).toBeLessThan(10_000);
  });

  it('rejects an empty model summary', async () => {
    const router = {
      chat: vi.fn(async () => ({
        content: { role: 'model' as const, parts: [{ text: '   ' }] },
      })),
      chatStream: vi.fn(),
    } as any;

    await expect(summarizeHistory(router, history, 'summary-model'))
      .rejects.toThrow('总结模型返回了空摘要');
  });

  it('groups one long user task by complete tool exchanges instead of one giant turn', () => {
    const longTaskHistory: Content[] = [
      { role: 'user', parts: [{ text: 'long task' }] },
      { role: 'model', parts: [{ functionCall: { name: 'a', args: {}, callId: 'a1' } }] },
      { role: 'user', parts: [{ functionResponse: { name: 'a', response: { ok: true }, callId: 'a1' } }] },
      { role: 'model', parts: [{ functionCall: { name: 'b', args: {}, callId: 'b1' } }] },
      { role: 'user', parts: [{ functionResponse: { name: 'b', response: { ok: true }, callId: 'b1' } }] },
      { role: 'model', parts: [{ text: 'final' }] },
    ];

    const units = groupHistoryByCompactUnit(longTaskHistory);
    expect(units.map(unit => unit.length)).toEqual([1, 2, 2, 1]);
    expect(units[1][0].parts.some(part => 'functionCall' in part)).toBe(true);
    expect(units[1][1].parts.some(part => 'functionResponse' in part)).toBe(true);
  });

  it('keeps every function call/response pair in the same bounded summary request', async () => {
    const longTaskHistory: Content[] = [{ role: 'user', parts: [{ text: 'process all stages' }] }];
    for (let i = 0; i < 5; i++) {
      longTaskHistory.push({
        role: 'model',
        parts: [{ functionCall: { name: `stage_${i}`, args: { i }, callId: `call_${i}` } }],
      });
      longTaskHistory.push({
        role: 'user',
        parts: [{
          functionResponse: {
            name: `stage_${i}`,
            response: { output: `${i}:` + 'x'.repeat(10_000) },
            callId: `call_${i}`,
          },
        }],
      });
    }
    const requests: LLMRequest[] = [];
    const modelConfig = {
      provider: 'openai-compatible', apiKey: '', model: 'summary', baseUrl: '', contextWindow: 2_000,
    };
    const router = {
      chat: vi.fn(async (request: LLMRequest) => {
        requests.push(request);
        return { content: { role: 'model' as const, parts: [{ text: `summary-${requests.length}` }] } };
      }),
      chatStream: vi.fn(),
      getModelConfig: vi.fn(() => modelConfig),
      getCurrentConfig: vi.fn(() => modelConfig),
    } as any;

    await summarizeHistory(router, longTaskHistory, 'summary', undefined, {
      stream: false,
      purpose: 'continuation',
    });

    expect(requests.length).toBeGreaterThan(1);
    for (let requestIndex = 0; requestIndex < requests.length; requestIndex++) {
      const request = requests[requestIndex];
      expect(request.generationConfig?.maxOutputTokens).toBe(400);
      expect(router.chat.mock.calls[requestIndex][3]).toEqual({ maxOutputTokensCeiling: 400 });
      for (let i = 0; i < request.contents.length; i++) {
        const calls = request.contents[i].parts.filter(part => 'functionCall' in part);
        if (calls.length === 0) continue;
        const next = request.contents[i + 1];
        expect(next?.role).toBe('user');
        expect(next?.parts.filter(part => 'functionResponse' in part)).toHaveLength(calls.length);
      }
    }
  });

  it('uses the strictest summary config, model window, and static requestBody limit', async () => {
    const modelConfig = {
      provider: 'openai-compatible',
      apiKey: '',
      model: 'summary',
      baseUrl: '',
      contextWindow: 100_000,
      requestBody: { max_tokens: 5_000 },
    };
    const router = {
      chat: vi.fn(async () => ({
        content: { role: 'model' as const, parts: [{ text: 'bounded summary' }] },
      })),
      chatStream: vi.fn(),
      getModelConfig: vi.fn(() => modelConfig),
      getCurrentConfig: vi.fn(() => modelConfig),
    } as any;
    const config = parseSummaryConfig({ maxOutputTokens: 30_000 });

    await summarizeHistory(router, history, 'summary', config, { stream: false });

    const request = router.chat.mock.calls[0][0] as LLMRequest;
    const prompt = (request.contents.at(-1)?.parts[0] as { text?: string }).text ?? '';
    expect(request.generationConfig?.maxOutputTokens).toBe(5_000);
    expect(prompt).toContain('approximately 3750 tokens');
    expect(router.chat.mock.calls[0][3]).toEqual({ maxOutputTokensCeiling: 5_000 });
  });

  it('appends mandatory continuation guidance even with a custom summary prompt', async () => {
    const router = {
      chat: vi.fn(async (_request: LLMRequest) => ({
        content: { role: 'model' as const, parts: [{ text: 'checkpoint summary' }] },
      })),
      chatStream: vi.fn(),
    } as any;

    await summarizeHistory(
      router,
      history,
      'summary-model',
      {
        systemPrompt: 'custom system',
        userPrompt: 'CUSTOM SUMMARY REQUEST',
        maxOutputTokens: 8_000,
      },
      { purpose: 'continuation' },
    );

    const request = router.chat.mock.calls[0][0] as LLMRequest;
    const prompt = (request.contents.at(-1)?.parts[0] as { text?: string }).text ?? '';
    expect(prompt).toContain('CUSTOM SUMMARY REQUEST');
    expect(prompt).toContain('unfinished tool loop');
    expect(prompt).toContain('Do not claim the task is complete');
  });
});

describe('Backend.summarize', () => {
  it('honors backend stream configuration for compact summaries', async () => {
    const histories = new Map<string, Content[]>([['s1', [...history]]]);
    const storage = {
      getHistory: vi.fn(async (sessionId: string) => histories.get(sessionId) ?? []),
      addMessage: vi.fn(async (sessionId: string, msg: Content) => {
        if (!histories.has(sessionId)) histories.set(sessionId, []);
        histories.get(sessionId)!.push(msg);
      }),
    };
    const router = {
      chat: vi.fn(async () => { throw new Error('non-stream chat should not be used'); }),
      chatStream: vi.fn((_request: LLMRequest, _modelName?: string, _signal?: AbortSignal) => streamFrom([
        { textDelta: 'compact ' },
        { textDelta: 'summary' },
      ])),
      getCurrentModelName: vi.fn(() => 'mock-model'),
      getModelConfig: vi.fn(() => ({ model: 'mock-model', provider: 'gemini', supportsVision: true })),
    } as any;

    const tools = new ToolRegistry();
    tools.register({
      declaration: { name: 'status_check', description: 'check status' },
      handler: async () => ({ ok: true }),
    });
    const prompt = new PromptAssembler();
    prompt.setSystemPrompt('main model system prompt');

    const backend = new Backend(
      router,
      storage as any,
      tools,
      new ToolStateManager(),
      prompt,
      { stream: true, summaryModelName: 'summary-model' },
    );
    const compactComplete = vi.fn();
    backend.on('compact:complete', compactComplete);

    const result = await backend.summarize('s1');

    expect(result).toBe('compact summary');
    expect(router.chat).not.toHaveBeenCalled();
    expect(router.chatStream).toHaveBeenCalledWith(
      expect.any(Object), 'summary-model', expect.any(AbortSignal),
      { maxOutputTokensCeiling: DEFAULT_MAX_OUTPUT_TOKENS },
    );
    expect(storage.addMessage).toHaveBeenCalledWith('s1', expect.objectContaining({
      role: 'user',
      isSummary: true,
      parts: [{ text: '[Context Summary]\n\ncompact summary' }],
    }));

    const persistedSummary = histories.get('s1')!.at(-1)!;
    const summaryTokens = estimateTokenCount('[Context Summary]\n\ncompact summary');
    expect(persistedSummary.usageMetadata).toMatchObject({
      promptTokenCount: summaryTokens,
      totalTokenCount: summaryTokens,
    });

    const compactResult = compactComplete.mock.calls[0][1];
    const expectedRequest = prompt.assemble(
      prepareHistoryForLLM([persistedSummary]),
      tools.getDeclarations(),
    );
    expect(compactResult.summaryTokens).toBe(summaryTokens);
    expect(compactResult.afterTokens).toBe(estimateLLMRequestTokens(expectedRequest));
    expect(persistedSummary.compactedContextTokenCount).toBe(compactResult.afterTokens);
    expect(compactResult.afterTokens).toBeGreaterThan(compactResult.summaryTokens);
    expect(backend.getLastSessionTokens('s1')).toBe(compactResult.afterTokens);

    // 新 transcript 直接从 summary 的专用字段恢复完整上下文，而不是误用摘要 usage。
    const reloadedBackend = new Backend(
      router,
      storage as any,
      tools,
      new ToolStateManager(),
      prompt,
      { stream: true, summaryModelName: 'summary-model' },
    );
    await reloadedBackend.getHistory('s1');
    expect(reloadedBackend.getLastSessionTokens('s1')).toBe(compactResult.afterTokens);

    // 旧 transcript 没有专用字段时，用当前 system/tools/有效历史重建完整请求。
    delete persistedSummary.compactedContextTokenCount;
    const legacyReloadedBackend = new Backend(
      router,
      storage as any,
      tools,
      new ToolStateManager(),
      prompt,
      { stream: true, summaryModelName: 'summary-model' },
    );
    const legacyHistory = await legacyReloadedBackend.getHistory('s1');
    const expectedLegacyTokens = estimateLLMRequestTokens(prompt.assemble(
      prepareHistoryForLLM(legacyHistory),
      tools.getDeclarations(),
    ));
    expect(legacyReloadedBackend.getLastSessionTokens('s1')).toBe(expectedLegacyTokens);
    expect(expectedLegacyTokens).toBe(compactResult.afterTokens);
    expect(expectedLegacyTokens).not.toBe(summaryTokens);
  });

  it('rejects manual compact while a turn is active for the same session', async () => {
    const histories = new Map<string, Content[]>([['s1', [...history]]]);
    const storage = {
      getHistory: vi.fn(async (sessionId: string) => histories.get(sessionId) ?? []),
      addMessage: vi.fn(async (sessionId: string, msg: Content) => {
        if (!histories.has(sessionId)) histories.set(sessionId, []);
        histories.get(sessionId)!.push(msg);
      }),
    };
    const router = {
      chat: vi.fn(),
      chatStream: vi.fn(),
      getCurrentModelName: vi.fn(() => 'mock-model'),
      getModelConfig: vi.fn(() => ({ model: 'mock-model', provider: 'gemini', supportsVision: true })),
    } as any;

    const backend = new Backend(
      router,
      storage as any,
      new ToolRegistry(),
      new ToolStateManager(),
      new PromptAssembler(),
    );

    expect(backend.getTurnLock().tryAcquire('s1')).toBe(true);
    await expect(backend.summarize('s1')).rejects.toThrow('当前会话正在生成中，无法压缩上下文');
    backend.getTurnLock().release('s1');
    expect(router.chat).not.toHaveBeenCalled();
    expect(router.chatStream).not.toHaveBeenCalled();
    expect(storage.addMessage).not.toHaveBeenCalled();
  });

  it('prepares compact history without binary payloads or local tool metadata', async () => {
    const unsafeHistory: Content[] = [
      {
        role: 'user',
        parts: [{
          inlineData: {
            mimeType: 'image/png',
            data: 'abc123',
            name: 'secret-screenshot.png',
          },
        }],
      },
      {
        role: 'model',
        parts: [{
          functionCall: {
            name: 'write_file',
            args: { path: 'demo.txt', content: 'new' },
            callId: 'call_1',
          },
        }],
      },
      {
        role: 'user',
        parts: [{
          functionResponse: {
            name: 'write_file',
            response: { ok: true },
            callId: 'call_1',
            durationMs: 42,
            diffPreview: { toolName: 'write_file', title: 'Diff', toolLabel: 'write_file', summary: [], items: [] } as any,
          },
        }],
      },
      {
        role: 'model',
        parts: [{ text: 'tool work completed' }],
      },
    ];
    const histories = new Map<string, Content[]>([['s1', [...unsafeHistory]]]);
    const storage = {
      getHistory: vi.fn(async (sessionId: string) => histories.get(sessionId) ?? []),
      addMessage: vi.fn(async (sessionId: string, msg: Content) => {
        if (!histories.has(sessionId)) histories.set(sessionId, []);
        histories.get(sessionId)!.push(msg);
      }),
    };
    const router = {
      chat: vi.fn(async (_request: LLMRequest) => ({
        content: { role: 'model' as const, parts: [{ text: 'safe summary' }] },
      })),
      chatStream: vi.fn(),
      getCurrentModelName: vi.fn(() => 'mock-model'),
      getModelConfig: vi.fn(() => ({ model: 'mock-model', provider: 'gemini', supportsVision: true })),
    } as any;

    const backend = new Backend(
      router,
      storage as any,
      new ToolRegistry(),
      new ToolStateManager(),
      new PromptAssembler(),
      { summaryModelName: 'summary-model' },
    );

    await backend.summarize('s1');

    const request = router.chat.mock.calls[0][0] as LLMRequest;
    const imagePart = request.contents[0].parts[0] as any;
    const responsePart = request.contents[2].parts[0] as any;

    expect(imagePart.text).toContain('image/png');
    expect(imagePart.text).toContain('binary omitted');
    expect(responsePart.functionResponse).toEqual({
      name: 'write_file',
      response: { ok: true },
      callId: 'call_1',
    });
    expect(router.chat).toHaveBeenCalledWith(
      expect.any(Object), 'summary-model', expect.any(AbortSignal),
      { maxOutputTokensCeiling: DEFAULT_MAX_OUTPUT_TOKENS },
    );
  });
});
