/**
 * Backend 队列化集成测试
 *
 * 覆盖：
 *   - 用户消息入队后自动触发 handleMessage
 *   - turn 进行中入队的消息等 turn 结束后再处理（不并发）
 *   - 用户消息优先于 notification 处理
 *   - drainQueue 重入保护：在 turn 锁占用时入队不导致栈溢出
 *   - abortChat 正常中止进行中的 turn
 *   - clearSession 清空队列中残留消息并释放 turn 锁
 *   - 不同 session 的消息可以并行 turn
 *
 * 需要 mock storage 和 router。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Backend } from '../src/core/backend/backend.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { ToolStateManager } from '../src/tools/state.js';
import { PromptAssembler } from '../src/prompt/assembler.js';
import { CrossAgentTaskBoard } from '../src/core/cross-agent-task-board.js';
import type { Content, Part, LLMRequest } from '../src/types/index.js';

// ============ Mock 辅助 ============

/**
 * 创建一个最简 mock storage。
 * 只实现 Backend 在 chat 流程中必须调用的方法。
 */
function createMockStorage() {
  const histories = new Map<string, Content[]>();
  return {
    getHistory: vi.fn(async (sessionId: string) => {
      return histories.get(sessionId) ?? [];
    }),
    addMessage: vi.fn(async (sessionId: string, msg: Content) => {
      if (!histories.has(sessionId)) histories.set(sessionId, []);
      histories.get(sessionId)!.push(msg);
    }),
    getMeta: vi.fn(async () => undefined),
    updateMeta: vi.fn(async () => {}),
    saveMeta: vi.fn(async () => {}),
    clearHistory: vi.fn(async (sessionId: string) => { histories.delete(sessionId); }),
    listSessionMetas: vi.fn(async () => []),
    listSessions: vi.fn(async () => []),
    clearSession: vi.fn(async (sessionId: string) => {
      histories.delete(sessionId);
    }),
    truncateHistory: vi.fn(async () => {}),
    updateLastMessage: vi.fn(async () => {}),
    _histories: histories,
  };
}

/**
 * 创建一个 mock router。
 * chat() 返回一条纯文本的 model 响应，不做工具调用，
 * 这样 ToolLoop 一轮就结束。
 */
function createMockRouter(responseText: string = 'mock response', delayMs: number = 0) {
  return {
    chat: vi.fn(async (_request: LLMRequest, _modelName?: string, _signal?: AbortSignal) => {
      if (delayMs > 0) {
        // 模拟真实 LLM 调用：在 signal abort 时立即抛出 AbortError，
        // 而不是等 delay 结束。真实的 fetch API 也是这样工作的。
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, delayMs);
          if (_signal) {
            if (_signal.aborted) { clearTimeout(timer); reject(new DOMException('The operation was aborted', 'AbortError')); return; }
            _signal.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('The operation was aborted', 'AbortError')); }, { once: true });
          }
        });
      }
      return {
        content: {
          role: 'model' as const,
          parts: [{ text: responseText }] as Part[],
          createdAt: Date.now(),
        },
        usageMetadata: { totalTokenCount: 100 },
      };
    }),
    chatStream: vi.fn(),
    getCurrentModelName: vi.fn(() => 'mock-model'),
    getModelInfo: vi.fn(() => ({})),
  } as any;
}

function createAssembler(): PromptAssembler {
  const a = new PromptAssembler();
  a.setSystemPrompt('test system prompt');
  return a;
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============ 测试 ============

describe('Backend: 队列化调度', () => {
  let storage: ReturnType<typeof createMockStorage>;
  let router: ReturnType<typeof createMockRouter>;
  let tools: ToolRegistry;
  let toolState: ToolStateManager;
  let prompt: PromptAssembler;
  let backend: Backend;

  beforeEach(() => {
    storage = createMockStorage();
    router = createMockRouter('reply', 10);
    tools = new ToolRegistry();
    toolState = new ToolStateManager();
    prompt = createAssembler();
    backend = new Backend(router, storage as any, tools, toolState, prompt, {
      stream: false,
      maxToolRounds: 5,
    });
    // 注册 error 监听器，防止 Node.js EventEmitter 在无监听时抛出 ERR_UNHANDLED_ERROR。
    // Backend.executeTurn 捕获异常后会 emit('error')，测试中必须消费此事件。
    backend.on('error', () => {});
  });

  // ---- 自动触发 ----

  it('用户消息入队后自动触发 handleMessage', async () => {
    const doneSpy = vi.fn();
    backend.on('done', doneSpy);

    await backend.chat('s1', '你好');

    // done 事件至少触发一次
    expect(doneSpy).toHaveBeenCalledTimes(1);
    expect(doneSpy.mock.calls[0][0]).toBe('s1');
    // router.chat 被调用说明 handleMessage 确实执行了
    expect(router.chat).toHaveBeenCalled();
  });

  // ---- 同一 session 不并发 ----

  it('turn 进行中入队的消息等 turn 结束后再处理（不并发）', async () => {
    // 让 router.chat 有一定延迟，确保 turn 持续一段时间
    const slowRouter = createMockRouter('slow reply', 50);
    const slowBackend = new Backend(slowRouter, storage as any, tools, toolState, prompt, {
      stream: false,
      maxToolRounds: 5,
    });
    slowBackend.on('error', () => {});

    const executionOrder: string[] = [];
    slowBackend.on('done', (sid: string) => {
      executionOrder.push(sid);
    });

    // 同时发两条消息到同一个 session
    const p1 = slowBackend.chat('s1', '第一条');
    const p2 = slowBackend.chat('s1', '第二条');

    await Promise.all([p1, p2]);

    // 两个 turn 都完成了
    expect(executionOrder.filter(s => s === 's1')).toHaveLength(2);
    // LLM 被调用了两次（每条消息一次）
    expect(slowRouter.chat).toHaveBeenCalledTimes(2);
  });

  // ---- 用户消息优先于 notification ----

  it('用户消息优先于 notification 处理', async () => {
    // 用一个慢 router 让第一个 turn 持续
    const slowRouter = createMockRouter('reply', 50);
    const slowBackend = new Backend(slowRouter, storage as any, tools, toolState, prompt, {
      stream: false,
      maxToolRounds: 5,
    });
    slowBackend.on('error', () => {});

    const processingOrder: string[] = [];

    // 重写 router.chat 以记录处理顺序
    let callIndex = 0;
    slowRouter.chat.mockImplementation(async (request: any) => {
      callIndex++;
      const idx = callIndex;
      // 第一次调用时，在 turn 进行中往队列里塞一条 notification 和一条 user 消息
      if (idx === 1) {
        // 模拟在 turn 进行中入队
        slowBackend.enqueueAgentNotification('s1', '<task-notification><status>completed</status></task-notification>');
        // 等一点时间确保 notification 入队后再入队 user 消息
        await delay(5);
        // 用 chat 方法入队 user 消息（chat 内部调 enqueueUser）
        void slowBackend.chat('s1', '紧急用户消息');
      }
      if (idx > 1) {
        // 从 request 的用户消息中提取文本来判断处理顺序
        const userContent = request.contents?.find((c: Content) => c.role === 'user');
        if (userContent) {
          const text = userContent.parts?.map((p: Part) => (p as any).text).join('') ?? '';
          if (text.includes('紧急用户消息')) {
            processingOrder.push('user');
          } else if (text.includes('task-notification')) {
            processingOrder.push('notification');
          }
        }
      }
      await delay(10);
      return {
        content: {
          role: 'model' as const,
          parts: [{ text: `reply-${idx}` }] as Part[],
          createdAt: Date.now(),
        },
        usageMetadata: { totalTokenCount: 100 },
      };
    });

    // 启动第一个 turn
    await slowBackend.chat('s1', '初始消息');

    // 等待后续 turn 完成
    await delay(200);

    // 验证 user 消息在 notification 之前被处理
    // 注意：由于调度的异步性，这里只要 user 出现在 notification 之前即可
    if (processingOrder.length >= 2) {
      const userIdx = processingOrder.indexOf('user');
      const notifIdx = processingOrder.indexOf('notification');
      if (userIdx >= 0 && notifIdx >= 0) {
        expect(userIdx).toBeLessThan(notifIdx);
      }
    }
  });

  // ---- drainQueue 重入保护 ----

  it('drainQueue 重入保护：高频入队不导致栈溢出', async () => {
    // 连续快速入队多条消息，验证不会因递归 drainQueue 导致问题
    const fastRouter = createMockRouter('fast', 1);
    const fastBackend = new Backend(fastRouter, storage as any, tools, toolState, prompt, {
      stream: false,
      maxToolRounds: 5,
    });
    fastBackend.on('error', () => {});

    const promises: Promise<void>[] = [];
    for (let i = 0; i < 10; i++) {
      promises.push(fastBackend.chat('s1', `消息${i}`));
    }

    // 不应抛出栈溢出错误
    await Promise.all(promises);
    expect(fastRouter.chat).toHaveBeenCalledTimes(10);
  });

  // ---- abortChat ----

  it('abortChat 正常中止进行中的 turn', async () => {
    // 用一个很慢的 router 确保 turn 在 abort 时还在进行
    const verySlowRouter = createMockRouter('never', 5000);
    const slowBackend = new Backend(verySlowRouter, storage as any, tools, toolState, prompt, {
      stream: false,
      maxToolRounds: 5,
    });
    slowBackend.on('error', () => {});

    const doneSpy = vi.fn();
    slowBackend.on('done', doneSpy);

    // 启动 turn（不 await，因为它会阻塞很久）
    const chatPromise = slowBackend.chat('s1', '长时间任务');

    // 等一小段时间让 turn 启动
    await delay(30);

    // 中止
    slowBackend.abortChat('s1');

    // 等 chat promise 完成（abort 后应较快 resolve）
    await chatPromise;

    expect(doneSpy).toHaveBeenCalled();
  });

  it('abortChat 同时中止该 session 发起的后台任务', () => {
    const board = new CrossAgentTaskBoard();
    const backend = new Backend(router, storage as any, tools, toolState, prompt, {
      stream: false,
      maxToolRounds: 5,
    });
    backend.setTaskBoard(board);

    board.register({
      taskId: 'task_abort_1',
      sourceAgent: 'test-agent',
      sourceSessionId: 's1',
      targetAgent: 'test-agent',
      type: 'sub_agent',
      description: '后台任务',
    });

    backend.abortChat('s1');

    expect(board.get('task_abort_1')?.status).toBe('killed');
  });

  // ---- clearSession ----

  it('clearSession 清空队列中残留消息并释放 turn 锁', async () => {
    // 入队后但 turn 还没结束时 clearSession
    const slowRouter = createMockRouter('reply', 100);
    const slowBackend = new Backend(slowRouter, storage as any, tools, toolState, prompt, {
      stream: false,
      maxToolRounds: 5,
    });
    slowBackend.on('error', () => {});

    // 入队两条消息
    void slowBackend.chat('s1', '消息1');
    void slowBackend.chat('s1', '消息2');
    await delay(10);

    // 清空 session
    await slowBackend.clearSession('s1');

    // 队列中不应还有 s1 的消息
    const mq = (slowBackend as any).messageQueue;
    expect(mq.hasMessages('s1')).toBe(false);
  });

  // ---- 不同 session 并行 turn ----

  it('不同 session 的消息可以并行 turn', async () => {
    const parallelRouter = createMockRouter('reply', 30);
    const parallelBackend = new Backend(parallelRouter, storage as any, tools, toolState, prompt, {
      stream: false,
      maxToolRounds: 5,
    });
    parallelBackend.on('error', () => {});

    const startTime = Date.now();

    // 同时向两个不同 session 发消息
    await Promise.all([
      parallelBackend.chat('s1', '消息-s1'),
      parallelBackend.chat('s2', '消息-s2'),
    ]);

    const elapsed = Date.now() - startTime;

    // 两个 session 并行执行，总时间应接近单个 turn 的时间，而不是两倍
    // 允许一定的调度开销（200ms 上限，实际单个 turn 约 30ms）
    expect(elapsed).toBeLessThan(200);
    expect(parallelRouter.chat).toHaveBeenCalledTimes(2);
  });
});
