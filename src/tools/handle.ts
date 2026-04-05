/**
 * 工具执行句柄（Handle）
 *
 * 每个工具执行的双向通信通道。平台端通过 Handle 订阅执行细节（下行），
 * 也通过 Handle 发送控制指令（上行），类似 WebSocket 的双向模型。
 *
 * 生命周期：由 ToolStateManager.create() 时创建，随工具执行结束自然释放。
 */

import { EventEmitter } from 'events';
import type { ToolInvocation, ToolOutputEntry, ToolStatus } from '../types/tool';
import { TERMINAL_TOOL_STATUSES } from '../types/tool';
import type { ToolStateManager } from './state';

// ============ 事件类型声明 ============

export interface ToolExecutionHandleEvents {
  /** 状态变化 */
  state: (status: ToolStatus, previousStatus: ToolStatus) => void;
  /** 实时输出流（累积式） */
  output: (entry: ToolOutputEntry) => void;
  /** 进度数据（覆盖式快照） */
  progress: (data: Record<string, unknown>) => void;
  /** 子工具产生 */
  child: (childHandle: ToolExecutionHandle) => void;
  /** 执行结束（进入终态） */
  done: (result?: unknown, error?: string) => void;
  /** 通用下行消息 */
  message: (type: string, data?: unknown) => void;
  /** @internal handler 接收的上行消息 */
  _upstream: (type: string, data?: unknown) => void;
}

// ============ ToolExecutionHandle ============

export class ToolExecutionHandle extends EventEmitter {
  private abortController = new AbortController();
  private _outputHistory: ToolOutputEntry[] = [];
  private _childHandles: ToolExecutionHandle[] = [];
  private _depth: number;
  private _parentId?: string;

  constructor(
    private invocation: ToolInvocation,
    private toolState: ToolStateManager | null,
    depth: number = 0,
    parentId?: string,
  ) {
    super();
    this._depth = depth;
    this._parentId = parentId;
  }

  // ── 只读属性 ──

  get id(): string { return this.invocation.id; }
  get toolName(): string { return this.invocation.toolName; }
  get status(): ToolStatus { return this.invocation.status; }
  get signal(): AbortSignal { return this.abortController.signal; }
  get parentId(): string | undefined { return this._parentId; }
  get depth(): number { return this._depth; }

  // ── 上行：平台 → 核心 ──

  /**
   * 终止此工具执行。
   * 触发工具级 AbortSignal，并将状态转为 error。
   */
  abort(): void {
    this.abortController.abort();
    if (!this.toolState) return;  // 历史工具无法操作
    if (!TERMINAL_TOOL_STATUSES.has(this.invocation.status)) {
      try {
        this.toolState.transition(this.id, 'error', { error: 'Aborted by user' });
      } catch {
        // 可能已终态，忽略
      }
    }
  }

  /**
   * 审批此工具执行（一类审批：Y/N 确认）。
   */
  approve(approved: boolean): void {
    if (!this.toolState) return;
    if (approved) {
      this.toolState.transition(this.id, 'executing');
    } else {
      this.toolState.transition(this.id, 'error', { error: '用户已拒绝执行' });
    }
  }

  /**
   * Diff 预览确认（二类审批）。
   */
  apply(applied: boolean): void {
    if (!this.toolState) return;
    if (applied) {
      this.toolState.transition(this.id, 'executing');
    } else {
      this.toolState.transition(this.id, 'error', { error: '用户在 diff 预览中拒绝了执行' });
    }
  }

  /**
   * 通用上行消息通道。
   * handler 通过 context.onMessage 接收。
   */
  send(type: string, data?: unknown): void {
    this.emit('_upstream', type, data);
  }

  // ── 下行：核心 → 平台（由 ToolStateManager / scheduler 内部调用）──

  /**
   * @internal 由 ToolStateManager.transition() 调用。
   * 发射 state 事件；终态时额外发射 done 事件。
   */
  _emitState(status: ToolStatus, previousStatus: ToolStatus): void {
    this.emit('state', status, previousStatus);
    if (TERMINAL_TOOL_STATUSES.has(status)) {
      this.emit('done', this.invocation.result, this.invocation.error);
    }
  }

  /**
   * @internal 由 ToolStateManager.transition() 在 progress 更新时调用。
   */
  _emitProgress(data: Record<string, unknown>): void {
    this.emit('progress', data);
  }

  /**
   * 追加输出内容到输出历史，并发射 output 事件。
   * 由 scheduler 通过 context.appendOutput 暴露给 handler。
   */
  appendOutput(entry: Omit<ToolOutputEntry, 'timestamp'>): void {
    const full: ToolOutputEntry = { ...entry, timestamp: Date.now() };
    this._outputHistory.push(full);
    this.emit('output', full);
  }

  /**
   * 注册子 Handle（由子代理的 childToolState 事件触发）。
   * 发射 child 事件通知平台端。
   */
  addChild(child: ToolExecutionHandle): void {
    this._childHandles.push(child);
    this.emit('child', child);
  }

  // ── 下行：通用消息 ──

  /**
   * @internal 发送通用下行消息（扩展点）。
   */
  sendMessage(type: string, data?: unknown): void {
    this.emit('message', type, data);
  }

  // ── 查询 ──

  /** 获取当前 ToolInvocation 的快照副本 */
  getSnapshot(): ToolInvocation {
    return { ...this.invocation };
  }

  /** 获取输出历史副本 */
  getOutputHistory(): ToolOutputEntry[] {
    return [...this._outputHistory];
  }

  /** 获取子 Handle 列表副本 */
  getChildren(): ToolExecutionHandle[] {
    return [...this._childHandles];
  }

  // ── 工厂方法 ──

  /**
   * 从历史 ToolInvocation 创建只读 Handle。
   * 用于历史会话中的工具记录，不支持上行操作（abort/approve/apply 为空操作）。
   */
  static fromInvocation(invocation: ToolInvocation): ToolExecutionHandle {
    return new ToolExecutionHandle(invocation, null);
  }
}
