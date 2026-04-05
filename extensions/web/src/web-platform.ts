/**
 * Web GUI 平台适配器（扩展版本）
 *
 * 提供基于 SSE 的 HTTP API 和静态文件服务。
 * 通过 IrisAPI 与核心逻辑交互。
 */

import * as crypto from 'crypto';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  PlatformAdapter,
  createExtensionLogger,
  isThoughtTextPart,
} from '@irises/extension-sdk';
import type {
  IrisBackendLike,
  RoutableHttpPlatform,
  ImageInput,
  DocumentInput,
  Content,
  Part,
  IrisAPI,
  AgentDefinitionLike,
  MultiAgentCapable,
} from '@irises/extension-sdk';
import { createCloudflareHandlers } from './handlers/cloudflare';
import { createDeployHandlers } from './handlers/deploy';
import { Router, sendJSON, readBody } from './router';
import { createChatHandler } from './handlers/chat';
import { createSessionsHandlers } from './handlers/sessions';
import { createConfigHandlers } from './handlers/config';
import { createDiffPreviewHandler } from './handlers/diff-preview';
import { createExtensionHandlers } from './handlers/extensions';
import { assertManagementToken } from './security/management';
import { formatContent, formatMessages } from './message-format';
import { createTerminalHandler, type TerminalHandler } from './handlers/terminal';
import { createNotificationHandler, type NotificationHandler } from './handlers/notifications';

const logger = createExtensionLogger('WebPlatform');

type RuntimeReloadExtensions = Record<string, unknown>;

export interface WebPlatformConfig {
  port: number;
  host: string;
  authToken?: string;
  managementToken?: string;
  configPath: string;
  /** 当前活动模型的提供商名称（如 gemini / openai-compatible / claude） */
  provider: string;
  modelId: string;
  streamEnabled: boolean;
}

/** 多 Agent 模式下每个 Agent 的上下文 */
export interface AgentContext {
  name: string;
  description?: string;
  backend: IrisBackendLike;
  config: WebPlatformConfig;
  /** MCP 管理器 getter（延迟求值，热重载后自动获取最新引用） */
  getMCPManager: () => any | undefined;
  setMCPManager: (mgr?: any) => void;
  /** 当前 Agent 对应的数据目录，用于热重载时扫描正确的 skills 目录 */
  dataDir?: string;
  extensions?: RuntimeReloadExtensions;
}

/** MIME 类型映射 */
const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
};

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

export interface WebPlatformDeps {
  api?: IrisAPI;
  projectRoot?: string;
  dataDir?: string;
  configDir?: string;
  isCompiledBinary?: boolean;
}

export class WebPlatform extends PlatformAdapter implements MultiAgentCapable, RoutableHttpPlatform {
  private server?: http.Server;
  private router: Router;
  private config: WebPlatformConfig;
  private publicDir: string;
  private deps: WebPlatformDeps;

  /** Agent 上下文 Map（单 Agent 模式下只有一个 'default' 条目） */
  private agents = new Map<string, AgentContext>();
  private defaultAgentName = 'default';

  /** sessionId → 正在处理的 SSE 响应 */
  private pendingResponses = new Map<string, http.ServerResponse>();

  /** 启动时生成的一次性部署令牌 */
  private deployToken: string;

  /** 终端 WebSocket 处理器 */
  private terminalHandler: TerminalHandler;

  /** 通知 WebSocket 处理器（异步子代理事件推送） */
  private notificationHandler: NotificationHandler;

  /** Agent 热重载回调：给定 agent 定义，返回 bootstrap 结果 */
  private reloadHandler?: (agent: AgentDefinitionLike | '__default__') => Promise<any>;

  /** 平台配置热重载回调 */
  private platformReloadHandler?: (mergedConfig: any) => Promise<void>;

  /** 记录当前是否处于多 agent 模式（用于 reload 时判断模式切换） */
  private multiAgentMode = false;

  /** 追踪 wireBackendEvents 绑定的监听器，以便精确移除而不影响其他平台 */
  private backendListenerCleanups = new Map<string, () => void>();

  constructor(backend: IrisBackendLike, config: WebPlatformConfig, deps: WebPlatformDeps = {}) {
    super();
    this.config = config;
    this.deps = deps;
    this.router = new Router();
    this.publicDir = this.resolvePublicDir();
    // 单 Agent 模式：创建默认 agent 上下文
    let _mcpManager: any | undefined;
    this.agents.set('default', {
      name: 'default', backend, config,
      getMCPManager: () => _mcpManager,
      setMCPManager: (mgr?) => { _mcpManager = mgr; },
      dataDir: path.dirname(config.configPath),
      extensions: undefined,
    });
    this.setupRoutes();
    this.deployToken = crypto.randomBytes(16).toString('hex');
    this.terminalHandler = createTerminalHandler(this.deps.isCompiledBinary, this.deps.projectRoot);
    this.notificationHandler = createNotificationHandler();
  }

  /** 解析 public 目录路径 */
  private resolvePublicDir(): string {
    const root = this.deps.projectRoot ?? process.cwd();
    const candidates = [
      path.join(root, 'web-ui', 'dist'),
      path.join(MODULE_DIR, 'web-ui/dist'),
      path.join(MODULE_DIR, '../web-ui/dist'),
      path.join(root, 'public'),
      path.join(MODULE_DIR, 'public'),
    ];

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) return candidate;
    }

    return candidates[0];
  }

  /** 添加 Agent（多 Agent 模式使用）。首次调用时移除构造函数创建的 'default' 占位 */
  addAgent(
    name: string, backend: IrisBackendLike, config: WebPlatformConfig | Record<string, unknown>, description?: string,
    getMCPManager?: () => any | undefined,
    setMCPManager?: (mgr?: any) => void,
    extensions?: RuntimeReloadExtensions,
  ): void {
    // 移除构造函数创建的占位 default agent
    if (this.defaultAgentName === 'default' && this.agents.has('default') && name !== 'default') {
      this.agents.delete('default');
      this.defaultAgentName = name;
    }
    // 从传入的通用配置中提取 Web 平台专属配置
    const raw = config as Record<string, unknown>;
    const webSub = (raw.platform as Record<string, unknown> | undefined)?.web as Record<string, unknown> | undefined;
    const cfg: WebPlatformConfig = {
      port: (webSub?.port ?? raw.port ?? this.config.port) as number,
      host: (webSub?.host ?? raw.host ?? this.config.host) as string,
      authToken: (webSub?.authToken ?? raw.authToken ?? this.config.authToken) as string | undefined,
      managementToken: (webSub?.managementToken ?? raw.managementToken ?? this.config.managementToken) as string | undefined,
      configPath: (raw.configPath ?? '') as string,
      provider: (raw.provider ?? 'unknown') as string,
      modelId: (raw.modelId ?? 'unknown') as string,
      streamEnabled: (raw.streamEnabled ?? true) as boolean,
    };
    this.agents.set(name, {
      name, description, backend, config: cfg,
      getMCPManager: getMCPManager ?? (() => undefined),
      setMCPManager: setMCPManager ?? (() => {}),
      dataDir: cfg.configPath ? path.dirname(cfg.configPath) : undefined,
      extensions,
    });
  }

  /**
   * 注入热重载回调。由 index.ts 在启动时调用，
   * 提供按 agent 名称执行 bootstrap 的能力。
   */
  setReloadHandler(handler: (agent: AgentDefinitionLike | '__default__') => Promise<any>): void {
    this.reloadHandler = handler;
  }

  /** 注入平台配置热重载回调 */
  setPlatformReloadHandler(handler: (mergedConfig: any) => Promise<void>): void {
    this.platformReloadHandler = handler;
  }

  /**
   * 热重载 Agent 列表：重新读取 agents.yaml，对比运行中的 agents，
   * 新增/删除 agent 而不影响未变更的 agent。
   */
  async reloadAgents(): Promise<{ added: string[]; removed: string[]; kept: string[]; message: string }> {
    if (!this.reloadHandler) {
      return { added: [], removed: [], kept: [], message: '未注入 reload handler，无法热重载。' };
    }

    const agentManager = this.deps.api?.agentManager;
    if (!agentManager) {
      return { added: [], removed: [], kept: [], message: 'agentManager 不可用，无法热重载。' };
    }

    agentManager.resetCache();

    const status = agentManager.getStatus();
    const enabled = status.enabled;
    const newDefs = enabled ? status.agents : [];
    // 多 agent 模式下还有一个 __global__ 全局 AI
    const newNames = new Set(newDefs.map(d => d.name));
    if (enabled) newNames.add('__global__');

    const currentNames = new Set(this.agents.keys());
    const added: string[] = [];
    const removed: string[] = [];
    const kept: string[] = [];

    /** 精确移除 Web 平台为指定 agent 绑定的 SSE 监听器，并清理 MCP 连接 */
    const unwireAgent = async (name: string) => {
      const cleanup = this.backendListenerCleanups.get(name);
      if (cleanup) {
        cleanup();
        this.backendListenerCleanups.delete(name);
      }
      // 断开旧 agent 的 MCP 连接，避免资源泄漏
      const agent = this.agents.get(name);
      if (agent) {
        try {
          const mcp = agent.getMCPManager();
          if (mcp) await mcp.disconnectAll();
        } catch { /* ignore */ }
      }
    };

    /** 为 agent 创建上下文并绑定事件 */
    const bootstrapAgent = async (def: AgentDefinitionLike | '__default__'): Promise<void> => {
      const result = await this.reloadHandler!(def);
      const name = def === '__default__' ? 'default' : (def as AgentDefinitionLike).name;
      const currentModel = result.router.getCurrentModelInfo();
      let _mcpManager = result.getMCPManager();
      this.agents.set(name, {
        name,
        description: def === '__default__' ? undefined
          : name === '__global__' ? '全局 AI'
          : (def as AgentDefinitionLike).description,
        backend: result.backend,
        config: {
          ...this.config,
          provider: currentModel.provider,
          modelId: currentModel.modelId,
          streamEnabled: result.config.system.stream,
          configPath: result.configDir,
        },
        getMCPManager: () => _mcpManager,
        dataDir: path.dirname(result.configDir),
        setMCPManager: (mgr?) => { _mcpManager = mgr; },
        extensions: { llmProviders: result.extensions.llmProviders, ocrProviders: result.extensions.ocrProviders },
      });
      this.wireBackendEvents(result.backend, name);
    };

    if (!enabled) {
      // 切换到单 Agent 模式
      if (!this.agents.has('default') || this.agents.size > 1) {
        for (const name of currentNames) {
          await unwireAgent(name);
        }
        this.agents.clear();

        await bootstrapAgent('__default__');
        this.defaultAgentName = 'default';
        this.multiAgentMode = false;
        return { added: [], removed: [...currentNames], kept: [], message: '已切换到单 Agent 模式。' };
      }
      return { added: [], removed: [], kept: ['default'], message: '已处于单 Agent 模式，无需变更。' };
    }

    // 多 Agent 模式
    this.multiAgentMode = true;

    // 移除不再存在的 agent
    for (const name of currentNames) {
      if (name === 'default' || !newNames.has(name)) {
        await unwireAgent(name);
        this.agents.delete(name);
        removed.push(name);
      }
    }

    // 保留未变更的 agent
    for (const name of newNames) {
      if (currentNames.has(name) && name !== 'default') {
        kept.push(name);
      }
    }

    // 新增 agent
    for (const name of newNames) {
      if (!currentNames.has(name) || currentNames.has('default')) {
        try {
          const def = name === '__global__'
            ? { name: '__global__' } as AgentDefinitionLike
            : newDefs.find(d => d.name === name);
          if (!def) {
            logger.warn(`Agent「${name}」在定义列表中未找到，跳过。`);
            continue;
          }
          await bootstrapAgent(def);
          added.push(name);

          if (this.defaultAgentName === 'default' || !this.agents.has(this.defaultAgentName)) {
            this.defaultAgentName = name;
          }
        } catch (err) {
          logger.error(`热重载 Agent「${name}」失败:`, err);
        }
      }
    }

    const msg = `热重载完成：新增 ${added.length}，移除 ${removed.length}，保留 ${kept.length}。`;
    logger.info(msg);
    return { added, removed, kept, message: msg };
  }

  /** 根据请求的 X-Agent-Name header 解析 Agent 上下文 */
  resolveAgent(req: http.IncomingMessage): AgentContext {
    const agentName = req.headers['x-agent-name'];
    if (typeof agentName === 'string' && agentName && this.agents.has(agentName)) {
      return this.agents.get(agentName)!;
    }
    return this.agents.get(this.defaultAgentName) ?? this.agents.values().next().value!;
  }

  /** 获取所有 Agent 列表（供 /api/agents 端点使用） */
  getAgentList(): { name: string; description?: string }[] {
    // 单 Agent 模式（只有 'default'）返回空数组
    if (this.agents.size === 1 && this.agents.has('default')) return [];
    return Array.from(this.agents.values()).map(a => ({ name: a.name, description: a.description }));
  }

  // ============ PlatformAdapter 接口 ============

  async start(): Promise<void> {
    // 为所有 Agent 的 Backend 绑定 SSE 事件转发
    for (const agent of this.agents.values()) {
      this.wireBackendEvents(agent.backend, agent.name);
    }

    return new Promise((resolve) => {
      this.server = http.createServer(async (req, res) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Management-Token, X-Deploy-Token, X-Agent-Name');

        if (req.method === 'OPTIONS') {
          res.writeHead(204);
          res.end();
          return;
        }

        const url = req.url ?? '/';
        const pathname = new URL(url, `http://${req.headers.host ?? 'localhost'}`).pathname;

        // 全局 API 路由认证
        if (this.config.authToken && url.startsWith('/api/')) {
          const auth = req.headers.authorization ?? '';
          const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
          if (token !== this.config.authToken) {
            sendJSON(res, 401, {
              error: '未授权：缺少或无效的 API 访问令牌',
              code: 'AUTH_TOKEN_INVALID',
            });
            return;
          }
        }

        // 管理面认证
        if (
          pathname === '/api/config'
          || pathname.startsWith('/api/config/')
          || pathname.startsWith('/api/deploy/')
          || pathname.startsWith('/api/cloudflare/')
          || (pathname.startsWith('/api/extensions/') && req.method !== 'GET')
        ) {
          if (!assertManagementToken(req, res, this.config.managementToken)) {
            return;
          }
        }

        try {
          const handled = await this.router.handle(req, res);
          if (!handled) {
            if (pathname.startsWith('/api/')) {
              sendJSON(res, 404, { error: '未找到 API 路由' });
            } else {
              await this.serveStatic(req, res);
            }
          }
        } catch (err: unknown) {
          logger.error('请求处理异常:', err);
          if (!res.headersSent) {
            sendJSON(res, 500, { error: '服务器内部错误' });
          }
        }
      });

      // WebSocket upgrade — 终端连接
      this.server.on('upgrade', (req, socket, head) => {
        const upgradeUrl = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
        if (upgradeUrl.pathname === '/ws/terminal') {
          // Auth 检查（WebSocket 无法携带自定义 header，通过 query 传递 token）
          if (this.config.authToken) {
            const token = upgradeUrl.searchParams.get('token') ?? '';
            if (token !== this.config.authToken) {
              socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
              socket.destroy();
              return;
            }
          }
          this.terminalHandler.handleUpgrade(req, socket, head);
        } else if (upgradeUrl.pathname === '/ws/notifications') {
          // 通知 WebSocket — 异步子代理事件推送
          if (this.config.authToken) {
            const token = upgradeUrl.searchParams.get('token') ?? '';
            if (token !== this.config.authToken) {
              socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
              socket.destroy();
              return;
            }
          }
          this.notificationHandler.handleUpgrade(req, socket, head);
        } else {
          socket.destroy();
        }
      });

      this.server.listen(this.config.port, this.config.host, () => {
        logger.info(`Web GUI 已启动: http://${this.config.host}:${this.config.port}`);
        logger.info(`部署令牌（一键部署需要）: ${this.deployToken}`);
        if (this.terminalHandler.available) {
          logger.info('终端 WebSocket 已就绪: /ws/terminal');
        } else {
          logger.warn('node-pty 不可用，终端功能已禁用');
        }
        logger.info('通知 WebSocket 已就绪: /ws/notifications');
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    this.terminalHandler.killAll();
    this.notificationHandler.close();

    for (const [, res] of this.pendingResponses) {
      if (!res.writableEnded) res.end();
    }
    this.pendingResponses.clear();

    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }

  // ============ 供 chat handler 调用的方法 ============

  hasPending(sessionId: string): boolean {
    return this.pendingResponses.has(sessionId);
  }

  registerPending(sessionId: string, res: http.ServerResponse): void {
    this.pendingResponses.set(sessionId, res);
  }

  removePending(sessionId: string): void {
    this.pendingResponses.delete(sessionId);
    this.sseWriteCount.delete(sessionId);
  }

  /** 分发用户消息到 Backend（根据 agent 上下文） */
  async dispatchMessage(sessionId: string, message: string, images?: ImageInput[], documents?: DocumentInput[], agentName?: string): Promise<void> {
    const agent = agentName && this.agents.has(agentName)
      ? this.agents.get(agentName)!
      : this.agents.get(this.defaultAgentName) ?? this.agents.values().next().value!;
    await agent.backend.chat(sessionId, message, images, documents, 'web');
  }

  /** 注入 MCP 管理器引用（单 Agent 兼容 / 指定 agent） */
  setMCPManager(mgr: any, agentName?: string): void {
    const name = agentName ?? this.defaultAgentName;
    const agent = this.agents.get(name);
    if (agent) agent.setMCPManager(mgr);
  }

  /** 获取 MCP 管理器（单 Agent 兼容 / 指定 agent） */
  getMCPManager(agentName?: string): any | undefined {
    const name = agentName ?? this.defaultAgentName;
    return this.agents.get(name)?.getMCPManager();
  }

  // ============ 内部方法 ============

  /** 为一个 Backend 绑定 SSE 事件转发，并追踪监听器以便后续精确移除 */
  private wireBackendEvents(backend: IrisBackendLike, agentName?: string): void {
    const onResponse = (sid: string, text: string) => {
      this.writeSSE(sid, { type: 'message', text });
    };
    const onStreamStart = (sid: string) => {
      this.writeSSE(sid, { type: 'stream_start' });
    };
    const onStreamChunk = (sid: string, chunk: string) => {
      this.writeSSE(sid, { type: 'delta', text: chunk });
    };
    const onError = (sid: string, message: string) => {
      this.writeSSE(sid, { type: 'error', message });
    };
    const onAssistantContent = (sid: string, content: Content) => {
      this.writeSSE(sid, { type: 'assistant_content', message: formatContent(content) });
    };
    const onStreamParts = (sid: string, parts: Part[]) => {
      for (const part of parts) {
        if (isThoughtTextPart(part) && part.text) {
          this.writeSSE(sid, {
            type: 'thought_delta',
            text: part.text,
            durationMs: (part as any).thoughtDurationMs,
          });
        }
      }
    };
    const onStreamEnd = (sid: string) => {
      this.writeSSE(sid, { type: 'stream_end' });
    };
    const onDone = (sid: string, durationMs: number) => {
      this.writeSSE(sid, { type: 'done_meta', durationMs });
    };
    const onToolExecute = (sid: string, handle: any) => {
      // 推送新工具启动
      this.writeSSE(sid, {
        type: 'tool_start',
        tool: { id: handle.id, toolName: handle.toolName, status: handle.status, args: handle.getSnapshot().args, depth: handle.depth, parentId: handle.parentId },
      });
      // 订阅状态变化
      handle.on('state', (status: string, prev: string) => {
        this.writeSSE(sid, { type: 'tool_state', toolId: handle.id, status, prev, snapshot: handle.getSnapshot() });
      });
      // 订阅实时输出
      handle.on('output', (entry: any) => {
        this.writeSSE(sid, { type: 'tool_output', toolId: handle.id, entry });
      });
      // 订阅进度
      handle.on('progress', (data: any) => {
        this.writeSSE(sid, { type: 'tool_progress', toolId: handle.id, data });
      });
      // 子工具产生
      handle.on('child', (childHandle: any) => {
        // 递归：子 handle 也走同样的事件订阅
        onToolExecute(sid, childHandle);
      });
    };
    const onUsage = (sid: string, usage: any) => {
      this.writeSSE(sid, { type: 'usage', usage });
    };
    const onRetry = (sid: string, attempt: number, maxRetries: number, error: string) => {
      this.writeSSE(sid, { type: 'retry', attempt, maxRetries, error });
    };
    const onAutoCompact = (sid: string, summaryText: string) => {
      this.writeSSE(sid, { type: 'auto_compact', summary: summaryText });
    };
    const onUserToken = (sid: string, tokenCount: number) => {
      this.writeSSE(sid, { type: 'user_token', tokenCount });
    };
    const onAgentNotification = (sid: string, taskId: string, status: string, summary: string) => {
      const data = { type: 'agent_notification', taskId, status, summary };
      // agent:notification 走专用推送逻辑，避免 writeSSE fallthrough 导致 WS 重复发送。
      // 有 SSE 时两个通道都推（SSE 给当前聊天流，WS 给全局任务面板）；
      // 无 SSE 时只推 WS。
      const res = this.pendingResponses.get(sid);
      if (res && !res.writableEnded) {
        this.writeSSE(sid, data);
      }
      this.notificationHandler.pushEvent(sid, data);
    };
    const onTurnStart = (sid: string, turnId: string, mode: string) => {
      this.writeSSE(sid, { type: 'turn_start', turnId, mode });
    };

    backend.on('response', onResponse);
    backend.on('stream:start', onStreamStart);
    backend.on('stream:chunk', onStreamChunk);
    backend.on('error', onError);
    backend.on('assistant:content', onAssistantContent);
    backend.on('stream:parts', onStreamParts);
    backend.on('stream:end', onStreamEnd);
    backend.on('done', onDone);
    backend.on('tool:execute' as any, onToolExecute);
    backend.on('usage', onUsage);
    backend.on('retry', onRetry);
    backend.on('auto-compact', onAutoCompact);
    backend.on('user:token', onUserToken);
    backend.on('agent:notification' as any, onAgentNotification);
    backend.on('turn:start' as any, onTurnStart);

    // 记录清理函数，热重载时精确移除这些监听器而不影响其他平台
    if (agentName) {
      this.backendListenerCleanups.set(agentName, () => {
        backend.off!('response', onResponse);
        backend.off!('stream:start', onStreamStart);
        backend.off!('stream:chunk', onStreamChunk);
        backend.off!('error', onError);
        backend.off!('assistant:content', onAssistantContent);
        backend.off!('stream:parts', onStreamParts);
        backend.off!('stream:end', onStreamEnd);
        backend.off!('done', onDone);
        backend.off!('tool:execute' as any, onToolExecute);
        backend.off!('usage', onUsage);
        backend.off!('retry', onRetry);
        backend.off!('auto-compact', onAutoCompact);
        backend.off!('user:token', onUserToken);
        backend.off!('agent:notification' as any, onAgentNotification);
        backend.off!('turn:start' as any, onTurnStart);
      });
    }
  }

  /** 每个 session 写入的 SSE 事件计数，用于调试流式传输 */
  private sseWriteCount = new Map<string, number>();

  private writeSSE(sessionId: string, data: any): void {
    const res = this.pendingResponses.get(sessionId);
    if (!res || res.writableEnded) {
      // 无活跃 SSE 连接（空闲时 notification turn），回退到 WebSocket 推送
      this.notificationHandler.pushEvent(sessionId, data);
      return;
    }
    const count = (this.sseWriteCount.get(sessionId) ?? 0) + 1;
    this.sseWriteCount.set(sessionId, count);
    const ok = res.write(`data: ${JSON.stringify(data)}\n\n`);
    if (data.type === 'delta' && (count <= 3 || count % 20 === 0)) {
      logger.info(`[SSE #${count}] delta (${data.text?.length ?? 0} chars) write=${ok}`);
    } else if (data.type !== 'delta') {
      logger.info(`[SSE #${count}] ${data.type} write=${ok}`);
    }
  }

  /**
   * 向 Web 服务注册自定义 HTTP 路由。
   * 供插件通过 IrisAPI.registerWebRoute 调用。
   */
  registerRoute(method: string, path: string, handler: (req: any, res: any, params: Record<string, string>) => Promise<void>): void {
    this.router.add(method.toUpperCase(), path, handler);
  }

  private setupRoutes(): void {
    const { configPath } = this.config;

    // Agent 列表 API（运行时可用的 agent）
    this.router.get('/api/agents', async (_req, res) => {
      sendJSON(res, 200, { agents: this.getAgentList() });
    });

    // Agent 管理 API（读取 agents.yaml 完整状态，含未启用的 agent）
    this.router.get('/api/agents/status', async (_req, res) => {
      const agentManager = this.deps.api?.agentManager;
      if (!agentManager) { sendJSON(res, 503, { error: 'agentManager 不可用' }); return; }
      sendJSON(res, 200, agentManager.getStatus());
    });

    // Agent 热重载（手动触发）
    this.router.post('/api/agents/reload', async (_req, res) => {
      const result = await this.reloadAgents();
      sendJSON(res, 200, result);
    });

    // Agent 启用/禁用切换（修改 agents.yaml 的 enabled 字段，自动热重载）
    this.router.post('/api/agents/toggle', async (req, res) => {
      const body = await readBody(req);
      if (typeof body.enabled !== 'boolean') {
        sendJSON(res, 400, { error: '缺少 enabled 参数' });
        return;
      }
      const agentManager = this.deps.api?.agentManager;
      if (!agentManager) { sendJSON(res, 503, { error: 'agentManager 不可用' }); return; }
      const result = agentManager.setEnabled(body.enabled);
      if (result.success) {
        const reload = await this.reloadAgents();
        sendJSON(res, 200, { ...result, reload });
      } else {
        sendJSON(res, 500, result);
      }
    });

    // Agent CRUD API
    this.router.post('/api/agents/init', async (_req, res) => {
      const agentManager = this.deps.api?.agentManager;
      if (!agentManager) { sendJSON(res, 503, { error: 'agentManager 不可用' }); return; }
      const result = agentManager.createManifest();
      sendJSON(res, result.success ? 200 : 500, result);
    });

    this.router.post('/api/agents/create', async (req, res) => {
      const body = await readBody(req);
      if (typeof body.name !== 'string' || !body.name.trim()) {
        sendJSON(res, 400, { success: false, message: '缺少 name 参数' });
        return;
      }
      const agentManager = this.deps.api?.agentManager;
      if (!agentManager) { sendJSON(res, 503, { error: 'agentManager 不可用' }); return; }
      const result = agentManager.create(body.name.trim(), body.description);
      if (result.success) {
        const reload = await this.reloadAgents();
        sendJSON(res, 200, { ...result, reload });
      } else {
        sendJSON(res, 400, result);
      }
    });

    this.router.post('/api/agents/update', async (req, res) => {
      const body = await readBody(req);
      if (typeof body.name !== 'string' || !body.name.trim()) {
        sendJSON(res, 400, { success: false, message: '缺少 name 参数' });
        return;
      }
      const agentManager = this.deps.api?.agentManager;
      if (!agentManager) { sendJSON(res, 503, { error: 'agentManager 不可用' }); return; }
      const result = agentManager.update(body.name.trim(), {
        description: body.description,
        dataDir: body.dataDir,
      });
      sendJSON(res, result.success ? 200 : 400, result);
    });

    this.router.post('/api/agents/delete', async (req, res) => {
      const body = await readBody(req);
      if (typeof body.name !== 'string' || !body.name.trim()) {
        sendJSON(res, 400, { success: false, message: '缺少 name 参数' });
        return;
      }
      const agentManager = this.deps.api?.agentManager;
      if (!agentManager) { sendJSON(res, 503, { error: 'agentManager 不可用' }); return; }
      const result = agentManager.delete(body.name.trim());
      if (result.success) {
        const reload = await this.reloadAgents();
        sendJSON(res, 200, { ...result, reload });
      } else {
        sendJSON(res, 400, result);
      }
    });

    // 聊天 API
    this.router.post('/api/chat', createChatHandler(this));

    // 会话管理 API（通过 IrisAPI.storage 访问）
    this.router.get('/api/sessions', async (req, res) => {
      const storage = this.deps.api?.storage;
      if (!storage) { sendJSON(res, 503, { error: 'storage 不可用' }); return; }
      return createSessionsHandlers(storage).list(req, res);
    });
    this.router.get('/api/sessions/:id/messages', async (req, res, params) => {
      const storage = this.deps.api?.storage;
      if (!storage) { sendJSON(res, 503, { error: 'storage 不可用' }); return; }
      return createSessionsHandlers(storage).getMessages(req, res, params);
    });
    this.router.delete('/api/sessions/:id/messages', async (req, res, params) => {
      const storage = this.deps.api?.storage;
      if (!storage) { sendJSON(res, 503, { error: 'storage 不可用' }); return; }
      return createSessionsHandlers(storage).truncateMessages(req, res, params);
    });
    this.router.delete('/api/sessions/:id', async (req, res, params) => {
      const storage = this.deps.api?.storage;
      if (!storage) { sendJSON(res, 503, { error: 'storage 不可用' }); return; }
      return createSessionsHandlers(storage).remove(req, res, params);
    });

    // 部署管理 API（全局，不区分 agent）
    const deploy = createDeployHandlers(configPath, () => this.deployToken);
    this.router.get('/api/deploy/state', deploy.getState);
    this.router.get('/api/deploy/detect', deploy.detect);
    this.router.post('/api/deploy/preview', deploy.preview);
    this.router.post('/api/deploy/nginx', deploy.deployNginx);
    this.router.post('/api/deploy/service', deploy.deployService);
    this.router.post('/api/deploy/sync-cloudflare', deploy.syncCloudflare);

    // Cloudflare 管理 API（全局）
    const cloudflare = createCloudflareHandlers(configPath);
    this.router.get('/api/cloudflare/status', cloudflare.status);
    this.router.post('/api/cloudflare/setup', cloudflare.setup);
    this.router.get('/api/cloudflare/dns', cloudflare.listDns);
    this.router.post('/api/cloudflare/dns', cloudflare.addDns);
    this.router.delete('/api/cloudflare/dns/:id', cloudflare.removeDns);
    this.router.get('/api/cloudflare/ssl', cloudflare.getSsl);
    this.router.put('/api/cloudflare/ssl', cloudflare.setSsl);

    // 扩展管理 + 平台目录 API（全局，不区分 agent）
    const extensions = createExtensionHandlers(this.deps.projectRoot ?? process.cwd());
    this.router.get('/api/extensions', extensions.list);
    this.router.get('/api/extensions/remote', extensions.remote);
    this.router.post('/api/extensions/install', extensions.install);
    this.router.post('/api/extensions/:name/enable', extensions.enable);
    this.router.post('/api/extensions/:name/disable', extensions.disable);
    this.router.delete('/api/extensions/:name', extensions.remove);
    this.router.get('/api/platforms', extensions.platforms);

    // 配置管理 API（通过 IrisAPI 访问）
    this.router.get('/api/config', async (req, res) => {
      if (!this.deps.api) { sendJSON(res, 503, { error: 'API 不可用' }); return; }
      return createConfigHandlers(this.deps.api).get(req, res);
    });
    this.router.put('/api/config', async (req, res) => {
      if (!this.deps.api) { sendJSON(res, 503, { error: 'API 不可用' }); return; }
      const agent = this.resolveAgent(req);
      const configHandlers = createConfigHandlers(this.deps.api, async (mergedConfig) => {
        const result = await this.deps.api?.configManager?.applyRuntimeConfigReload(mergedConfig);
        if (result && !result.error) {
          // 尝试从 backend 获取最新模型信息更新 agent config
          const modelInfo = agent.backend.getCurrentModelInfo?.();
          if (modelInfo) {
            agent.config.provider = modelInfo.provider ?? agent.config.provider;
            agent.config.modelId = modelInfo.modelId ?? agent.config.modelId;
          }
          agent.config.streamEnabled = (mergedConfig as any)?.system?.stream ?? agent.config.streamEnabled;
        }

        // 平台配置热重载
        if (this.platformReloadHandler && (mergedConfig as any)?.platform) {
          await this.platformReloadHandler(mergedConfig);
        }
      });
      return configHandlers.update(req, res);
    });
    this.router.post('/api/config/models', async (req, res) => {
      if (!this.deps.api) { sendJSON(res, 503, { error: 'API 不可用' }); return; }
      return createConfigHandlers(this.deps.api).listModels(req, res);
    });

    // 重置配置 API
    this.router.post('/api/config/reset', async (req, res) => {
      try {
        const { backend } = this.resolveAgent(req);
        const result = backend.resetConfigToDefaults?.();
        sendJSON(res, result && (result as any).success ? 200 : 500, result ?? { success: false, message: '不支持的操作' });
      } catch (err: unknown) {
        sendJSON(res, 500, { success: false, message: err instanceof Error ? err.message : '重置失败' });
      }
    });

    // 模型列表 API
    this.router.get('/api/models', async (req, res) => {
      try {
        const { backend } = this.resolveAgent(req);
        sendJSON(res, 200, { models: backend.listModels?.() ?? [] });
      } catch (err: unknown) {
        sendJSON(res, 500, { error: err instanceof Error ? err.message : '获取模型列表失败' });
      }
    });

    // 状态 API
    this.router.get('/api/status', async (req, res) => {
      const agent = this.resolveAgent(req);
      const modelInfo = agent.backend.getCurrentModelInfo?.() ?? {};
      const disabledTools = agent.backend.getDisabledTools?.() ?? [];
      const pRoot = this.deps.projectRoot ?? process.cwd();
      sendJSON(res, 200, {
        provider: agent.config.provider,
        model: agent.config.modelId,
        tools: agent.backend.getToolNames?.() ?? [],
        ...(disabledTools.length > 0 ? { disabledTools } : {}),
        stream: agent.config.streamEnabled,
        authProtected: !!this.config.authToken,
        managementProtected: !!this.config.managementToken,
        platform: 'web',
        contextWindow: modelInfo.contextWindow,
        mcpStatus: agent.getMCPManager()?.getServerInfo?.() ?? [],
        runtime: {
          projectRoot: this.deps.projectRoot,
          dataDir: this.deps.dataDir,
          configDir: this.deps.configDir,
          isCompiledBinary: this.deps.isCompiledBinary,
          configSource: fs.existsSync(path.join(pRoot, 'data/configs.example')) ? 'template' : 'embedded',
        },
      });
    });

    // Diff 预览 API
    this.router.get('/api/tools/:id/diff', async (req, res, params) => {
      const { backend } = this.resolveAgent(req);
      const utils = this.deps.api?.toolPreviewUtils;
      if (!utils) { sendJSON(res, 503, { error: 'toolPreviewUtils 不可用' }); return; }
      return createDiffPreviewHandler(backend, utils)(req, res, params);
    });

    // 工具审批 API
    this.router.post('/api/tools/:id/approve', async (req, res, params) => {
      try {
        const { backend } = this.resolveAgent(req);
        const body = await readBody(req);
        const handle = backend.getToolHandle?.(params.id);
        if (!handle) { sendJSON(res, 404, { error: '未找到工具调用' }); return; }
        handle.approve(body.approved);
        sendJSON(res, 200, { ok: true });
      } catch (err: unknown) {
        sendJSON(res, 400, { error: err instanceof Error ? err.message : '操作失败' });
      }
    });

    this.router.post('/api/tools/:id/apply', async (req, res, params) => {
      try {
        const { backend } = this.resolveAgent(req);
        const body = await readBody(req);
        const handle = backend.getToolHandle?.(params.id);
        if (!handle) { sendJSON(res, 404, { error: '未找到工具调用' }); return; }
        handle.apply(body.applied);
        sendJSON(res, 200, { ok: true });
      } catch (err: unknown) {
        sendJSON(res, 400, { error: err instanceof Error ? err.message : '操作失败' });
      }
    });

    // 工具终止
    this.router.post('/api/tools/:id/abort', async (req, res, params) => {
      try {
        const { backend } = this.resolveAgent(req);
        const handle = backend.getToolHandle?.(params.id);
        if (!handle) { sendJSON(res, 404, { error: '未找到工具调用' }); return; }
        handle.abort();
        sendJSON(res, 200, { ok: true });
      } catch (err: unknown) {
        sendJSON(res, 400, { error: err instanceof Error ? err.message : '操作失败' });
      }
    });

    // 撤销/重做 API
    this.router.post('/api/sessions/:id/undo', async (req, res, params) => {
      const { backend } = this.resolveAgent(req);
      const sessionId = params.id;
      if (this.hasPending(sessionId)) {
        sendJSON(res, 409, { error: '当前会话正在生成中，无法撤销' });
        return;
      }
      try {
        const result = await backend.undo?.(sessionId, 'last-visible-message');
        if (!result) {
          sendJSON(res, 200, { ok: true, changed: false });
          return;
        }
        const history = await backend.getHistory?.(sessionId) ?? [];
        sendJSON(res, 200, { ok: true, changed: true, messages: formatMessages(history) });
      } catch (err: unknown) {
        sendJSON(res, 500, { error: err instanceof Error ? err.message : '撤销失败' });
      }
    });

    this.router.post('/api/sessions/:id/redo', async (req, res, params) => {
      const { backend } = this.resolveAgent(req);
      const sessionId = params.id;
      if (this.hasPending(sessionId)) {
        sendJSON(res, 409, { error: '当前会话正在生成中，无法重做' });
        return;
      }
      try {
        const result = await backend.redo?.(sessionId);
        if (!result) {
          sendJSON(res, 200, { ok: true, changed: false });
          return;
        }
        const history = await backend.getHistory?.(sessionId) ?? [];
        sendJSON(res, 200, { ok: true, changed: true, messages: formatMessages(history) });
      } catch (err: unknown) {
        sendJSON(res, 500, { error: err instanceof Error ? err.message : '重做失败' });
      }
    });

    // 异步子代理任务查询 API
    this.router.get('/api/sessions/:id/tasks', async (req, res, params) => {
      const { backend } = this.resolveAgent(req);
      const tasks = backend.getAgentTasks?.(params.id) ?? [];
      sendJSON(res, 200, { tasks: tasks.map(t => ({
        taskId: t.taskId,
        sessionId: t.sessionId,
        description: t.description,
        status: t.status,
        startTime: t.startTime,
        endTime: t.endTime,
      })) });
    });

    // Shell 命令 API
    this.router.post('/api/shell', async (req, res) => {
      try {
        const { backend } = this.resolveAgent(req);
        const body = await readBody(req);
        if (!body.command || typeof body.command !== 'string') {
          sendJSON(res, 400, { error: '缺少 command 参数' });
          return;
        }
        const result = backend.runCommand?.(body.command);
        sendJSON(res, 200, result ?? { error: '不支持的操作' });
      } catch (err: unknown) {
        sendJSON(res, 500, { error: err instanceof Error ? err.message : '命令执行失败' });
      }
    });

    // 上下文压缩 API
    this.router.post('/api/compact', async (req, res) => {
      try {
        const { backend } = this.resolveAgent(req);
        const body = await readBody(req);
        const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';
        if (!sessionId) {
          sendJSON(res, 400, { error: '缺少 sessionId 参数' });
          return;
        }
        const summary = await backend.summarize?.(sessionId);
        sendJSON(res, 200, { ok: true, summary });
      } catch (err: unknown) {
        sendJSON(res, 500, { error: err instanceof Error ? err.message : '压缩失败' });
      }
    });

    // 模型切换 API
    this.router.post('/api/model/switch', async (req, res) => {
      try {
        const agent = this.resolveAgent(req);
        const body = await readBody(req);
        if (!body.modelName || typeof body.modelName !== 'string') {
          sendJSON(res, 400, { error: '缺少 modelName 参数' });
          return;
        }
        const info = agent.backend.switchModel?.(body.modelName, 'web');
        if (!info) {
          sendJSON(res, 500, { error: '模型切换不可用' });
          return;
        }
        agent.config.modelId = info.modelId;
        agent.config.provider = (info as any).provider ?? agent.config.provider;
        sendJSON(res, 200, info);
      } catch (err: unknown) {
        sendJSON(res, 400, { error: err instanceof Error ? err.message : '切换模型失败' });
      }
    });
  }

  /** 静态文件服务 */
  private async serveStatic(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    let pathname = url.pathname;

    if (pathname === '/' || pathname === '') pathname = '/index.html';

    const filePath = path.resolve(this.publicDir, pathname.slice(1));
    const relative = path.relative(this.publicDir, filePath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      sendJSON(res, 403, { error: '禁止访问' });
      return;
    }

    try {
      const stat = await fs.promises.stat(filePath);
      if (!stat.isFile()) throw new Error('非文件');

      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] ?? 'application/octet-stream';

      res.writeHead(200, { 'Content-Type': contentType, 'Content-Length': stat.size });
      fs.createReadStream(filePath).pipe(res);
    } catch {
      const indexPath = path.join(this.publicDir, 'index.html');
      try {
        const indexStat = await fs.promises.stat(indexPath);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': indexStat.size });
        fs.createReadStream(indexPath).pipe(res);
      } catch {
        sendJSON(res, 404, { error: '未找到资源' });
      }
    }
  }
}
