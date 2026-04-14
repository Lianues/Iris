/**
 * MCP 客户端
 *
 * 封装 MCP SDK Client，管理单个 MCP 服务器的连接、工具列表和工具调用。
 * SDK 为 ESM-only，通过动态 import() 加载。
 *
 * 支持三种传输方式：
 *   - stdio:          通过子进程标准输入输出通信
 *   - sse:             Server-Sent Events（HTTP 长连接）
 *   - streamable-http: Streamable HTTP（MCP 新版协议）
 */

import { createPluginLogger } from 'irises-extension-sdk';
import type { ToolAttachment } from 'irises-extension-sdk';
import type { MCPServerConfig, MCPClientStatus } from './types.js';

const logger = createPluginLogger('mcp', 'client');

/** SDK Tool 类型（避免静态 import ESM） */
interface SDKTool {
  name: string;
  description?: string;
  inputSchema: {
    type: 'object';
    properties?: Record<string, unknown>;
    required?: string[];
    [key: string]: unknown;
  };
}

/** SDK callTool 结果中的内容块 */
interface SDKContentBlock {
  type: string;
  text?: string;
  data?: string;
  mimeType?: string;
  [key: string]: unknown;
}

/** MCP 工具调用的结构化结果。 */
export interface MCPToolResult {
  text: string;
  attachments: ToolAttachment[];
}

export class MCPClient {
  readonly serverName: string;
  private config: MCPServerConfig;
  private _status: MCPClientStatus = 'disconnected';
  private _error?: string;
  private _tools: SDKTool[] = [];
  private client: any = null;
  private transport: any = null;

  constructor(serverName: string, config: MCPServerConfig) {
    this.serverName = serverName;
    this.config = config;
  }

  get status(): MCPClientStatus { return this._status; }
  get error(): string | undefined { return this._error; }
  get toolList(): SDKTool[] { return this._tools; }

  /** 连接服务器并拉取工具列表 */
  async connect(): Promise<void> {
    this._status = 'connecting';
    this._error = undefined;

    try {
      // @ts-ignore — ESM subpath import
      const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');

      this.client = new Client(
        { name: 'Iris', version:'1.0.0' },
        { capabilities: {} },
      );

      // 根据传输类型创建 transport
      this.transport = await this.createTransport();

      // 带超时连接
      const timeout = this.config.timeout ?? 30000;
      let timer: ReturnType<typeof setTimeout>;
      await Promise.race([
        this.client.connect(this.transport),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(`连接超时（${timeout}ms）`)), timeout);
        }),
      ]).finally(() => clearTimeout(timer!));

      // 拉取工具列表
      let timer2: ReturnType<typeof setTimeout>;
      const result = await Promise.race([
        this.client.listTools(),
        new Promise((_, reject) => {
          timer2 = setTimeout(() => reject(new Error(`listTools 超时（${timeout}ms）`)), timeout);
        }),
      ]).finally(() => clearTimeout(timer2!)) as any;
      this._tools = result.tools ?? [];
      this._status = 'connected';

      logger.info(`MCP 服务器 "${this.serverName}" 已连接 (${this.config.transport})，工具数: ${this._tools.length}`);
    } catch (err: unknown) {
      this._status = 'error';
      this._error = err instanceof Error ? err.message : String(err);
      this._tools = [];
      try { await this.client?.close?.(); } catch { /* ignore */ }
      try { await this.transport?.close?.(); } catch { /* ignore */ }
      this.client = null;
      this.transport = null;
      logger.warn(`MCP 服务器 "${this.serverName}" 连接失败: ${this._error}`);
    }
  }

  /** 根据配置创建对应的 transport 实例 */
  private async createTransport(): Promise<any> {
    switch (this.config.transport) {
      case 'stdio': {
        // @ts-ignore — ESM subpath import
        const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
        return new StdioClientTransport({
          command: this.config.command!,
          args: this.config.args,
          env: this.config.env
            ? { ...process.env as Record<string, string>, ...this.config.env }
            : undefined,
          cwd: this.config.cwd,
        });
      }

      case 'sse': {
        // @ts-ignore — ESM subpath import
        const { SSEClientTransport } = await import('@modelcontextprotocol/sdk/client/sse.js');
        const opts: any = {};
        if (this.config.headers) {
          opts.requestInit = { headers: this.config.headers };
        }
        return new SSEClientTransport(new URL(this.config.url!), opts);
      }

      case 'streamable-http': {
        // @ts-ignore — ESM subpath import
        const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
        const opts: any = {};
        if (this.config.headers) {
          opts.requestInit = { headers: this.config.headers };
        }
        return new StreamableHTTPClientTransport(new URL(this.config.url!), opts);
      }
    }
  }

  /** 调用工具 */
  async callTool(name: string, args: Record<string, unknown>): Promise<MCPToolResult> {
    if (!this.client || this._status !== 'connected') {
      throw new Error(`MCP 服务器 "${this.serverName}" 未连接`);
    }

    const result = await this.client.callTool({ name, arguments: args });

    if (result.isError) {
      const text = this.extractText(result.content);
      throw new Error(text || `MCP 工具 "${name}" 执行失败`);
    }

    return this.parseToolResult(result.content, name);
  }

  /**
   * 解析 MCP 工具结果。
   */
  private parseToolResult(content: SDKContentBlock[], toolName: string): MCPToolResult {
    const texts: string[] = [];
    const attachments: ToolAttachment[] = [];

    logger.info(`[parseToolResult] 工具 "${toolName}" 返回 ${Array.isArray(content) ? content.length : 0} 个 content block，`
      + `类型: ${Array.isArray(content) ? content.map(b => `${b.type}(keys=${Object.keys(b).join('+')})`).join(', ') : typeof content}`);

    if (!Array.isArray(content)) {
      return { text: String(content), attachments: [] };
    }

    for (const block of content) {
      if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
        texts.push(block.text);
        continue;
      }

      if (block.type === 'image' && typeof block.data === 'string' && typeof block.mimeType === 'string') {
        logger.info(`[parseToolResult] 发现图片 block: mimeType=${block.mimeType}, data 长度=${block.data.length}`);
        attachments.push({
          type: 'image',
          mimeType: block.mimeType,
          data: Buffer.from(block.data, 'base64'),
        });
      }
    }

    logger.info(`[parseToolResult] 解析完成: texts=${texts.length}, attachments=${attachments.length}`);
    if (attachments.length === 0 && Array.isArray(content) && content.length > 0) {
      logger.info(`[parseToolResult] 未发现图片附件。各 block 的 keys: ${content.map(b => JSON.stringify(Object.keys(b))).join(' | ')}`);
    }

    const hasAttachmentHint = texts.some((text) => /图片|image/i.test(text));
    if (attachments.length > 0 && !hasAttachmentHint) {
      texts.push(`已生成 ${attachments.length} 张图片，并直接发送给用户。`);
    }

    return {
      text: texts.join('\n').trim(),
      attachments,
    };
  }

  /** 从内容块数组中提取文本 */
  private extractText(content: SDKContentBlock[]): string {
    if (!Array.isArray(content)) return String(content);
    return content
      .filter((c: SDKContentBlock) => c.type === 'text' && c.text)
      .map((c: SDKContentBlock) => c.text)
      .join('\n');
  }

  /** 断开连接 */
  async disconnect(): Promise<void> {
    try {
      if (this.client) {
        await this.client.close?.();
      } else if (this.transport) {
        await this.transport.close?.();
      }
    } catch {
      // 忽略关闭错误
    } finally {
      this.client = null;
      this.transport = null;
      this._tools = [];
      this._status = 'disconnected';
      this._error = undefined;
    }
  }
}
