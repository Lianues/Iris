/**
 * CrossAgentTaskBoard — 全局任务板
 *
 * 统一管理所有异步后台任务（sub_agent 异步任务 + delegate_to_agent 跨 Agent 委派任务）。
 * 替代原有的 per-Agent AgentTaskRegistry。
 *
 * 核心职责：
 *   1. 任务生命周期管理（register / complete / fail / kill）
 *   2. 通知路由：任务完成/失败/中止时，自动构建 XML 通知并推送到 sourceAgent 的 backend
 *   3. 实时状态查询（query）供 query_delegated_task 工具使用
 *   4. 双维度并发计数（sourceSession / targetAgent）
 *   5. 事件发射（供 Backend 层转发给平台层）
 *
 * 设计动机：
 *   原有架构中每个 Agent 各有一个 AgentTaskRegistry 实例。
 *   引入跨 Agent 委派后出现三个结构性错位：
 *     - 生命周期归属错位：任务注册在 A 的 registry，执行在 B 的 backend
 *     - 并发计数语义错位：保护本 Agent 和保护目标 Agent 混在一个计数器
 *     - 事件路由含糊：跨 backend 事件桥接缺失
 *   全局任务板一次性解决这三个问题。
 */

import { EventEmitter } from 'events';
import { createLogger } from '../logger';

const logger = createLogger('CrossAgentTaskBoard');

// ---- 类型定义 ----

/** 任务类型：sub_agent 异步任务 / delegate 跨 Agent 委派 */
export type TaskType = 'sub_agent' | 'delegate';

/** 任务状态 */
export type TaskStatus = 'running' | 'completed' | 'failed' | 'killed';

/** 任务记录 */
export interface TaskRecord {
  taskId: string;
  /** 发起方 Agent 名称 */
  sourceAgent: string;
  /** 发起方的会话 ID（通知推回此会话） */
  sourceSessionId: string;
  /** 任务类型 */
  type: TaskType;
  /** 目标 Agent 名称（sub_agent 时与 sourceAgent 相同） */
  targetAgent: string;
  /** 当前状态 */
  status: TaskStatus;
  /** 任务描述 */
  description: string;
  /** 启动时间戳 */
  startTime: number;
  /** 结束时间戳（终态时设置） */
  endTime?: number;
  /** 累计 token 消耗 */
  totalTokens?: number;
  /** 最后一次 chunk 心跳时间戳（用于 isStreaming 判定） */
  lastChunkTime?: number;
  /** 执行结果（completed 时有值） */
  result?: string;
  /** 错误信息（failed 时有值） */
  error?: string;
  /** 中止控制器（仅 running 状态有效） */
  abortController?: AbortController;
}

/** register() 的输入参数（不含运行时自动生成的字段） */
export interface RegisterTaskInput {
  taskId: string;
  sourceAgent: string;
  sourceSessionId: string;
  targetAgent: string;
  type: TaskType;
  description: string;
}

/** query() 返回的状态快照（不暴露 abortController 等内部对象） */
export interface TaskSnapshot {
  taskId: string;
  targetAgent: string;
  status: TaskStatus;
  /** 最近 3 秒内有 chunk 心跳 → true */
  isStreaming: boolean;
  /** 已运行时长（running）或总运行时长（终态） */
  durationMs: number;
  totalTokens: number;
  error?: string;
  description: string;
}

// ---- 任务 ID 生成 ----

/** 任务 ID 生成计数器 */
let taskCounter = 0;

/** 生成唯一任务 ID */
export function createTaskId(): string {
  return `agent_task_${++taskCounter}_${Date.now()}`;
}

// ---- isStreaming 判定阈值 ----

/** chunk 心跳超时时间（毫秒），超过此时间未收到心跳则认为不在流式输出 */
const STREAMING_HEARTBEAT_TIMEOUT_MS = 3000;

// ---- 通知 XML 构建 ----

/**
 * 将毫秒转换为人类可读的时长格式。
 * 省略为 0 的高位段，保留至少秒级。
 * 例：
 *   1234     → "1s"
 *   65000    → "1m05s"
 *   3661000  → "1h01m01s"
 *   90061000 → "1d01h01m01s"
 */
/** @internal 导出供测试使用 */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0 || parts.length > 0) parts.push(`${parts.length > 0 ? String(hours).padStart(2, '0') : hours}h`);
  if (minutes > 0 || parts.length > 0) parts.push(`${parts.length > 0 ? String(minutes).padStart(2, '0') : minutes}m`);
  parts.push(`${parts.length > 0 ? String(seconds).padStart(2, '0') : seconds}s`);
  return parts.join('');
}

/**
 * 构建 task-notification XML 文本。
 * 与原 sub_agent 中的 buildNotificationXML 相同的格式，
 * 保持 LLM 侧解析的兼容性。
 */
function buildNotificationXML(opts: {
  taskId: string;
  status: 'completed' | 'failed' | 'killed';
  type: TaskType;
  sourceAgent: string;
  targetAgent: string;
  description: string;
  result?: string;
  error?: string;
  totalTokens?: number;
  durationMs?: number;
}): string {
  const resultSection = opts.result ? `\n<result>${opts.result}</result>` : '';
  const errorSection = opts.error ? `\n<error>${opts.error}</error>` : '';
  // 运行时指标：时长（人类可读格式）和 token 消耗
  const usageParts: string[] = [];
  if (opts.durationMs != null) usageParts.push(`<duration>${formatDuration(opts.durationMs)}</duration>`);
  if (opts.totalTokens != null && opts.totalTokens > 0) usageParts.push(`<tokens>${opts.totalTokens}</tokens>`);
  const usageSection = usageParts.length > 0 ? `\n<usage>${usageParts.join('')}</usage>` : '';

  return `<task-notification>
<task-id>${opts.taskId}</task-id>
<type>${opts.type}</type>
<executor>${opts.targetAgent}</executor>
<status>${opts.status}</status>
<summary>${opts.description}</summary>${resultSection}${errorSection}${usageSection}
</task-notification>`;
}

// ---- 核心类 ----

/**
 * 全局任务板。
 *
 * 在 runMultiAgent() 中创建单例，注册所有 Agent 的 backend 引用。
 * sub_agent 异步任务和 delegate_to_agent 委派任务都注册到此 board。
 * 任务完成/失败/中止时，board 自动构建 XML 通知并路由到 sourceAgent 的 backend。
 */
export class CrossAgentTaskBoard extends EventEmitter {
  /** 所有任务记录 */
  private tasks = new Map<string, TaskRecord>();

  /**
   * Agent 名称 → backend 引用的映射。
   * board 通过此映射找到 sourceAgent 的 backend，
   * 调用 enqueueAgentNotification() 推送通知。
   * 类型用 any 因为只需要 enqueueAgentNotification 方法，
   * 避免对完整 Backend 类型的循环依赖。
   */
  private backends = new Map<string, { enqueueAgentNotification(sessionId: string, text: string): void }>();

  // ---- Backend 注册 ----

  /**
   * 注册 Agent 的 backend 引用。
   * 启动时由 runMultiAgent() 调用，热重载时可覆盖。
   */
  registerBackend(agentName: string, backend: { enqueueAgentNotification(sessionId: string, text: string): void }): void {
    this.backends.set(agentName, backend);
    logger.info(`Backend 已注册: agent=${agentName}`);
  }

  // ---- 任务生命周期 ----

  /**
   * 注册新任务。
   * 返回创建的 TaskRecord（含 AbortController）。
   */
  register(input: RegisterTaskInput): TaskRecord {
    const task: TaskRecord = {
      ...input,
      status: 'running',
      startTime: Date.now(),
      abortController: new AbortController(),
    };
    this.tasks.set(input.taskId, task);
    logger.info(`任务已注册: taskId=${input.taskId}, type=${input.type}, source=${input.sourceAgent}, target=${input.targetAgent}`);
    this.emit('registered', task);
    return task;
  }

  /**
   * 标记任务完成。
   * 自动构建通知 XML 并推送到 sourceAgent 的 backend。
   */
  complete(taskId: string, result?: string): void {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== 'running') return;

    task.status = 'completed';
    task.endTime = Date.now();
    task.result = result;
    task.abortController = undefined;

    logger.info(`任务已完成: taskId=${taskId}, duration=${task.endTime - task.startTime}ms`);
    this.emit('completed', task);
    this.pushNotification(task, 'completed');
  }

  /**
   * 标记任务失败。
   * 自动构建失败通知并推送到 sourceAgent 的 backend。
   */
  fail(taskId: string, error: string): void {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== 'running') return;

    task.status = 'failed';
    task.endTime = Date.now();
    task.error = error;
    task.abortController = undefined;

    logger.error(`任务已失败: taskId=${taskId}, error="${error}"`);
    this.emit('failed', task);
    this.pushNotification(task, 'failed');
  }

  /**
   * 中止任务。
   * 触发 AbortController.abort()，推送 killed 通知。
   */
  kill(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== 'running') return;

    task.abortController?.abort();
    task.status = 'killed';
    task.endTime = Date.now();
    task.abortController = undefined;

    logger.info(`任务已中止: taskId=${taskId}`);
    this.emit('killed', task);
    this.pushNotification(task, 'killed');
  }

  // ---- 查询 ----

  /** 按 taskId 获取原始 TaskRecord（内部使用） */
  get(taskId: string): TaskRecord | undefined {
    return this.tasks.get(taskId);
  }

  /**
   * 查询任务实时状态快照（供 query_delegated_task 工具使用）。
   * 不暴露 abortController 等内部对象。
   */
  query(taskId: string): TaskSnapshot | undefined {
    const task = this.tasks.get(taskId);
    if (!task) return undefined;

    const now = Date.now();
    // isStreaming：最近 3 秒内有 chunk 心跳且任务仍在运行
    const isStreaming = task.status === 'running'
      && task.lastChunkTime != null
      && (now - task.lastChunkTime) < STREAMING_HEARTBEAT_TIMEOUT_MS;
    // durationMs：running 时为已运行时长，终态时为总运行时长
    const durationMs = (task.endTime ?? now) - task.startTime;

    return {
      taskId: task.taskId,
      targetAgent: task.targetAgent,
      status: task.status,
      isStreaming,
      durationMs,
      totalTokens: task.totalTokens ?? 0,
      error: task.error,
      description: task.description,
    };
  }

  // ---- 并发计数 ----

  /** 按 sourceSessionId 查询所有任务（不限状态，供 backend 查询接口使用） */
  getBySourceSession(sessionId: string): TaskRecord[] {
    return Array.from(this.tasks.values()).filter(
      t => t.sourceSessionId === sessionId,
    );
  }


  /** 按 sourceSessionId 查询当前 running 任务（保护发起方资源） */
  getRunningBySourceSession(sessionId: string): TaskRecord[] {
    return Array.from(this.tasks.values()).filter(
      t => t.sourceSessionId === sessionId && t.status === 'running',
    );
  }

  /** 按 targetAgent 查询当前 running 任务（保护目标 Agent 不被压垂） */
  getRunningByTargetAgent(agentName: string): TaskRecord[] {
    return Array.from(this.tasks.values()).filter(
      t => t.targetAgent === agentName && t.status === 'running',
    );
  }

  // ---- 批量操作 ----

  /**
   * 中止以指定 session 为 source 的所有 running 任务。
   * 由 Backend.clearSession() 调用。
   * 只影响以该 session 为发起方的任务，不影响其他 Agent。
   */
  killAllBySourceSession(sessionId: string): void {
    for (const task of this.tasks.values()) {
      if (task.sourceSessionId === sessionId && task.status === 'running') {
        this.kill(task.taskId);
      }
    }
  }

  /**
   * 清除已终止（非 running）的任务记录，释放内存。
   */
  clearCompleted(): number {
    let count = 0;
    for (const [id, task] of this.tasks) {
      if (task.status !== 'running') {
        this.tasks.delete(id);
        count++;
      }
    }
    return count;
  }

  // ---- 实时更新 ----

  /** 更新任务累计 token 数（运行中实时更新） */
  updateTokens(taskId: string, tokens: number): void {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== 'running') return;
    task.totalTokens = tokens;
    this.emit('token-update', task);
  }

  /** 发射 chunk 心跳（更新 lastChunkTime，驱动 isStreaming 判定） */
  emitChunkHeartbeat(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== 'running') return;
    task.lastChunkTime = Date.now();
    this.emit('chunk-heartbeat', task);
  }

  /** 当前任务总数 */
  get size(): number {
    return this.tasks.size;
  }

  // ---- 内部：通知路由 ----

  /**
   * 构建通知 XML 并推送到 sourceAgent 的 backend。
   * 这是 board 的核心价值：通知路由完全内聚，
   * 工具层和执行层只管调 complete()/fail()，不需要知道通知怎么发。
   */
  private pushNotification(task: TaskRecord, status: 'completed' | 'failed' | 'killed'): void {
    const backend = this.backends.get(task.sourceAgent);
    if (!backend) {
      // sourceAgent 的 backend 未注册，可能是单 Agent 模式或配置错误
      logger.warn(`无法推送通知: sourceAgent="${task.sourceAgent}" 的 backend 未注册`);
      return;
    }

    const durationMs = task.endTime! - task.startTime;
    const xml = buildNotificationXML({
      taskId: task.taskId,
      status,
      type: task.type,
      sourceAgent: task.sourceAgent,
      targetAgent: task.targetAgent,
      description: task.description,
      result: task.result,
      error: task.error,
      totalTokens: task.totalTokens,
      durationMs,
    });

    backend.enqueueAgentNotification(task.sourceSessionId, xml);
  }
}
