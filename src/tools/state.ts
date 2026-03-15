/**
 * 工具状态管理器
 *
 * 独立管理所有工具调用实例的生命周期状态。
 * 职责单一：只负责状态的创建、转换、查询和事件通知。
 * 不涉及工具的注册与实际执行逻辑。
 *
 * 状态流转：
 *   streaming → queued → awaiting_approval → executing → awaiting_apply → success
 *                  │            │                │              └──→ warning
 *                  │            │                └──→ success / warning / error
 *                  │            └──→ executing / error
 *                  └──→ executing / error
 *   （任何非终态均可直接转为 error）
 */

import { EventEmitter } from 'events';
import { ToolStatus, ToolInvocation, ToolStateChangeEvent, TERMINAL_TOOL_STATUSES } from '../types';
import { createLogger } from '../logger';

const logger = createLogger('ToolState');

// ============ 状态转换规则 ============

/** 合法的状态转换表 */
const VALID_TRANSITIONS: Record<ToolStatus, ToolStatus[]> = {
  streaming:         ['queued', 'error'],
  queued:            ['awaiting_approval', 'executing', 'error'],
  awaiting_approval: ['executing', 'error'],
  executing:         ['awaiting_apply', 'success', 'warning', 'error'],
  awaiting_apply:    ['success', 'warning', 'error'],
  success:           [],
  warning:           [],
  error:             [],
};

/** 终态集合 */
const TERMINAL_STATUSES = TERMINAL_TOOL_STATUSES;

// ============ 事件类型声明 ============

export interface ToolStateEvents {
  /** 工具调用被创建 */
  created: (invocation: ToolInvocation) => void;
  /** 状态发生变更 */
  stateChange: (event: ToolStateChangeEvent) => void;
  /** 进入终态 */
  completed: (invocation: ToolInvocation) => void;
}

// ============ ToolStateManager ============

export class ToolStateManager extends EventEmitter {
  private invocations = new Map<string, ToolInvocation>();
  private counter = 0;

  // ----创建 ----

  /**
   * 创建一个新的工具调用实例。
   *
   * @param toolName      工具名称
   * @param args          调用参数（streaming 阶段可传空对象）
   * @param initialStatus 初始状态，默认 'queued'
   * @returns 新创建的 ToolInvocation
   */
  create(
    toolName: string,
    args: Record<string, unknown> = {},
    initialStatus: ToolStatus = 'queued',
  ): ToolInvocation {
    const id = `tool_${++this.counter}_${Date.now()}`;
    const now = Date.now();

    const invocation: ToolInvocation = {
      id,
      toolName,
      args,
      status: initialStatus,
      createdAt: now,
      updatedAt: now,
    };

    this.invocations.set(id, invocation);
    logger.debug(`创建: ${toolName}(${id}) [${initialStatus}]`);
    this.emit('created', invocation);

    return invocation;
  }

  // ---- 状态转换 ----

  /**
   * 将工具调用转换到新状态。
   *
   * 自动校验状态转换合法性，不合法则抛出错误。
   * 转换完成后触发 'stateChange' 事件；若进入终态，额外触发 'completed' 事件。
   *
   * @param id        调用实例 ID
   * @param newStatus 目标状态
   * @param payload   可选载荷：result / error / args（用于 streaming 阶段更新参数）
   */
  transition(
    id: string,
    newStatus: ToolStatus,
    payload?: { result?: unknown; error?: string; args?: Record<string, unknown> },
  ): ToolInvocation {
    const invocation = this.invocations.get(id);
    if (!invocation) {
      throw new Error(`工具调用不存在: ${id}`);
    }

    const previousStatus = invocation.status;

    // 校验转换合法性
    const allowed = VALID_TRANSITIONS[previousStatus];
    if (!allowed.includes(newStatus)) {
      throw new Error(
        `非法状态转换: ${invocation.toolName}(${id}) ${previousStatus} → ${newStatus}`,
      );
    }

    // 更新字段
    invocation.status = newStatus;
    invocation.updatedAt = Date.now();
    if (payload?.result !== undefined) invocation.result = payload.result;
    if (payload?.error !== undefined) invocation.error = payload.error;
    if (payload?.args !== undefined) invocation.args = payload.args;

    logger.debug(`转换: ${invocation.toolName}(${id}) ${previousStatus} → ${newStatus}`);
    this.emit('stateChange', { invocation, previousStatus } as ToolStateChangeEvent);

    // 终态额外事件
    if (TERMINAL_STATUSES.has(newStatus)) {
      this.emit('completed', invocation);
    }

    return invocation;
  }

  // ---- 查询 ----

  /** 根据 ID 获取工具调用实例 */
  get(id: string): ToolInvocation | undefined {
    return this.invocations.get(id);
  }

  /** 按状态查询工具调用 */
  getByStatus(status: ToolStatus): ToolInvocation[] {
    return Array.from(this.invocations.values()).filter(i => i.status === status);
  }

  /** 获取所有活跃（非终态）的工具调用 */
  getActive(): ToolInvocation[] {
    return Array.from(this.invocations.values()).filter(
      i => !TERMINAL_STATUSES.has(i.status),
    );
  }

  /** 获取所有工具调用 */
  getAll(): ToolInvocation[] {
    return Array.from(this.invocations.values());
  }

  /** 已注册的调用实例数量 */
  get size(): number {
    return this.invocations.size;
  }

  // ---- 判断 ----

  /** 判断给定状态是否为终态 */
  isTerminal(status: ToolStatus): boolean {
    return TERMINAL_STATUSES.has(status);
  }

  /** 是否存在任何活跃调用 */
  hasActive(): boolean {
    for (const inv of this.invocations.values()) {
      if (!TERMINAL_STATUSES.has(inv.status)) return true;
    }
    return false;
  }

  // ---- 清理 ----

  /** 清除所有已完成（终态）的调用记录，返回清除数量 */
  clearCompleted(): number {
    let count = 0;
    for (const [id, inv] of this.invocations) {
      if (TERMINAL_STATUSES.has(inv.status)) {
        this.invocations.delete(id);
        count++;
      }
    }
    return count;
  }

  /** 清除所有调用记录 */
  clearAll(): void {
    this.invocations.clear();
    this.counter = 0;
  }

  // ---- 审批等待 ----

  /**
   * 等待工具调用被用户批准或拒绝。
   *
   * 调用方应先将工具状态转为 `awaiting_approval`，然后调用此方法阻塞。
   * 当外部代码将状态转为 `executing` 时返回 `true`（已批准）；
   * 当外部代码将状态转为 `error` 时返回 `false`（已拒绝）。
   */
  waitForApproval(id: string): Promise<boolean> {
    const invocation = this.invocations.get(id);
    if (!invocation) {
      throw new Error(`工具调用不存在: ${id}`);
    }

    // 如果状态已经不是 awaiting_approval，则直接返回
    if (invocation.status !== 'awaiting_approval') {
      return Promise.resolve(invocation.status === 'executing');
    }

    return new Promise<boolean>((resolve) => {
      const handler = (event: ToolStateChangeEvent) => {
        if (event.invocation.id !== id) return;
        if (event.invocation.status === 'executing') {
          this.off('stateChange', handler);
          resolve(true);
        } else if (TERMINAL_STATUSES.has(event.invocation.status)) {
          this.off('stateChange', handler);
          resolve(false);
        }
      };
      this.on('stateChange', handler);
    });
  }
}
