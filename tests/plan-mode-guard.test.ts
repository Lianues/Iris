import { describe, expect, it } from 'vitest';
import { filterToolDeclarationsForPlanMode, isAllowedPlanModeTool } from '../src/plan-mode/guard';
import { planModePlugin } from '../src/plan-mode/plugin';

describe('Plan Mode guard', () => {
  it('允许只读 memory_search', () => {
    expect(isAllowedPlanModeTool('memory_search', { query: 'project decisions' })).toEqual({ allowed: true });
  });

  it('禁止写入类 memory 工具', () => {
    for (const toolName of ['memory_add', 'memory_update', 'memory_delete']) {
      const decision = isAllowedPlanModeTool(toolName, {});
      expect(decision.allowed).toBe(false);
      expect(decision.reason).toContain('memory_search');
    }
  });

  it('Plan Mode 工具声明保留 memory_search 但过滤 memory 写入工具', () => {
    const declarations = [
      { name: 'memory_search' },
      { name: 'memory_add' },
      { name: 'memory_update' },
      { name: 'memory_delete' },
      { name: 'read_file' },
    ];

    expect(filterToolDeclarationsForPlanMode(declarations).map(item => item.name)).toEqual([
      'memory_search',
      'read_file',
    ]);
  });

  it('EnterPlanMode 应自动执行，不触发 scheduler 层 Y/N 审批', () => {
    const registeredTools: Array<{ declaration: { name: string }; approvalMode?: string }> = [];
    const context = {
      registerTools(tools: typeof registeredTools) {
        registeredTools.push(...tools);
      },
      getServiceRegistry() {
        return { register: () => ({ dispose() {} }) };
      },
      addHook() {},
      trackDisposable() {},
    };

    planModePlugin.activate(context as any);

    const enterTool = registeredTools.find(tool => tool.declaration.name === 'EnterPlanMode');
    expect(enterTool?.approvalMode).toBe('handler');
  });
});
