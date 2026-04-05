/**
 * 远程 ToolExecutionHandle 代理
 *
 * 在客户端进程中代理服务端的 ToolExecutionHandle，
 * 通过 IPC 转发 approve/reject/apply/abort 操作，
 * 并接收 state/output/progress/stream 事件。
 */

import { EventEmitter } from 'node:events';
import type { IPCClient } from './client';
import type { SerializedToolHandle } from './protocol';
import { Methods } from './protocol';
import { createLogger } from '../logger';

const logger = createLogger('RemoteToolHandle');

/**
 * 实现 ToolExecutionHandleLike 接口的远程代理。
 *
 * 平台层通过此对象与服务端的真实 ToolExecutionHandle 交互，
 * 使用方式与进程内直接引用完全相同。
 */
export class RemoteToolHandle extends EventEmitter {
  readonly handleId: string;
  readonly toolName: string;
  readonly toolId: string;
  readonly args: Record<string, unknown>;
  readonly approvalRequired: boolean;

  private _state: string;
  private _preview?: string;
  private _output?: string;
  private _outputHistory: string[] = [];

  constructor(
    private client: IPCClient,
    serialized: SerializedToolHandle,
  ) {
    super();
    this.handleId = serialized.handleId;
    this.toolName = serialized.toolName;
    this.toolId = serialized.toolId;
    this.args = serialized.args;
    this._state = serialized.state;
    this._preview = serialized.preview;
    this.approvalRequired = serialized.approvalRequired ?? false;
  }

  // --- ToolExecutionHandleLike 兼容属性 ---

  /** 兼容 Console 通过 handle.id 访问 */
  get id(): string {
    return this.handleId;
  }

  /** 当前状态 */
  get status(): string {
    return this._state;
  }

  get state(): string {
    return this._state;
  }

  get preview(): string | undefined {
    return this._preview;
  }

  get output(): string | undefined {
    return this._output;
  }

  /** 嵌套深度（远程模式下默认为 0） */
  get depth(): number {
    return 0;
  }

  /** 父 Handle ID（远程模式下无嵌套） */
  get parentId(): string | undefined {
    return undefined;
  }

  // --- ToolExecutionHandleLike 兼容方法 ---

  getSnapshot(): Record<string, unknown> {
    return {
      id: this.handleId,
      toolName: this.toolName,
      toolId: this.toolId,
      args: this.args,
      status: this._state,
      state: this._state,
      output: this._output,
      preview: this._preview,
      approvalRequired: this.approvalRequired,
    };
  }

  getOutputHistory(): string[] {
    return this._outputHistory;
  }

  getChildren(): RemoteToolHandle[] {
    return [];
  }

  // --- 代理操作（通过 IPC 发到服务端） ---

  approve(approved: boolean = true): void {
    if (approved) {
      this.client.call(Methods.HANDLE_APPROVE, [this.handleId, true])
        .catch((err) => logger.warn(`approve 失败: ${err.message}`));
    } else {
      this.reject();
    }
  }

  reject(): void {
    this.client.call(Methods.HANDLE_REJECT, [this.handleId])
      .catch((err) => logger.warn(`reject 失败: ${err.message}`));
  }

  apply(applied: boolean = true): void {
    this.client.call(Methods.HANDLE_APPLY, [this.handleId, applied])
      .catch((err) => logger.warn(`apply 失败: ${err.message}`));
  }

  abort(): void {
    this.client.call(Methods.HANDLE_ABORT, [this.handleId])
      .catch((err) => logger.warn(`abort 失败: ${err.message}`));
  }

  // --- 服务端事件接收 ---

  /** 由 RemoteBackendHandle 调用，更新状态并触发事件 */
  _updateState(state: string): void {
    this._state = state;
    this.emit('state', state);
  }

  _updateOutput(output: string): void {
    this._output = output;
    this._outputHistory.push(output);
    this.emit('output', output);
  }

  _updateProgress(progress: unknown): void {
    this.emit('progress', progress);
  }

  _appendStream(type: string, data?: unknown): void {
    this.emit('message', type, data);
  }

  /** 便于调试的 sessionId（实际不参与业务） */
  sessionId?: string;
}
