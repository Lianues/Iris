/**
 * IPC 客户端
 *
 * 连接到已运行的 IrisCore IPCServer，
 * 提供 request-response 和事件监听能力。
 */

import net from 'node:net';
import { EventEmitter } from 'node:events';
import { createLogger } from '../logger';
import { encodeFrame, FrameDecoder } from './framing';
import {
  type IPCRequest, type IPCResponse, type IPCNotification, type IPCMessage,
  type HandshakeResult,
  ErrorCodes, Methods,
  isResponse, isNotification,
} from './protocol';

const logger = createLogger('IPCClient');

/** 待处理的请求 */
interface PendingCall {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout> | undefined;
}

export interface IPCClientOptions {
  /** 请求超时（毫秒），默认 30s */
  timeout?: number;
}

export class IPCClient extends EventEmitter {
  private socket: net.Socket | null = null;
  private decoder: FrameDecoder | null = null;
  private pendingCalls = new Map<number, PendingCall>();
  private nextId = 1;
  private timeout: number;
  private connected = false;

  /** 事件通知回调 */
  private notificationHandlers: Array<(method: string, params: unknown[]) => void> = [];

  constructor(options?: IPCClientOptions) {
    super();
    this.timeout = options?.timeout ?? 30_000;
  }

  /**
   * 连接到 IPCServer
   */
  async connect(port: number, host = '127.0.0.1'): Promise<HandshakeResult> {
    return new Promise((resolve, reject) => {
      this.socket = net.createConnection({ port, host }, () => {
        this.connected = true;
        logger.info(`已连接到 IPC 服务: ${host}:${port}`);

        // 执行握手
        this.call(Methods.HANDSHAKE)
          .then((result) => resolve(result as HandshakeResult))
          .catch(reject);
      });

      this.decoder = new FrameDecoder();
      this.socket.pipe(this.decoder);

      this.decoder.on('data', (msg: IPCMessage) => {
        this.handleMessage(msg);
      });

      this.decoder.on('error', (err) => {
        logger.warn(`帧解析错误: ${err.message}`);
        this.disconnect();
      });

      this.socket.on('error', (err) => {
        if (!this.connected) {
          reject(new Error(`连接失败: ${err.message}`));
        } else {
          logger.error(`Socket 错误: ${err.message}`);
          this.emit('error', err);
        }
      });

      this.socket.on('close', () => {
        this.connected = false;
        // 拒绝所有待处理的请求
        for (const [id, pending] of this.pendingCalls) {
          if (pending.timer) clearTimeout(pending.timer);
          pending.reject(new Error('连接已断开'));
        }
        this.pendingCalls.clear();
        this.emit('close');
      });
    });
  }

  /**
   * 发送 RPC 请求，等待响应
   *
   * @param method  RPC 方法名
   * @param params  参数数组
   * @param options 可选：per-call 选项
   *   - timeout: 覆盖默认超时（毫秒）。0 表示无超时。
   */
  async call(
    method: string,
    params?: unknown[],
    options?: { timeout?: number },
  ): Promise<unknown> {
    if (!this.socket || !this.connected) {
      throw new Error('IPC 客户端未连接');
    }

    const id = this.nextId++;
    const request: IPCRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    return new Promise<unknown>((resolve, reject) => {
      const effectiveTimeout = options?.timeout ?? this.timeout;

      // timeout === 0 表示无超时（长时间运行的方法如 chat/summarize）
      const timer = effectiveTimeout > 0
        ? setTimeout(() => {
            this.pendingCalls.delete(id);
            reject(new Error(`IPC 请求超时: ${method} (${effectiveTimeout}ms)`));
          }, effectiveTimeout)
        : undefined;

      this.pendingCalls.set(id, { resolve, reject, timer });
      this.socket!.write(encodeFrame(request));
    });
  }

  /**
   * 注册事件通知回调
   *
   * 每当服务端推送事件时，所有注册的 handler 都会被调用。
   */
  onNotification(handler: (method: string, params: unknown[]) => void): void {
    this.notificationHandlers.push(handler);
  }

  /**
   * 移除事件通知回调
   */
  offNotification(handler: (method: string, params: unknown[]) => void): void {
    const idx = this.notificationHandlers.indexOf(handler);
    if (idx >= 0) this.notificationHandlers.splice(idx, 1);
  }

  /**
   * 订阅指定 session 的事件
   */
  async subscribe(sessions: string | string[]): Promise<void> {
    await this.call(Methods.SUBSCRIBE, [sessions]);
  }

  /**
   * 取消订阅
   */
  async unsubscribe(sessions: string | string[]): Promise<void> {
    await this.call(Methods.UNSUBSCRIBE, [sessions]);
  }

  /**
   * 断开连接
   */
  disconnect(): void {
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
      this.connected = false;
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  // ============ 内部 ============

  private handleMessage(msg: IPCMessage): void {
    if (isResponse(msg)) {
      // 匹配待处理的请求
      const pending = this.pendingCalls.get(msg.id);
      if (!pending) {
        logger.warn(`收到未知 id 的响应: ${msg.id}`);
        return;
      }
      this.pendingCalls.delete(msg.id);
      if (pending.timer) clearTimeout(pending.timer);

      if (msg.error) {
        pending.reject(new Error(msg.error.message));
      } else {
        pending.resolve(msg.result);
      }
    } else if (isNotification(msg)) {
      // 分发给所有通知 handler
      for (const handler of this.notificationHandlers) {
        try {
          handler(msg.method, msg.params ?? []);
        } catch (err) {
          logger.warn(`通知 handler 执行错误: ${(err as Error).message}`);
        }
      }
    }
  }
}
