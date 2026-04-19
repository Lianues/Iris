/**
 * RelayNodeClient — 中继节点客户端
 *
 * 运行在 Iris 实例内部，将本实例注册到中继服务器，
 * 使远程客户端可以通过中继连接到此实例。
 *
 * 当远程客户端通过中继配对后，创建一条 TCP 连接到本地 IPCServer，
 * 双向桥接 Relay WS 消息与 IPCServer TCP 帧。
 */

/// <reference path="./ws.d.ts" />

import net from 'node:net';
import { createLogger } from '../../../src/logger';
import { encodeFrame, FrameDecoder } from '../../../src/ipc/framing';
import type { RelayConfig, RelayMessage } from './types';

const logger = createLogger('RelayNode');

/** 重连配置 */
const RECONNECT_BASE_DELAY = 2000;
const RECONNECT_MAX_DELAY = 30_000;
const RECONNECT_JITTER = 0.25;

export class RelayNodeClient {
  private ipcPort: number;
  private relay: Required<Pick<RelayConfig, 'url' | 'nodeId' | 'token'>>;
  private ws: any = null;
  private tcp: net.Socket | null = null;
  private decoder: FrameDecoder | null = null;
  private running = false;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private paired = false;
  private isBun: boolean;

  constructor(opts: { ipcPort: number; relay: RelayConfig }) {
    this.ipcPort = opts.ipcPort;
    this.relay = {
      url: opts.relay.url!,
      nodeId: opts.relay.nodeId!,
      token: opts.relay.token!,
    };
    this.isBun = typeof (globalThis as any).Bun !== 'undefined';
  }

  start(): void {
    this.running = true;
    this.doConnect().catch((err) => {
      logger.warn(`初始连接 Relay 失败: ${(err as Error).message}`);
      if (this.running) this.scheduleReconnect();
    });
  }

  stop(): void {
    this.running = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    this.closeTcp();
    if (this.ws) {
      try { this.ws.close(); } catch {}
      this.ws = null;
    }
  }

  // ============ 连接到 Relay ============

  private async doConnect(): Promise<void> {
    if (!this.running) return;

    try {
      if (this.isBun) {
        this.ws = new WebSocket(this.relay.url);
      } else {
        const { default: WS } = await import('ws');
        this.ws = new WS(this.relay.url);
      }

      this.ws.onopen = () => {
        logger.info(`已连接到 Relay: ${this.relay.url}`);
        this.reconnectAttempt = 0;

        // 注册节点
        const registerMsg: RelayMessage = {
          type: 'register',
          nodeId: this.relay.nodeId,
          token: this.relay.token,
        };
        this.wsSend(JSON.stringify(registerMsg));
      };

      this.ws.onmessage = (event: any) => {
        const data = typeof event.data === 'string' ? event.data : event.data.toString('utf-8');
        this.handleRelayMessage(data);
      };

      this.ws.onerror = (err: any) => {
        logger.warn(`Relay WS 错误: ${err?.message || 'unknown'}`);
      };

      this.ws.onclose = () => {
        logger.info('Relay 连接断开');
        this.paired = false;
        this.closeTcp();
        if (this.running) {
          this.scheduleReconnect();
        }
      };
    } catch (err) {
      logger.warn(`连接 Relay 失败: ${(err as Error).message}`);
      if (this.running) {
        this.scheduleReconnect();
      }
    }
  }

  // ============ Relay 消息处理 ============

  private handleRelayMessage(data: string): void {
    let msg: RelayMessage;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }

    if (msg.type === 'paired') {
      logger.info('远程客户端已配对，建立 IPC 桥接');
      this.paired = true;
      this.createTcpBridge();
    } else if (msg.type === 'peer_disconnected') {
      logger.info('远程客户端断开');
      this.paired = false;
      this.closeTcp();
    } else if (msg.type === 'data') {
      // 转发到本地 IPC
      if (this.tcp && this.paired) {
        this.forwardToTcp(msg.payload);
      }
    } else if (msg.type === 'error') {
      logger.warn(`Relay 错误: ${msg.message}`);
    }
  }

  // ============ TCP 桥接 ============

  private createTcpBridge(): void {
    this.closeTcp();

    this.tcp = net.createConnection({ port: this.ipcPort, host: '127.0.0.1' });
    this.decoder = new FrameDecoder();

    this.tcp.pipe(this.decoder);

    // TCP → Relay（包装为 data 消息）
    this.decoder.on('data', (msg: unknown) => {
      if (!this.paired || !this.ws) return;
      try {
        const wrapped: RelayMessage = { type: 'data', payload: msg };
        this.wsSend(JSON.stringify(wrapped));
      } catch (err) {
        logger.warn(`TCP→Relay 转发失败: ${(err as Error).message}`);
      }
    });

    this.tcp.on('error', (err) => {
      logger.warn(`IPC TCP 错误: ${err.message}`);
      this.handleTcpBridgeDown();
    });

    this.tcp.on('close', () => {
      if (this.paired) {
        logger.warn('IPC TCP 连接意外关闭');
        this.handleTcpBridgeDown();
      }
    });

    this.decoder.on('error', (err) => {
      logger.warn(`IPC 帧解析错误: ${err.message}`);
    });
  }

  private forwardToTcp(payload: unknown): void {
    if (!this.tcp) return;
    try {
      const frame = encodeFrame(payload);
      this.tcp.write(frame);
    } catch (err) {
      logger.warn(`Relay→TCP 转发失败: ${(err as Error).message}`);
    }
  }

  /**
   * TCP 桥接断开时的处理：清理 TCP、重置 paired 状态。
   * 关闭 WS 触发 relay 发 peer_disconnected 给客户端，然后自动重连 relay。
   */
  private handleTcpBridgeDown(): void {
    if (!this.paired) return;
    this.paired = false;
    this.closeTcp();
    // 关闭到 relay 的 WS → 触发 relay 通知客户端 peer_disconnected
    // onclose 会自动触发 scheduleReconnect 重新注册节点
    if (this.ws) {
      try { this.ws.close(); } catch {}
    }
  }

  private closeTcp(): void {
    if (this.tcp) {
      this.tcp.destroy();
      this.tcp = null;
    }
    this.decoder = null;
  }

  // ============ 重连 ============

  private scheduleReconnect(): void {
    if (!this.running) return;

    const baseDelay = Math.min(
      RECONNECT_BASE_DELAY * Math.pow(2, this.reconnectAttempt),
      RECONNECT_MAX_DELAY,
    );
    const jitter = baseDelay * RECONNECT_JITTER * (Math.random() * 2 - 1);
    const delay = Math.max(500, baseDelay + jitter);

    this.reconnectAttempt++;
    logger.info(`将在 ${Math.round(delay)}ms 后重连 Relay (第 ${this.reconnectAttempt} 次)...`);

    this.reconnectTimer = setTimeout(() => {
      this.doConnect().catch((err) => {
        logger.warn(`重连 Relay 失败: ${(err as Error).message}`);
        if (this.running) this.scheduleReconnect();
      });
    }, delay);
  }

  // ============ 工具 ============

  private wsSend(data: string): void {
    try {
      if (this.ws) {
        this.ws.send(data);
      }
    } catch {}
  }
}
