/**
 * Web GUI 平台适配器
 *
 * 提供基于 SSE 的 HTTP API 和静态文件服务。
 * 通过 Backend API 与核心逻辑交互。
 */

import * as crypto from 'crypto';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { PlatformAdapter } from '../base';
import { createCloudflareHandlers } from './handlers/cloudflare';
import { createDeployHandlers } from './handlers/deploy';
import { Backend } from '../../core/backend';
import type { ImageInput } from '../../core/backend';
import type { DocumentInput } from '../../media/document-extract.js';
import { Router, sendJSON, readBody } from './router';
import { createChatHandler, createChatSuggestionsHandler } from './handlers/chat';
import { createSessionsHandlers } from './handlers/sessions';
import { createConfigHandlers } from './handlers/config';
import { createDiffPreviewHandler } from './handlers/diff-preview';
import { createLogger } from '../../logger';
import { MCPManager } from '../../mcp';
import { assertManagementToken } from './security/management';
import { applyRuntimeConfigReload } from '../../config/runtime';
import { Content, Part, isThoughtTextPart } from '../../types';
import { formatContent, formatMessages } from './message-format';

const logger = createLogger('WebPlatform');

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
  backend: Backend;
  config: WebPlatformConfig;
  /** MCP 管理器 getter（延迟求值，热重载后自动获取最新引用） */
  getMCPManager: () => MCPManager | undefined;
  setMCPManager: (mgr?: MCPManager) => void;
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

function resolvePublicDir(): string {
  const candidates = [
    path.join(MODULE_DIR, 'web-ui/dist'),
    path.resolve(process.cwd(), 'src/platforms/web/web-ui/dist'),
    path.resolve(process.cwd(), 'dist/platforms/web/web-ui/dist'),
    path.join(MODULE_DIR, 'public'),
    path.resolve(process.cwd(), 'src/platforms/web/public'),
    path.resolve(process.cwd(), 'dist/platforms/web/public'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  return candidates[0];
}

export class WebPlatform extends PlatformAdapter {
  private server?: http.Server;
  private router: Router;
  private config: WebPlatformConfig;
  private publicDir: string;

  /** Agent 上下文 Map（单 Agent 模式下只有一个 'default' 条目） */
  private agents = new Map<string, AgentContext>();
  private defaultAgentName = 'default';

  /** sessionId → 正在处理的 SSE 响应 */
  private pendingResponses = new Map<string, http.ServerResponse>();

  /** 启动时生成的一次性部署令牌 */
  private deployToken: string;

  constructor(backend: Backend, config: WebPlatformConfig) {
    super();
    this.config = config;
    this.router = new Router();
    this.publicDir = resolvePublicDir();
    // 单 Agent 模式：创建默认 agent 上下文
    let _mcpManager: MCPManager | undefined;
    this.agents.set('default', {
      name: 'default', backend, config,
      getMCPManager: () => _mcpManager,
      setMCPManager: (mgr?) => { _mcpManager = mgr; },
    });
    this.setupRoutes();
    this.deployToken = crypto.randomBytes(16).toString('hex');
  }

  /** 添加 Agent（多 Agent 模式使用）。首次调用时移除构造函数创建的 'default' 占位 */
  addAgent(
    name: string, backend: Backend, config: WebPlatformConfig, description?: string,
    getMCPManager?: () => MCPManager | undefined,
    setMCPManager?: (mgr?: MCPManager) => void,
  ): void {
    // 移除构造函数创建的占位 default agent
    if (this.defaultAgentName === 'default' && this.agents.has('default') && name !== 'default') {
      this.agents.delete('default');
      this.defaultAgentName = name;
    }
    this.agents.set(name, {
      name, description, backend, config,
      getMCPManager: getMCPManager ?? (() => undefined),
      setMCPManager: setMCPManager ?? (() => {}),
    });
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
      this.wireBackendEvents(agent.backend);
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

      this.server.listen(this.config.port, this.config.host, () => {
        logger.info(`Web GUI 已启动: http://${this.config.host}:${this.config.port}`);
        logger.info(`部署令牌（一键部署需要）: ${this.deployToken}`);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
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
    await agent.backend.chat(sessionId, message, images, documents);
  }

  /** 注入 MCP 管理器引用（单 Agent 兼容 / 指定 agent） */
  setMCPManager(mgr: MCPManager, agentName?: string): void {
    const name = agentName ?? this.defaultAgentName;
    const agent = this.agents.get(name);
    if (agent) agent.setMCPManager(mgr);
  }

  /** 获取 MCP 管理器（单 Agent 兼容 / 指定 agent） */
  getMCPManager(agentName?: string): MCPManager | undefined {
    const name = agentName ?? this.defaultAgentName;
    return this.agents.get(name)?.getMCPManager();
  }

  // ============ 内部方法 ============

  /** 为一个 Backend 绑定 SSE 事件转发 */
  private wireBackendEvents(backend: Backend): void {
    backend.on('response', (sid: string, text: string) => {
      this.writeSSE(sid, { type: 'message', text });
    });
    backend.on('stream:start', (sid: string) => {
      this.writeSSE(sid, { type: 'stream_start' });
    });
    backend.on('stream:chunk', (sid: string, chunk: string) => {
      this.writeSSE(sid, { type: 'delta', text: chunk });
    });
    backend.on('error', (sid: string, message: string) => {
      this.writeSSE(sid, { type: 'error', message });
    });
    backend.on('assistant:content', (sid: string, content: Content) => {
      this.writeSSE(sid, { type: 'assistant_content', message: formatContent(content) });
    });
    backend.on('stream:parts', (sid: string, parts: Part[]) => {
      for (const part of parts) {
        if (isThoughtTextPart(part) && part.text) {
          this.writeSSE(sid, {
            type: 'thought_delta',
            text: part.text,
            durationMs: part.thoughtDurationMs,
          });
        }
      }
    });
    backend.on('stream:end', (sid: string) => {
      this.writeSSE(sid, { type: 'stream_end' });
    });
    backend.on('done', (sid: string, durationMs: number) => {
      this.writeSSE(sid, { type: 'done_meta', durationMs });
    });
    backend.on('tool:update', (sid: string, invocations: any[]) => {
      this.writeSSE(sid, { type: 'tool_update', invocations });
    });
    backend.on('usage', (sid: string, usage: any) => {
      this.writeSSE(sid, { type: 'usage', usage });
    });
    backend.on('retry', (sid: string, attempt: number, maxRetries: number, error: string) => {
      this.writeSSE(sid, { type: 'retry', attempt, maxRetries, error });
    });
  }

  /** 每个 session 写入的 SSE 事件计数，用于调试流式传输 */
  private sseWriteCount = new Map<string, number>();

  private writeSSE(sessionId: string, data: any): void {
    const res = this.pendingResponses.get(sessionId);
    if (!res || res.writableEnded) return;
    const count = (this.sseWriteCount.get(sessionId) ?? 0) + 1;
    this.sseWriteCount.set(sessionId, count);
    const ok = res.write(`data: ${JSON.stringify(data)}\n\n`);
    if (data.type === 'delta' && (count <= 3 || count % 20 === 0)) {
      logger.info(`[SSE #${count}] delta (${data.text?.length ?? 0} chars) write=${ok}`);
    } else if (data.type !== 'delta') {
      logger.info(`[SSE #${count}] ${data.type} write=${ok}`);
    }
  }

  private setupRoutes(): void {
    const { configPath } = this.config;

    // Agent 列表 API（运行时可用的 agent）
    this.router.get('/api/agents', async (_req, res) => {
      sendJSON(res, 200, { agents: this.getAgentList() });
    });

    // Agent 管理 API（读取 agents.yaml 完整状态，含未启用的 agent）
    this.router.get('/api/agents/status', async (_req, res) => {
      const { getAgentStatus } = await import('../../agents');
      sendJSON(res, 200, getAgentStatus());
    });

    // Agent 启用/禁用切换（修改 agents.yaml 的 enabled 字段）
    this.router.post('/api/agents/toggle', async (req, res) => {
      const body = await readBody(req);
      if (typeof body.enabled !== 'boolean') {
        sendJSON(res, 400, { error: '缺少 enabled 参数' });
        return;
      }
      const { setAgentEnabled } = await import('../../agents');
      const result = setAgentEnabled(body.enabled);
      sendJSON(res, result.success ? 200 : 500, result);
    });

    // 聊天 API
    this.router.post('/api/chat', createChatHandler(this));
    this.router.get('/api/chat/suggestions', async (req, res) => {
      const { backend } = this.resolveAgent(req);
      return createChatSuggestionsHandler(backend)(req, res);
    });

    // 会话管理 API（按 agent 隔离 storage）
    this.router.get('/api/sessions', async (req, res) => {
      const { backend } = this.resolveAgent(req);
      return createSessionsHandlers(backend.getStorage()).list(req, res);
    });
    this.router.get('/api/sessions/:id/messages', async (req, res, params) => {
      const { backend } = this.resolveAgent(req);
      return createSessionsHandlers(backend.getStorage()).getMessages(req, res, params);
    });
    this.router.delete('/api/sessions/:id/messages', async (req, res, params) => {
      const { backend } = this.resolveAgent(req);
      return createSessionsHandlers(backend.getStorage()).truncateMessages(req, res, params);
    });
    this.router.delete('/api/sessions/:id', async (req, res, params) => {
      const { backend } = this.resolveAgent(req);
      return createSessionsHandlers(backend.getStorage()).remove(req, res, params);
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

    // 配置管理 API（使用请求对应 agent 的 backend）
    this.router.get('/api/config', async (req, res) => {
      const agent = this.resolveAgent(req);
      return createConfigHandlers(agent.config.configPath, async () => {}).get(req, res);
    });
    this.router.put('/api/config', async (req, res) => {
      const agent = this.resolveAgent(req);
      const configHandlers = createConfigHandlers(agent.config.configPath, async (mergedConfig) => {
        const summary = await applyRuntimeConfigReload(
          {
            backend: agent.backend,
            getMCPManager: agent.getMCPManager,
            setMCPManager: agent.setMCPManager,
          },
          mergedConfig,
        );
        agent.config.provider = summary.provider;
        agent.config.modelId = summary.modelId;
        agent.config.streamEnabled = summary.streamEnabled;
      });
      return configHandlers.update(req, res);
    });
    this.router.post('/api/config/models', async (req, res) => {
      const agent = this.resolveAgent(req);
      return createConfigHandlers(agent.config.configPath, async () => {}).listModels(req, res);
    });

    // 重置配置 API
    this.router.post('/api/config/reset', async (req, res) => {
      try {
        const { backend } = this.resolveAgent(req);
        const result = backend.resetConfigToDefaults();
        sendJSON(res, result.success ? 200 : 500, result);
      } catch (err: unknown) {
        sendJSON(res, 500, { success: false, message: err instanceof Error ? err.message : '重置失败' });
      }
    });

    // 模型列表 API
    this.router.get('/api/models', async (req, res) => {
      try {
        const { backend } = this.resolveAgent(req);
        sendJSON(res, 200, { models: backend.listModels() });
      } catch (err: unknown) {
        sendJSON(res, 500, { error: err instanceof Error ? err.message : '获取模型列表失败' });
      }
    });

    // 状态 API
    this.router.get('/api/status', async (req, res) => {
      const agent = this.resolveAgent(req);
      const modelInfo = agent.backend.getCurrentModelInfo();
      sendJSON(res, 200, {
        provider: agent.config.provider,
        model: agent.config.modelId,
        tools: agent.backend.getToolNames(),
        stream: agent.config.streamEnabled,
        authProtected: !!this.config.authToken,
        managementProtected: !!this.config.managementToken,
        platform: 'web',
        contextWindow: modelInfo.contextWindow,
      });
    });

    // Diff 预览 API
    this.router.get('/api/tools/:id/diff', async (req, res, params) => {
      const { backend } = this.resolveAgent(req);
      return createDiffPreviewHandler(backend)(req, res, params);
    });

    // 工具审批 API
    this.router.post('/api/tools/:id/approve', async (req, res, params) => {
      try {
        const { backend } = this.resolveAgent(req);
        const body = await readBody(req);
        backend.approveTool(params.id, body.approved);
        sendJSON(res, 200, { ok: true });
      } catch (err: unknown) {
        sendJSON(res, 400, { error: err instanceof Error ? err.message : '操作失败' });
      }
    });

    this.router.post('/api/tools/:id/apply', async (req, res, params) => {
      try {
        const { backend } = this.resolveAgent(req);
        const body = await readBody(req);
        backend.applyTool(params.id, body.applied);
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
        const result = await backend.undo(sessionId, 'last-visible-message');
        if (!result) {
          sendJSON(res, 200, { ok: true, changed: false });
          return;
        }
        const history = await backend.getHistory(sessionId);
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
        const result = await backend.redo(sessionId);
        if (!result) {
          sendJSON(res, 200, { ok: true, changed: false });
          return;
        }
        const history = await backend.getHistory(sessionId);
        sendJSON(res, 200, { ok: true, changed: true, messages: formatMessages(history) });
      } catch (err: unknown) {
        sendJSON(res, 500, { error: err instanceof Error ? err.message : '重做失败' });
      }
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
        const result = backend.runCommand(body.command);
        sendJSON(res, 200, result);
      } catch (err: unknown) {
        sendJSON(res, 500, { error: err instanceof Error ? err.message : '命令执行失败' });
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
        const info = agent.backend.switchModel(body.modelName);
        agent.config.modelId = info.modelId;
        agent.config.provider = info.provider;
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
