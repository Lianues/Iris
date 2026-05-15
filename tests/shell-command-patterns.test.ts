import { describe, expect, it } from 'vitest';
import { buildExecutionPlan, executePlan, generateCommandPatterns } from '../src/tools/scheduler.js';
import { ToolRegistry } from '../src/tools/registry.js';
import type { FunctionCallPart, ToolExecutionContext } from '../src/types/index.js';

function fc(name: string, args: Record<string, unknown> = {}, callId?: string): FunctionCallPart {
  return { functionCall: { name, args, callId: callId ?? `call_${name}_${Date.now()}` } };
}

function createCommandRegistry(toolName: 'shell' | 'bash', onContext: (context?: ToolExecutionContext) => void): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register({
    approvalMode: 'handler',
    declaration: {
      name: toolName,
      description: `test ${toolName} tool`,
    },
    handler: async (_args, context) => {
      onContext(context);
      return { ok: true };
    },
  });
  return registry;
}

describe('shell command remembered patterns', () => {
  it('生成命令记忆规则时同时包含精确匹配和前缀通配', () => {
    expect(generateCommandPatterns('npm test')).toEqual(['npm test', 'npm test *']);
    expect(generateCommandPatterns('ls')).toEqual(['ls', 'ls *']);
    expect(generateCommandPatterns('python -m pytest')).toEqual(['python -m pytest', 'python *']);
    expect(generateCommandPatterns('git push origin main')).toEqual(['git push origin main', 'git push *']);
  });

  it('无参数命令选择“始终允许”后，下次相同命令能命中 allowPatterns', async () => {
    let approvedByUser: boolean | undefined;
    const registry = createCommandRegistry('shell', (context) => {
      approvedByUser = context?.approvedByUser;
    });
    const calls = [fc('shell', { command: 'npm test' })];
    const plan = buildExecutionPlan(calls, registry);

    await executePlan(calls, plan, registry, undefined, undefined, {
      permissions: {
        shell: {
          autoApprove: false,
          allowPatterns: generateCommandPatterns('npm test'),
        },
      },
    });

    expect(approvedByUser).toBe(true);
  });

  it('生成的前缀通配规则仍可覆盖同类带参数命令', async () => {
    let approvedByUser: boolean | undefined;
    const registry = createCommandRegistry('shell', (context) => {
      approvedByUser = context?.approvedByUser;
    });
    const calls = [fc('shell', { command: 'npm test -- --runInBand' })];
    const plan = buildExecutionPlan(calls, registry);

    await executePlan(calls, plan, registry, undefined, undefined, {
      permissions: {
        shell: {
          autoApprove: false,
          allowPatterns: generateCommandPatterns('npm test'),
        },
      },
    });

    expect(approvedByUser).toBe(true);
  });

  it('完整命令精确规则不会额外放宽为裸前缀命令', async () => {
    let approvedByUser: boolean | undefined;
    const registry = createCommandRegistry('shell', (context) => {
      approvedByUser = context?.approvedByUser;
    });
    const calls = [fc('shell', { command: 'git push' })];
    const plan = buildExecutionPlan(calls, registry);

    await executePlan(calls, plan, registry, undefined, undefined, {
      permissions: {
        shell: {
          autoApprove: false,
          allowPatterns: generateCommandPatterns('git push origin main'),
        },
      },
    });

    expect(approvedByUser).toBeUndefined();
  });

  it('bash 工具使用同一套命令记忆规则', async () => {
    let approvedByUser: boolean | undefined;
    const registry = createCommandRegistry('bash', (context) => {
      approvedByUser = context?.approvedByUser;
    });
    const calls = [fc('bash', { command: 'npm test' })];
    const plan = buildExecutionPlan(calls, registry);

    await executePlan(calls, plan, registry, undefined, undefined, {
      permissions: {
        bash: {
          autoApprove: false,
          allowPatterns: generateCommandPatterns('npm test'),
        },
      },
    });

    expect(approvedByUser).toBe(true);
  });
});
