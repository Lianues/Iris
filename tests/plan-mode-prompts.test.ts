import { describe, expect, it } from 'vitest';
import { buildPlanModeExitReminder, buildPlanModeInstructions } from '../src/plan-mode/prompts';

describe('Plan Mode prompts', () => {
  it('active instructions stay cache-friendly by avoiding session-specific state', () => {
    const instructions = buildPlanModeInstructions();

    expect(instructions).toContain('Plan Mode 已启用');
    expect(instructions).toContain('read_plan / write_plan');
    expect(instructions).toContain('计划文件由 Iris 管理');

    // 不把 session/cwd 派生的计划文件路径或 planExists 状态写入 system prompt，
    // 避免每个 session、每次计划写入状态变化都打碎 Claude system prompt cache。
    expect(instructions).not.toContain('.iris');
    expect(instructions).not.toContain('plans');
    expect(instructions).not.toContain('计划文件当前');
    expect(instructions).not.toContain('不存在或为空');
  });

  it('exit reminder avoids embedding the dynamic plan file path', () => {
    const reminder = buildPlanModeExitReminder();

    expect(reminder).toContain('已退出 Plan Mode');
    expect(reminder).toContain('用户已经批准当前 Agent 当前 session 的计划');
    expect(reminder).not.toContain('计划文件：');
    expect(reminder).not.toContain('.iris');
    expect(reminder).not.toContain('plans');
  });
});
