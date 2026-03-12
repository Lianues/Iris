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
import { Router, sendJSON } from './router';
import { createChatHandler } from './handlers/chat';
import { createSessionsHandlers } from './handlers/sessions';
import { createConfigHandlers } from './handlers/config';
import { createLogger } from '../../logger';
import { MCPManager } from '../../mcp';
import { assertManagementToken } from './security/management';
import { applyRuntimeConfigReload } from '../../config/runtime';

const logger = createLogger('WebPlatform');

export interface WebPlatformConfig {
  port: number;
  host: string;
  authToken?: string;
  managementToken?: string;
  configPath: string;
  llmName: string;
  modelName: string;
  streamEnabled: boolean;
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
  private backend: Backend;
  private publicDir: string;

  /** sessionId → 正在处理的 SSE 响应 */
  private pendingResponses = new Map<string, http.ServerResponse>();

  /** MCP 管理器引用，供热重载使用 */
  private mcpManager?: MCPManager;

  /** 启动时生成的一次性部署令牌 */
  private deployToken: string;

  constructor(backend: Backend, config: WebPlatformConfig) {
    super();
    this.backend = backend;
    this.config = config;
    this.router = new Router();
    this.publicDir = resolvePublicDir();
    this.setupRoutes();
    this.deployToken = crypto.randomBytes(16).toString('hex');
  }

  // ============ PlatformAdapter 接口 ============

  async start(): Promise<void> {
    // 监听 Backend 事件，转发到对应的 SSE 连接
    this.backend.on('response', (sid: string, text: string) => {
      this.writeSSE(sid, { type: 'message', text });
    });

    this.backend.on('stream:chunk', (sid: string, chunk: string) => {
      this.writeSSE(sid, { type: 'delta', text: chunk });
    });

    this.backend.on('error', (sid: string, message: string) => {
      this.writeSSE(sid, { type: 'error', message });
    });

    this.backend.on('stream:end', (sid: string) => {
      this.writeSSE(sid, { type: 'stream_end' });
    });

    return new Promise((resolve) => {
      this.server = http.createServer(async (req, res) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Management-Token, X-Deploy-Token');

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
  }

  /** 分发用户消息到 Backend */
  async dispatchMessage(sessionId: string, message: string, images?: ImageInput[], documents?: DocumentInput[]): Promise<void> {
    await this.backend.chat(sessionId, message, images, documents);
  }

  /** 注入 MCP 管理器引用 */
  setMCPManager(mgr: MCPManager): void {
    this.mcpManager = mgr;
  }

  /** 获取当前 MCP 管理器 */
  getMCPManager(): MCPManager | undefined {
    return this.mcpManager;
  }

  // ============ 内部方法 ============

  private writeSSE(sessionId: string, data: any): void {
    const res = this.pendingResponses.get(sessionId);
    if (!res || res.writableEnded) return;
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  }

  private setupRoutes(): void {
    const storage = this.backend.getStorage();
    const { configPath } = this.config;

    // 聊天 API
    this.router.post('/api/chat', createChatHandler(this));

    // 会话管理 API
    const sessions = createSessionsHandlers(storage);
    this.router.get('/api/sessions', sessions.list);
    this.router.get('/api/sessions/:id/messages', sessions.getMessages);
    this.router.delete('/api/sessions/:id/messages', sessions.truncateMessages);
    this.router.delete('/api/sessions/:id', sessions.remove);

    // 部署管理 API
    const deploy = createDeployHandlers(configPath, () => this.deployToken);
    this.router.get('/api/deploy/state', deploy.getState);
    this.router.get('/api/deploy/detect', deploy.detect);
    this.router.post('/api/deploy/preview', deploy.preview);
    this.router.post('/api/deploy/nginx', deploy.deployNginx);
    this.router.post('/api/deploy/service', deploy.deployService);
    this.router.post('/api/deploy/sync-cloudflare', deploy.syncCloudflare);

    // Cloudflare 管理 API
    const cloudflare = createCloudflareHandlers(configPath);
    this.router.get('/api/cloudflare/status', cloudflare.status);
    this.router.post('/api/cloudflare/setup', cloudflare.setup);
    this.router.get('/api/cloudflare/dns', cloudflare.listDns);
    this.router.post('/api/cloudflare/dns', cloudflare.addDns);
    this.router.delete('/api/cloudflare/dns/:id', cloudflare.removeDns);
    this.router.get('/api/cloudflare/ssl', cloudflare.getSsl);
    this.router.put('/api/cloudflare/ssl', cloudflare.setSsl);

    // 配置管理 API（带热重载回调）
    const config = createConfigHandlers(configPath, async (mergedConfig) => {
      const summary = await applyRuntimeConfigReload(
        {
          backend: this.backend,
          getMCPManager: () => this.mcpManager,
          setMCPManager: (manager?: MCPManager) => {
            this.mcpManager = manager;
          },
        },
        mergedConfig,
      );

      this.config.llmName = summary.llmName;
      this.config.modelName = summary.modelName;
      this.config.streamEnabled = summary.streamEnabled;
    });
    this.router.get('/api/config', config.get);
    this.router.put('/api/config', config.update);
    this.router.post('/api/config/models', config.listModels);

    // 状态 API
    this.router.get('/api/status', async (_req, res) => {
      sendJSON(res, 200, {
        provider: this.config.llmName,
        model: this.config.modelName,
        tools: this.backend.getToolNames(),
        stream: this.config.streamEnabled,
        authProtected: !!this.config.authToken,
        managementProtected: !!this.config.managementToken,
        platform: 'web',
      });
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
