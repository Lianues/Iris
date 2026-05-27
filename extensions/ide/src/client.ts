import { EventEmitter } from 'events';
import { z } from 'zod/v4';
import type { DetectedIde, IdeAtMentioned, IdeSelection } from './types.js';

const SelectionChangedSchema = z.object({
  method: z.literal('selection_changed'),
  params: z.object({
    selection: z.object({
      start: z.object({ line: z.number(), character: z.number() }),
      end: z.object({ line: z.number(), character: z.number() }),
    }).nullable().optional(),
    text: z.string().optional(),
    filePath: z.string().optional(),
  }),
});

const AtMentionedSchema = z.object({
  method: z.literal('at_mentioned'),
  params: z.object({
    filePath: z.string(),
    lineStart: z.number().optional(),
    lineEnd: z.number().optional(),
  }),
});

interface IdeClientEvents {
  selection: (selection: IdeSelection) => void;
  atMentioned: (payload: IdeAtMentioned) => void;
  close: () => void;
  error: (error: Error) => void;
}

type Listener<T extends keyof IdeClientEvents> = IdeClientEvents[T];

type SDKContentBlock = {
  type?: string;
  text?: string;
  [key: string]: unknown;
};

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function extractText(content: unknown): string {
  if (!Array.isArray(content)) return '';
  return content
    .filter((block): block is SDKContentBlock => !!block && typeof block === 'object')
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n');
}

function normalizeSelection(params: z.infer<typeof SelectionChangedSchema>['params']): IdeSelection {
  if (!params.selection?.start || !params.selection?.end) {
    return {
      filePath: params.filePath,
      text: params.text,
      lineCount: 0,
    };
  }

  const startLine = Math.max(1, Math.floor(params.selection.start.line) + 1);
  let endLine = Math.max(1, Math.floor(params.selection.end.line) + 1);
  // Most editor APIs report a range ending at character 0 of the next line for
  // whole-line selections. In that case, keep the visual selected line count.
  if (params.selection.end.character === 0 && endLine > startLine) {
    endLine -= 1;
  }

  return {
    filePath: params.filePath,
    text: params.text,
    lineStart: startLine,
    lineEnd: Math.max(startLine, endLine),
    lineCount: Math.max(0, Math.max(startLine, endLine) - startLine + 1),
  };
}

export class IdeRpcClient {
  private readonly events = new EventEmitter();
  private client: any;
  private transport: any;

  constructor(readonly ide: DetectedIde) {}

  on<T extends keyof IdeClientEvents>(event: T, listener: Listener<T>): () => void {
    this.events.on(event, listener as (...args: unknown[]) => void);
    return () => this.events.off(event, listener as (...args: unknown[]) => void);
  }

  async connect(): Promise<void> {
    const { Client } = await import('@modelcontextprotocol/sdk/client');
    this.client = new Client(
      { name: 'Iris', version: '1.0.0' },
      { capabilities: {} },
    );

    this.transport = await this.createTransport();
    this.client.onerror = (error: Error) => this.events.emit('error', toError(error));
    this.client.onclose = () => this.events.emit('close');
    this.registerNotificationHandlers();

    await this.client.connect(this.transport);
  }

  private async createTransport(): Promise<any> {
    if (this.ide.transport === 'sse') {
      const { SSEClientTransport } = await import('@modelcontextprotocol/sdk/client/sse.js');
      const headers: Record<string, string> = {
        'User-Agent': 'Iris IDE Integration',
      };
      if (this.ide.authToken) {
        // Iris-native extensions should prefer X-Iris-Ide-Authorization. The
        // Claude header is sent only for local compatibility experiments.
        headers['X-Iris-Ide-Authorization'] = this.ide.authToken;
        headers['X-Claude-Code-Ide-Authorization'] = this.ide.authToken;
      }
      return new SSEClientTransport(new URL(this.ide.url), {
        requestInit: { headers },
      });
    }

    if (this.ide.authToken) {
      throw new Error('当前 MVP 暂不支持带 authToken 的 WebSocket IDE 连接，请使用 SSE transport 或 Iris-native IDE 插件。');
    }

    const { WebSocketClientTransport } = await import('@modelcontextprotocol/sdk/client/websocket.js');
    return new WebSocketClientTransport(new URL(this.ide.url));
  }

  private registerNotificationHandlers(): void {
    this.client.setNotificationHandler(SelectionChangedSchema, (notification: z.infer<typeof SelectionChangedSchema>) => {
      const selection = normalizeSelection(notification.params);
      this.events.emit('selection', selection);
    });

    this.client.setNotificationHandler(AtMentionedSchema, (notification: z.infer<typeof AtMentionedSchema>) => {
      const data = notification.params;
      this.events.emit('atMentioned', {
        filePath: data.filePath,
        lineStart: data.lineStart !== undefined ? data.lineStart + 1 : undefined,
        lineEnd: data.lineEnd !== undefined ? data.lineEnd + 1 : undefined,
      } satisfies IdeAtMentioned);
    });
  }

  async callRpc(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    if (!this.client) throw new Error('IDE 尚未连接');
    const result = await this.client.callTool({ name: method, arguments: params });
    if (result?.isError) {
      throw new Error(extractText(result.content) || `IDE RPC ${method} 执行失败`);
    }
    return result?.content;
  }

  async close(): Promise<void> {
    try {
      await this.client?.close?.();
    } finally {
      try { await this.transport?.close?.(); } catch { /* ignore */ }
      this.client = undefined;
      this.transport = undefined;
    }
  }
}
