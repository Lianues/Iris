/**
 * 后台工具权限与结果状态回归测试
 *
 * 为什么加这些测试：
 * 1. cross-agent 委派会话是隐藏后台 session，不能像前台 Console 那样做人机审批；
 * 2. sub_agent 也是非交互执行环境，权限策略必须在无 UI 的情况下仍然可预测；
 * 3. write_file 这类批量工具会把单文件失败收敛进结果对象，调度层不能再把“返回了对象”误判为“执行成功”。
 *
 * 这些测试分别覆盖：
 * - 非交互上下文下，未授权工具必须直接失败，不能偷偷执行；
 * - sub_agent 必须继承完整 toolsConfig，而不只是 permissions 子集；
 * - cross-agent 隐藏会话下，已授权写工具不应被 diff 审批卡死；
 * - 批量工具全失败时，调度层应标记为 error，而不是 success。
 */

import { describe, expect, it } from 'vitest';
import { buildExecutionPlan, executePlan } from '../src/tools/scheduler.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { ToolStateManager } from '../src/tools/state.js';
import { createSubAgentTool, SubAgentTypeRegistry } from '../src/tools/internal/sub-agent/index.js';
import type { FunctionCallPart, Content } from '../src/types/index.js';
import type { ToolPolicyConfig, ToolsConfig } from '../src/config/types.js';

function fc(name: string, args: Record<string, unknown> = {}, callId?: string): FunctionCallPart {
  return { functionCall: { name, args, callId: callId ?? `call_${name}_${Date.now()}` } };
}

function createRegistry(tools: Array<{
  name: string;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
  parallel?: boolean;
}>): ToolRegistry {
  const registry = new ToolRegistry();
  for (const t of tools) {
    registry.register({
      declaration: {
        name: t.name,
        description: `tool ${t.name}`,
      },
      handler: t.handler,
      parallel: t.parallel,
    });
  }
  return registry;
}

describe('background tool permissions', () => {
  it('非交互上下文下，未自动授权的工具必须直接失败，不能偷偷执行', async () => {
    let handlerCalled = false;
    const registry = createRegistry([
      {
        name: 'manual_tool',
        handler: async () => {
          handlerCalled = true;
          return { result: 'should_not_run' };
        },
      },
    ]);

    const calls = [fc('manual_tool')];
    const plan = buildExecutionPlan(calls, registry);
    const policies = {
      permissions: {
        manual_tool: { autoApprove: false } as ToolPolicyConfig,
      },
    } satisfies { permissions: Record<string, ToolPolicyConfig> };

    const results = await executePlan(calls, plan, registry, undefined, undefined, policies);
    const response = results[0].functionResponse.response as Record<string, unknown>;

    expect(handlerCalled).toBe(false);
    expect(String(response.error || '')).toContain('人工确认');
  });

  it('sub_agent 必须继承完整 toolsConfig，不能丢掉 autoApproveAll 这类全局开关', async () => {
    let manualToolCalled = false;
    const tools = createRegistry([
      {
        name: 'manual_tool',
        handler: async () => {
          manualToolCalled = true;
          return { result: 'manual_ok' };
        },
      },
    ]);

    const subAgentTypes = new SubAgentTypeRegistry();
    subAgentTypes.register({
      name: 'worker',
      description: '测试类型',
      systemPrompt: 'you are worker',
      allowedTools: ['manual_tool'],
      parallel: false,
      maxToolRounds: 4,
      stream: false,
    });

    let llmRound = 0;
    const fakeRouter = {
      chat: async (): Promise<{ content: Content }> => {
        llmRound++;
        if (llmRound === 1) {
          return { content: { role: 'model', parts: [fc('manual_tool')] } };
        }
        return { content: { role: 'model', parts: [{ text: 'sub agent done' }] } };
      },
    };

    const inheritedToolsConfig: ToolsConfig = {
      // 为什么这样测：sub_agent 以前只继承 permissions，导致 autoApproveAll 在后台执行时丢失。
      autoApproveAll: true,
      permissions: {
        manual_tool: { autoApprove: false },
      },
    };

    const subAgentTool = createSubAgentTool({
      getRouter: () => fakeRouter as any,
      getToolsConfig: () => inheritedToolsConfig,
      retryOnError: false,
      maxRetries: 0,
      tools,
      subAgentTypes,
      maxDepth: 3,
    });

    const result = await subAgentTool.handler({ prompt: 'run it', type: 'worker' }) as Record<string, unknown>;

    expect(manualToolCalled).toBe(true);
    expect(result.result).toBe('sub agent done');
  });

  it('cross-agent 隐藏会话下，已自动授权的 write_file 不应再被 diff 审批卡死', async () => {
    let handlerCalled = false;
    const registry = createRegistry([
      {
        name: 'write_file',
        handler: async () => {
          handlerCalled = true;
          return {
            results: [{ path: 'hello.ts', success: true, action: 'created' }],
            successCount: 1,
            failCount: 0,
            totalCount: 1,
          };
        },
      },
    ]);

    const toolState = new ToolStateManager();
    const invocation = toolState.create(
      'write_file',
      { files: [{ path: 'hello.ts', content: 'console.log("hi")' }] },
      'queued',
      'cross-agent:__global__:task-1',
    );

    const calls = [fc('write_file', { files: [{ path: 'hello.ts', content: 'console.log("hi")' }] })];
    const plan = buildExecutionPlan(calls, registry);
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 50);

    const results = await executePlan(
      calls,
      plan,
      registry,
      toolState,
      [invocation.id],
      {
        permissions: {
          write_file: {
            autoApprove: true,
            // 为什么保留 true：真实用户通常只开了 write_file 权限，没有顺手关掉 diff 视图。
            // 修复后，隐藏后台 session 不应再把 Console 专用 diff 审批当成阻塞条件。
            showApprovalView: true,
          },
        },
      },
      controller.signal,
    );

    const response = results[0].functionResponse.response as Record<string, unknown>;
    expect(handlerCalled).toBe(true);
    expect(response.error).toBeUndefined();
    expect((toolState.get(invocation.id)?.status)).toBe('success');
  });

  it('批量工具全失败时，调度层必须标记为 error，不能继续显示 success', async () => {
    const registry = createRegistry([
      {
        name: 'write_file',
        handler: async () => ({
          results: [{ path: 'hello.ts', success: false, error: 'EACCES: permission denied' }],
          successCount: 0,
          failCount: 1,
          totalCount: 1,
        }),
      },
    ]);

    const toolState = new ToolStateManager();
    const invocation = toolState.create(
      'write_file',
      { files: [{ path: 'hello.ts', content: 'console.log("hi")' }] },
      'queued',
      'visible-session',
    );

    const calls = [fc('write_file', { files: [{ path: 'hello.ts', content: 'console.log("hi")' }] })];
    const plan = buildExecutionPlan(calls, registry);
    const results = await executePlan(
      calls,
      plan,
      registry,
      toolState,
      [invocation.id],
      { permissions: { write_file: { autoApprove: true, showApprovalView: false } } },
    );

    const response = results[0].functionResponse.response as Record<string, unknown>;
    expect(String(response.error || '')).toContain('EACCES');
    expect(toolState.get(invocation.id)?.status).toBe('error');
  });
});
