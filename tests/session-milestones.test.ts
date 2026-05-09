import { describe, expect, it, vi } from 'vitest';
import { SessionMilestoneManager } from '../src/core/session-milestones.js';
import { CrossAgentTaskBoard } from '../src/core/cross-agent-task-board.js';
import { createUpdateMilestonesTool, createListMilestonesTool } from '../src/tools/internal/milestones.js';

describe('SessionMilestoneManager', () => {
  it('支持 replaceAll 初始化并计算统计', () => {
    const manager = new SessionMilestoneManager();
    const listener = vi.fn();
    manager.on('updated', listener);

    const snapshot = manager.update('s1', [
      { id: 'm1', title: '分析代码', status: 'completed' },
      { id: 'm2', title: '实现功能', status: 'in_progress', activeForm: '实现功能' },
      { id: 'm3', title: '运行测试', status: 'pending' },
    ], { sourceAgent: 'master', replaceAll: true });

    expect(snapshot.stats.total).toBe(3);
    expect(snapshot.stats.completed).toBe(1);
    expect(snapshot.stats.inProgress).toBe(1);
    expect(snapshot.stats.open).toBe(2);
    expect(snapshot.items[1].owner).toBe('master');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('默认增量合并，保留其他 Agent 的条目', () => {
    const manager = new SessionMilestoneManager();
    manager.update('s1', [
      { id: 'm1', title: '主 Agent 任务', status: 'in_progress', owner: 'master' },
      { id: 'm2', title: '研究任务', status: 'pending', owner: 'researcher' },
    ], { replaceAll: true });

    const snapshot = manager.update('s1', [
      { id: 'm2', title: '研究任务', status: 'completed' },
    ], { sourceAgent: 'researcher' });

    expect(snapshot.items).toHaveLength(2);
    expect(snapshot.items.find(i => i.id === 'm1')?.status).toBe('in_progress');
    expect(snapshot.items.find(i => i.id === 'm2')?.status).toBe('completed');
    expect(snapshot.items.find(i => i.id === 'm2')?.owner).toBe('researcher');
  });

  it('同 owner 启动新 in_progress 时自动收敛旧活跃项', () => {
    const manager = new SessionMilestoneManager();
    manager.update('s1', [
      { id: 'm1', title: '第一步', status: 'in_progress', owner: 'master' },
      { id: 'm2', title: '第二步', status: 'pending', owner: 'master' },
      { id: 'w1', title: 'Worker 并行项', status: 'in_progress', owner: 'worker' },
    ], { sourceAgent: 'master', routeAgent: 'master', replaceAll: true });

    const snapshot = manager.update('s1', [
      { id: 'm2', status: 'in_progress' },
    ], { sourceAgent: 'master', routeAgent: 'master' });

    expect(snapshot.items.find(i => i.id === 'm1')?.status).toBe('pending');
    expect(snapshot.items.find(i => i.id === 'm2')?.status).toBe('in_progress');
    expect(snapshot.items.find(i => i.id === 'w1')?.status).toBe('in_progress');
    expect(snapshot.stats.inProgress).toBe(2);
  });


  it('维护 milestone version，并在 expectedVersion 不匹配时拒绝更新', () => {
    const manager = new SessionMilestoneManager();
    const first = manager.update('s1', [
      { id: 'm1', title: '实现功能', status: 'in_progress' },
    ], { sourceAgent: 'master', routeAgent: 'master', replaceAll: true });

    expect(first.items[0].version).toBe(1);
    expect(first.items[0].updatedBy).toBe('master');

    const second = manager.update('s1', [
      { id: 'm1', status: 'completed', expectedVersion: 1 },
    ], { sourceAgent: 'master', routeAgent: 'master' });

    expect(second.items[0].status).toBe('completed');
    expect(second.items[0].version).toBe(2);

    expect(() => manager.update('s1', [
      { id: 'm1', status: 'blocked', expectedVersion: 1 },
    ], { sourceAgent: 'master', routeAgent: 'master' })).toThrow(/版本冲突/);

    expect(manager.getSnapshot('s1').items[0].status).toBe('completed');
    expect(manager.getSnapshot('s1').items[0].version).toBe(2);
  });

  it('阻止非 owner 的委派方直接覆盖 milestone，前台 routeAgent 可接管', () => {
    const manager = new SessionMilestoneManager();
    manager.update('s1', [{ id: 'm1', title: 'Worker 任务', status: 'pending', owner: 'worker' }], { sourceAgent: 'master', routeAgent: 'master', replaceAll: true });

    expect(() => manager.update('s1', [{ id: 'm1', status: 'completed' }], { sourceAgent: 'tester', routeAgent: 'master' })).toThrow(/无权/);
    const snapshot = manager.update('s1', [{ id: 'm1', status: 'completed' }], { sourceAgent: 'master', routeAgent: 'master' });
    expect(snapshot.items[0].status).toBe('completed');
    expect(snapshot.items[0].version).toBe(2);
  });

  it('拒绝通过伪造 routeAgent 绕过 owner 保护或 replaceAll 主清单', () => {
    const manager = new SessionMilestoneManager();
    manager.update('s1', [
      { id: 'm1', title: '主 Agent 任务', status: 'in_progress', owner: 'master' },
      { id: 'm2', title: 'Worker 任务', status: 'pending', owner: 'worker' },
    ], { sourceAgent: 'master', routeAgent: 'master', replaceAll: true });

    expect(() => manager.update('s1', [
      { id: 'm1', status: 'completed' },
    ], { sourceAgent: 'worker', routeAgent: 'worker' })).toThrow(/无权/);

    const afterReplaceAttempt = manager.update('s1', [
      { id: 'm3', title: '伪造替换', status: 'completed', owner: 'worker' },
    ], { sourceAgent: 'worker', routeAgent: 'worker', replaceAll: true });

    expect(afterReplaceAttempt.routeAgent).toBe('master');
    expect(afterReplaceAttempt.items.map(item => item.id)).toEqual(['m1', 'm2', 'm3']);
    expect(afterReplaceAttempt.items.find(item => item.id === 'm1')?.status).toBe('in_progress');
  });

  it('旧快照缺少 routeAgent 时仍不能让非 owner 伪造前台身份', () => {
    const manager = new SessionMilestoneManager();
    manager.update('legacy-session', [
      { id: 'm1', title: '旧版主任务', status: 'in_progress', owner: 'master' },
    ], { replaceAll: true });

    expect(manager.getSnapshot('legacy-session').routeAgent).toBeUndefined();
    expect(() => manager.update('legacy-session', [
      { id: 'm1', status: 'completed' },
    ], { sourceAgent: 'worker', routeAgent: 'worker' })).toThrow(/无权/);

    const afterReplaceAttempt = manager.update('legacy-session', [
      { id: 'm2', title: 'Worker 增量任务', status: 'completed', owner: 'worker' },
    ], { sourceAgent: 'worker', routeAgent: 'worker', replaceAll: true });

    expect(afterReplaceAttempt.routeAgent).toBeUndefined();
    expect(afterReplaceAttempt.items.map(item => item.id)).toEqual(['m1', 'm2']);
    expect(afterReplaceAttempt.items.find(item => item.id === 'm1')?.status).toBe('in_progress');
    expect(() => manager.update('legacy-session', [
      { id: 'm1', status: 'completed' },
    ], { sourceAgent: 'worker', routeAgent: 'worker' })).toThrow(/无权/);
  });




  it('为工具成功提示查找同 owner 的活跃 milestone', () => {
    const manager = new SessionMilestoneManager();
    manager.update('s1', [
      { id: 'm1', title: '主任务', status: 'in_progress', owner: 'master' },
      { id: 'm2', title: 'Worker 子任务', status: 'in_progress', owner: 'worker' },
    ], { sourceAgent: 'master', routeAgent: 'master', replaceAll: true });

    expect(manager.findActiveMilestoneForToolSync('s1', { sourceAgent: 'worker', routeAgent: 'master' })?.id).toBe('m2');
    expect(manager.findActiveMilestoneForToolSync('s1', { sourceAgent: 'master', routeAgent: 'master' })?.id).toBe('m1');
    expect(manager.findActiveMilestoneForToolSync('s1', { sourceAgent: 'tester', routeAgent: 'master' })).toBeUndefined();
  });

  it('工具失败时只阻塞同 owner 的进行中 milestone', () => {
    const manager = new SessionMilestoneManager();
    manager.update('s1', [
      { id: 'm1', title: '主任务', status: 'in_progress', owner: 'master' },
      { id: 'm2', title: '委派任务', status: 'in_progress', owner: 'worker' },
    ], { sourceAgent: 'master', routeAgent: 'master', replaceAll: true });

    const snapshot = manager.markActiveBlockedByToolFailure('s1', {
      toolId: 'tool-1',
      toolName: 'shell',
      error: 'exit code 1',
      sourceAgent: 'worker',
      routeAgent: 'master',
    })!;

    expect(snapshot.items.find(i => i.id === 'm1')?.status).toBe('in_progress');
    expect(snapshot.items.find(i => i.id === 'm2')?.status).toBe('blocked');
    expect(snapshot.items.find(i => i.id === 'm2')?.description).toContain('工具 shell 执行失败');
  });
});

describe('milestone tools', () => {
  it('update_milestones 和 list_milestones 使用当前 session', async () => {
    const manager = new SessionMilestoneManager();
    const deps = {
      manager,
      getSessionId: () => 's-tool',
      getAgentName: () => 'agent-a',
    };
    const updateTool = createUpdateMilestonesTool(deps);
    const listTool = createListMilestonesTool(deps);

    const result = await updateTool.handler({
      replaceAll: true,
      items: [{ id: 'm1', title: '接入 UI', status: 'in_progress' }],
    }) as any;

    expect(result.ok).toBe(true);
    expect(result.snapshot.items[0].owner).toBe('agent-a');

    const list = await listTool.handler({}) as any;
    expect(list.snapshot.sessionId).toBe('s-tool');
    expect(list.snapshot.items[0].title).toBe('接入 UI');
  });

  it('委派 Agent 的 milestone 更新会路由回发起方 session，并禁止 replaceAll 覆盖主清单', async () => {
    const manager = new SessionMilestoneManager();
    const taskBoard = new CrossAgentTaskBoard();
    const taskId = 'agent_task_test_1';

    manager.update('source-session', [
      { id: 'm0', title: '主 Agent 总清单', status: 'in_progress', owner: 'master' },
    ], { sourceAgent: 'master', routeAgent: 'master', replaceAll: true });

    taskBoard.register({
      taskId,
      sourceAgent: 'master',
      sourceSessionId: 'source-session',
      targetAgent: 'worker',
      type: 'delegate',
      description: '委派测试',
    });

    const updateTool = createUpdateMilestonesTool({
      manager,
      taskBoard,
      getSessionId: () => `cross-agent:master:${taskId}`,
      getAgentName: () => 'worker',
    });

    const result = await updateTool.handler({
      replaceAll: true,
      items: [{ id: 'm1', title: 'Worker 子任务', status: 'completed' }],
    }) as any;

    expect(result.snapshot.sessionId).toBe('source-session');
    expect(result.snapshot.routeAgent).toBe('master');
    expect(result.snapshot.sourceAgent).toBe('worker');
    expect(result.snapshot.items.map((item: any) => item.id)).toEqual(['m0', 'm1']);
    expect(result.snapshot.items.find((item: any) => item.id === 'm1')?.owner).toBe('worker');
    expect(manager.getSnapshot(`cross-agent:master:${taskId}`).items).toHaveLength(0);
  });
});
