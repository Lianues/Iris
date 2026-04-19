/**
 * NetServer — WebSocket ↔ TCP 桥接服务器
 *
 * 在本地 IPCServer（TCP localhost）旁边运行一个 WebSocket 服务器，
 * 为每个认证通过的 WS 客户端创建一条 TCP 连接到 IPCServer，
 * 双向桥接消息，实现远程设备对 Iris 实例的完整控制。
 *
 * 设计原则：零修改 IPCServer。所有远程访问逻辑封装在此模块中。
 */

/// <reference path="./ws.d.ts" />

import net from 'node:net';
import { createLogger } from '../../../src/logger';
import { encodeFrame, FrameDecoder } from '../../../src/ipc/framing';
import { validateAuthMessage } from './auth';
import { DiscoveryListener } from './discovery';
import type { NetConfig } from './types';

const logger = createLogger('NetServer');

/** 速率限制：每个 IP 的失败记录 */
interface RateLimitEntry {
  count: number;
  firstFailAt: number;
  bannedUntil: number;
}

const RATE_LIMIT_WINDOW = 60_000;     // 60s 窗口
const RATE_LIMIT_MAX_FAILURES = 5;    // 最多 5 次失败
const RATE_LIMIT_BAN_DURATION = 300_000; // 封禁 5 分钟

/** 单个桥接连接 */
interface BridgeConnection {
  ws: any; // WebSocket 实例（Bun 或 ws 包）
  tcp: net.Socket;
  decoder: FrameDecoder;
  authenticated: boolean;
  heartbeatTimer?: ReturnType<typeof setInterval>;
  pongReceived: boolean;
}

export class NetServer {
  private ipcPort: number;
  private config: NetConfig;
  private server: any = null; // Bun.Server 或 ws.WebSocketServer
  private connections = new Set<BridgeConnection>();
  private rateLimits = new Map<string, RateLimitEntry>();
  private isBun: boolean;
  private discoveryListener: DiscoveryListener | null = null;
  private agentName?: string;

  constructor(opts: { ipcPort: number; config: NetConfig; agentName?: string }) {
    this.ipcPort = opts.ipcPort;
    this.config = opts.config;
    this.agentName = opts.agentName;
    this.isBun = typeof (globalThis as any).Bun !== 'undefined';
  }

  async start(): Promise<number> {
    const port = this.config.port ?? 9100;
    const host = this.config.host ?? '0.0.0.0';

    if (this.isBun) {
      await this.startBun(host, port);
    } else {
      await this.startWs(host, port);
    }

    // 启动 UDP 发现监听
    try {
      this.discoveryListener = new DiscoveryListener({
        discoveryPort: 9101,  // 固定发现端口，与客户端 discoverLanInstances 默认值一致
        wsPort: port,
        agentName: this.agentName,
      });
      await this.discoveryListener.start();
    } catch (err) {
      logger.warn(`Discovery 启动失败（非致命）: ${(err as Error).message}`);
    }

    logger.info(`Net 服务已启动: ${host}:${port}`);
    return port;
  }

  async stop(): Promise<void> {
    // 关闭发现监听
    if (this.discoveryListener) {
      this.discoveryListener.stop();
      this.discoveryListener = null;
    }

    // 关闭所有桥接连接
    for (const conn of this.connections) {
      this.closeConnection(conn);
    }
    this.connections.clear();

    if (this.server) {
      if (this.isBun) {
        this.server.stop();
      } else {
        await new Promise<void>((resolve) => this.server.close(() => resolve()));
      }
      this.server = null;
    }
    logger.info('Net 服务已停止');
  }

  getClientCount(): number {
    return this.connections.size;
  }

  // ============ Bun WebSocket Server ============

  private async startBun(host: string, port: number): Promise<void> {
    const self = this;
    const Bun = (globalThis as any).Bun;

    this.server = Bun.serve({
      hostname: host,
      port,
      fetch(req: Request, server: any) {
        const url = new URL(req.url);
        if (url.pathname === '/ws' || url.pathname === '/') {
          const ip = server.requestIP(req)?.address ?? 'unknown';
          if (self.isRateLimited(ip)) {
            return new Response('Too Many Requests', { status: 429 });
          }
          const success = server.upgrade(req, { data: { ip } });
          if (!success) {
            return new Response('WebSocket upgrade failed', { status: 400 });
          }
          return undefined;
        }
        return new Response('Not Found', { status: 404 });
      },
      websocket: {
        open(ws: any) {
          // 连接已打开，等待 auth 消息（10s 内必须认证）
          const authTimer = setTimeout(() => {
            try { ws.close(4008, 'Auth timeout'); } catch {}
          }, 10_000);
          (ws as any)._bridge = { authenticated: false, ip: ws.data?.ip ?? 'unknown', authTimer };
        },
        message(ws: any, message: string | Buffer) {
          const data = typeof message === 'string' ? message : message.toString('utf-8');
          const bridge = (ws as any)._bridge;

          if (!bridge.authenticated) {
            clearTimeout(bridge.authTimer);
            self.handleAuth(ws, data, bridge.ip, 'bun');
          } else if (bridge.conn) {
            // 转发 WS → TCP
            self.forwardWsToTcp(bridge.conn, data);
          }
        },
        close(ws: any) {
          const bridge = (ws as any)._bridge;
          if (bridge?.conn) {
            self.closeConnection(bridge.conn);
          }
        },
        pong(ws: any) {
          const bridge = (ws as any)._bridge;
          if (bridge?.conn) {
            bridge.conn.pongReceived = true;
          }
        },
      },
    });
  }

  // ============ ws Package WebSocket Server ============

  private async startWs(host: string, port: number): Promise<void> {
    const { WebSocketServer } = await import('ws');
    const wss = new WebSocketServer({ host, port });
    this.server = wss;

    wss.on('connection', (ws: any, req: any) => {
      const ip = req.socket.remoteAddress ?? 'unknown';

      if (this.isRateLimited(ip)) {
        ws.close(4029, 'Rate limited');
        return;
      }

      let authenticated = false;
      let conn: BridgeConnection | undefined;

      // 10s 内必须认证，否则关闭
      const authTimer = setTimeout(() => {
        if (!authenticated) {
          try { ws.close(4008, 'Auth timeout'); } catch {}
        }
      }, 10_000);

      ws.on('message', (data: Buffer) => {
        const str = data.toString('utf-8');

        if (!authenticated) {
          clearTimeout(authTimer);
          this.handleAuth(ws, str, ip, 'ws', (bridge) => {
            authenticated = true;
            conn = bridge;
          });
        } else if (conn) {
          this.forwardWsToTcp(conn, str);
        }
      });

      ws.on('close', () => {
        if (conn) this.closeConnection(conn);
      });

      ws.on('pong', () => {
        if (conn) conn.pongReceived = true;
      });
    });
  }

  // ============ 认证 ============

  private handleAuth(
    ws: any,
    data: string,
    ip: string,
    mode: 'bun' | 'ws',
    onSuccess?: (conn: BridgeConnection) => void,
  ): void {
    const token = this.config.token;
    if (!token) {
      this.wsClose(ws, mode, 4003, 'No token configured');
      return;
    }

    const result = validateAuthMessage(data, token);
    if (!result.valid) {
      this.recordAuthFailure(ip);
      logger.warn(`认证失败 (ip=${ip}): ${result.error}`);
      this.wsClose(ws, mode, 4003, 'Unauthorized');
      return;
    }

    // 认证通过，建立 TCP 连接到本地 IPCServer
    const tcp = net.createConnection({ port: this.ipcPort, host: '127.0.0.1' });
    const decoder = new FrameDecoder();

    const conn: BridgeConnection = {
      ws,
      tcp,
      decoder,
      authenticated: true,
      pongReceived: true,
    };

    tcp.pipe(decoder);

    // TCP → WS：FrameDecoder 解析出 JSON 对象后转发
    decoder.on('data', (msg: unknown) => {
      try {
        const json = JSON.stringify(msg);
        this.wsSend(ws, mode, json);
      } catch (err) {
        logger.warn(`TCP→WS 序列化失败: ${(err as Error).message}`);
      }
    });

    tcp.on('error', (err) => {
      logger.warn(`TCP 连接错误: ${err.message}`);
      this.closeConnection(conn);
    });

    tcp.on('close', () => {
      this.closeConnection(conn);
    });

    decoder.on('error', (err) => {
      logger.warn(`TCP 帧解析错误: ${err.message}`);
      this.closeConnection(conn);
    });

    this.connections.add(conn);

    // 设置心跳
    conn.heartbeatTimer = setInterval(() => {
      if (!conn.pongReceived) {
        logger.warn('WS 心跳超时，关闭连接');
        this.closeConnection(conn);
        return;
      }
      conn.pongReceived = false;
      this.wsPing(ws, mode);
    }, 30_000);

    // 通知客户端认证成功
    this.wsSend(ws, mode, JSON.stringify({ type: 'auth_ok' }));

    // Bun 模式下在 ws 实例上记录 bridge
    if (mode === 'bun') {
      (ws as any)._bridge = { authenticated: true, conn, ip };
    }

    onSuccess?.(conn);
    logger.info(`远程客户端已连接 (ip=${ip})`);
  }

  // ============ 消息转发 ============

  private forwardWsToTcp(conn: BridgeConnection, data: string): void {
    try {
      // WS 消息是完整 JSON 字符串，需要加上长度前缀发送给 IPCServer
      const parsed = JSON.parse(data);
      const frame = encodeFrame(parsed);
      conn.tcp.write(frame);
    } catch (err) {
      logger.warn(`WS→TCP 转发失败: ${(err as Error).message}`);
    }
  }

  // ============ 连接清理 ============

  private closeConnection(conn: BridgeConnection): void {
    if (!this.connections.has(conn)) return;
    this.connections.delete(conn);

    if (conn.heartbeatTimer) {
      clearInterval(conn.heartbeatTimer);
      conn.heartbeatTimer = undefined;
    }

    conn.tcp.destroy();
    // WS 可能已经关闭，忽略错误
    try {
      if (typeof conn.ws.close === 'function') {
        conn.ws.close();
      } else if (typeof conn.ws.terminate === 'function') {
        conn.ws.terminate();
      }
    } catch {}
  }

  // ============ 速率限制 ============

  private isRateLimited(ip: string): boolean {
    const entry = this.rateLimits.get(ip);
    if (!entry) return false;

    const now = Date.now();

    // 检查是否在封禁期内
    if (entry.bannedUntil > now) return true;

    // 超出窗口，重置
    if (now - entry.firstFailAt > RATE_LIMIT_WINDOW) {
      this.rateLimits.delete(ip);
      return false;
    }

    return false;
  }

  private recordAuthFailure(ip: string): void {
    const now = Date.now();
    const entry = this.rateLimits.get(ip);

    if (!entry || now - entry.firstFailAt > RATE_LIMIT_WINDOW) {
      this.rateLimits.set(ip, { count: 1, firstFailAt: now, bannedUntil: 0 });
      return;
    }

    entry.count++;
    if (entry.count >= RATE_LIMIT_MAX_FAILURES) {
      entry.bannedUntil = now + RATE_LIMIT_BAN_DURATION;
      logger.warn(`IP ${ip} 认证失败次数过多，封禁 ${RATE_LIMIT_BAN_DURATION / 1000}s`);
    }
  }

  // ============ WS 运行时适配 ============

  private wsSend(ws: any, mode: 'bun' | 'ws', data: string): void {
    try {
      if (mode === 'bun') {
        ws.send(data);
      } else {
        if (ws.readyState === 1 /* OPEN */) {
          ws.send(data);
        }
      }
    } catch {}
  }

  private wsPing(ws: any, mode: 'bun' | 'ws'): void {
    try {
      if (mode === 'bun') {
        ws.ping();
      } else {
        if (ws.readyState === 1) {
          ws.ping();
        }
      }
    } catch {}
  }

  private wsClose(ws: any, mode: 'bun' | 'ws', code: number, reason: string): void {
    try {
      ws.close(code, reason);
    } catch {}
  }
}
