/**
 * IPC 服务端
 *
 * 在 IrisHost 启动后为每个 IrisCore 创建一个 TCP 服务端，
 * 绑定到 127.0.0.1 的自动分配端口。
 *
 * 外部进程（如 `iris attach`）通过读取 lock 文件获取端口号，
 * 连接后通过 JSON-RPC 2.0 协议与 Backend 交互。
 */

import net from 'node:net';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { EventEmitter } from 'node:events';
import { createLogger } from '../logger';
import { encodeFrame, FrameDecoder } from './framing';
import {
  type IPCRequest, type IPCResponse, type IPCNotification, type IPCMessage,
  type LockFileContent, type SerializedToolHandle, type HandshakeResult,
  ErrorCodes, Methods, BACKEND_EVENT_TO_IPC, Events,
  isRequest,
} from './protocol';

const logger = createLogger('IPCServer');

// ============ 客户端连接 ============

/** 单个 IPC 客户端连接 */
class ClientConnection {
  /** 订阅的 sessionId 集合，'*' 表示订阅全部 */
  subscribedSessions = new Set<string>();
  private decoder: FrameDecoder;

  constructor(
    readonly id: string,
    readonly socket: net.Socket,
    private onMessage: (conn: ClientConnection, msg: IPCMessage) => void,
    private onClose: (conn: ClientConnection) => void,
  ) {
    this.decoder = new FrameDecoder();
    socket.pipe(this.decoder);

    this.decoder.on('data', (msg: IPCMessage) => {
      this.onMessage(this, msg);
    });

    this.decoder.on('error', (err) => {
      logger.warn(`客户端 ${this.id} 帧解析错误: ${err.message}`);
      this.close();
    });

    socket.on('close', () => this.onClose(this));
    socket.on('error', (err) => {
      logger.warn(`客户端 ${this.id} socket 错误: ${err.message}`);
    });
  }

  send(msg: IPCResponse | IPCNotification): void {
    if (this.socket.writable) {
      this.socket.write(encodeFrame(msg));
    }
  }

  /** 检查是否订阅了指定 session */
  isSubscribed(sessionId: string): boolean {
    return this.subscribedSessions.has('*') || this.subscribedSessions.has(sessionId);
  }

  close(): void {
    this.socket.destroy();
  }
}

// ============ IPCServer ============

/**
 * IPCServer 对 Backend 的最小依赖接口。
 *
 * 不直接引用 Backend 类或 IrisBackendLike（避免循环依赖），
 * 而是精确声明 IPCServer 实际调用的方法子集。
 */
interface IPCBackendLike {
  // EventEmitter 方法
  on(event: string, listener: (...args: any[]) => void): any;
  removeListener(event: string, listener: (...args: any[]) => void): any;
  // 必选
  chat(sessionId: string, text: string, images?: unknown[], documents?: unknown[], platform?: string): Promise<unknown>;
  clearSession(sessionId: string): Promise<void>;
  switchModel(modelName: string, platform?: string): unknown;
  listModels(): unknown[];
  listSessionMetas(): Promise<unknown[]>;
  abortChat(sessionId: string): void;
  isStreamEnabled(): boolean;
  // 可选
  undo?(sessionId: string, scope?: string): Promise<unknown>;
  redo?(sessionId: string): Promise<unknown>;
  clearRedo?(sessionId: string): void;
  getHistory?(sessionId: string): Promise<unknown[]>;
  listSkills?(): unknown[];
  listModes?(): unknown[];
  switchMode?(modeName: string): boolean;
  summarize?(sessionId: string): Promise<unknown>;
  getToolNames?(): string[];
  getCurrentModelInfo?(): unknown;
  getDisabledTools?(): string[];
  getActiveSessionId?(): string | undefined;
  getToolHandle?(toolId: string): unknown;
  getToolHandles?(sessionId: string): unknown[];
  runCommand?(cmd: string): unknown;
  resetConfigToDefaults?(): unknown;
  getAgentTasks?(sessionId: string): unknown[];
  getRunningAgentTasks?(sessionId: string): unknown[];
  getAgentTask?(taskId: string): unknown;
  getToolPolicies?(): Record<string, unknown> | undefined;
  getCwd?(): string;
  setCwd?(dirPath: string): void;
}

/** IPCServer 对 ToolExecutionHandle 的最小依赖接口 */
interface IPCToolHandle {
  approve(v: boolean): void;
  apply(v: boolean): void;
  abort(): void;
  on(event: string, listener: (...args: any[]) => void): any;
  id?: string;
  toolName?: string;
  status?: string;
  getSnapshot?(): Record<string, any>;
}


export interface IPCServerOptions {
  /** Backend 实例 */
  backend: IPCBackendLike;
  /** 可选的 IrisAPI 子集 */
  api?: Record<string, any>;
  /** Agent 名称 */
  agentName: string;
  /** 数据目录（存放 lock 文件） */
  dataDir: string;
}

export class IPCServer extends EventEmitter {
  private server: net.Server | null = null;
  private clients = new Map<string, ClientConnection>();
  private nextClientId = 1;
  private port = 0;
  private lockFilePath: string;
  private backend: IPCBackendLike;
  private api: Record<string, any> | undefined;
  private agentName: string;
  private dataDir: string;
  /** 服务端侧注册的活跃 ToolExecutionHandle，以 handleId 为 key */
  private activeHandles = new Map<string, IPCToolHandle>();
  /** Backend 事件监听器引用（用于关闭时清理） */
  private eventListeners: Array<{ event: string; listener: (...args: any[]) => void }> = [];

  constructor(options: IPCServerOptions) {
    super();
    this.backend = options.backend;
    this.api = options.api;
    this.agentName = options.agentName;
    this.dataDir = options.dataDir;
    this.lockFilePath = path.join(this.dataDir, `iris-${this.agentName}.lock`);
  }

  async start(): Promise<number> {
    // 确保数据目录存在
    fs.mkdirSync(this.dataDir, { recursive: true });

    // 检查是否已有实例运行
    this.checkExistingInstance();

    return new Promise((resolve, reject) => {
      this.server = net.createServer((socket) => this.handleConnection(socket));

      this.server.on('error', (err) => {
        logger.error(`IPC 服务启动失败: ${err.message}`);
        reject(err);
      });

      // 绑定 127.0.0.1 端口 0（OS 自动分配）
      this.server.listen(0, '127.0.0.1', () => {
        const addr = this.server!.address() as net.AddressInfo;
        this.port = addr.port;
        this.writeLockFile();
        this.setupBackendEventForwarding();
        logger.info(`IPC 服务已启动: 127.0.0.1:${this.port} (agent=${this.agentName})`);
        resolve(this.port);
      });
    });
  }

  async stop(): Promise<void> {
    // 断开所有客户端
    for (const client of this.clients.values()) {
      client.close();
    }
    this.clients.clear();

    // 移除 Backend 事件监听器
    for (const { event, listener } of this.eventListeners) {
      this.backend.removeListener(event, listener);
    }
    this.eventListeners = [];

    // 关闭服务器
    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server!.close(() => resolve());
      });
      this.server = null;
    }

    // 清理 lock 文件
    this.removeLockFile();
    this.activeHandles.clear();

    logger.info('IPC 服务已停止');
  }

  getPort(): number {
    return this.port;
  }

  getClientCount(): number {
    return this.clients.size;
  }

  // ============ 连接管理 ============

  private handleConnection(socket: net.Socket): void {
    const clientId = `client-${this.nextClientId++}`;
    const conn = new ClientConnection(
      clientId,
      socket,
      (c, msg) => this.handleMessage(c, msg),
      (c) => this.handleDisconnect(c),
    );
    this.clients.set(clientId, conn);
    logger.info(`IPC 客户端已连接: ${clientId}`);
  }

  private handleDisconnect(conn: ClientConnection): void {
    this.clients.delete(conn.id);
    logger.info(`IPC 客户端已断开: ${conn.id}`);
  }

  // ============ 消息分发 ============

  private handleMessage(conn: ClientConnection, msg: IPCMessage): void {
    if (!isRequest(msg)) {
      logger.warn(`收到非 Request 消息，忽略`);
      return;
    }

    this.dispatchRequest(conn, msg).catch((err) => {
      logger.error(`处理请求失败: ${msg.method}`, err);
      conn.send({
        jsonrpc: '2.0',
        id: msg.id,
        error: { code: ErrorCodes.INTERNAL_ERROR, message: (err as Error).message },
      });
    });
  }

  private async dispatchRequest(conn: ClientConnection, req: IPCRequest): Promise<void> {
    const params = req.params ?? [];

    try {
      let result: unknown;

      switch (req.method) {
        // ---- Backend 核心方法 ----
        case Methods.CHAT:
          result = await this.backend.chat(params[0] as string, params[1] as string, params[2] as unknown[] | undefined, params[3] as unknown[] | undefined, params[4] as string | undefined);
          break;
        case Methods.CLEAR_SESSION:
          result = await this.backend.clearSession(params[0] as string);
          break;
        case Methods.SWITCH_MODEL:
          result = this.backend.switchModel(params[0] as string, params[1] as string | undefined);
          break;
        case Methods.LIST_MODELS:
          result = this.backend.listModels();
          break;
        case Methods.LIST_SESSION_METAS:
          result = await this.backend.listSessionMetas();
          break;
        case Methods.ABORT_CHAT:
          this.backend.abortChat(params[0] as string);
          result = null;
          break;
        case Methods.IS_STREAM_ENABLED:
          result = this.backend.isStreamEnabled();
          break;
        case Methods.UNDO:
          result = await this.backend.undo?.(params[0] as string, params[1] as string | undefined) ?? null;
          break;
        case Methods.REDO:
          result = await this.backend.redo?.(params[0] as string) ?? null;
          break;
        case Methods.CLEAR_REDO:
          this.backend.clearRedo?.(params[0] as string);
          result = null;
          break;
        case Methods.GET_HISTORY:
          result = await this.backend.getHistory?.(params[0] as string) ?? [];
          break;
        case Methods.LIST_SKILLS:
          result = this.backend.listSkills?.() ?? [];
          break;
        case Methods.LIST_MODES:
          result = this.backend.listModes?.() ?? [];
          break;
        case Methods.SWITCH_MODE:
          result = this.backend.switchMode?.(params[0] as string) ?? false;
          break;
        case Methods.SUMMARIZE:
          result = await this.backend.summarize?.(params[0] as string);
          break;
        case Methods.GET_TOOL_NAMES:
          result = this.backend.getToolNames?.() ?? [];
          break;
        case Methods.GET_CURRENT_MODEL_INFO:
          result = this.backend.getCurrentModelInfo?.();
          break;
        case Methods.GET_DISABLED_TOOLS:
          result = this.backend.getDisabledTools?.();
          break;
        case Methods.GET_ACTIVE_SESSION_ID:
          result = this.backend.getActiveSessionId?.();
          break;
        case Methods.RUN_COMMAND:
          result = this.backend.runCommand?.(params[0] as string);
          break;
        case Methods.RESET_CONFIG:
          result = this.backend.resetConfigToDefaults?.();
          break;
        case Methods.GET_AGENT_TASKS:
          result = this.backend.getAgentTasks?.(params[0] as string) ?? [];
          break;
        case Methods.GET_RUNNING_AGENT_TASKS:
          result = this.backend.getRunningAgentTasks?.(params[0] as string) ?? [];
          break;
        case Methods.GET_AGENT_TASK:
          result = this.backend.getAgentTask?.(params[0] as string);
          break;
        case Methods.GET_TOOL_POLICIES:
          result = this.backend.getToolPolicies?.();
          break;
        case Methods.GET_CWD:
          result = this.backend.getCwd?.();
          break;
        case Methods.SET_CWD:
          this.backend.setCwd?.(params[0] as string);
          result = null;
          break;

        // ---- 工具 Handle ----
        case Methods.GET_TOOL_HANDLE: {
          const handle = this.backend.getToolHandle?.(params[0] as string);
          result = handle ? this.serializeHandle(handle) : null;
          break;
        }
        case Methods.GET_TOOL_HANDLES: {
          const handles = this.backend.getToolHandles?.(params[0] as string) ?? [];
          result = handles.map((h: any) => this.serializeHandle(h));
          break;
        }

        // ---- Handle 操作 ----
        case Methods.HANDLE_APPROVE: {
          const h = this.activeHandles.get(params[0] as string);
          if (!h) {
            conn.send({ jsonrpc: '2.0', id: req.id, error: { code: ErrorCodes.HANDLE_NOT_FOUND, message: `Handle not found: ${params[0]}` } });
            return;
          }
          (h as any).approve(params[1] ?? true);
          result = true;
          break;
        }
        case Methods.HANDLE_REJECT: {
          const h = this.activeHandles.get(params[0] as string);
          if (!h) {
            conn.send({ jsonrpc: '2.0', id: req.id, error: { code: ErrorCodes.HANDLE_NOT_FOUND, message: `Handle not found: ${params[0]}` } });
            return;
          }
          (h as any).approve(false);
          result = true;
          break;
        }
        case Methods.HANDLE_APPLY: {
          const h = this.activeHandles.get(params[0] as string);
          if (!h) {
            conn.send({ jsonrpc: '2.0', id: req.id, error: { code: ErrorCodes.HANDLE_NOT_FOUND, message: `Handle not found: ${params[0]}` } });
            return;
          }
          (h as any).apply(params[1] ?? true);
          result = true;
          break;
        }
        case Methods.HANDLE_ABORT: {
          const h = this.activeHandles.get(params[0] as string);
          if (!h) {
            conn.send({ jsonrpc: '2.0', id: req.id, error: { code: ErrorCodes.HANDLE_NOT_FOUND, message: `Handle not found: ${params[0]}` } });
            return;
          }
          (h as any).abort();
          result = true;
          break;
        }

        // ---- 客户端控制 ----
        case Methods.SUBSCRIBE: {
          const sessions = params[0] as string[] | string;
          const list = Array.isArray(sessions) ? sessions : [sessions];
          for (const sid of list) conn.subscribedSessions.add(sid);
          result = { subscribed: list };
          break;
        }
        case Methods.UNSUBSCRIBE: {
          const sessions = params[0] as string[] | string;
          const list = Array.isArray(sessions) ? sessions : [sessions];
          for (const sid of list) conn.subscribedSessions.delete(sid);
          result = { unsubscribed: list };
          break;
        }
        case Methods.INIT_SESSION_CWD: {
          const { initSessionCwd } = await import('../core/backend/session-context');
          initSessionCwd(params[0] as string, params[1] as string);
          result = null;
          break;
        }
        case Methods.HANDSHAKE: {
          const handshake: HandshakeResult = {
            version: '1.0.0',
            agentName: this.agentName,
            pid: process.pid,
            streamEnabled: this.backend.isStreamEnabled?.() ?? true,
          };
          result = handshake;
          break;
        }

        // ---- API 子集 ----
        case Methods.API_SET_LOG_LEVEL:
          this.api?.setLogLevel?.(...params);
          result = null;
          break;
        case Methods.API_GET_CONSOLE_SETTINGS_TABS:
          result = this.api?.getConsoleSettingsTabs?.() ?? [];
          break;
        case Methods.API_LIST_AGENTS:
          result = this.api?.listAgents?.() ?? [];
          break;
        case Methods.API_AGENT_NETWORK_LIST_PEERS:
          result = this.api?.agentNetwork?.listPeers?.() ?? [];
          break;
        case Methods.API_AGENT_NETWORK_GET_PEER_DESCRIPTION:
          result = this.api?.agentNetwork?.getPeerDescription?.(...params);
          break;
        case Methods.API_CONFIG_MANAGER_READ:
          result = await this.api?.configManager?.readEditableConfig?.();
          break;
        case Methods.API_CONFIG_MANAGER_UPDATE:
          result = await this.api?.configManager?.updateEditableConfig?.(...params);
          break;
        case Methods.API_ROUTER_REMOVE_REQUEST_BODY_KEYS:
          this.api?.router?.removeCurrentModelRequestBodyKeys?.(...params);
          result = null;
          break;
        case Methods.API_ROUTER_PATCH_REQUEST_BODY:
          this.api?.router?.patchCurrentModelRequestBody?.(...params);
          result = null;
          break;

        // ---- 服务端全局信息 ----
        case Methods.GET_CONFIG: {
          // 返回当前 Backend 的配置快照
          const config = (this.backend as any).config ?? {};
          result = config;
          break;
        }
        case Methods.GET_CONFIG_DIR: {
          // 从 api 中获取 configDir
          const configDir = this.api?.configDir ?? this.dataDir ?? '';
          result = configDir;
          break;
        }

        default:
          conn.send({
            jsonrpc: '2.0',
            id: req.id,
            error: { code: ErrorCodes.METHOD_NOT_FOUND, message: `未知方法: ${req.method}` },
          });
          return;
      }

      conn.send({ jsonrpc: '2.0', id: req.id, result });
    } catch (err) {
      conn.send({
        jsonrpc: '2.0',
        id: req.id,
        error: {
          code: ErrorCodes.BACKEND_ERROR,
          message: err instanceof Error ? err.message : String(err),
        },
      });
    }
  }

  // ============ 工具 Handle 管理 ============

  private serializeHandle(handle: any): SerializedToolHandle {
    const snapshot = handle.getSnapshot?.() ?? {};
    const handleId = handle.id ?? snapshot.id ?? '';

    // 幂等：如果已经注册过，直接返回序列化结果，不重复注册事件
    if (!this.activeHandles.has(handleId)) {
      this.activeHandles.set(handleId, handle);
      // 转发 handle 事件到客户端
      this.forwardHandleEvents(handleId, handle, snapshot.sessionId);
    }

    return {
      handleId,
      toolName: handle.toolName ?? snapshot.toolName ?? '',
      toolId: handleId,
      args: snapshot.args ?? {},
      state: String(handle.status ?? snapshot.status ?? 'pending'),
    };
  }

  private forwardHandleEvents(handleId: string, handle: any, sessionId?: string): void {
    const sid = sessionId ?? '';

    const onState = (state: string) => {
      this.broadcastToSubscribed(sid, {
        jsonrpc: '2.0',
        method: Events.HANDLE_STATE,
        params: [handleId, state],
      });
    };

    const onOutput = (output: unknown) => {
      this.broadcastToSubscribed(sid, {
        jsonrpc: '2.0',
        method: Events.HANDLE_OUTPUT,
        params: [handleId, output],
      });
    };

    const onProgress = (progress: unknown) => {
      this.broadcastToSubscribed(sid, {
        jsonrpc: '2.0',
        method: Events.HANDLE_PROGRESS,
        params: [handleId, progress],
      });
    };

    const onMessage = (type: string, data?: unknown) => {
      this.broadcastToSubscribed(sid, {
        jsonrpc: '2.0',
        method: Events.HANDLE_STREAM,
        params: [handleId, type, data],
      });
    };

    handle.on('state', onState);
    handle.on('output', onOutput);
    handle.on('progress', onProgress);
    handle.on('message', onMessage);

    // 当 handle 进入终态时清理
    const cleanup = () => {
      this.activeHandles.delete(handleId);
      handle.off('state', onState);
      handle.off('output', onOutput);
      handle.off('progress', onProgress);
      handle.off('message', onMessage);
    };
    handle.on('state', (state: string) => {
      if (['done', 'error', 'aborted'].includes(state)) cleanup();
    });
  }

  // ============ Backend 事件转发 ============

  private setupBackendEventForwarding(): void {
    for (const [backendEvent, ipcEvent] of Object.entries(BACKEND_EVENT_TO_IPC)) {
      const listener = (...args: any[]) => {
        // Backend 事件的第一个参数始终是 sessionId
        const sessionId = args[0] as string;

        // 特殊处理 tool:execute 事件：序列化 ToolExecutionHandle
        if (backendEvent === 'tool:execute') {
          const handle = args[1];
          const serialized = this.serializeHandle(handle);
          this.broadcastToSubscribed(sessionId, {
            jsonrpc: '2.0',
            method: ipcEvent,
            params: [sessionId, serialized],
          });
          return;
        }

        this.broadcastToSubscribed(sessionId, {
          jsonrpc: '2.0',
          method: ipcEvent,
          params: args,
        });
      };

      this.backend.on(backendEvent, listener);
      this.eventListeners.push({ event: backendEvent, listener });
    }
  }

  /** 向所有订阅了指定 session 的客户端广播消息 */
  private broadcastToSubscribed(sessionId: string, msg: IPCNotification): void {
    for (const client of this.clients.values()) {
      if (client.isSubscribed(sessionId)) {
        client.send(msg);
      }
    }
  }

  // ============ Lock 文件管理 ============

  private checkExistingInstance(): void {
    try {
      if (!fs.existsSync(this.lockFilePath)) return;
      const content = JSON.parse(fs.readFileSync(this.lockFilePath, 'utf-8')) as LockFileContent;

      // 检查进程是否存活
      try {
        process.kill(content.pid, 0);
        // 进程存活，报错
        throw new Error(
          `Iris 实例已在运行 (PID=${content.pid}, port=${content.port}, agent=${content.agentName})。` +
          `如果这是残留的 lock 文件，请删除: ${this.lockFilePath}`
        );
      } catch (err: any) {
        if (err.code === 'ESRCH') {
          // 进程不存在，清理残留 lock 文件
          logger.info(`清理残留的 lock 文件 (PID=${content.pid} 已不存在)`);
          fs.unlinkSync(this.lockFilePath);
        } else if (err.message?.includes('实例已在运行')) {
          throw err;
        }
      }
    } catch (err: any) {
      if (err.message?.includes('实例已在运行')) throw err;
      // 其他错误（如文件损坏），忽略并继续
      logger.warn(`检查 lock 文件时出错: ${err.message}`);
    }
  }

  private writeLockFile(): void {
    const content: LockFileContent = {
      pid: process.pid,
      port: this.port,
      agentName: this.agentName,
      startedAt: new Date().toISOString(),
    };
    fs.writeFileSync(this.lockFilePath, JSON.stringify(content, null, 2));
  }

  private removeLockFile(): void {
    try {
      if (fs.existsSync(this.lockFilePath)) {
        fs.unlinkSync(this.lockFilePath);
      }
    } catch {
      // 清理失败不致命
    }
  }
}

// ============ 工具函数 ============

/** 解析 lock 文件，获取连接信息 */
export function readLockFile(dataDir: string, agentName: string): LockFileContent | null {
  const lockFilePath = path.join(dataDir, `iris-${agentName}.lock`);
  try {
    if (!fs.existsSync(lockFilePath)) return null;
    const content = JSON.parse(fs.readFileSync(lockFilePath, 'utf-8')) as LockFileContent;

    // 验证进程是否存活
    try {
      process.kill(content.pid, 0);
      return content;
    } catch {
      // 进程已死，lock 文件已过期
      return null;
    }
  } catch {
    return null;
  }
}
