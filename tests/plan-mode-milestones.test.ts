import { describe, expect, it } from 'vitest';
import { buildMilestonesFromApprovedPlan, extractPlanMilestoneCandidates } from '../src/plan-mode/milestones.js';

describe('Plan Mode milestone extraction', () => {
  it('优先从编号实施步骤生成 milestone', () => {
    const plan = `# 计划

## 背景
- 这是背景说明，不应进入进度面板

## 实施步骤
1. 接入后端状态管理
2. 补充 Console 进度面板
3. 运行测试并修复问题
`;

    const items = buildMilestonesFromApprovedPlan(plan, { owner: 'master', planFilePath: '/tmp/plan.md' });
    expect(items.map(item => item.title)).toEqual([
      '接入后端状态管理',
      '补充 Console 进度面板',
      '运行测试并修复问题',
    ]);
    expect(items[0]).toMatchObject({ id: 'm1', status: 'pending', owner: 'master' });
    expect((items[0].metadata as any).origin).toBe('plan_mode');
    expect((items[0].metadata as any).planFilePath).toBe('/tmp/plan.md');
  });

  it('支持 Markdown task list，并跳过代码块', () => {
    const plan = `## Tasks
- [ ] 修改工具描述
- [x] 验证类型检查

\`\`\`
- [ ] 这里是代码示例，不应进入
\`\`\`
`;
    const candidates = extractPlanMilestoneCandidates(plan);
    expect(candidates.map(item => item.text)).toEqual(['修改工具描述', '验证类型检查']);
  });


  it('跳过被动章节中的 task list 和编号列表', () => {
    const plan = `# 计划

## 背景
1. 当前已有会话级 milestone 面板
2. 这些是背景说明

## 验收标准
- [ ] 页面能展示进度
1. 测试通过

## 实施步骤
1. 修复权限校验
2. 运行回归测试
`;

    const candidates = extractPlanMilestoneCandidates(plan);
    expect(candidates.map(item => item.text)).toEqual(['修复权限校验', '运行回归测试']);
  });


  it('没有可解析步骤时生成兜底 milestone', () => {
    const items = buildMilestonesFromApprovedPlan('这是一段没有列表的短计划。');
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe('按批准计划执行');
  });
});
