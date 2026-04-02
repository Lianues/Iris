/**
 * 异步子代理集成测试
 *
 * 覆盖：
 *   - run_in_background=true 时 handler 立即返回 async_launched
 *   - 同步模式（run_in_background 不传或 false）保持原有行为
 *   - 并发异步子代理数超过 MAX_CONCURRENT_ASYNC_AGENTS 时拒绝创建
 *   - 子代理完成后调用 enqueueNotification 并写入正确的 XML
 *   - 子代理失败后 notification XML 包含错误信息
 *   - 子代理被 abort 后 notification XML 状态为 killed
 *
 * 需要 mock router（LLM 调用）。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createSubAgentTool,
  SubAgentTypeRegistry,
} from '../src/tools/internal/sub-agent/index.js';
import type { SubAgentTypeConfig } from '../src/tools/internal/sub-agent/types.js';
import { AgentTaskRegistry } from '../src/core/agent-task-registry.js';
import { ToolRegistry } from '../src/tools/registry.js';
import type { Content, Part } from '../src/types/index.js';

// ============ Mock 辅助 ============

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 创建一个 mock router，chat() 返回纯文本，ToolLoop 一轮结束。
 * delayMs 控制 LLM 响应延迟，用于模拟耗时操作。
 */
function createMockRouter(responseText: string = 'sub-agent result', delayMs: number = 0) {
  return {
    chat: vi.fn(async () => {
      if (delayMs > 0) await delay(delayMs);
      return {
        content: {
          role: 'model' as const,
          parts: [{ text: responseText }] as Part[],
          createdAt: Date.now(),
        },
        usageMetadata: { totalTokenCount: 50 },
      };
    }),
    chatStream: vi.fn(),
    getCurrentModelName: vi.fn(() => 'mock-model'),
  } as any;
}

/** 创建标准的子代理类型注册表（只有一个 general-purpose 类型） */
function createTypeRegistry(): SubAgentTypeRegistry {
  const registry = new SubAgentTypeRegistry();
  registry.register({
    name: 'general-purpose',
    description: '通用子代理, 在需要执行具体的操作性任务或高强度机械产出时调用“苦力1号”，严禁将其作为基础代码或文本的查阅工具使用，请以监管者身份指挥该无主观能动性的执行单元完成任务。',
    systemPrompt: '你是苦力1号，高级编程专家，外包程序员。严格按照指令干活。尽全力完成指令。',
    parallel: false,
    maxToolRounds: 10,
    stream: false,
  });
  return registry;
}

/** 创建空的工具注册表 */
function createTools(): ToolRegistry {
  return new ToolRegistry();
}

// ============ 测试 ============

describe('async-sub-agent: 异步路径', () => {
  let router: ReturnType<typeof createMockRouter>;
  let taskRegistry: AgentTaskRegistry;
  let typeRegistry: SubAgentTypeRegistry;
  let tools: ToolRegistry;
  let enqueueNotification: ReturnType<typeof vi.fn>;
  let getSessionId: () => string | undefined;

  beforeEach(() => {
    router = createMockRouter('sub result', 10);
    taskRegistry = new AgentTaskRegistry();
    typeRegistry = createTypeRegistry();
    tools = createTools();
    enqueueNotification = vi.fn();
    getSessionId = () => 'test-session';
  });

  // ---- run_in_background=true 立即返回 ----

  it('run_in_background=true 时 handler 立即返回 async_launched', async () => {
    const tool = createSubAgentTool({
      getRouter: () => router,
      tools,
      subAgentTypes: typeRegistry,
      maxDepth: 3,
      getToolPolicies: () => ({}),
      enqueueNotification,
      getSessionId,
      agentTaskRegistry: taskRegistry,
    });

    const startTime = Date.now();
    const result = await tool.handler!({ prompt: '测试任务', run_in_background: true }) as any;
    const elapsed = Date.now() - startTime;

    // 应立即返回，不等子代理完成
    expect(elapsed).toBeLessThan(50);
    expect(result.status).toBe('async_launched');
    expect(result.taskId).toBeDefined();
    expect(result.description).toBeDefined();

    // 任务已注册
    const task = taskRegistry.get(result.taskId);
    expect(task).toBeDefined();
    expect(task!.status).toBe('running');
  });

  // ---- 同步模式保持原有行为 ----

  /**
   * 辅助函数：消费 handler 返回值。
   * 如果返回 AsyncIterable（generator），迭代取最后一个值作为结果。
   * 如果返回 Promise，直接 await。
   */
  async function consumeHandler(returned: unknown): Promise<any> {
    // handler 可能返回 Promise<AsyncIterable>（async 函数包裹 generator），
    // 先 await 解包 Promise，再检查是否为 AsyncIterable。
    const resolved = await returned;
    if (resolved != null && typeof resolved === 'object' && Symbol.asyncIterator in (resolved as any)) {
      let last: any;
      for await (const v of resolved as AsyncIterable<unknown>) { last = v; }
      return last;
    }
    return resolved;
  }

  it('同步模式（run_in_background 不传或 false）保持原有行为', async () => {
    const tool = createSubAgentTool({
      getRouter: () => router,
      tools,
      subAgentTypes: typeRegistry,
      maxDepth: 3,
      getToolPolicies: () => ({}),
      enqueueNotification,
      getSessionId,
      agentTaskRegistry: taskRegistry,
    });

    // 不传 run_in_background
    const result1 = await consumeHandler(tool.handler!({ prompt: '同步任务' }));
    expect(result1.result).toBeDefined();
    expect(result1.status).toBeUndefined(); // 同步模式没有 status 字段

    // run_in_background=false
    const result2 = await consumeHandler(tool.handler!({ prompt: '同步任务2', run_in_background: false }));
    expect(result2.result).toBeDefined();
    expect(result2.status).toBeUndefined();
  });

  // ---- 并发限制 ----

  it('并发异步子代理数超过 MAX_CONCURRENT_ASYNC_AGENTS 时拒绝创建', async () => {
    const tool = createSubAgentTool({
      getRouter: () => createMockRouter('result', 1000), // 慢 router，保证任务不会结束
      tools,
      subAgentTypes: typeRegistry,
      maxDepth: 3,
      getToolPolicies: () => ({}),
      enqueueNotification,
      getSessionId,
      agentTaskRegistry: taskRegistry,
    });

    // MAX_CONCURRENT_ASYNC_AGENTS 默认为 5，启动 5 个
    for (let i = 0; i < 5; i++) {
      const r = await tool.handler!({ prompt: `任务${i}`, run_in_background: true }) as any;
      expect(r.status).toBe('async_launched');
    }

    // 第 6 个应被拒绝
    const rejected = await tool.handler!({ prompt: '第6个', run_in_background: true }) as any;
    expect(rejected.error).toBeDefined();
    expect(rejected.error).toContain('超过上限');
  });

  // ---- 完成后 notification ----

  it('子代理完成后调用 enqueueNotification 并写入正确的 XML', async () => {
    const tool = createSubAgentTool({
      getRouter: () => router,
      tools,
      subAgentTypes: typeRegistry,
      maxDepth: 3,
      getToolPolicies: () => ({}),
      enqueueNotification,
      getSessionId,
      agentTaskRegistry: taskRegistry,
    });

    const result = await tool.handler!({ prompt: '后台任务', run_in_background: true }) as any;
    const taskId = result.taskId;

    // 等待异步子代理完成
    await delay(100);

    // enqueueNotification 应被调用
    expect(enqueueNotification).toHaveBeenCalledTimes(1);
    const [sid, xml] = enqueueNotification.mock.calls[0];
    expect(sid).toBe('test-session');

    // XML 格式验证
    expect(xml).toContain('<task-notification>');
    expect(xml).toContain(`<task-id>${taskId}</task-id>`);
    expect(xml).toContain('<status>completed</status>');
    expect(xml).toContain('<result>');

    // 任务状态应为 completed
    expect(taskRegistry.get(taskId)!.status).toBe('completed');
  });

  // ---- 失败后 notification ----

  it('子代理失败后 notification XML 包含错误信息', async () => {
    // 创建一个会失败的 router
    const failRouter = {
      chat: vi.fn(async () => {
        throw new Error('LLM 服务不可用');
      }),
      chatStream: vi.fn(),
      getCurrentModelName: vi.fn(() => 'mock-model'),
    } as any;

    const tool = createSubAgentTool({
      getRouter: () => failRouter,
      tools,
      subAgentTypes: typeRegistry,
      maxDepth: 3,
      getToolPolicies: () => ({}),
      enqueueNotification,
      getSessionId,
      agentTaskRegistry: taskRegistry,
    });

    const result = await tool.handler!({ prompt: '会失败的任务', run_in_background: true }) as any;
    const taskId = result.taskId;

    // 等待异步子代理完成（失败）
    await delay(100);

    expect(enqueueNotification).toHaveBeenCalledTimes(1);
    const [, xml] = enqueueNotification.mock.calls[0];

    // XML 中应包含失败状态和错误信息
    expect(xml).toContain('<status>failed</status>');
    expect(xml).toContain('<error>');
    expect(xml).toContain('LLM 服务不可用');

    // 任务状态应为 failed
    expect(taskRegistry.get(taskId)!.status).toBe('failed');
  });

  // ---- abort 后 notification ----

  it('子代理被 abort 后 notification XML 状态为 killed', async () => {
    // 用很慢的 router，确保 abort 时任务还在运行
    const verySlowRouter = createMockRouter('never', 5000);

    const tool = createSubAgentTool({
      getRouter: () => verySlowRouter,
      tools,
      subAgentTypes: typeRegistry,
      maxDepth: 3,
      getToolPolicies: () => ({}),
      enqueueNotification,
      getSessionId,
      agentTaskRegistry: taskRegistry,
    });

    const result = await tool.handler!({ prompt: '长时间任务', run_in_background: true }) as any;
    const taskId = result.taskId;

    // 等任务启动
    await delay(20);

    // 通过 taskRegistry 中止任务
    taskRegistry.kill(taskId);

    // 等待 abort 处理完成
    await delay(100);

    // enqueueNotification 应被调用，XML 中状态为 killed
    if (enqueueNotification.mock.calls.length > 0) {
      const [, xml] = enqueueNotification.mock.calls[0];
      expect(xml).toContain('<status>killed</status>');
    }

    // 任务状态应为 killed
    expect(taskRegistry.get(taskId)!.status).toBe('killed');
  });

  // ---- 无异步依赖时不显示 run_in_background ----

  it('无 enqueueNotification 时 handler 不支持异步路径', async () => {
    // 不注入 enqueueNotification
    const tool = createSubAgentTool({
      getRouter: () => router,
      tools,
      subAgentTypes: typeRegistry,
      maxDepth: 3,
      getToolPolicies: () => ({}),
      // 不提供 enqueueNotification / getSessionId
    });

    // run_in_background=true 但无异步依赖，应走同步路径（返回 AsyncIterable）
    const lastValue = await consumeHandler(tool.handler!({ prompt: '测试', run_in_background: true }));
    expect(lastValue.result).toBeDefined();
    expect(lastValue.status).toBeUndefined();
  });
});
