/**
 * Relay Hub — 中继服务器
 *
 * 轻量级 WebSocket 中继，用于 NAT 穿透。
 * Iris 节点注册到 Hub，远程客户端通过 Hub 连接节点。
 *
 * 协议流程：
 *   1. 节点连接 → 发 register {nodeId, token}
 *   2. 客户端连接 → 发 connect {nodeId, token}
 *   3. Token 匹配 → 向双方发 paired → 后续消息透传
 *   4. 任一方断开 → 向对方发 peer_disconnected
 *
 * 启动方式：iris relay --port 9001
 */

/// <reference path="./ws.d.ts" />

import { createLogger } from '../../../src/logger';
import { constantTimeEqual } from './auth';
import type { RelayMessage } from './types';

const logger = createLogger('Relay');

/** 已注册的节点 */
interface RegisteredNode {
  ws: any;
  nodeId: string;
  token: string;
  pairedClient: any | null;
  mode: 'bun' | 'ws';
}

/** 已连接的客户端 */
interface ConnectedClient {
  ws: any;
  nodeId: string;
  pairedNode: RegisteredNode | null;
  mode: 'bun' | 'ws';
}

export class RelayHub {
  private nodes = new Map<string, RegisteredNode>();
  private server: any = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  private isBun: boolean;

  constructor() {
    this.isBun = typeof (globalThis as any).Bun !== 'undefined';
  }

  async start(port: number, host = '0.0.0.0'): Promise<void> {
    if (this.isBun) {
      await this.startBun(host, port);
    } else {
      await this.startWs(host, port);
    }

    // 心跳检测：每 30s ping 所有节点和已配对的客户端
    this.heartbeatTimer = setInterval(() => {
      for (const node of this.nodes.values()) {
        this.wsPing(node.ws, node.mode);
        if (node.pairedClient) {
          this.wsPing(node.pairedClient, node.mode);
        }
      }
    }, 30_000);

    logger.info(`Relay Hub 已启动: ${host}:${port}`);
  }

  async stop(): Promise<void> {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }

    for (const node of this.nodes.values()) {
      try { node.ws.close(); } catch {}
    }
    this.nodes.clear();

    if (this.server) {
      if (this.isBun) {
        this.server.stop();
      } else {
        await new Promise<void>((resolve) => this.server.close(() => resolve()));
      }
      this.server = null;
    }
    logger.info('Relay Hub 已停止');
  }

  // ============ Bun Server ============

  private async startBun(host: string, port: number): Promise<void> {
    const self = this;
    const Bun = (globalThis as any).Bun;

    this.server = Bun.serve({
      hostname: host,
      port,
      fetch(req: Request, server: any) {
        const success = server.upgrade(req);
        if (!success) {
          return new Response('Iris Relay Hub', { status: 200 });
        }
        return undefined;
      },
      websocket: {
        open(ws: any) {
          (ws as any)._relay = { role: 'unknown' };
        },
        message(ws: any, message: string | Buffer) {
          const data = typeof message === 'string' ? message : message.toString('utf-8');
          self.handleMessage(ws, data, 'bun');
        },
        close(ws: any) {
          self.handleClose(ws);
        },
      },
    });
  }

  // ============ ws Package Server ============

  private async startWs(host: string, port: number): Promise<void> {
    const { WebSocketServer } = await import('ws');
    const wss = new WebSocketServer({ host, port });
    this.server = wss;

    wss.on('connection', (ws: any) => {
      (ws as any)._relay = { role: 'unknown' };

      ws.on('message', (data: Buffer) => {
        this.handleMessage(ws, data.toString('utf-8'), 'ws');
      });

      ws.on('close', () => {
        this.handleClose(ws);
      });
    });
  }

  // ============ 消息处理 ============

  private handleMessage(ws: any, data: string, mode: 'bun' | 'ws'): void {
    let msg: RelayMessage;
    try {
      msg = JSON.parse(data);
    } catch {
      this.wsSend(ws, mode, JSON.stringify({ type: 'error', message: 'invalid_json' }));
      return;
    }

    if (msg.type === 'register') {
      this.handleRegister(ws, msg, mode);
    } else if (msg.type === 'connect') {
      this.handleConnect(ws, msg, mode);
    } else if (msg.type === 'data') {
      // 透传数据
      this.handleData(ws, msg);
    } else {
      // 未知消息类型也尝试作为 data 透传
      this.handleRawForward(ws, data);
    }
  }

  private handleRegister(ws: any, msg: { type: 'register'; nodeId: string; token: string }, mode: 'bun' | 'ws'): void {
    const { nodeId, token } = msg;

    if (!nodeId || !token) {
      this.wsSend(ws, mode, JSON.stringify({ type: 'error', message: 'missing nodeId or token' }));
      return;
    }

    // 如果该 nodeId 已有注册，关闭旧连接
    const existing = this.nodes.get(nodeId);
    if (existing) {
      logger.info(`节点 ${nodeId} 重新注册，关闭旧连接`);
      try { existing.ws.close(); } catch {}
      this.nodes.delete(nodeId);
    }

    const node: RegisteredNode = { ws, nodeId, token, pairedClient: null, mode };
    this.nodes.set(nodeId, node);
    (ws as any)._relay = { role: 'node', nodeId };

    logger.info(`节点已注册: ${nodeId}`);
  }

  private handleConnect(ws: any, msg: { type: 'connect'; nodeId: string; token: string }, mode: 'bun' | 'ws'): void {
    const { nodeId, token } = msg;

    const node = this.nodes.get(nodeId);
    if (!node) {
      this.wsSend(ws, mode, JSON.stringify({ type: 'error', message: `节点 "${nodeId}" 未注册` }));
      return;
    }

    // 验证 token 匹配（常量时间比较，防止时序攻击）
    if (!constantTimeEqual(node.token, token)) {
      this.wsSend(ws, mode, JSON.stringify({ type: 'error', message: 'token 不匹配' }));
      return;
    }

    // 如果节点已有配对客户端，断开旧客户端
    if (node.pairedClient) {
      logger.info(`节点 ${nodeId} 已有客户端，断开旧连接`);
      this.wsSend(node.pairedClient, node.mode, JSON.stringify({ type: 'peer_disconnected' }));
      try { node.pairedClient.close(); } catch {}
    }

    // 配对
    node.pairedClient = ws;
    (ws as any)._relay = { role: 'client', nodeId, pairedNode: node };

    // 通知双方已配对
    this.wsSend(ws, mode, JSON.stringify({ type: 'paired' }));
    this.wsSend(node.ws, node.mode, JSON.stringify({ type: 'paired' }));

    logger.info(`客户端已与节点 ${nodeId} 配对`);
  }

  private handleData(ws: any, msg: { type: 'data'; payload: unknown }): void {
    const relay = (ws as any)._relay;
    if (!relay) return;

    if (relay.role === 'node') {
      // 节点 → 客户端
      const node = this.nodes.get(relay.nodeId);
      if (node?.pairedClient) {
        this.wsSend(node.pairedClient, node.mode, JSON.stringify(msg));
      }
    } else if (relay.role === 'client') {
      // 客户端 → 节点
      const node = relay.pairedNode as RegisteredNode;
      if (node) {
        this.wsSend(node.ws, node.mode, JSON.stringify(msg));
      }
    }
  }

  /**
   * 对于非 relay 协议消息（即 IPC JSON-RPC 消息），
   * 自动包装为 data 类型转发。
   */
  private handleRawForward(ws: any, data: string): void {
    const relay = (ws as any)._relay;
    if (!relay) return;

    const wrapped = JSON.stringify({ type: 'data', payload: JSON.parse(data) });

    if (relay.role === 'node') {
      const node = this.nodes.get(relay.nodeId);
      if (node?.pairedClient) {
        this.wsSend(node.pairedClient, node.mode, wrapped);
      }
    } else if (relay.role === 'client') {
      const node = relay.pairedNode as RegisteredNode;
      if (node) {
        this.wsSend(node.ws, node.mode, wrapped);
      }
    }
  }

  private handleClose(ws: any): void {
    const relay = (ws as any)._relay;
    if (!relay) return;

    if (relay.role === 'node') {
      const node = this.nodes.get(relay.nodeId);
      if (node) {
        // 通知配对的客户端
        if (node.pairedClient) {
          this.wsSend(node.pairedClient, node.mode, JSON.stringify({ type: 'peer_disconnected' }));
        }
        this.nodes.delete(relay.nodeId);
        logger.info(`节点断开: ${relay.nodeId}`);
      }
    } else if (relay.role === 'client') {
      const node = relay.pairedNode as RegisteredNode | null;
      if (node) {
        node.pairedClient = null;
        // 通知节点客户端已断开
        this.wsSend(node.ws, node.mode, JSON.stringify({ type: 'peer_disconnected' }));
        logger.info(`客户端断开 (node=${node.nodeId})`);
      }
    }
  }

  // ============ WS 适配 ============

  private wsSend(ws: any, mode: 'bun' | 'ws', data: string): void {
    try {
      if (mode === 'bun') {
        ws.send(data);
      } else {
        if (ws.readyState === 1) ws.send(data);
      }
    } catch {}
  }

  private wsPing(ws: any, mode: 'bun' | 'ws'): void {
    try {
      if (mode === 'bun') {
        ws.ping();
      } else {
        if (ws.readyState === 1) ws.ping();
      }
    } catch {}
  }
}

// ============ CLI 入口 ============

export async function runRelay(argv: string[]): Promise<void> {
  let port = 9001;
  let host = '0.0.0.0';

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--port' && argv[i + 1]) {
      port = parseInt(argv[++i], 10);
    } else if (argv[i] === '--host' && argv[i + 1]) {
      host = argv[++i];
    } else if (argv[i] === '--help' || argv[i] === '-h') {
      console.log(`
iris relay — 启动远程互联中继服务器

参数:
  --port <number>  监听端口（默认: 9001）
  --host <addr>    监听地址（默认: 0.0.0.0）
  -h, --help       显示帮助
`);
      process.exit(0);
    }
  }

  const hub = new RelayHub();
  await hub.start(port, host);
  console.log(`[Iris] Relay Hub 已启动: ${host}:${port}`);
  console.log('按 Ctrl+C 停止...');

  // 等待信号退出
  const shutdown = async () => {
    console.log('\n正在关闭 Relay Hub...');
    await hub.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // 保持进程存活
  await new Promise(() => {});
}
