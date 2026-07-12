import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { Backend } from '../src/core/backend/backend.js';
import { StorageProvider, type SessionMeta } from '../src/storage/base.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { ToolStateManager } from '../src/tools/state.js';
import { PromptAssembler } from '../src/prompt/assembler.js';
import { writeFile } from '../src/tools/internal/write_file.js';
import { clearSessionCwd, setSessionCwd } from '../src/core/backend/session-context.js';
import { estimateLLMRequestTokens } from '../src/core/backend/compaction.js';
import { prepareHistoryForLLM } from '../src/core/backend/history.js';
import type { Content, LLMRequest } from '../src/types/index.js';
import type { LLMConfig } from '../src/config/types.js';
import { estimateTokenCount } from 'tokenx';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

class MemoryStorage extends StorageProvider {
  readonly histories = new Map<string, Content[]>();
  readonly metas = new Map<string, SessionMeta>();

  async getHistory(sessionId: string): Promise<Content[]> { return clone(this.histories.get(sessionId) ?? []); }
  async addMessage(sessionId: string, content: Content): Promise<void> {
    const history = this.histories.get(sessionId) ?? [];
    history.push(clone(content));
    this.histories.set(sessionId, history);
  }
  async clearHistory(sessionId: string): Promise<void> { this.histories.delete(sessionId); }
  async updateLastMessage(sessionId: string, updater: (content: Content) => Content): Promise<void> {
    const history = this.histories.get(sessionId) ?? [];
    if (history.length === 0) return;
    history[history.length - 1] = clone(updater(clone(history[history.length - 1])));
  }
  async truncateHistory(sessionId: string, keepCount: number): Promise<void> {
    this.histories.set(sessionId, (this.histories.get(sessionId) ?? []).slice(0, keepCount));
  }
  async listSessions(): Promise<string[]> { return [...this.histories.keys()]; }
  async getMeta(sessionId: string): Promise<SessionMeta | null> { return clone(this.metas.get(sessionId) ?? null); }
  async saveMeta(meta: SessionMeta): Promise<void> { this.metas.set(meta.id, clone(meta)); }
  async listSessionMetas(): Promise<SessionMeta[]> { return [...this.metas.values()].map(clone); }
}

function isSummaryRequest(request: LLMRequest): boolean {
  const last = request.contents.at(-1);
  const text = last?.parts.map(part => 'text' in part ? part.text ?? '' : '').join('') ?? '';
  return text.includes('## User Requirements') || text.includes('summarize');
}

function makeBackend(storage: MemoryStorage, usageForChat: number, requests: LLMRequest[]) {
  const modelConfig: LLMConfig = {
    provider: 'openai-compatible',
    apiKey: '',
    model: 'mock-model',
    baseUrl: 'https://example.test/v1',
    contextWindow: 100,
    autoSummaryThreshold: '90%',
  };
  const router = {
    chat: vi.fn(async (request: LLMRequest) => {
      requests.push(clone(request));
      const summary = isSummaryRequest(request);
      return {
        content: {
          role: 'model' as const,
          parts: [{ text: summary ? 'short compact summary' : 'normal answer' }],
          createdAt: Date.now(),
        },
        usageMetadata: summary ? { totalTokenCount: 8 } : { totalTokenCount: usageForChat },
      };
    }),
    chatStream: vi.fn(),
    getCurrentModelName: vi.fn(() => 'mock'),
    getCurrentConfig: vi.fn(() => modelConfig),
    getModelConfig: vi.fn(() => modelConfig),
    getModelInfo: vi.fn(() => ({})),
  } as any;
  const prompt = new PromptAssembler();
  prompt.setSystemPrompt('test');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iris-auto-compact-'));
  const backend = new Backend(
    router,
    storage,
    new ToolRegistry(),
    new ToolStateManager(),
    prompt,
    {
      stream: false,
      maxToolRounds: 5,
      currentLLMConfig: modelConfig,
      summaryModelName: 'mock',
      dataDir,
    },
  );
  backend.on('error', () => {});
  return { backend, router, dataDir, modelConfig };
}

describe('Backend auto compact timing', () => {
  it('restores persisted usage and compacts before storing the next user message', async () => {
    const storage = new MemoryStorage();
    await storage.addMessage('s1', { role: 'user', parts: [{ text: 'old question' }] });
    await storage.addMessage('s1', {
      role: 'model',
      parts: [{ text: 'old answer' }],
      usageMetadata: { totalTokenCount: 89 },
    });
    const requests: LLMRequest[] = [];
    const { backend, dataDir, modelConfig } = makeBackend(storage, 95, requests);
    const complete = vi.fn();
    backend.on('compact:complete', complete);

    try {
      await backend.chat('s1', 'NEW QUESTION');

      expect(complete).toHaveBeenCalledTimes(1);
      expect(complete.mock.calls[0][1].reason).toBe('pre-turn-threshold');
      expect(requests).toHaveLength(2);
      const summaryRequestText = JSON.stringify(requests[0]);
      expect(summaryRequestText).not.toContain('NEW QUESTION');
      expect(JSON.stringify(requests[1])).toContain('NEW QUESTION');

      const history = await storage.getHistory('s1');
      const summaryIndex = history.findIndex(item => item.isSummary);
      const newQuestionIndex = history.findIndex(item => item.parts.some(part => 'text' in part && part.text === 'NEW QUESTION'));
      expect(summaryIndex).toBeGreaterThanOrEqual(0);
      expect(newQuestionIndex).toBeGreaterThan(summaryIndex);

      const compactedPrompt = new PromptAssembler();
      compactedPrompt.setSystemPrompt('test');
      const expectedAfterRequest = compactedPrompt.assemble(
        prepareHistoryForLLM([history[summaryIndex]], modelConfig),
        [],
      );
      expect(complete.mock.calls[0][1].afterTokens)
        .toBe(estimateLLMRequestTokens(expectedAfterRequest));
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('finishes post-turn compact before emitting done', async () => {
    const storage = new MemoryStorage();
    const requests: LLMRequest[] = [];
    const { backend, dataDir, modelConfig } = makeBackend(storage, 95, requests);
    const order: string[] = [];
    let completedResult: any;
    backend.on('compact:start', () => order.push('compact:start'));
    backend.on('compact:complete', (_sid, result) => {
      completedResult = result;
      order.push('compact:complete');
    });
    backend.on('done', () => order.push('done'));

    try {
      await backend.chat('s1', 'hello');

      expect(order).toEqual(['compact:start', 'compact:complete', 'done']);
      const history = await storage.getHistory('s1');
      expect(history.at(-1)?.isSummary).toBe(true);
      const summary = history.at(-1)!;
      const summaryText = (summary.parts[0] as { text: string }).text;
      const expectedSummaryTokens = estimateTokenCount(summaryText);
      const mainRequest = requests.find(request => !isSummaryRequest(request))!;
      const expectedCompactedRequest: LLMRequest = {
        ...mainRequest,
        contents: prepareHistoryForLLM([summary], modelConfig),
      };

      expect(completedResult.summaryTokens).toBe(expectedSummaryTokens);
      expect(summary.usageMetadata).toMatchObject({
        promptTokenCount: expectedSummaryTokens,
        totalTokenCount: expectedSummaryTokens,
      });
      expect(completedResult.afterTokens).toBe(estimateLLMRequestTokens(expectedCompactedRequest));
      expect(backend.getLastSessionTokens('s1')).toBe(completedResult.afterTokens);
      expect(completedResult.afterTokens).toBeLessThan(95);
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('skips ordinary retries and compacts once after a first-round context overflow', async () => {
    const storage = new MemoryStorage();
    await storage.addMessage('s1', { role: 'user', parts: [{ text: 'old question' }] });
    await storage.addMessage('s1', {
      role: 'model',
      parts: [{ text: 'old answer' }],
      usageMetadata: { totalTokenCount: 20 },
    });
    const requests: LLMRequest[] = [];
    const { backend, router, dataDir } = makeBackend(storage, 40, requests);
    let normalAttempts = 0;
    router.chat.mockImplementation(async (request: LLMRequest) => {
      requests.push(clone(request));
      if (isSummaryRequest(request)) {
        return {
          content: { role: 'model' as const, parts: [{ text: 'recovered compact summary' }] },
          usageMetadata: { totalTokenCount: 8 },
        };
      }
      normalAttempts++;
      if (normalAttempts === 1) {
        throw new Error('context_length_exceeded: maximum context length reached');
      }
      return {
        content: { role: 'model' as const, parts: [{ text: 'answer after compact' }] },
        usageMetadata: { totalTokenCount: 40 },
      };
    });
    const complete = vi.fn();
    const error = vi.fn();
    backend.on('compact:complete', complete);
    backend.on('error', error);

    try {
      await backend.chat('s1', 'KEEP THIS EXACT USER MESSAGE');

      expect(normalAttempts).toBe(2);
      expect(complete).toHaveBeenCalledTimes(1);
      expect(complete.mock.calls[0][1].reason).toBe('context-overflow-retry');
      expect(error).not.toHaveBeenCalled();

      const history = await storage.getHistory('s1');
      const exactUserMessages = history.filter(content =>
        content.parts.some(part => 'text' in part && part.text === 'KEEP THIS EXACT USER MESSAGE'));
      expect(exactUserMessages).toHaveLength(1);
      const summaryIndex = history.findIndex(content => content.isSummary);
      const userIndex = history.findIndex(content => content === exactUserMessages[0]);
      expect(userIndex).toBeGreaterThan(summaryIndex);
      const normalRequests = requests.filter(request => !isSummaryRequest(request));
      expect(normalRequests).toHaveLength(2);
      expect(complete.mock.calls[0][1].afterTokens)
        .toBe(estimateLLMRequestTokens(normalRequests[1]));
      expect(history.at(-1)?.role).toBe('model');
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('compacts at a closed tool boundary and continues the same long task without replaying tools', async () => {
    const storage = new MemoryStorage();
    const requests: LLMRequest[] = [];
    const modelConfig: LLMConfig = {
      provider: 'openai-compatible',
      apiKey: '',
      model: 'mock-long-task',
      baseUrl: 'https://example.test/v1',
      contextWindow: 1_000,
      autoSummaryThreshold: '90%',
    };
    let normalCalls = 0;
    const router = {
      chat: vi.fn(async (request: LLMRequest) => {
        requests.push(clone(request));
        if (isSummaryRequest(request)) {
          return {
            content: {
              role: 'model' as const,
              parts: [{ text: 'tool step completed successfully; continue with the final response' }],
            },
            usageMetadata: { totalTokenCount: 20 },
          };
        }
        normalCalls++;
        if (normalCalls === 1) {
          return {
            content: {
              role: 'model' as const,
              parts: [{ functionCall: { name: 'large_step', args: {}, callId: 'large-step-1' } }],
            },
            usageMetadata: { totalTokenCount: 120 },
          };
        }
        return {
          content: { role: 'model' as const, parts: [{ text: 'long task finished' }] },
          usageMetadata: { totalTokenCount: 80 },
        };
      }),
      chatStream: vi.fn(),
      getCurrentModelName: vi.fn(() => 'mock-long-task'),
      getCurrentConfig: vi.fn(() => modelConfig),
      getModelConfig: vi.fn(() => modelConfig),
      getModelInfo: vi.fn(() => ({})),
    } as any;
    const tools = new ToolRegistry();
    const toolHandler = vi.fn(async () => ({ payload: 'x'.repeat(8_000), ok: true }));
    tools.register({
      declaration: { name: 'large_step', description: 'return a large completed result' },
      handler: toolHandler,
    });
    const prompt = new PromptAssembler();
    prompt.setSystemPrompt('test');
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iris-in-turn-compact-'));
    const backend = new Backend(router, storage, tools, new ToolStateManager(), prompt, {
      stream: false,
      maxToolRounds: 5,
      currentLLMConfig: modelConfig,
      summaryModelName: 'mock-long-task',
      toolsConfig: { permissions: { large_step: { autoApprove: true } } },
      dataDir,
    });
    backend.on('error', () => {});
    const complete = vi.fn();
    const order: string[] = [];
    backend.on('compact:complete', (_sid, result) => {
      complete(result);
      order.push(`compact:${result.reason}`);
    });
    backend.on('done', () => order.push('done'));

    try {
      await backend.chat('s-long', 'perform the long task');

      expect(toolHandler).toHaveBeenCalledTimes(1);
      expect(normalCalls).toBe(2);
      expect(complete).toHaveBeenCalledTimes(1);
      expect(complete.mock.calls[0][0].reason).toBe('in-turn-threshold');
      expect(order).toEqual(['compact:in-turn-threshold', 'done']);
      const normalRequests = requests.filter(request => !isSummaryRequest(request));
      expect(normalRequests).toHaveLength(2);
      expect(complete.mock.calls[0][0].afterTokens)
        .toBe(estimateLLMRequestTokens(normalRequests[1]));
      expect(JSON.stringify(normalRequests[1])).toContain('tool step completed successfully');
      expect(JSON.stringify(normalRequests[1])).not.toContain('x'.repeat(1_000));
      const history = await storage.getHistory('s-long');
      expect(history.some(item => item.isSummary)).toBe(true);
      const persistedLargeResponse = history
        .flatMap(content => content.parts)
        .find(part => (
          'functionResponse' in part
          && part.functionResponse.name === 'large_step'
        ));
      expect(persistedLargeResponse && 'functionResponse' in persistedLargeResponse
        ? persistedLargeResponse.functionResponse.response
        : undefined).toEqual({
        result: { payload: 'x'.repeat(8_000), ok: true },
      });
      expect(persistedLargeResponse && 'functionResponse' in persistedLargeResponse
        ? persistedLargeResponse.functionResponse.diffPreview
        : undefined).toBeUndefined();
      expect(history.at(-1)?.role).toBe('model');
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('does not compact when a fresh tool response only has a huge local diff preview', async () => {
    const sessionId = 's-local-diff-preview';
    const storage = new MemoryStorage();
    const requests: LLMRequest[] = [];
    const modelConfig: LLMConfig = {
      provider: 'openai-compatible',
      apiKey: '',
      model: 'mock-local-metadata',
      baseUrl: 'https://example.test/v1',
      contextWindow: 10_000,
      autoSummaryThreshold: '90%',
    };
    let normalCalls = 0;
    const router = {
      chat: vi.fn(async (request: LLMRequest) => {
        requests.push(clone(request));
        if (isSummaryRequest(request)) {
          return {
            content: { role: 'model' as const, parts: [{ text: 'unexpected summary' }] },
            usageMetadata: { totalTokenCount: 100 },
          };
        }
        normalCalls++;
        if (normalCalls === 1) {
          return {
            content: {
              role: 'model' as const,
              parts: [{
                functionCall: {
                  name: 'write_file',
                  args: { path: 'large-existing.txt', content: 'small replacement\n' },
                  callId: 'write-small-result',
                },
              }],
            },
            usageMetadata: { totalTokenCount: 200 },
          };
        }
        return {
          content: { role: 'model' as const, parts: [{ text: 'write completed' }] },
          usageMetadata: { totalTokenCount: 300 },
        };
      }),
      chatStream: vi.fn(),
      getCurrentModelName: vi.fn(() => 'mock-local-metadata'),
      getCurrentConfig: vi.fn(() => modelConfig),
      getModelConfig: vi.fn(() => modelConfig),
      getModelInfo: vi.fn(() => ({})),
    } as any;
    const tools = new ToolRegistry();
    tools.register(writeFile);
    const prompt = new PromptAssembler();
    prompt.setSystemPrompt('test');
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iris-local-diff-workspace-'));
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iris-local-diff-data-'));
    const localOnlyContent = 'LOCAL_ONLY_DIFF_PREVIEW_LINE\n'.repeat(12_000);
    fs.writeFileSync(path.join(workspaceDir, 'large-existing.txt'), localOnlyContent, 'utf-8');
    setSessionCwd(sessionId, workspaceDir);

    const backend = new Backend(router, storage, tools, new ToolStateManager(), prompt, {
      stream: false,
      maxToolRounds: 5,
      currentLLMConfig: modelConfig,
      summaryModelName: 'mock-local-metadata',
      toolsConfig: {
        autoApproveDiff: true,
        permissions: { write_file: { autoApprove: true } },
      },
      dataDir,
    });
    backend.on('error', () => {});
    const complete = vi.fn();
    backend.on('compact:complete', complete);

    try {
      await backend.chat(sessionId, 'replace the existing file with a short value');

      expect(normalCalls).toBe(2);
      expect(complete).not.toHaveBeenCalled();
      expect(requests.filter(isSummaryRequest)).toHaveLength(0);

      const normalRequests = requests.filter(request => !isSummaryRequest(request));
      expect(normalRequests).toHaveLength(2);
      const secondRequestText = JSON.stringify(normalRequests[1]);
      expect(secondRequestText).not.toContain('diffPreview');
      expect(secondRequestText).not.toContain('durationMs');
      expect(secondRequestText).not.toContain('LOCAL_ONLY_DIFF_PREVIEW_LINE');
      expect(estimateLLMRequestTokens(normalRequests[1])).toBeLessThan(9_000);

      const persistedHistory = await storage.getHistory(sessionId);
      const persistedResponse = persistedHistory
        .flatMap(content => content.parts)
        .find(part => 'functionResponse' in part)?.functionResponse;
      expect(persistedResponse).toBeDefined();
      expect(persistedResponse?.durationMs).toEqual(expect.any(Number));
      expect(persistedResponse?.diffPreview).toBeDefined();
      expect(JSON.stringify(persistedResponse?.diffPreview)).toContain('LOCAL_ONLY_DIFF_PREVIEW_LINE');
      expect(estimateTokenCount(JSON.stringify(persistedResponse?.diffPreview))).toBeGreaterThan(9_000);
      expect(persistedResponse?.response).toEqual({
        result: { path: 'large-existing.txt', success: true, action: 'modified' },
      });
      expect(fs.readFileSync(path.join(workspaceDir, 'large-existing.txt'), 'utf-8'))
        .toBe('small replacement\n');
    } finally {
      clearSessionCwd(sessionId);
      fs.rmSync(workspaceDir, { recursive: true, force: true });
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
