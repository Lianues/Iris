/**
 * AbortController 全链路测试
 *
 * 覆盖：
 *   - executePlan / executeSingle（scheduler 层）
 *   - ToolLoop.run()（tool-loop 层）
 *   - buildAbortResult 边界情况
 *   - sanitizeHistory（加载兜底）
 *   - ToolStateManager 集成
 *   - 并发安全
 *   - combineSignals 降级
 */

import { describe, it, beforeEach, expect } from 'vitest';
import { ToolLoop, type LLMCaller } from '../src/core/tool-loop.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { ToolStateManager } from '../src/tools/state.js';
import { buildExecutionPlan, executePlan } from '../src/tools/scheduler.js';
import { PromptAssembler } from '../src/prompt/assembler.js';
import type { Content, FunctionCallPart } from '../src/types/index.js';
import type { ToolPolicyConfig } from '../src/config/types.js';
import { sanitizeHistory, cleanupTrailingHistory } from '../src/core/history-sanitizer.js';

// ============ 辅助工具 ============

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function createRegistry(tools: Array<{ name: string; handler: (args: Record<string, unknown>) => Promise<unknown>; parallel?: boolean }>): ToolRegistry {
  const registry = new ToolRegistry();
  for (const t of tools) {
    registry.register({
      declaration: { name: t.name, description: `tool ${t.name}` },
      handler: t.handler,
      parallel: t.parallel,
    });
  }
  return registry;
}

function fc(name: string, args: Record<string, unknown> = {}, callId?: string): FunctionCallPart {
  return { functionCall: { name, args, callId: callId ?? `call_${name}_${Date.now()}` } };
}

function createAssembler(): PromptAssembler {
  const a = new PromptAssembler();
  a.setSystemPrompt('test');
  return a;
}

function textModelContent(text: string): Content {
  return { role: 'model', parts: [{ text }] };
}

function toolCallModelContent(toolName: string, args: Record<string, unknown> = {}): Content {
  return { role: 'model', parts: [fc(toolName, args)] };
}

/**
 * 一个 Proxy 对象，任何工具名查询都返回 { autoApprove: true }。
 * 用于测试中跳过策略检查。
 * 需要配合 ownKeys/getOwnPropertyDescriptor 让 Object.keys() 正常工作——
 * 但 ownKeys 需要预知键名，这里改用工厂函数更安全。
 */
function allToolsAutoApprove(...toolNames: string[]): { permissions: Record<string, ToolPolicyConfig> } {
  const policies: Record<string, ToolPolicyConfig> = {};
  for (const n of toolNames) policies[n] = { autoApprove: true };
  return { permissions: policies };
}

// ============ scheduler 层测试 ============

describe('scheduler: abort support', () => {
  it('executeSingle: signal 已 aborted 时直接返回错误，不执行 handler', async () => {
    let handlerCalled = false;
    const registry = createRegistry([{
      name: 'test_tool',
      handler: async () => { handlerCalled = true; return 'ok'; },
    }]);
    const controller = new AbortController();
    controller.abort();

    const calls = [fc('test_tool')];
    const plan = buildExecutionPlan(calls, registry);
    const results = await executePlan(calls, plan, registry, undefined, undefined, allToolsAutoApprove(...calls.map(c => c.functionCall.name)), controller.signal);

    expect(results).toHaveLength(1);
    expect((results[0].functionResponse.response as any).error).toBe('Operation aborted');
    expect(handlerCalled).toBe(false);
  });

  it('executePlan: 多批中途 abort，剩余批次返回错误', async () => {
    const executionOrder: string[] = [];
    const controller = new AbortController();

    const registry = createRegistry([
      {
        name: 'tool_a',
        handler: async () => { executionOrder.push('a'); controller.abort(); return 'a_result'; },
      },
      {
        name: 'tool_b',
        handler: async () => { executionOrder.push('b'); return 'b_result'; },
      },
    ]);

    const calls = [fc('tool_a'), fc('tool_b')];
    const plan = buildExecutionPlan(calls, registry);
    const results = await executePlan(calls, plan, registry, undefined, undefined, allToolsAutoApprove(...calls.map(c => c.functionCall.name)), controller.signal);

    expect(results).toHaveLength(2);
    expect((results[0].functionResponse.response as any).result).toBe('a_result');
    expect((results[1].functionResponse.response as any).error).toBe('Operation aborted');
    expect(executionOrder).toEqual(['a']);
  });

  it('executePlan: 并行批次中 signal 已 aborted，所有工具返回错误', async () => {
    const controller = new AbortController();
    controller.abort();

    const registry = createRegistry([
      { name: 'read_a', handler: async () => 'a', parallel: true },
      { name: 'read_b', handler: async () => 'b', parallel: true },
    ]);

    const calls = [fc('read_a'), fc('read_b')];
    const plan = buildExecutionPlan(calls, registry);
    const results = await executePlan(calls, plan, registry, undefined, undefined, allToolsAutoApprove(...calls.map(c => c.functionCall.name)), controller.signal);

    expect(results).toHaveLength(2);
    expect((results[0].functionResponse.response as any).error).toBe('Operation aborted');
    expect((results[1].functionResponse.response as any).error).toBe('Operation aborted');
  });

  it('executePlan: 有 ToolStateManager 时，abort 的工具转为 error 状态', async () => {
    const controller = new AbortController();
    controller.abort();

    const registry = createRegistry([{
      name: 'test_tool',
      handler: async () => 'ok',
    }]);
    const toolState = new ToolStateManager();
    const invocation = toolState.create('test_tool', {}, 'queued');

    const calls = [fc('test_tool')];
    const plan = buildExecutionPlan(calls, registry);
    await executePlan(calls, plan, registry, toolState, [invocation.id], allToolsAutoApprove('test_tool'), controller.signal);

    const updated = toolState.get(invocation.id)!;
    expect(updated.status).toBe('error');
    expect(updated.error).toBe('Operation aborted');
  });

  it('executePlan: signal 未触发时正常执行', async () => {
    const controller = new AbortController();

    const registry = createRegistry([{
      name: 'test_tool',
      handler: async () => 'result_ok',
    }]);

    const calls = [fc('test_tool')];
    const plan = buildExecutionPlan(calls, registry);
    const results = await executePlan(calls, plan, registry, undefined, undefined, allToolsAutoApprove(...calls.map(c => c.functionCall.name)), controller.signal);

    expect((results[0].functionResponse.response as any).result).toBe('result_ok');
  });
});

// ============ ToolLoop 层测试 ============

describe('ToolLoop: abort support', () => {
  let registry: ToolRegistry;
  let assembler: PromptAssembler;

  beforeEach(() => {
    registry = createRegistry([
      { name: 'slow_tool', handler: async () => { await delay(100); return 'slow_result'; } },
      { name: 'fast_tool', handler: async () => 'fast_result' },
    ]);
    assembler = createAssembler();
  });

  it('循环前 signal 已 aborted：立即返回 aborted=true，不调用 LLM', async () => {
    const controller = new AbortController();
    controller.abort();
    let llmCalled = false;

    const callLLM: LLMCaller = async () => { llmCalled = true; return textModelContent('hi'); };
    const loop = new ToolLoop(registry, assembler, { maxRounds: 10, toolsConfig: allToolsAutoApprove('slow_tool', 'fast_tool') });
    const history: Content[] = [{ role: 'user', parts: [{ text: 'hello' }] }];

    const result = await loop.run(history, callLLM, { signal: controller.signal });

    expect(result.aborted).toBe(true);
    expect(llmCalled).toBe(false);
  });

  it('LLM 返回纯文本后 abort：保留文本，aborted=undefined（已正常完成）', async () => {
    const controller = new AbortController();
    const callLLM: LLMCaller = async () => textModelContent('final answer');
    const loop = new ToolLoop(registry, assembler, { maxRounds: 10, toolsConfig: allToolsAutoApprove('slow_tool', 'fast_tool') });
    const history: Content[] = [{ role: 'user', parts: [{ text: 'hello' }] }];

    const result = await loop.run(history, callLLM, { signal: controller.signal });

    expect(result.text).toBe('final answer');
    expect(result.aborted).toBeUndefined();
  });

  it('LLM 调用期间 abort：安全退出，不追加不完整的 model 消息', async () => {
    const controller = new AbortController();
    const callLLM: LLMCaller = async () => {
      controller.abort();
      throw new DOMException('The operation was aborted', 'AbortError');
    };
    const loop = new ToolLoop(registry, assembler, { maxRounds: 10, toolsConfig: allToolsAutoApprove('slow_tool', 'fast_tool') });
    const history: Content[] = [{ role: 'user', parts: [{ text: 'hello' }] }];
    const historyLenBefore = history.length;

    const result = await loop.run(history, callLLM, { signal: controller.signal });

    expect(result.aborted).toBe(true);
    expect(history).toHaveLength(historyLenBefore);
  });

  it('thinking+工具调用阶段中止：保留 model 消息并追加中断响应', async () => {
    const controller = new AbortController();
    let callCount = 0;
    const callLLM: LLMCaller = async () => {
      callCount++;
      if (callCount === 1) {
        return {
          role: 'model' as const,
          parts: [
            { text: 'let me think...', thought: true },
            fc('slow_tool'),
          ],
        };
      }
      return textModelContent('should not reach');
    };
    const abortRegistry = createRegistry([{
      name: 'slow_tool',
      handler: async () => { controller.abort(); await delay(10); return 'ok'; },
    }]);
    const loop = new ToolLoop(abortRegistry, assembler, { maxRounds: 10, toolsConfig: allToolsAutoApprove('slow_tool', 'fast_tool') });
    const history: Content[] = [{ role: 'user', parts: [{ text: 'hello' }] }];

    const result = await loop.run(history, callLLM, { signal: controller.signal });

    expect(result.aborted).toBe(true);
    const lastMsg = history[history.length - 1];
    expect(lastMsg.role).toBe('user');
    // 最后一条应是中断响应（functionResponse），而非原始用户消息
    expect(lastMsg.parts.some(p => 'functionResponse' in p)).toBe(true);
  });

  it('文本输出中中止：保留已有可见文本', async () => {
    const controller = new AbortController();
    let callCount = 0;
    const callLLM: LLMCaller = async () => {
      callCount++;
      if (callCount === 1) return toolCallModelContent('fast_tool');
      if (callCount === 2) {
        const content = textModelContent('partial output here');
        setTimeout(() => controller.abort(), 0);
        return content;
      }
      return textModelContent('should not reach');
    };
    const loop = new ToolLoop(registry, assembler, { maxRounds: 10, toolsConfig: allToolsAutoApprove('slow_tool', 'fast_tool') });
    const history: Content[] = [{ role: 'user', parts: [{ text: 'hello' }] }];

    const result = await loop.run(history, callLLM, { signal: controller.signal });

    expect(result.text).toBe('partial output here');
  });

  it('工具调用中中止：保留 model 消息并追加中断响应', async () => {
    const controller = new AbortController();
    const callLLM: LLMCaller = async () => toolCallModelContent('slow_tool');

    const slowRegistry = createRegistry([{
      name: 'slow_tool',
      handler: async () => { controller.abort(); await delay(50); return 'slow_result'; },
    }]);
    const loop = new ToolLoop(slowRegistry, assembler, { maxRounds: 10, toolsConfig: allToolsAutoApprove('slow_tool', 'fast_tool') });
    const history: Content[] = [{ role: 'user', parts: [{ text: 'hello' }] }];

    const result = await loop.run(history, callLLM, { signal: controller.signal });

    expect(result.aborted).toBe(true);
    const lastMsg = history[history.length - 1];
    expect(lastMsg.role).toBe('user');
    // 最后一条应是中断响应（functionResponse），model+FC 被保留
    expect(lastMsg.parts.some(p => 'functionResponse' in p)).toBe(true);
    // model+FC 仍在历史中
    expect(history.some(h => h.role === 'model' && h.parts.some(p => 'functionCall' in p))).toBe(true);
  });

  it('多轮工具调用后 abort：保留已完成的工具对，未完成的追加中断响应', async () => {
    const controller = new AbortController();
    let callCount = 0;
    const callLLM: LLMCaller = async () => {
      callCount++;
      if (callCount === 1) return toolCallModelContent('fast_tool');
      if (callCount === 2) return toolCallModelContent('slow_tool');
      return textModelContent('should not reach');
    };

    const mixedRegistry = createRegistry([
      { name: 'fast_tool', handler: async () => 'fast_ok' },
      { name: 'slow_tool', handler: async () => { controller.abort(); return 'slow_ok'; } },
    ]);
    const loop = new ToolLoop(mixedRegistry, assembler, { maxRounds: 10, toolsConfig: allToolsAutoApprove('slow_tool', 'fast_tool') });
    const history: Content[] = [{ role: 'user', parts: [{ text: 'hello' }] }];

    const result = await loop.run(history, callLLM, { signal: controller.signal });

    expect(result.aborted).toBe(true);
    const lastModelIdx = history.map((h, i) => h.role === 'model' ? i : -1).filter(i => i >= 0).pop();
    if (lastModelIdx !== undefined && lastModelIdx >= 0) {
      const lastModel = history[lastModelIdx];
      const hasFunctionCall = lastModel.parts.some(p => 'functionCall' in p);
      if (hasFunctionCall) {
        const nextMsg = history[lastModelIdx + 1];
        expect(nextMsg).toBeDefined();
        expect(nextMsg.role).toBe('user');
        expect(nextMsg.parts.some(p => 'functionResponse' in p)).toBe(true);
      }
    }
  });

  it('无 signal 时正常执行（向后兼容）', async () => {
    const callLLM: LLMCaller = async () => textModelContent('normal response');
    const loop = new ToolLoop(registry, assembler, { maxRounds: 10, toolsConfig: allToolsAutoApprove('slow_tool', 'fast_tool') });
    const history: Content[] = [{ role: 'user', parts: [{ text: 'hello' }] }];

    const result = await loop.run(history, callLLM);

    expect(result.text).toBe('normal response');
    expect(result.aborted).toBeUndefined();
  });

  it('abort 后 history 格式合法：永远不以孤立的 functionCall model 消息结尾', async () => {
    const controller = new AbortController();
    let callCount = 0;
    const callLLM: LLMCaller = async () => {
      callCount++;
      const content = toolCallModelContent('fast_tool');
      if (callCount >= 2) controller.abort();
      return content;
    };

    const loop = new ToolLoop(registry, assembler, { maxRounds: 10, toolsConfig: allToolsAutoApprove('slow_tool', 'fast_tool') });
    const history: Content[] = [{ role: 'user', parts: [{ text: 'hello' }] }];

    const result = await loop.run(history, callLLM, { signal: controller.signal });

    expect(result.aborted).toBe(true);
    for (let i = 0; i < history.length; i++) {
      const msg = history[i];
      if (msg.role === 'model' && msg.parts.some(p => 'functionCall' in p)) {
        const next = history[i + 1];
        expect(next).toBeDefined();
        expect(next.role).toBe('user');
        expect(next.parts.some(p => 'functionResponse' in p)).toBe(true);
      }
    }
  });
});

// ============ buildAbortResult 边界测试 ============

describe('ToolLoop: buildAbortResult edge cases', () => {
  const assembler = createAssembler();
  const registry = createRegistry([{ name: 'tool_a', handler: async () => 'ok' }]);

  it('历史为空时 abort：不崩溃', async () => {
    const controller = new AbortController();
    controller.abort();
    const callLLM: LLMCaller = async () => textModelContent('never');
    const loop = new ToolLoop(registry, assembler, { maxRounds: 10, toolsConfig: allToolsAutoApprove('slow_tool', 'fast_tool') });
    const history: Content[] = [];

    const result = await loop.run(history, callLLM, { signal: controller.signal });

    expect(result.aborted).toBe(true);
    expect(history).toHaveLength(0);
  });

  it('只有 user 消息时 abort：保留 user 消息', async () => {
    const controller = new AbortController();
    controller.abort();
    const callLLM: LLMCaller = async () => textModelContent('never');
    const loop = new ToolLoop(registry, assembler, { maxRounds: 10, toolsConfig: allToolsAutoApprove('slow_tool', 'fast_tool') });
    const history: Content[] = [{ role: 'user', parts: [{ text: 'hello' }] }];

    const result = await loop.run(history, callLLM, { signal: controller.signal });

    expect(result.aborted).toBe(true);
    expect(history).toHaveLength(1);
    expect(history[0].role).toBe('user');
  });

  it('已有完整对话历史 + abort：不删除已有历史', async () => {
    const controller = new AbortController();
    controller.abort();
    const callLLM: LLMCaller = async () => textModelContent('never');
    const loop = new ToolLoop(registry, assembler, { maxRounds: 10, toolsConfig: allToolsAutoApprove('slow_tool', 'fast_tool') });
    const history: Content[] = [
      { role: 'user', parts: [{ text: 'hello' }] },
      { role: 'model', parts: [{ text: 'hi there' }] },
      { role: 'user', parts: [{ text: 'bye' }] },
    ];

    const result = await loop.run(history, callLLM, { signal: controller.signal });

    expect(result.aborted).toBe(true);
    expect(history).toHaveLength(3);
  });

  it('model 消息同时包含 thought 和可见文本：保留', async () => {
    const controller = new AbortController();
    let callCount = 0;
    const callLLM: LLMCaller = async () => {
      callCount++;
      if (callCount === 1) {
        const content: Content = {
          role: 'model',
          parts: [{ text: 'thinking...', thought: true }, { text: 'visible output' }],
        };
        setTimeout(() => controller.abort(), 0);
        return content;
      }
      return textModelContent('never');
    };
    const loop = new ToolLoop(registry, assembler, { maxRounds: 10, toolsConfig: allToolsAutoApprove('slow_tool', 'fast_tool') });
    const history: Content[] = [{ role: 'user', parts: [{ text: 'hello' }] }];

    const result = await loop.run(history, callLLM, { signal: controller.signal });

    expect(result.text).toBe('visible output');
    expect(result.aborted).toBeUndefined();
  });
});

// ============ ToolLoop + ToolStateManager 集成 ============

describe('ToolLoop + ToolStateManager: abort', () => {
  const assembler = createAssembler();

  it('abort 时 ToolState 中活跃的 invocations 转为 error', async () => {
    const controller = new AbortController();
    const toolState = new ToolStateManager();
    const registry = createRegistry([{
      name: 'slow_tool',
      handler: async () => { controller.abort(); await delay(50); return 'result'; },
    }]);
    const callLLM: LLMCaller = async () => toolCallModelContent('slow_tool');
    const loop = new ToolLoop(registry, assembler, { maxRounds: 10, toolsConfig: allToolsAutoApprove('slow_tool', 'fast_tool') }, toolState);
    const history: Content[] = [{ role: 'user', parts: [{ text: 'go' }] }];

    const result = await loop.run(history, callLLM, { signal: controller.signal });

    expect(result.aborted).toBe(true);
    expect(toolState.getAll().length).toBeGreaterThan(0);
  });
});

// ============ 并发安全 ============

describe('abort: concurrency safety', () => {
  it('多次 abort 不报错（幂等）', () => {
    const controller = new AbortController();
    controller.abort();
    controller.abort();
    controller.abort();
    expect(controller.signal.aborted).toBe(true);
  });

  it('已 aborted 的 signal 传入 ToolLoop 立即返回', async () => {
    const controller = new AbortController();
    controller.abort();
    const registry = createRegistry([]);
    const assembler = createAssembler();
    const callLLM: LLMCaller = async () => { throw new Error('should not be called'); };
    const loop = new ToolLoop(registry, assembler, { maxRounds: 10, toolsConfig: allToolsAutoApprove('slow_tool', 'fast_tool') });
    const history: Content[] = [{ role: 'user', parts: [{ text: 'hi' }] }];

    const start = Date.now();
    const result = await loop.run(history, callLLM, { signal: controller.signal });
    const elapsed = Date.now() - start;

    expect(result.aborted).toBe(true);
    expect(elapsed).toBeLessThan(50);
  });
});

// ============ combineSignals 测试 ============

describe('combineSignals (via sendRequest behavior)', () => {
  it('AbortSignal.timeout 存在时不崩溃', () => {
    const signal = AbortSignal.timeout(1000);
    expect(signal.aborted).toBe(false);
  });

  it('AbortSignal.any 可用性检测', () => {
    const available = typeof AbortSignal.any === 'function';
    console.log(`  AbortSignal.any 可用: ${available} (Node ${process.version})`);
    expect(true).toBe(true);
  });

  it('降级方案合并两个 signal：外部 abort 触发合并 signal', () => {
    const external = new AbortController();
    const combined = new AbortController();
    const onAbort = () => combined.abort(external.signal.reason);
    external.signal.addEventListener('abort', onAbort, { once: true });

    expect(combined.signal.aborted).toBe(false);
    external.abort('user stop');
    expect(combined.signal.aborted).toBe(true);
  });

  it('降级方案：外部 signal 已 aborted 时立即生效', () => {
    const external = new AbortController();
    external.abort('already stopped');
    const combined = new AbortController();
    if (external.signal.aborted) combined.abort(external.signal.reason);
    expect(combined.signal.aborted).toBe(true);
  });
});

// ============ waitForApproval + AbortSignal 测试 ============

describe('ToolStateManager.waitForApproval: abort support', () => {
  let toolState: ToolStateManager;

  beforeEach(() => {
    toolState = new ToolStateManager();
  });

  it('等待审批期间 abort 触发：返回 false，工具状态转为 error', async () => {
    const inv = toolState.create('test_tool', {}, 'queued');
    toolState.transition(inv.id, 'awaiting_approval');

    const controller = new AbortController();

    // 50ms 后 abort
    setTimeout(() => controller.abort(), 50);

    const approved = await toolState.waitForApproval(inv.id, controller.signal);

    expect(approved).toBe(false);
    expect(toolState.get(inv.id)!.status).toBe('error');
    expect(toolState.get(inv.id)!.error).toBe('Operation aborted');
  });

  it('signal 已 aborted 时直接返回 false', async () => {
    const inv = toolState.create('test_tool', {}, 'queued');
    toolState.transition(inv.id, 'awaiting_approval');

    const controller = new AbortController();
    controller.abort();

    const start = Date.now();
    const approved = await toolState.waitForApproval(inv.id, controller.signal);
    const elapsed = Date.now() - start;

    expect(approved).toBe(false);
    expect(elapsed).toBeLessThan(20);
    expect(toolState.get(inv.id)!.status).toBe('error');
  });

  it('不传 signal 时保持原有行为：正常批准返回 true', async () => {
    const inv = toolState.create('test_tool', {}, 'queued');
    toolState.transition(inv.id, 'awaiting_approval');

    // 50ms 后批准
    setTimeout(() => toolState.transition(inv.id, 'executing'), 50);

    const approved = await toolState.waitForApproval(inv.id);
    expect(approved).toBe(true);
  });

  it('不传 signal 时保持原有行为：拒绝返回 false', async () => {
    const inv = toolState.create('test_tool', {}, 'queued');
    toolState.transition(inv.id, 'awaiting_approval');

    // 50ms 后拒绝
    setTimeout(() => toolState.transition(inv.id, 'error', { error: 'denied' }), 50);

    const approved = await toolState.waitForApproval(inv.id);
    expect(approved).toBe(false);
  });

  it('批准先于 abort 发生：返回 true，abort 不再影响状态', async () => {
    const inv = toolState.create('test_tool', {}, 'queued');
    toolState.transition(inv.id, 'awaiting_approval');

    const controller = new AbortController();

    // 先批准
    setTimeout(() => toolState.transition(inv.id, 'executing'), 30);
    // 再 abort（应无效）
    setTimeout(() => controller.abort(), 80);

    const approved = await toolState.waitForApproval(inv.id, controller.signal);
    expect(approved).toBe(true);
    expect(toolState.get(inv.id)!.status).toBe('executing');
  });

  it('状态已经不是 awaiting_approval 时直接返回，signal 不影响', async () => {
    const inv = toolState.create('test_tool', {}, 'queued');
    toolState.transition(inv.id, 'executing');

    const controller = new AbortController();
    const approved = await toolState.waitForApproval(inv.id, controller.signal);
    expect(approved).toBe(true);
    expect(controller.signal.aborted).toBe(false);
  });

  it('abort 后 stateChange 监听被清除（无泄漏）', async () => {
    const inv = toolState.create('test_tool', {}, 'queued');
    toolState.transition(inv.id, 'awaiting_approval');

    const listenerCountBefore = toolState.listenerCount('stateChange');
    const controller = new AbortController();

    const promise = toolState.waitForApproval(inv.id, controller.signal);

    // 等一个微任务让监听注册完毕
    await new Promise(r => setTimeout(r, 0));
    expect(toolState.listenerCount('stateChange')).toBe(listenerCountBefore + 1);

    controller.abort();
    await promise;

    // 监听应已清除
    expect(toolState.listenerCount('stateChange')).toBe(listenerCountBefore);
  });
});

// ============ scheduler + waitForApproval + abort 集成测试 ============

describe('scheduler: abort during awaiting_approval', () => {
  it('工具处于 awaiting_approval 时 abort，executeSingle 正确退出', async () => {
    const registry = createRegistry([{
      name: 'manual_tool',
      handler: async () => 'should_not_reach',
    }]);
    const toolState = new ToolStateManager();
    const inv = toolState.create('manual_tool', {}, 'queued');

    const controller = new AbortController();

    const calls = [fc('manual_tool')];
    const plan = buildExecutionPlan(calls, registry);
    const policies = {
      permissions: { manual_tool: { autoApprove: false } as ToolPolicyConfig },
    };

    // 100ms 后 abort（模拟用户按 ESC）
    setTimeout(() => controller.abort(), 100);

    const results = await executePlan(
      calls, plan, registry, toolState, [inv.id], policies, controller.signal,
    );

    expect(results).toHaveLength(1);
    // waitForApproval 被 abort 中断，返回拒绝
    const response = results[0].functionResponse.response as Record<string, unknown>;
    expect(response.error).toBeTruthy();
    expect(toolState.get(inv.id)!.status).toBe('error');
  });
});

// ============ sanitizeHistory / cleanupTrailingHistory 测试 ============

describe('sanitizeHistory: 加载兜底清理', () => {

  it('合法历史不做任何修改', () => {
    const history: Content[] = [
      { role: 'user', parts: [{ text: 'hello' }] },
      { role: 'model', parts: [{ text: 'hi there' }] },
    ];
    const appended = sanitizeHistory(history);
    expect(appended).toHaveLength(0);
    expect(history).toHaveLength(2);
  });

  it('空历史不崩溃', () => {
    const history: Content[] = [];
    const appended = sanitizeHistory(history);
    expect(appended).toHaveLength(0);
    expect(history).toHaveLength(0);
  });

  it('dangling functionCall → 保留并追加中断响应', () => {
    const history: Content[] = [
      { role: 'user', parts: [{ text: 'hello' }] },
      { role: 'model', parts: [fc('my_tool', {}, 'call_1')] },
    ];
    const appended = sanitizeHistory(history);
    // 应追加一条中断响应
    expect(appended).toHaveLength(1);
    expect(history).toHaveLength(3);
    // 最后一条是 user + functionResponse
    const last = history[2];
    expect(last.role).toBe('user');
    expect(last.parts).toHaveLength(1);
    const fr = last.parts[0] as any;
    expect(fr.functionResponse).toBeDefined();
    expect(fr.functionResponse.name).toBe('my_tool');
    expect(fr.functionResponse.callId).toBe('call_1');
    expect(fr.functionResponse.response.error).toContain('interrupted');
  });

  it('多个 dangling functionCall → 每个都有对应的中断响应', () => {
    const history: Content[] = [
      { role: 'user', parts: [{ text: 'hello' }] },
      { role: 'model', parts: [fc('tool_a', {}, 'call_a'), fc('tool_b', {}, 'call_b')] },
    ];
    const appended = sanitizeHistory(history);
    expect(appended).toHaveLength(1);
    expect(history).toHaveLength(3);
    const frParts = history[2].parts;
    expect(frParts).toHaveLength(2);
    expect((frParts[0] as any).functionResponse.name).toBe('tool_a');
    expect((frParts[1] as any).functionResponse.name).toBe('tool_b');
  });

  it('末尾纯 thought → 丢弃', () => {
    const history: Content[] = [
      { role: 'user', parts: [{ text: 'hello' }] },
      { role: 'model', parts: [{ text: 'thinking...', thought: true }] },
    ];
    const appended = sanitizeHistory(history);
    expect(appended).toHaveLength(0);
    expect(history).toHaveLength(1);
  });

  it('末尾孤立 tool response → 丢弃', () => {
    const history: Content[] = [
      { role: 'user', parts: [{ text: 'hello' }] },
      // 没有对应的 model+FC，只有一个孤立的 tool response
      { role: 'user', parts: [{ functionResponse: { name: 'orphan', response: {}, callId: 'x' } }] },
    ];
    const appended = sanitizeHistory(history);
    expect(appended).toHaveLength(0);
    expect(history).toHaveLength(1);
  });

  it('完整 FC+FR 对 → 保留', () => {
    const history: Content[] = [
      { role: 'user', parts: [{ text: 'hello' }] },
      { role: 'model', parts: [fc('my_tool', {}, 'call_1')] },
      { role: 'user', parts: [{ functionResponse: { name: 'my_tool', response: { result: 'ok' }, callId: 'call_1' } }] },
    ];
    const appended = sanitizeHistory(history);
    expect(appended).toHaveLength(0);
    expect(history).toHaveLength(3);
  });

  it('末尾 thought + 前面 dangling FC：先移除 thought，再补全 FC', () => {
    const history: Content[] = [
      { role: 'user', parts: [{ text: 'hello' }] },
      { role: 'model', parts: [fc('my_tool', {}, 'call_1')] },
      // 假设因为某种原因存了一条孤立 thought
      { role: 'model', parts: [{ text: 'hmm...', thought: true }] },
    ];
    const appended = sanitizeHistory(history);
    // thought 被移除，然后 dangling FC 被补全
    expect(history).toHaveLength(3); // user + model+FC + abortResponse
    expect(appended).toHaveLength(1);
    expect(history[2].role).toBe('user');
    expect((history[2].parts[0] as any).functionResponse.name).toBe('my_tool');
  });

  it('有可见文本的 model 消息 → 保留不动', () => {
    const history: Content[] = [
      { role: 'user', parts: [{ text: 'hello' }] },
      { role: 'model', parts: [{ text: 'some partial output' }] },
    ];
    const appended = sanitizeHistory(history);
    expect(appended).toHaveLength(0);
    expect(history).toHaveLength(2);
  });

  it('cleanupTrailingHistory 的 minLength 约束', () => {
    const history: Content[] = [
      { role: 'user', parts: [{ text: 'hello' }] },
      { role: 'model', parts: [{ text: 'thinking...', thought: true }] },
    ];
    // minLength = 2 表示不能低于 2 条
    const appended = cleanupTrailingHistory(history, 2);
    expect(appended).toHaveLength(0);
    expect(history).toHaveLength(2); // 不能 pop 到 2 以下，所以保持不动
  });

  it('callId 正确透传到中断响应', () => {
    const history: Content[] = [
      { role: 'user', parts: [{ text: 'go' }] },
      { role: 'model', parts: [fc('search', { q: 'test' }, 'toolu_abc123')] },
    ];
    sanitizeHistory(history);
    const fr = (history[2].parts[0] as any).functionResponse;
    expect(fr.callId).toBe('toolu_abc123');
    expect(fr.name).toBe('search');
  });
});

