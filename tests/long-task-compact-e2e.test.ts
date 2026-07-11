import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { Backend } from '../src/core/backend/backend.js';
import { StorageProvider, type SessionMeta } from '../src/storage/base.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { ToolStateManager } from '../src/tools/state.js';
import { PromptAssembler } from '../src/prompt/assembler.js';
import type { Content, LLMRequest } from '../src/types/index.js';
import type { LLMConfig } from '../src/config/types.js';

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
  return text.includes('## User Requirements') || text.includes('summarize') || text.includes('unfinished tool loop');
}

/**
 * 端到端集成测试：精确模拟用户描述的"长任务中途 compact"场景。
 *
 * 场景设定（等比缩小 400K 真实场景）：
 * - contextWindow = 10_000（等价于 400K）
 * - autoSummaryThreshold = "90%" → 9_000（等价于 360K）
 * - 动态安全线 = min(9_000, 10_000 - 1_000 - 200) = 8_800（等价于 ~352K）
 * - 工具结果 80K 字符 → 估算约 14K+ tokens，远超 8_800
 * - compact 应在第一轮工具完成后、第二轮 LLM 调用前触发
 * - compact 后任务从压缩历史继续，不重放工具
 */
describe('Long task in-turn compact: end-to-end', () => {
  function createLongTaskBackend(options: {
    contextWindow: number;
    toolResultSize: number;
    toolRounds: number;
    summaryResponseText: string;
    finalResponseText: string;
  }) {
    const { contextWindow, toolResultSize, toolRounds, summaryResponseText, finalResponseText } = options;

    const modelConfig: LLMConfig = {
      provider: 'openai-compatible',
      apiKey: '',
      model: 'mock-long-task',
      baseUrl: 'https://example.test/v1',
      contextWindow,
      autoSummaryThreshold: '90%',
    };

    const requests: LLMRequest[] = [];
    let normalCalls = 0;
    let summaryCalls = 0;

    const router = {
      chat: vi.fn(async (request: LLMRequest) => {
        requests.push(clone(request));
        if (isSummaryRequest(request)) {
          summaryCalls++;
          return {
            content: {
              role: 'model' as const,
              parts: [{ text: summaryResponseText }],
            },
            usageMetadata: { totalTokenCount: 50 },
          };
        }
        normalCalls++;
        if (normalCalls <= toolRounds) {
          return {
            content: {
              role: 'model' as const,
              parts: [{ functionCall: { name: 'work_step', args: { round: normalCalls }, callId: `call-${normalCalls}` } }],
            },
            usageMetadata: { totalTokenCount: Math.floor(contextWindow * 0.3) },
          };
        }
        return {
          content: { role: 'model' as const, parts: [{ text: finalResponseText }] },
          usageMetadata: { totalTokenCount: Math.floor(contextWindow * 0.2) },
        };
      }),
      chatStream: vi.fn(),
      getCurrentModelName: vi.fn(() => 'mock-long-task'),
      getCurrentConfig: vi.fn(() => modelConfig),
      getModelConfig: vi.fn(() => modelConfig),
      getModelInfo: vi.fn(() => ({})),
    } as any;

    const tools = new ToolRegistry();
    const toolHandler = vi.fn(async (args: Record<string, unknown>) => ({
      round: args.round,
      data: 'x'.repeat(toolResultSize),
      ok: true,
    }));
    tools.register({
      declaration: { name: 'work_step', description: 'perform one work step' },
      handler: toolHandler,
    });

    const storage = new MemoryStorage();
    const prompt = new PromptAssembler();
    prompt.setSystemPrompt('test system prompt');
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iris-e2e-compact-'));
    const backend = new Backend(router, storage, tools, new ToolStateManager(), prompt, {
      stream: false,
      maxToolRounds: 20,
      currentLLMConfig: modelConfig,
      summaryModelName: 'mock-long-task',
      toolsConfig: { permissions: { work_step: { autoApprove: true } } },
      dataDir,
    });
    backend.on('error', () => {});

    return {
      backend, router, storage, dataDir, tools, toolHandler, requests,
      getNormalCalls: () => normalCalls,
      getSummaryCalls: () => summaryCalls,
    };
  }

  it('a task starting near the threshold compacts mid-task and continues without replaying tools', async () => {
    const { backend, storage, dataDir, toolHandler, requests, getNormalCalls, getSummaryCalls } = createLongTaskBackend({
      contextWindow: 10_000,
      toolResultSize: 80_000, // 80K chars → ~14K+ estimated tokens, well above 8,800
      toolRounds: 1,
      summaryResponseText: 'step 1 done; produce the final answer now',
      finalResponseText: 'long task completed successfully',
    });

    const events: string[] = [];
    backend.on('compact:start', () => events.push('compact:start'));
    backend.on('compact:complete', (_sid, result) => events.push(`compact:complete:${result.reason}`));
    backend.on('compact:error', () => events.push('compact:error'));
    backend.on('done', () => events.push('done'));
    backend.on('error', () => events.push('error'));

    try {
      await backend.chat('s-e2e', 'perform the long task');

      // 1. 工具只被调用了一次——compact 后不重放
      expect(toolHandler).toHaveBeenCalledTimes(1);

      // 2. 正常 LLM 调用恰好两次：第一次返回工具调用，第二次返回最终文本
      expect(getNormalCalls()).toBe(2);

      // 3. 总结模型被调用了一次
      expect(getSummaryCalls()).toBe(1);

      // 4. 事件顺序：compact 在 done 之前，没有 error
      expect(events).toContain('compact:complete:in-turn-threshold');
      expect(events.indexOf('compact:complete:in-turn-threshold')).toBeLessThan(events.indexOf('done'));
      expect(events).not.toContain('error');

      // 5. 第二次正常请求包含 summary 文本，不包含原始大工具结果
      const normalRequests = requests.filter(r => !isSummaryRequest(r));
      expect(normalRequests).toHaveLength(2);
      const secondRequestJson = JSON.stringify(normalRequests[1]);
      expect(secondRequestJson).toContain('step 1 done');
      expect(secondRequestJson).not.toContain('x'.repeat(100));

      // 6. 历史末尾是最终 model 回复
      const history = await storage.getHistory('s-e2e');
      expect(history.at(-1)?.role).toBe('model');
      const finalText = history.at(-1)?.parts.map(p => 'text' in p ? p.text : '').join('') ?? '';
      expect(finalText).toContain('long task completed');

      // 7. 历史中包含 isSummary 检查点
      expect(history.some(item => item.isSummary)).toBe(true);
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('a multi-round task triggers multiple in-turn compactions and still finishes', async () => {
    const { backend, storage, dataDir, toolHandler, getNormalCalls } = createLongTaskBackend({
      contextWindow: 10_000,
      toolResultSize: 80_000,
      toolRounds: 3,
      summaryResponseText: 'progress checkpoint: all steps so far completed, continue',
      finalResponseText: 'all three steps done',
    });

    const compactReasons: string[] = [];
    backend.on('compact:complete', (_sid, result) => compactReasons.push(result.reason));
    backend.on('done', () => {});
    backend.on('error', () => {});

    try {
      await backend.chat('s-multi', 'do three steps');

      // 三轮工具各调用一次，compact 不重放
      expect(toolHandler).toHaveBeenCalledTimes(3);

      // 正常 LLM 调用 = 3 次工具调用 + 1 次最终回复 = 4
      expect(getNormalCalls()).toBe(4);

      // 至少触发一次 in-turn compact
      const inTurnCompacts = compactReasons.filter(r => r === 'in-turn-threshold');
      expect(inTurnCompacts.length).toBeGreaterThanOrEqual(1);

      // 最终历史末尾是 model 回复
      const history = await storage.getHistory('s-multi');
      expect(history.at(-1)?.role).toBe('model');
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('does not infinite-loop when compact fails to reduce context below the threshold', async () => {
    const modelConfig: LLMConfig = {
      provider: 'openai-compatible',
      apiKey: '',
      model: 'mock-loop',
      baseUrl: 'https://example.test/v1',
      contextWindow: 10_000,
      autoSummaryThreshold: '90%',
    };

    const requests: LLMRequest[] = [];
    let normalCalls = 0;
    const router = {
      chat: vi.fn(async (request: LLMRequest) => {
        requests.push(clone(request));
        if (isSummaryRequest(request)) {
          // summary 也返回巨大的文本——compact 后请求仍然超阈值
          return {
            content: {
              role: 'model' as const,
              parts: [{ text: 'y'.repeat(80_000) }],
            },
            usageMetadata: { totalTokenCount: 5_000 },
          };
        }
        normalCalls++;
        if (normalCalls === 1) {
          return {
            content: {
              role: 'model' as const,
              parts: [{ functionCall: { name: 'big_step', args: {}, callId: 'big-1' } }],
            },
            usageMetadata: { totalTokenCount: 3_000 },
          };
        }
        return {
          content: { role: 'model' as const, parts: [{ text: 'done' }] },
          usageMetadata: { totalTokenCount: 100 },
        };
      }),
      chatStream: vi.fn(),
      getCurrentModelName: vi.fn(() => 'mock-loop'),
      getCurrentConfig: vi.fn(() => modelConfig),
      getModelConfig: vi.fn(() => modelConfig),
      getModelInfo: vi.fn(() => ({})),
    } as any;

    const tools = new ToolRegistry();
    const toolHandler = vi.fn(async () => ({ data: 'x'.repeat(80_000) }));
    tools.register({
      declaration: { name: 'big_step', description: 'big step' },
      handler: toolHandler,
    });

    const storage = new MemoryStorage();
    const prompt = new PromptAssembler();
    prompt.setSystemPrompt('test');
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iris-loop-compact-'));
    const backend = new Backend(router, storage, tools, new ToolStateManager(), prompt, {
      stream: false,
      maxToolRounds: 20,
      currentLLMConfig: modelConfig,
      summaryModelName: 'mock-loop',
      toolsConfig: { permissions: { big_step: { autoApprove: true } } },
      dataDir,
    });

    const errors: string[] = [];
    backend.on('error', (_sid, err) => errors.push(err));
    backend.on('done', () => {});
    const compactCount = { value: 0 };
    backend.on('compact:complete', () => compactCount.value++);

    try {
      await backend.chat('s-loop', 'run');

      // compact 至多触发一次（summary 很大 → 第二次 preflight 仍超阈值 → 报错停止）
      expect(compactCount.value).toBeLessThanOrEqual(1);
      // 工具只被调用一次
      expect(toolHandler).toHaveBeenCalledTimes(1);
      // 最终以 error 结束，而不是无限循环
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toMatch(/安全线|上限|检查点|压缩/);
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('abort after in-turn compact does not delete pre-compact history', async () => {
    const modelConfig: LLMConfig = {
      provider: 'openai-compatible',
      apiKey: '',
      model: 'mock-abort',
      baseUrl: 'https://example.test/v1',
      contextWindow: 10_000,
      autoSummaryThreshold: '90%',
    };

    let normalCalls = 0;
    const router = {
      chat: vi.fn(async (request: LLMRequest) => {
        if (isSummaryRequest(request)) {
          return {
            content: { role: 'model' as const, parts: [{ text: 'checkpoint summary' }] },
            usageMetadata: { totalTokenCount: 50 },
          };
        }
        normalCalls++;
        if (normalCalls === 1) {
          return {
            content: {
              role: 'model' as const,
              parts: [{ functionCall: { name: 'work', args: {}, callId: 'work-1' } }],
            },
            usageMetadata: { totalTokenCount: 3_000 },
          };
        }
        // 第二次正常调用永远不会到达（abort 会先触发）
        return {
          content: { role: 'model' as const, parts: [{ text: 'should not reach' }] },
          usageMetadata: { totalTokenCount: 100 },
        };
      }),
      chatStream: vi.fn(),
      getCurrentModelName: vi.fn(() => 'mock-abort'),
      getCurrentConfig: vi.fn(() => modelConfig),
      getModelConfig: vi.fn(() => modelConfig),
      getModelInfo: vi.fn(() => ({})),
    } as any;

    const tools = new ToolRegistry();
    const toolHandler = vi.fn(async () => ({ data: 'x'.repeat(80_000) }));
    tools.register({
      declaration: { name: 'work', description: 'work step' },
      handler: toolHandler,
    });

    const storage = new MemoryStorage();
    const prompt = new PromptAssembler();
    prompt.setSystemPrompt('test');
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iris-abort-compact-'));
    const backend = new Backend(router, storage, tools, new ToolStateManager(), prompt, {
      stream: false,
      maxToolRounds: 20,
      currentLLMConfig: modelConfig,
      summaryModelName: 'mock-abort',
      toolsConfig: { permissions: { work: { autoApprove: true } } },
      dataDir,
    });
    backend.on('error', () => {});

    let compactDone = false;
    backend.on('compact:complete', () => { compactDone = true; });

    backend.on('done', () => {});

    // 在 compact 完成后立即 abort
    const chatPromise = backend.chat('s-abort', 'do work');
    setTimeout(() => backend.abortChat('s-abort'), 100);

    try {
      await chatPromise;
    } catch {
      // abort 可能导致 chat reject
    }

    try {
      // compact 确实发生了
      expect(compactDone).toBe(true);
      // 工具只被调用一次
      expect(toolHandler).toHaveBeenCalledTimes(1);
      // 历史中仍然包含 compact 前写入的 summary 检查点
      const history = await storage.getHistory('s-abort');
      const summaryCount = history.filter(item => item.isSummary).length;
      expect(summaryCount).toBeGreaterThanOrEqual(1);
      // 历史不会因 abort 被截断到 0——compact 前的内容仍然保留
      expect(history.length).toBeGreaterThan(1);
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('autoSummaryThreshold: false disables in-turn compact entirely', async () => {
    const modelConfig: LLMConfig = {
      provider: 'openai-compatible',
      apiKey: '',
      model: 'mock-disabled',
      baseUrl: 'https://example.test/v1',
      contextWindow: 10_000,
      autoSummaryThreshold: false,
    };

    let normalCalls = 0;
    const router = {
      chat: vi.fn(async (request: LLMRequest) => {
        if (isSummaryRequest(request)) {
          return {
            content: { role: 'model' as const, parts: [{ text: 'should not be called' }] },
            usageMetadata: { totalTokenCount: 50 },
          };
        }
        normalCalls++;
        if (normalCalls === 1) {
          return {
            content: {
              role: 'model' as const,
              parts: [{ functionCall: { name: 'work', args: {}, callId: 'work-1' } }],
            },
            usageMetadata: { totalTokenCount: 3_000 },
          };
        }
        return {
          content: { role: 'model' as const, parts: [{ text: 'done without compact' }] },
          usageMetadata: { totalTokenCount: 100 },
        };
      }),
      chatStream: vi.fn(),
      getCurrentModelName: vi.fn(() => 'mock-disabled'),
      getCurrentConfig: vi.fn(() => modelConfig),
      getModelConfig: vi.fn(() => modelConfig),
      getModelInfo: vi.fn(() => ({})),
    } as any;

    const tools = new ToolRegistry();
    const toolHandler = vi.fn(async () => ({ data: 'x'.repeat(80_000) }));
    tools.register({
      declaration: { name: 'work', description: 'work step' },
      handler: toolHandler,
    });

    const storage = new MemoryStorage();
    const prompt = new PromptAssembler();
    prompt.setSystemPrompt('test');
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iris-disabled-compact-'));
    const backend = new Backend(router, storage, tools, new ToolStateManager(), prompt, {
      stream: false,
      maxToolRounds: 20,
      currentLLMConfig: modelConfig,
      summaryModelName: 'mock-disabled',
      toolsConfig: { permissions: { work: { autoApprove: true } } },
      dataDir,
    });
    backend.on('error', () => {});

    const compactEvents: string[] = [];
    backend.on('compact:start', () => compactEvents.push('start'));
    backend.on('compact:complete', () => compactEvents.push('complete'));

    try {
      await backend.chat('s-disabled', 'do work');

      // compact 完全不触发
      expect(compactEvents).toHaveLength(0);
      // 任务正常完成
      expect(toolHandler).toHaveBeenCalledTimes(1);
      expect(normalCalls).toBe(2);
      const history = await storage.getHistory('s-disabled');
      expect(history.at(-1)?.role).toBe('model');
      expect(history.some(item => item.isSummary)).toBe(false);
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
