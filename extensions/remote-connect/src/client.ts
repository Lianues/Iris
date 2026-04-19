/**
 * WsIPCClient — WebSocket IPC 客户端
 *
 * 实现 IPCClientLike 接口，通过 WebSocket 连接远程 Iris 实例。
 * 支持直连和通过中继连接两种模式。
 *
 * WS 消息格式：直接发送 JSON 字符串（WS 自带帧边界，无需长度前缀）。
 * 服务端的 NetServer 负责在 WS 和 TCP（IPCServer）之间做帧格式转换。
 */

/// <reference path="./ws.d.ts" />

import { EventEmitter } from 'node:events';
import { createLogger } from '../../../src/logger';
import type { IPCClientLike } from '../../../src/ipc/client-like';
import type { HandshakeResult } from '../../../src/ipc/protocol';
import { Methods } from '../../../src/ipc/protocol';
import type { RelayMessage } from './types';

const logger = createLogger('WsIPCClient');

/** 待处理的 RPC 请求 */
interface PendingCall {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout> | undefined;
}

/** 重连配置 */
const RECONNECT_BASE_DELAY = 1000;
const RECONNECT_MAX_DELAY = 30_000;
const RECONNECT_JITTER = 0.25;
const RECONNECT_BUDGET = 10 * 60 * 1000; // 10 分钟总预算

/** 心跳配置 */
const HEARTBEAT_INTERVAL = 15_000;
const HEARTBEAT_TIMEOUT = 10_000;

export class WsIPCClient extends EventEmitter implements IPCClientLike {
  private ws: any = null;
  private pendingCalls = new Map<number, PendingCall>();
  private nextId = 1;
  private timeout: number;
  private connected = false;
  private notificationHandlers: Array<(method: string, params: unknown[]) => void> = [];

  // 重连状态
  private reconnectEnabled = false;
  private reconnectAttempt = 0;
  private reconnectBudgetStart = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  /** 重连回调正在执行中（防止 onclose 和 catch 双重调度） */
  private reconnectInProgress = false;

  // 心跳
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  private heartbeatTimeoutTimer: ReturnType<typeof setTimeout> | undefined;
  private lastTickTime = 0;
  private sleepDetectionTimer: ReturnType<typeof setInterval> | undefined;

  // 连接参数（用于重连）
  private connectUrl = '';
  private connectToken = '';
  private connectMode: 'direct' | 'relay' = 'direct';
  private relayNodeId = '';

  // 订阅状态（用于重连恢复）
  private subscribedSessions: string[] = [];

  private isBun: boolean;

  constructor(options?: { timeout?: number }) {
    super();
    this.timeout = options?.timeout ?? 30_000;
    this.isBun = typeof (globalThis as any).Bun !== 'undefined';
  }

  /**
   * 直连远程 Iris 实例
   */
  async connect(url: string, token: string): Promise<HandshakeResult> {
    this.connectUrl = url;
    this.connectToken = token;
    this.connectMode = 'direct';
    this.reconnectEnabled = true;

    await this.doConnect();
    return this.doHandshake();
  }

  /**
   * 通过中继连接远程 Iris 实例
   */
  async connectViaRelay(relayUrl: string, nodeId: string, token: string): Promise<HandshakeResult> {
    this.connectUrl = relayUrl;
    this.connectToken = token;
    this.connectMode = 'relay';
    this.relayNodeId = nodeId;
    this.reconnectEnabled = true;

    await this.doConnect();

    // 发送中继连接请求
    const connectMsg: RelayMessage = { type: 'connect', nodeId, token };
    this.wsSend(JSON.stringify(connectMsg));

    // 等待 paired 消息
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        this.offNotification(handler);
        this.off('close', onClose);
      };
      const handler = (method: string, params: unknown[]) => {
        if (method === '__relay_paired') {
          cleanup();
          resolve();
        } else if (method === '__relay_error') {
          cleanup();
          reject(new Error(`中继错误: ${params[0]}`));
        }
      };
      const onClose = () => {
        cleanup();
        reject(new Error('中继连接断开'));
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('中继配对超时'));
      }, 30_000);
      this.onNotification(handler);
      this.once('close', onClose);
    });

    return this.doHandshake();
  }

  // ============ IPCClientLike 接口 ============

  async call(
    method: string,
    params?: unknown[],
    options?: { timeout?: number },
  ): Promise<unknown> {
    if (!this.ws || !this.connected) {
      throw new Error('WS 客户端未连接');
    }

    const id = this.nextId++;
    const request = {
      jsonrpc: '2.0' as const,
      id,
      method,
      params,
    };

    return new Promise<unknown>((resolve, reject) => {
      const effectiveTimeout = options?.timeout ?? this.timeout;

      const timer = effectiveTimeout > 0
        ? setTimeout(() => {
            this.pendingCalls.delete(id);
            reject(new Error(`WS RPC 请求超时: ${method} (${effectiveTimeout}ms)`));
          }, effectiveTimeout)
        : undefined;

      this.pendingCalls.set(id, { resolve, reject, timer });
      this.wsSend(JSON.stringify(request));
    });
  }

  onNotification(handler: (method: string, params: unknown[]) => void): void {
    this.notificationHandlers.push(handler);
  }

  offNotification(handler: (method: string, params: unknown[]) => void): void {
    const idx = this.notificationHandlers.indexOf(handler);
    if (idx >= 0) this.notificationHandlers.splice(idx, 1);
  }

  async subscribe(sessions: string | string[]): Promise<void> {
    const arr = Array.isArray(sessions) ? sessions : [sessions];
    this.subscribedSessions = arr;
    await this.call(Methods.SUBSCRIBE, [sessions]);
  }

  disconnect(): void {
    this.reconnectEnabled = false;
    this.clearTimers();

    if (this.ws) {
      try { this.ws.close(); } catch {}
      this.ws = null;
    }
    this.connected = false;
    this.rejectAllPending('连接已断开');
  }

  isConnected(): boolean {
    return this.connected;
  }

  // ============ 内部连接逻辑 ============

  private doConnect(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      try {
        // 清理残留的旧 WS（如 relay 配对失败后 WS 仍活着的情况）
        // 必须摘除 onclose 防止触发连锁反应（rejectAllPending / scheduleReconnect）
        if (this.ws) {
          try {
            this.ws.onclose = null;
            this.ws.onerror = null;
            this.ws.onmessage = null;
            this.ws.close();
          } catch {}
          this.ws = null;
        }

        // 确保 URL 以 ws:// 或 wss:// 开头
        let wsUrl = this.connectUrl;
        if (!wsUrl.startsWith('ws://') && !wsUrl.startsWith('wss://')) {
          wsUrl = 'ws://' + wsUrl;
        }
        // 直连模式：添加 /ws 路径（如果没有的话）
        if (this.connectMode === 'direct' && !wsUrl.includes('/ws')) {
          wsUrl = wsUrl.replace(/\/?$/, '/ws');
        }

        if (this.isBun) {
          this.ws = new WebSocket(wsUrl);
        } else {
          // Node.js 环境：动态导入 ws
          import('ws').then(({ default: WS }) => {
            this.ws = new WS(wsUrl);
            this.setupWsListeners(resolve, reject);
          }).catch(reject);
          return;
        }

        this.setupWsListeners(resolve, reject);
      } catch (err) {
        reject(err);
      }
    });
  }

  private setupWsListeners(resolve: () => void, reject: (err: Error) => void): void {
    let resolved = false;

    this.ws.onopen = () => {
      if (this.connectMode === 'direct') {
        // 直连模式：发送认证消息，等待 auth_ok 才 resolve
        this.wsSend(JSON.stringify({ type: 'auth', token: this.connectToken }));
      } else if (this.connectMode === 'relay') {
        // relay 模式：WS 连接成功即可 resolve，后续 connect/paired 由 connectViaRelay 处理
        if (!resolved) {
          resolved = true;
          this.connected = true;
          this.startHeartbeat();
          this.startSleepDetection();
          this.reconnectAttempt = 0;
          resolve();
        }
      }
    };

    this.ws.onmessage = (event: any) => {
      const data = typeof event.data === 'string' ? event.data : event.data.toString('utf-8');
      this.handleMessage(data, () => {
        if (!resolved) {
          resolved = true;
          this.connected = true;
          this.startHeartbeat();
          this.startSleepDetection();
          this.reconnectAttempt = 0;
          resolve();
        }
      });
    };

    this.ws.onerror = (err: any) => {
      const msg = err?.message || err?.error?.message || 'WebSocket error';
      if (!resolved) {
        resolved = true;
        reject(new Error(msg));
      } else {
        logger.warn(`WS 错误: ${msg}`);
      }
    };

    this.ws.onclose = () => {
      this.connected = false;
      this.stopHeartbeat();
      this.rejectAllPending('连接已断开');
      this.emit('close');

      if (!resolved) {
        resolved = true;
        reject(new Error('连接被关闭'));
      } else if (this.reconnectEnabled && !this.reconnectInProgress) {
        // 仅在非重连回调执行期间才调度（避免与 catch 块双重调度）
        this.scheduleReconnect();
      }
    };

    // ws 包的 pong 事件
    if (typeof this.ws.on === 'function') {
      this.ws.on('pong', () => {
        if (this.heartbeatTimeoutTimer) {
          clearTimeout(this.heartbeatTimeoutTimer);
          this.heartbeatTimeoutTimer = undefined;
        }
      });
    }
  }

  private handleMessage(data: string, onAuthOk?: () => void): void {
    let msg: any;
    try {
      msg = JSON.parse(data);
    } catch {
      logger.warn('收到无效 JSON 消息');
      return;
    }

    // 认证确认
    if (msg.type === 'auth_ok') {
      onAuthOk?.();
      return;
    }

    // Relay 协议消息
    if (msg.type === 'paired') {
      // 通知 connectViaRelay / scheduleReconnect 中的等待逻辑
      for (const handler of this.notificationHandlers) {
        try { handler('__relay_paired', []); } catch {}
      }
      onAuthOk?.();
      return;
    }
    if (msg.type === 'error') {
      for (const handler of this.notificationHandlers) {
        try { handler('__relay_error', [msg.message]); } catch {}
      }
      return;
    }
    if (msg.type === 'peer_disconnected') {
      logger.warn('远程节点断开连接');
      // 关闭 WS → 触发 onclose → scheduleReconnect 统一处理重连+重配对
      try { this.ws?.close(); } catch {}
      return;
    }
    // Relay data 包装：提取 payload
    if (msg.type === 'data' && msg.payload) {
      msg = msg.payload;
    }

    // JSON-RPC 响应
    if (msg.jsonrpc === '2.0' && typeof msg.id === 'number') {
      const pending = this.pendingCalls.get(msg.id);
      if (!pending) return;
      this.pendingCalls.delete(msg.id);
      if (pending.timer) clearTimeout(pending.timer);

      if (msg.error) {
        pending.reject(new Error(msg.error.message));
      } else {
        pending.resolve(msg.result);
      }
      return;
    }

    // JSON-RPC 通知
    if (msg.jsonrpc === '2.0' && typeof msg.id === 'undefined' && msg.method) {
      for (const handler of this.notificationHandlers) {
        try {
          handler(msg.method, msg.params ?? []);
        } catch (err) {
          logger.warn(`通知 handler 错误: ${(err as Error).message}`);
        }
      }
      return;
    }
  }

  // ============ IPC 握手 ============

  private async doHandshake(): Promise<HandshakeResult> {
    const result = await this.call(Methods.HANDSHAKE);
    return result as HandshakeResult;
  }

  // ============ 心跳 ============

  private startHeartbeat(): void {
    this.stopHeartbeat();
    // Bun 原生 WebSocket 有 ping() 方法但没有 pong 事件回调，
    // 使用 ping/pong 会导致 timeout 必触发。仅在 ws 包（Node.js）下启用。
    if (this.isBun) return;
    this.heartbeatTimer = setInterval(() => {
      if (!this.ws || !this.connected) return;
      try {
        if (typeof this.ws.ping === 'function') {
          this.ws.ping();
          this.heartbeatTimeoutTimer = setTimeout(() => {
            logger.warn('WS 心跳超时');
            try { this.ws?.close(); } catch {}
          }, HEARTBEAT_TIMEOUT);
        }
      } catch {}
    }, HEARTBEAT_INTERVAL);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
    if (this.heartbeatTimeoutTimer) {
      clearTimeout(this.heartbeatTimeoutTimer);
      this.heartbeatTimeoutTimer = undefined;
    }
  }

  // ============ 睡眠检测 ============

  private startSleepDetection(): void {
    // 清理旧 timer（防止重连时泄漏）
    if (this.sleepDetectionTimer) {
      clearInterval(this.sleepDetectionTimer);
    }
    this.lastTickTime = Date.now();
    this.sleepDetectionTimer = setInterval(() => {
      const now = Date.now();
      const gap = now - this.lastTickTime;
      if (gap > 60_000) {
        logger.info(`检测到系统睡眠/唤醒 (gap=${Math.round(gap / 1000)}s)，重置重连预算`);
        this.reconnectAttempt = 0;
        this.reconnectBudgetStart = 0;
      }
      this.lastTickTime = now;
    }, 5_000);
  }

  // ============ 自动重连 ============

  private scheduleReconnect(): void {
    if (!this.reconnectEnabled) return;

    const now = Date.now();
    if (this.reconnectBudgetStart === 0) {
      this.reconnectBudgetStart = now;
    }

    // 超出预算
    if (now - this.reconnectBudgetStart > RECONNECT_BUDGET) {
      logger.error('重连预算耗尽，放弃重连');
      this.reconnectEnabled = false;
      return;
    }

    // 计算延迟（指数退避 + 抖动）
    const baseDelay = Math.min(
      RECONNECT_BASE_DELAY * Math.pow(2, this.reconnectAttempt),
      RECONNECT_MAX_DELAY,
    );
    const jitter = baseDelay * RECONNECT_JITTER * (Math.random() * 2 - 1);
    const delay = Math.max(100, baseDelay + jitter);

    this.reconnectAttempt++;
    logger.info(`将在 ${Math.round(delay)}ms 后尝试第 ${this.reconnectAttempt} 次重连...`);

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectInProgress = true;
      try {
        await this.doConnect();

        if (this.connectMode === 'relay') {
          // relay 模式：需要重新发送 connect 并等待配对
          const connectMsg: RelayMessage = { type: 'connect', nodeId: this.relayNodeId, token: this.connectToken };
          this.wsSend(JSON.stringify(connectMsg));
          await new Promise<void>((resolve, reject) => {
            const cleanup = () => {
              clearTimeout(timer);
              this.offNotification(handler);
              this.off('close', onClose);
            };
            const handler = (method: string, params: unknown[]) => {
              if (method === '__relay_paired') {
                cleanup();
                resolve();
              } else if (method === '__relay_error') {
                cleanup();
                reject(new Error(`中继错误: ${params[0]}`));
              }
            };
            const onClose = () => {
              cleanup();
              reject(new Error('重连中继连接断开'));
            };
            const timer = setTimeout(() => {
              cleanup();
              reject(new Error('重连配对超时'));
            }, 30_000);
            this.onNotification(handler);
            this.once('close', onClose);
          });
        }

        // 重连成功，重新握手和订阅
        await this.doHandshake();
        if (this.subscribedSessions.length > 0) {
          await this.call(Methods.SUBSCRIBE, [this.subscribedSessions]);
        }
        logger.info('重连成功');
        this.reconnectAttempt = 0;
        this.reconnectBudgetStart = 0;
      } catch (err) {
        logger.warn(`重连失败: ${(err as Error).message}`);
        this.reconnectInProgress = false;
        this.scheduleReconnect();
        return;
      }
      this.reconnectInProgress = false;
    }, delay);
  }

  // ============ 工具方法 ============

  private wsSend(data: string): void {
    try {
      if (this.ws) {
        this.ws.send(data);
      }
    } catch (err) {
      logger.warn(`WS 发送失败: ${(err as Error).message}`);
    }
  }

  private rejectAllPending(reason: string): void {
    for (const [id, pending] of this.pendingCalls) {
      if (pending.timer) clearTimeout(pending.timer);
      pending.reject(new Error(reason));
    }
    this.pendingCalls.clear();
  }

  private clearTimers(): void {
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    if (this.sleepDetectionTimer) {
      clearInterval(this.sleepDetectionTimer);
      this.sleepDetectionTimer = undefined;
    }
  }
}
