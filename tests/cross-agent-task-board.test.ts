/**
 * CrossAgentTaskBoard 单元测试
 *
 * 全局单例任务板，统一管理 sub_agent 异步任务和 delegate_to_agent 跨 Agent 委派任务。
 * 替代原有的 per-Agent AgentTaskRegistry。
 *
 * 覆盖：
 *   - 基础生命周期：register → complete / fail / kill
 *   - Backend 注册与通知路由：complete/fail 自动构建 XML 并推送到 sourceAgent 的 backend
 *   - 任务类型区分：sub_agent vs delegate
 *   - 查询能力：query() 返回实时状态快照，含 isStreaming 判定
 *   - 并发限制：按 sourceSessionId 和 targetAgent 两个维度独立计数
 *   - clearSession 隔离：只中止以该 session 为 source 的任务
 *   - 事件发射：registered/completed/failed/killed/token-update/chunk-heartbeat
 *   - 幂等性：终态任务不可再次变更
 *   - 边界情况：不存在的 taskId、未注册的 backend
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// 从实现文件导入公共 API
import {
  CrossAgentTaskBoard,
  createTaskId,
  formatDuration,
  type TaskRecord,
  type TaskType,
} from '../src/core/cross-agent-task-board.js';

/**
 * 创建一个最小化的 mock backend，
 * 只需要 enqueueAgentNotification 方法供 board 推送通知。
 */
function createMockBackend() {
  return {
    enqueueAgentNotification: vi.fn(),
  };
}

describe('CrossAgentTaskBoard', () => {
  let board: CrossAgentTaskBoard;
  let backendA: ReturnType<typeof createMockBackend>;
  let backendB: ReturnType<typeof createMockBackend>;

  beforeEach(() => {
    board = new CrossAgentTaskBoard();
    backendA = createMockBackend();
    backendB = createMockBackend();
    // 注册两个 Agent 的 backend
    board.registerBackend('agent-a', backendA as any);
    board.registerBackend('agent-b', backendB as any);
  });

  // ========================================
  // 1. 基础生命周期
  // ========================================

  describe('基础生命周期', () => {
    it('register 创建 running 状态的任务并含 AbortController', () => {
      const task = board.register({
        taskId: 'task-1',
        sourceAgent: 'agent-a',
        sourceSessionId: 'session-1',
        targetAgent: 'agent-b',
        type: 'delegate',
        description: '测试委派任务',
      });

      expect(task.taskId).toBe('task-1');
      expect(task.sourceAgent).toBe('agent-a');
      expect(task.sourceSessionId).toBe('session-1');
      expect(task.targetAgent).toBe('agent-b');
      expect(task.type).toBe('delegate');
      expect(task.status).toBe('running');
      expect(task.description).toBe('测试委派任务');
      expect(task.abortController).toBeInstanceOf(AbortController);
      expect(task.startTime).toBeGreaterThan(0);
      expect(task.endTime).toBeUndefined();
    });

    it('complete 将状态切为 completed 并记录结果', () => {
      board.register({
        taskId: 'task-1',
        sourceAgent: 'agent-a',
        sourceSessionId: 'session-1',
        targetAgent: 'agent-b',
        type: 'delegate',
        description: '测试',
      });

      board.complete('task-1', '执行结果');

      const task = board.get('task-1')!;
      expect(task.status).toBe('completed');
      expect(task.result).toBe('执行结果');
      expect(task.abortController).toBeUndefined();
      expect(task.endTime).toBeGreaterThan(0);
    });

    it('fail 将状态切为 failed 并记录错误信息', () => {
      board.register({
        taskId: 'task-1',
        sourceAgent: 'agent-a',
        sourceSessionId: 'session-1',
        targetAgent: 'agent-a',
        type: 'sub_agent',
        description: '测试',
      });

      board.fail('task-1', 'LLM 调用超时');

      const task = board.get('task-1')!;
      expect(task.status).toBe('failed');
      expect(task.error).toBe('LLM 调用超时');
      expect(task.abortController).toBeUndefined();
      expect(task.endTime).toBeGreaterThan(0);
    });

    it('kill 触发 abort 信号并切为 killed', () => {
      const task = board.register({
        taskId: 'task-1',
        sourceAgent: 'agent-a',
        sourceSessionId: 'session-1',
        targetAgent: 'agent-b',
        type: 'delegate',
        description: '测试',
      });
      const abortSpy = vi.spyOn(task.abortController!, 'abort');

      board.kill('task-1');

      expect(abortSpy).toHaveBeenCalledTimes(1);
      const updated = board.get('task-1')!;
      expect(updated.status).toBe('killed');
      expect(updated.abortController).toBeUndefined();
      expect(updated.endTime).toBeGreaterThan(0);
    });
  });

  // ========================================
  // 2. 幂等性：终态不可再次变更
  // ========================================

  describe('幂等性', () => {
    it('已 completed 的任务不能再次 fail/kill/complete', () => {
      board.register({
        taskId: 'task-1',
        sourceAgent: 'agent-a',
        sourceSessionId: 'session-1',
        targetAgent: 'agent-a',
        type: 'sub_agent',
        description: '测试',
      });
      board.complete('task-1', 'done');

      // 再次操作均为空操作
      board.fail('task-1', 'error');
      expect(board.get('task-1')!.status).toBe('completed');
      expect(board.get('task-1')!.error).toBeUndefined();

      board.kill('task-1');
      expect(board.get('task-1')!.status).toBe('completed');

      board.complete('task-1', 'new result');
      expect(board.get('task-1')!.result).toBe('done');
    });

    it('对不存在的 taskId 调用 complete/fail/kill 不报错', () => {
      // 不应抛出异常
      board.complete('nonexistent', 'result');
      board.fail('nonexistent', 'error');
      board.kill('nonexistent');
    });
  });

  // ========================================
  // 3. 通知路由：complete/fail 自动推送到 sourceAgent 的 backend
  // ========================================

  describe('通知路由', () => {
    it('complete 时自动构建通知并推送到 sourceAgent 的 backend', () => {
      board.register({
        taskId: 'task-1',
        sourceAgent: 'agent-a',
        sourceSessionId: 'session-1',
        targetAgent: 'agent-b',
        type: 'delegate',
        description: '帮我跑测试',
      });

      board.complete('task-1', '全部通过');

      // 通知应推送到 agent-a（sourceAgent）的 backend
      expect(backendA.enqueueAgentNotification).toHaveBeenCalledTimes(1);
      // 推送到 sourceSessionId
      expect(backendA.enqueueAgentNotification).toHaveBeenCalledWith(
        'session-1',
        expect.stringContaining('task-notification'),
      );
      // 通知 XML 应包含关键信息
      const xml = backendA.enqueueAgentNotification.mock.calls[0][1] as string;
      expect(xml).toContain('task-1');        // taskId
      expect(xml).toContain('<type>delegate</type>');     // 任务类型
      expect(xml).toContain('<executor>agent-b</executor>'); // 执行方
      expect(xml).toContain('completed');      // status
      expect(xml).toContain('全部通过');       // result
      expect(xml).toContain('帮我跑测试');     // description/summary

      // agent-b 的 backend 不应收到通知（它是执行方不是发起方）
      expect(backendB.enqueueAgentNotification).not.toHaveBeenCalled();
    });

    it('fail 时自动推送失败通知到 sourceAgent', () => {
      board.register({
        taskId: 'task-2',
        sourceAgent: 'agent-a',
        sourceSessionId: 'session-2',
        targetAgent: 'agent-b',
        type: 'delegate',
        description: '编译项目',
      });

      board.fail('task-2', '编译错误: 语法不合法');

      expect(backendA.enqueueAgentNotification).toHaveBeenCalledTimes(1);
      const xml = backendA.enqueueAgentNotification.mock.calls[0][1] as string;
      expect(xml).toContain('failed');
      expect(xml).toContain('编译错误: 语法不合法');
    });

    it('kill 时推送 killed 通知到 sourceAgent', () => {
      board.register({
        taskId: 'task-3',
        sourceAgent: 'agent-a',
        sourceSessionId: 'session-3',
        targetAgent: 'agent-b',
        type: 'delegate',
        description: '长时间任务',
      });

      board.kill('task-3');

      expect(backendA.enqueueAgentNotification).toHaveBeenCalledTimes(1);
      const xml = backendA.enqueueAgentNotification.mock.calls[0][1] as string;
      expect(xml).toContain('killed');
    });

    it('sub_agent 任务 complete 时通知也推到 sourceAgent', () => {
      // sub_agent 的 sourceAgent 和 targetAgent 相同
      board.register({
        taskId: 'task-4',
        sourceAgent: 'agent-a',
        sourceSessionId: 'session-4',
        targetAgent: 'agent-a',
        type: 'sub_agent',
        description: '子代理任务',
      });

      board.complete('task-4', '子代理结果');

      // 通知推到 agent-a 自己
      expect(backendA.enqueueAgentNotification).toHaveBeenCalledTimes(1);
      expect(backendA.enqueueAgentNotification).toHaveBeenCalledWith(
        'session-4',
        expect.stringContaining('子代理结果'),
      );
    });

    it('sourceAgent 的 backend 未注册时 complete 不抛异常', () => {
      // 创建一个新 board，不注册任何 backend
      const emptyBoard = new CrossAgentTaskBoard();
      emptyBoard.register({
        taskId: 'task-orphan',
        sourceAgent: 'agent-unknown',
        sourceSessionId: 'session-x',
        targetAgent: 'agent-unknown',
        type: 'sub_agent',
        description: '孤儿任务',
      });

      // 不应抛异常，只是通知发不出去
      expect(() => emptyBoard.complete('task-orphan', 'result')).not.toThrow();
    });
  });

  // ========================================
  // 4. 通知 XML 应包含运行时长和 token 消耗
  // ========================================

  describe('通知 XML 包含运行时指标', () => {
    it('通知 XML 包含人类可读的 duration', () => {
      board.register({
        taskId: 'task-dur',
        sourceAgent: 'agent-a',
        sourceSessionId: 'session-1',
        targetAgent: 'agent-b',
        type: 'delegate',
        description: '测试时长',
      });

      // 模拟一点耗时
      board.complete('task-dur', 'ok');

      const xml = backendA.enqueueAgentNotification.mock.calls[0][1] as string;
      // 耗时很短，应该是 "0s" 格式
      expect(xml).toMatch(/<duration>\d+s<\/duration>/);
    });

    it('通知 XML 包含 token 消耗（如果有）', () => {
      board.register({
        taskId: 'task-tok',
        sourceAgent: 'agent-a',
        sourceSessionId: 'session-1',
        targetAgent: 'agent-b',
        type: 'delegate',
        description: '测试 token',
      });

      board.updateTokens('task-tok', 1500);
      board.complete('task-tok', 'ok');

      const xml = backendA.enqueueAgentNotification.mock.calls[0][1] as string;
      expect(xml).toContain('1500');
    });
  });

  // ========================================
  // 5. query() 查询
  // ========================================

  describe('query 实时状态查询', () => {
    it('query 返回 running 任务的状态快照', () => {
      board.register({
        taskId: 'task-q1',
        sourceAgent: 'agent-a',
        sourceSessionId: 'session-1',
        targetAgent: 'agent-b',
        type: 'delegate',
        description: '查询测试',
      });

      const snapshot = board.query('task-q1');
      expect(snapshot).toBeDefined();
      expect(snapshot!.taskId).toBe('task-q1');
      expect(snapshot!.targetAgent).toBe('agent-b');
      expect(snapshot!.status).toBe('running');
      expect(snapshot!.isStreaming).toBe(false);  // 没有 chunk heartbeat
      expect(snapshot!.durationMs).toBeGreaterThanOrEqual(0);
      expect(snapshot!.totalTokens).toBe(0);
      expect(snapshot!.error).toBeUndefined();
      expect(snapshot!.description).toBe('查询测试');
    });

    it('query 对不存在的 taskId 返回 undefined', () => {
      expect(board.query('nonexistent')).toBeUndefined();
    });

    it('query 的 isStreaming 在有近期 chunk heartbeat 时为 true', () => {
      board.register({
        taskId: 'task-stream',
        sourceAgent: 'agent-a',
        sourceSessionId: 'session-1',
        targetAgent: 'agent-b',
        type: 'delegate',
        description: '流式测试',
      });

      // 发送 chunk heartbeat
      board.emitChunkHeartbeat('task-stream');

      const snapshot = board.query('task-stream');
      expect(snapshot!.isStreaming).toBe(true);
    });

    it('query 的 isStreaming 在 heartbeat 过期后为 false', () => {
      board.register({
        taskId: 'task-stale',
        sourceAgent: 'agent-a',
        sourceSessionId: 'session-1',
        targetAgent: 'agent-b',
        type: 'delegate',
        description: '过期测试',
      });

      // 手动设置 lastChunkTime 为 5 秒前（模拟过期）
      const task = board.get('task-stale')!;
      (task as any).lastChunkTime = Date.now() - 5000;

      const snapshot = board.query('task-stale');
      expect(snapshot!.isStreaming).toBe(false);
    });

    it('query 返回已完成任务的总运行时长', () => {
      board.register({
        taskId: 'task-done',
        sourceAgent: 'agent-a',
        sourceSessionId: 'session-1',
        targetAgent: 'agent-a',
        type: 'sub_agent',
        description: '完成任务',
      });
      board.complete('task-done', 'ok');

      const snapshot = board.query('task-done');
      expect(snapshot!.status).toBe('completed');
      expect(snapshot!.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('query 返回 token 计数', () => {
      board.register({
        taskId: 'task-tokens',
        sourceAgent: 'agent-a',
        sourceSessionId: 'session-1',
        targetAgent: 'agent-b',
        type: 'delegate',
        description: 'token 测试',
      });
      board.updateTokens('task-tokens', 2000);

      const snapshot = board.query('task-tokens');
      expect(snapshot!.totalTokens).toBe(2000);
    });
  });

  // ========================================
  // 6. 并发限制：双维度独立计数
  // ========================================

  describe('并发限制', () => {
    it('getRunningBySourceSession 按 sourceSessionId 计数', () => {
      board.register({
        taskId: 't1', sourceAgent: 'agent-a', sourceSessionId: 'session-1',
        targetAgent: 'agent-a', type: 'sub_agent', description: '1',
      });
      board.register({
        taskId: 't2', sourceAgent: 'agent-a', sourceSessionId: 'session-1',
        targetAgent: 'agent-b', type: 'delegate', description: '2',
      });
      board.register({
        taskId: 't3', sourceAgent: 'agent-b', sourceSessionId: 'session-2',
        targetAgent: 'agent-a', type: 'delegate', description: '3',
      });

      // session-1 有 2 个 running 任务
      expect(board.getRunningBySourceSession('session-1')).toHaveLength(2);
      // session-2 有 1 个
      expect(board.getRunningBySourceSession('session-2')).toHaveLength(1);
      // 不存在的 session
      expect(board.getRunningBySourceSession('session-x')).toHaveLength(0);
    });

    it('getRunningByTargetAgent 按 targetAgent 计数', () => {
      board.register({
        taskId: 't1', sourceAgent: 'agent-a', sourceSessionId: 'session-1',
        targetAgent: 'agent-b', type: 'delegate', description: '1',
      });
      board.register({
        taskId: 't2', sourceAgent: 'agent-a', sourceSessionId: 'session-2',
        targetAgent: 'agent-b', type: 'delegate', description: '2',
      });
      board.register({
        taskId: 't3', sourceAgent: 'agent-b', sourceSessionId: 'session-3',
        targetAgent: 'agent-a', type: 'delegate', description: '3',
      });

      // agent-b 作为 target 有 2 个 running
      expect(board.getRunningByTargetAgent('agent-b')).toHaveLength(2);
      // agent-a 作为 target 有 1 个
      expect(board.getRunningByTargetAgent('agent-a')).toHaveLength(1);
    });

    it('完成的任务不计入 running 计数', () => {
      board.register({
        taskId: 't1', sourceAgent: 'agent-a', sourceSessionId: 'session-1',
        targetAgent: 'agent-b', type: 'delegate', description: '1',
      });
      board.register({
        taskId: 't2', sourceAgent: 'agent-a', sourceSessionId: 'session-1',
        targetAgent: 'agent-b', type: 'delegate', description: '2',
      });
      board.complete('t1', 'done');

      expect(board.getRunningBySourceSession('session-1')).toHaveLength(1);
      expect(board.getRunningByTargetAgent('agent-b')).toHaveLength(1);
    });
  });

  // ========================================
  // 7. killAllBySourceSession：clearSession 隔离
  // ========================================

  describe('killAllBySourceSession', () => {
    it('只中止以该 session 为 source 的 running 任务', () => {
      const t1 = board.register({
        taskId: 't1', sourceAgent: 'agent-a', sourceSessionId: 'session-1',
        targetAgent: 'agent-b', type: 'delegate', description: '1',
      });
      board.register({
        taskId: 't2', sourceAgent: 'agent-a', sourceSessionId: 'session-1',
        targetAgent: 'agent-a', type: 'sub_agent', description: '2',
      });
      board.register({
        taskId: 't3', sourceAgent: 'agent-b', sourceSessionId: 'session-2',
        targetAgent: 'agent-a', type: 'delegate', description: '3',
      });
      // t1 先完成
      board.complete('t1', 'done');

      board.killAllBySourceSession('session-1');

      // t1 已 completed，不受影响
      expect(board.get('t1')!.status).toBe('completed');
      // t2 被 killed
      expect(board.get('t2')!.status).toBe('killed');
      // t3 属于 session-2，不受影响
      expect(board.get('t3')!.status).toBe('running');
    });

    it('kill 时触发 abort signal', () => {
      const task = board.register({
        taskId: 't-abort', sourceAgent: 'agent-a', sourceSessionId: 'session-1',
        targetAgent: 'agent-b', type: 'delegate', description: 'abort 测试',
      });
      const abortSpy = vi.spyOn(task.abortController!, 'abort');

      board.killAllBySourceSession('session-1');

      expect(abortSpy).toHaveBeenCalledTimes(1);
    });
  });

  // ========================================
  // 8. updateTokens 和 emitChunkHeartbeat
  // ========================================

  describe('实时更新', () => {
    it('updateTokens 更新 totalTokens', () => {
      board.register({
        taskId: 't-tok', sourceAgent: 'agent-a', sourceSessionId: 'session-1',
        targetAgent: 'agent-b', type: 'delegate', description: 'token',
      });

      board.updateTokens('t-tok', 500);
      expect(board.get('t-tok')!.totalTokens).toBe(500);

      board.updateTokens('t-tok', 1200);
      expect(board.get('t-tok')!.totalTokens).toBe(1200);
    });

    it('updateTokens 对非 running 任务是空操作', () => {
      board.register({
        taskId: 't-tok2', sourceAgent: 'agent-a', sourceSessionId: 'session-1',
        targetAgent: 'agent-a', type: 'sub_agent', description: 'token',
      });
      board.complete('t-tok2', 'done');
      board.updateTokens('t-tok2', 9999);

      // totalTokens 不应被更新（保持 complete 时的值）
      expect(board.get('t-tok2')!.totalTokens).not.toBe(9999);
    });

    it('emitChunkHeartbeat 更新 lastChunkTime', () => {
      board.register({
        taskId: 't-hb', sourceAgent: 'agent-a', sourceSessionId: 'session-1',
        targetAgent: 'agent-b', type: 'delegate', description: 'heartbeat',
      });

      const before = Date.now();
      board.emitChunkHeartbeat('t-hb');
      const after = Date.now();

      const task = board.get('t-hb')!;
      expect(task.lastChunkTime).toBeGreaterThanOrEqual(before);
      expect(task.lastChunkTime).toBeLessThanOrEqual(after);
    });
  });

  // ========================================
  // 9. 事件发射
  // ========================================

  describe('事件', () => {
    it('register/complete/fail/kill 分别 emit 对应事件', () => {
      const registered = vi.fn();
      const completed = vi.fn();
      const failed = vi.fn();
      const killed = vi.fn();

      board.on('registered', registered);
      board.on('completed', completed);
      board.on('failed', failed);
      board.on('killed', killed);

      board.register({
        taskId: 't1', sourceAgent: 'agent-a', sourceSessionId: 's1',
        targetAgent: 'agent-a', type: 'sub_agent', description: 'd1',
      });
      expect(registered).toHaveBeenCalledTimes(1);

      board.register({
        taskId: 't2', sourceAgent: 'agent-a', sourceSessionId: 's1',
        targetAgent: 'agent-b', type: 'delegate', description: 'd2',
      });
      board.register({
        taskId: 't3', sourceAgent: 'agent-a', sourceSessionId: 's1',
        targetAgent: 'agent-a', type: 'sub_agent', description: 'd3',
      });

      board.complete('t1', 'ok');
      expect(completed).toHaveBeenCalledTimes(1);

      board.fail('t2', 'err');
      expect(failed).toHaveBeenCalledTimes(1);

      board.kill('t3');
      expect(killed).toHaveBeenCalledTimes(1);
    });

    it('token-update 事件在 updateTokens 时触发', () => {
      const tokenUpdate = vi.fn();
      board.on('token-update', tokenUpdate);

      board.register({
        taskId: 't-ev', sourceAgent: 'agent-a', sourceSessionId: 's1',
        targetAgent: 'agent-b', type: 'delegate', description: 'ev',
      });
      board.updateTokens('t-ev', 100);

      expect(tokenUpdate).toHaveBeenCalledTimes(1);
      expect(tokenUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: 't-ev', totalTokens: 100 }),
      );
    });

    it('chunk-heartbeat 事件在 emitChunkHeartbeat 时触发', () => {
      const heartbeat = vi.fn();
      board.on('chunk-heartbeat', heartbeat);

      board.register({
        taskId: 't-hb-ev', sourceAgent: 'agent-a', sourceSessionId: 's1',
        targetAgent: 'agent-b', type: 'delegate', description: 'hb',
      });
      board.emitChunkHeartbeat('t-hb-ev');

      expect(heartbeat).toHaveBeenCalledTimes(1);
    });
  });

  // ========================================
  // 10. clearCompleted
  // ========================================

  describe('clearCompleted', () => {
    it('只删除非 running 的记录', () => {
      board.register({
        taskId: 't1', sourceAgent: 'agent-a', sourceSessionId: 's1',
        targetAgent: 'agent-a', type: 'sub_agent', description: '1',
      });
      board.register({
        taskId: 't2', sourceAgent: 'agent-a', sourceSessionId: 's1',
        targetAgent: 'agent-b', type: 'delegate', description: '2',
      });
      board.register({
        taskId: 't3', sourceAgent: 'agent-a', sourceSessionId: 's1',
        targetAgent: 'agent-a', type: 'sub_agent', description: '3',
      });
      board.complete('t1', 'done');
      board.fail('t2', 'error');
      // t3 仍为 running

      const count = board.clearCompleted();

      expect(count).toBe(2);
      expect(board.get('t1')).toBeUndefined();
      expect(board.get('t2')).toBeUndefined();
      expect(board.get('t3')).toBeDefined();
      expect(board.get('t3')!.status).toBe('running');
      expect(board.size).toBe(1);
    });
  });

  // ========================================
  // 11. createTaskId
  // ========================================

  describe('createTaskId', () => {
    it('生成唯一的任务 ID', () => {
      const id1 = createTaskId();
      const id2 = createTaskId();
      expect(id1).not.toBe(id2);
      expect(id1).toMatch(/^agent_task_/);
    });
  });

  // ========================================
  // 12. Backend 注册
  // ========================================

  describe('registerBackend', () => {
    it('覆盖注册同名 backend 不报错', () => {
      const newBackend = createMockBackend();
      board.registerBackend('agent-a', newBackend as any);

      board.register({
        taskId: 't-override', sourceAgent: 'agent-a', sourceSessionId: 's1',
        targetAgent: 'agent-b', type: 'delegate', description: '覆盖测试',
      });
      board.complete('t-override', 'ok');

      // 通知应该发到新的 backend
      expect(newBackend.enqueueAgentNotification).toHaveBeenCalledTimes(1);
      // 旧 backend 不应收到
      expect(backendA.enqueueAgentNotification).not.toHaveBeenCalled();
    });
  });

  // ========================================
  // 13. formatDuration 时长格式化
  // ========================================

  describe('formatDuration', () => {
    it('不足 1 秒 → "0s"', () => {
      // 500ms 四舍五入为 1s，用 499ms 测试 0s
      expect(formatDuration(499)).toBe('0s');
    });

    it('纯秒 → "5s"', () => {
      expect(formatDuration(5000)).toBe('5s');
    });

    it('分+秒 → "1m05s"', () => {
      expect(formatDuration(65000)).toBe('1m05s');
    });

    it('时+分+秒 → "1h01m01s"', () => {
      expect(formatDuration(3661000)).toBe('1h01m01s');
    });

    it('天+时+分+秒 → "1d01h01m01s"', () => {
      expect(formatDuration(90061000)).toBe('1d01h01m01s');
    });

    it('整分钟无秒 → "2m00s"', () => {
      expect(formatDuration(120000)).toBe('2m00s');
    });
  });
});
