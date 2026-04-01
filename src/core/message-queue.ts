/**
 * 统一消息队列
 *
 * 所有消息源（用户输入、子代理通知、系统命令）共用一个队列。
 * 优先级决定出队顺序：user > notification。
 * 同优先级内先入先出（FIFO）。
 *
 * 设计动机：
 *   Iris 原先的 Backend.chat() 是同步阻塞式的——用户发一条消息，
 *   handleMessage() 从头跑到尾，turn 结束后才能接收下一条。
 *   引入消息队列后，所有消息源（用户输入、异步子代理完成通知）
 *   统一入队，由 Backend 的 drainQueue() 按优先级逐条取出处理。
 */

import { EventEmitter } from 'events';
import type { ImageInput, DocumentInput } from './backend/types';
import { createLogger } from '../logger';

const logger = createLogger('MessageQueue');

/** turnId 自增计数器（进程内唯一） */
let turnIdCounter = 0;

// ============ 优先级定义 ============

/**
 * 消息优先级。
 *
 * - user：用户直接输入的消息，最高优先级。
 * - notification：异步子代理完成后的通知，低优先级。
 *
 * 用户消息永远优先于子代理通知被出队处理，
 * 避免后台任务密集完成时阻塞用户交互。
 */
export type QueuePriority = 'user' | 'notification';

/** 优先级排序值，数字越小优先级越高 */
const PRIORITY_ORDER: Record<QueuePriority, number> = {
  user: 0,
  notification: 1,
};

// ============ 消息类型 ============

/**
 * 队列中的一条消息。
 *
 * mode 字段区分下游处理逻辑：
 * - 'chat'：普通用户消息，走完整的 handleMessage 流程（存储、元数据、undo 等）。
 * - 'task-notification'：异步子代理完成通知，走精简路径（跳过存储/元数据，
 *   直接以 user-role 注入 LLM 历史触发新 turn）。
 */
export interface QueuedMessage {
  /** 消息文本内容 */
  text: string;
  /** 本次 turn 的唯一标识（由 chat() 入队时生成，用于 done 事件精确配对） */
  turnId: string;
  /** 目标会话 ID */
  sessionId: string;
  /** 优先级（入队时由 enqueueUser/enqueueNotification 自动设定） */
  priority: QueuePriority;
  /** 消息模式，决定 Backend 的处理路径 */
  mode: 'chat' | 'task-notification';
  /** 入队时间戳（毫秒） */
  enqueuedAt: number;
  /** 附带的图片（可选，仅 mode='chat' 时有效） */
  images?: ImageInput[];
  /** 附带的文档（可选，仅 mode='chat' 时有效） */
  documents?: DocumentInput[];
  /** 来源平台名称（可选） */
  platformName?: string;
}

// ============ 消息队列 ============

export class MessageQueue extends EventEmitter {
  private queue: QueuedMessage[] = [];

  /**
   * 用户消息入队（高优先级）。
   *
   * 由 Backend.chat() 调用，将用户输入放入队列。
   * 入队后 emit 'enqueued' 事件，触发 Backend.drainQueue() 自动处理。
   * @returns 生成的 turnId，供 chat() 配对 done 事件使用
   */
  enqueueUser(msg: Omit<QueuedMessage, 'priority' | 'mode' | 'enqueuedAt' | 'turnId'>): string {
    // 生成唯一 turnId，供 chat() 的 Promise 与 done 事件精确配对。
    // 格式：turn_<自增计数>_<时间戳>，保证进程内唯一。
    const turnId = `turn_${++turnIdCounter}_${Date.now()}`;
    const queued: QueuedMessage = {
      ...msg,
      priority: 'user',
      mode: 'chat',
      turnId,
      enqueuedAt: Date.now(),
    };
    this.queue.push(queued);
    logger.debug(`用户消息入队: session=${msg.sessionId}, queueSize=${this.queue.length}`);
    this.emit('enqueued');
    return turnId;
  }

  /**
   * 子代理通知入队（低优先级）。
   *
   * 由异步子代理完成后调用（通过 Backend.enqueueAgentNotification）。
   * 入队后 emit 'enqueued' 事件，触发 Backend.drainQueue() 自动处理。
   *
   * 优先级低于用户消息，确保用户输入永远先被处理。
   */
  enqueueNotification(msg: Omit<QueuedMessage, 'priority' | 'mode' | 'enqueuedAt' | 'turnId'>): void {
    // notification turn 同样分配 turnId，虽然 notification 不经过 chat()，
    // 但 executeTurn emit done 时统一携带 turnId，保持接口一致。
    const queued: QueuedMessage = {
      ...msg,
      priority: 'notification',
      mode: 'task-notification',
      turnId: `turn_${++turnIdCounter}_${Date.now()}`,
      enqueuedAt: Date.now(),
    };
    this.queue.push(queued);
    logger.debug(`子代理通知入队: session=${msg.sessionId}, queueSize=${this.queue.length}`);
    this.emit('enqueued');
  }

  /**
   * 取出优先级最高的消息。
   *
   * 扫描整个队列，找到优先级最高（数值最小）的消息并移除。
   * 同优先级内按入队顺序（FIFO）。
   * 可选按 sessionId 过滤，仅取指定会话的消息。
   * 可选排除指定的 session 集合（供 drainQueue 跳过正在执行 turn 的 session）。
   *
   * @param sessionId 可选，仅取指定会话的消息
   * @param excludeSessions 可选，排除指定会话的消息（用于跳过 turn 锁占用的 session）
   * @returns 取出的消息，队列为空时返回 undefined
   */
  dequeue(sessionId?: string, excludeSessions?: Set<string>): QueuedMessage | undefined {
    if (this.queue.length === 0) return undefined;

    let bestIdx = -1;
    let bestPriority = Infinity;

    for (let i = 0; i < this.queue.length; i++) {
      const msg = this.queue[i];
      // 按 sessionId 过滤（如果指定）
      if (sessionId && msg.sessionId !== sessionId) continue;
      // 跳过被排除的 session（drainQueue 用来跳过正在执行 turn 的 session）
      if (excludeSessions?.has(msg.sessionId)) continue;
      const p = PRIORITY_ORDER[msg.priority];
      if (p < bestPriority) {
        bestIdx = i;
        bestPriority = p;
      }
    }

    if (bestIdx === -1) return undefined;
    return this.queue.splice(bestIdx, 1)[0];
  }

  /**
   * 查看队列头部最高优先级的消息（不移除）。
   *
   * @param sessionId 可选，仅查看指定会话的消息
   * @param excludeSessions 可选，排除指定会话的消息
   * @returns 最高优先级的消息，队列为空时返回 undefined
   */
  peek(sessionId?: string, excludeSessions?: Set<string>): QueuedMessage | undefined {
    if (this.queue.length === 0) return undefined;

    let bestIdx = -1;
    let bestPriority = Infinity;

    for (let i = 0; i < this.queue.length; i++) {
      const msg = this.queue[i];
      if (sessionId && msg.sessionId !== sessionId) continue;
      if (excludeSessions?.has(msg.sessionId)) continue;
      const p = PRIORITY_ORDER[msg.priority];
      if (p < bestPriority) {
        bestIdx = i;
        bestPriority = p;
      }
    }

    if (bestIdx === -1) return undefined;
    return this.queue[bestIdx];
  }

  /**
   * 队列中是否有待处理消息。
   *
   * @param sessionId 可选，仅检查指定会话
   */
  hasMessages(sessionId?: string): boolean {
    if (!sessionId) return this.queue.length > 0;
    return this.queue.some(m => m.sessionId === sessionId);
  }

  /**
   * 获取队列中指定会话的待处理消息数量。
   */
  getSessionMessageCount(sessionId: string): number {
    return this.queue.filter(m => m.sessionId === sessionId).length;
  }

  /**
   * 清空指定会话的所有待处理消息。
   *
   * 在 Backend.clearSession() 时调用，
   * 防止已清空的会话中残留的异步子代理通知被处理。
   */
  clearSession(sessionId: string): void {
    const before = this.queue.length;
    this.queue = this.queue.filter(m => m.sessionId !== sessionId);
    const removed = before - this.queue.length;
    if (removed > 0) {
      logger.debug(`清空会话队列: session=${sessionId}, removed=${removed}`);
    }
  }

  /**
   * 将消息原样放回队列（不触发事件、不修改时间戳）。
   *
   * 供 Backend.drainQueue() 在 tryAcquire 失败时使用。
   * 与 enqueueUser/enqueueNotification 的区别：
   *   - 不触发 emit('enqueued')，避免同步递归调用 drainQueue
   *   - 不覆盖 priority/mode/enqueuedAt，保持原始入队顺序
   *
   * 消息放回后由当前 drainQueue 循环自然跳过（通过 excludeSessions），
   * 或等 turn 结束后 turnLock 的 'released' 事件触发下一次 drainQueue。
   */
  requeue(msg: QueuedMessage): void {
    this.queue.push(msg);
  }

  /**
   * 提取并移除指定会话的所有 task-notification 消息。
   *
   * 用于通知批量合并：当所有异步子代理完成时，将队列中积压的通知
   * 一次性取出，与 pendingNotifications 中已暂存的合并后统一处理。
   * 仅移除 mode='task-notification' 的消息，不影响用户消息。
   */
  drainSessionNotifications(sessionId: string): QueuedMessage[] {
    const drained: QueuedMessage[] = [];
    this.queue = this.queue.filter(m => {
      if (m.sessionId === sessionId && m.mode === 'task-notification') {
        drained.push(m);
        return false;
      }
      return true;
    });
    return drained;
  }

  /**
   * 清空所有待处理消息。
   */
  clearAll(): void {
    this.queue = [];
  }

  /** 当前队列长度 */
  get length(): number {
    return this.queue.length;
  }
}
