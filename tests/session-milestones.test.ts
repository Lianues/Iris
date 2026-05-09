import { describe, expect, it, vi } from 'vitest';
import { SessionMilestoneManager } from '../extensions/milestone/src/session.js';
import { CrossAgentTaskBoard } from '../src/core/cross-agent-task-board.js';
import { createMilestoneToolsForApi, MILESTONE_EXTENSION_SERVICE_ID } from '../extensions/milestone/src/index.js';

function createMilestoneTools(input: {
  manager: SessionMilestoneManager;
  sessionId: string;
  agentName?: string;
  taskBoard?: CrossAgentTaskBoard;
}) {
  const api = {
    services: { get: (id: string) => id === MILESTONE_EXTENSION_SERVICE_ID ? input.manager : undefined },
    backend: {
      getActiveSessionId: () => input.sessionId,
      on: () => api.backend,
      off: () => api.backend,
    },
    agentName: input.agentName,
    taskBoard: input.taskBoard,
    config: { tools: { permissions: {} } },
  } as any;
  const [updateTool, listTool] = createMilestoneToolsForApi(api);
  return { updateTool, listTool };
}

describe('SessionMilestoneManager', () => {
  it('支持 replaceAll 初始化并计算统计', () => {
    const manager = new SessionMilestoneManager();
    const listener = vi.fn();
    manager.on('updated', listener);

    const snapshot = manager.update('s1', [
      { title: '分析代码', status: 'completed' },
      { title: '实现功能', status: 'in_progress', activeForm: '实现功能' },
      { title: '运行测试', status: 'pending' },
    ], { replaceAll: true });

    expect(snapshot.stats.total).toBe(3);
    expect(snapshot.stats.completed).toBe(1);
    expect(snapshot.stats.inProgress).toBe(1);
    expect(snapshot.stats.open).toBe(2);
    expect(snapshot.items.map(item => item.title)).toEqual(['分析代码', '实现功能', '运行测试']);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('默认按 title 增量合并，保留未涉及条目', () => {
    const manager = new SessionMilestoneManager();
    manager.update('s1', [
      { title: '主线任务', status: 'in_progress' },
      { title: '研究任务', status: 'pending' },
    ], { replaceAll: true });

    const snapshot = manager.update('s1', [
      { title: '研究任务', status: 'completed' },
    ]);

    expect(snapshot.items).toHaveLength(2);
    expect(snapshot.items.find(i => i.title === '主线任务')?.status).toBe('in_progress');
    expect(snapshot.items.find(i => i.title === '研究任务')?.status).toBe('completed');
  });

  it('启动新 in_progress 时自动收敛旧活跃项', () => {
    const manager = new SessionMilestoneManager();
    manager.update('s1', [
      { title: '第一步', status: 'in_progress' },
      { title: '第二步', status: 'pending' },
      { title: '第三步', status: 'pending' },
    ], { replaceAll: true });

    const snapshot = manager.update('s1', [
      { title: '第二步', status: 'in_progress' },
    ]);

    expect(snapshot.items.find(i => i.title === '第一步')?.status).toBe('pending');
    expect(snapshot.items.find(i => i.title === '第二步')?.status).toBe('in_progress');
    expect(snapshot.items.find(i => i.title === '第三步')?.status).toBe('pending');
    expect(snapshot.stats.inProgress).toBe(1);
  });

  it('不再维护并发版本字段', () => {
    const manager = new SessionMilestoneManager();
    const first = manager.update('s1', [
      { title: '实现功能', status: 'in_progress' },
    ], { replaceAll: true });

    expect((first.items[0] as any).version).toBeUndefined();

    const second = manager.update('s1', [
      { title: '实现功能', status: 'completed' },
    ]);

    expect(second.items[0].status).toBe('completed');
    expect((second.items[0] as any).version).toBeUndefined();
  });

  it('内部仍可保留 metadata 扩展字段', () => {
    const manager = new SessionMilestoneManager();
    const snapshot = manager.update('s1', [
      { title: '主任务', status: 'in_progress', metadata: { origin: 'test' } } as any,
    ], { replaceAll: true });

    const active = snapshot.items.find(i => i.title === '主任务')!;
    expect(active.status).toBe('in_progress');
    expect((active.metadata as any)?.origin).toBe('test');
  });

  it('工具失败联动仍可写入内部 metadata，但不会阻塞任务', () => {
    const manager = new SessionMilestoneManager();
    manager.update('s1', [
      { title: '主任务', status: 'in_progress' },
      { title: '待办任务', status: 'pending' },
    ], { replaceAll: true });

    const snapshot = manager.noteActiveToolFailure('s1', {
      toolId: 'tool-1',
      toolName: 'shell',
      error: 'exit code 1',
    })!;

    const active = snapshot.items.find(i => i.title === '主任务')!;
    expect(active.status).toBe('in_progress');
    expect((active.metadata?.toolSync as any)?.kind).toBe('tool_error_note');
    expect((active.metadata?.toolSync as any)?.toolName).toBe('shell');
    expect(Array.isArray(active.metadata?.toolErrors)).toBe(true);
  });
});

describe('milestone tools', () => {
  it('update_milestones 和 list_milestones 使用当前 session', async () => {
    const manager = new SessionMilestoneManager();
    const { updateTool, listTool } = createMilestoneTools({
      manager,
      sessionId: 's-tool',
      agentName: 'agent-a',
    });

    const result = await updateTool.handler({
      replaceAll: true,
      items: [{ title: '接入 UI', status: 'in_progress', metadata: { from: 'ai' } }],
    }) as any;

    expect(result.ok).toBe(true);
    expect(result.snapshot.items[0].title).toBe('接入 UI');
    expect(result.snapshot.items[0].version).toBeUndefined();
    expect(result.snapshot.items[0].metadata).toBeUndefined();
    expect(manager.getSnapshot('s-tool').items[0].metadata).toBeUndefined();

    const schemaProps = ((updateTool.declaration.parameters as any).properties.items.items as any).properties;
    expect(schemaProps.metadata).toBeUndefined();

    const list = await listTool.handler({}) as any;
    expect(list.snapshot.sessionId).toBe('s-tool');
    expect(list.snapshot.items[0].title).toBe('接入 UI');
    expect(list.snapshot.items[0].metadata).toBeUndefined();
  });

  it('委派 Agent 的 milestone 更新会路由回发起方 session', async () => {
    const manager = new SessionMilestoneManager();
    const taskBoard = new CrossAgentTaskBoard();
    const taskId = 'agent_task_test_1';

    manager.update('source-session', [
      { title: '主 Agent 总清单', status: 'in_progress' },
    ], { replaceAll: true });

    taskBoard.register({
      taskId,
      sourceAgent: 'master',
      sourceSessionId: 'source-session',
      targetAgent: 'worker',
      type: 'delegate',
      description: '委派测试',
    });

    const { updateTool } = createMilestoneTools({
      manager,
      taskBoard,
      sessionId: `cross-agent:master:${taskId}`,
      agentName: 'worker',
    });

    const result = await updateTool.handler({
      items: [{ title: 'Worker 子任务', status: 'completed' }],
    }) as any;

    expect(result.snapshot.sessionId).toBe('source-session');
    expect(result.snapshot.sourceAgent).toBeUndefined();
    expect(result.snapshot.routeAgent).toBeUndefined();
    expect(result.snapshot.items.map((item: any) => item.title)).toEqual(['主 Agent 总清单', 'Worker 子任务']);
    expect(manager.getSnapshot(`cross-agent:master:${taskId}`).items).toHaveLength(0);
  });
});
