import { EventEmitter } from 'events';
import type { Disposable } from 'irises-extension-sdk';
import type { ToolDiffPreviewResponseLike } from 'irises-extension-sdk/plugin';
import { IdeRpcClient } from './client.js';
import { detectIDEs, isPathInsideCwd, relativeToCwd } from './detect.js';
import type {
  DetectedIde,
  IdeAtMentioned,
  IdeConfig,
  IdeConnectionState,
  IdeManagerService,
  IdeSelection,
  IdeStatusSnapshot,
} from './types.js';

type LoggerLike = {
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
};

export interface IdeManagerOptions {
  dataDir: string;
  getCwd: () => string;
  config: IdeConfig;
  logger: LoggerLike;
}

export class IdeManager implements IdeManagerService {
  private readonly events = new EventEmitter();
  private config: IdeConfig;
  private detected: DetectedIde[] = [];
  private state: IdeConnectionState = 'disconnected';
  private error: string | undefined;
  private rpcClient: IdeRpcClient | undefined;
  private connectedIde: DetectedIde | undefined;
  private selection: IdeSelection | undefined;
  private openedFile: string | undefined;

  constructor(private readonly options: IdeManagerOptions) {
    this.config = options.config;
  }

  async initialize(): Promise<void> {
    await this.detect();
    if (this.config.autoConnect) {
      const valid = this.detected.filter((ide) => ide.isValid);
      if (valid.length === 1) {
        try {
          await this.connect(valid[0].id);
        } catch (error) {
          this.options.logger.warn('[ide] autoConnect 失败:', error);
        }
      }
    }
  }

  updateConfig(config: IdeConfig): void {
    this.config = config;
    if (!config.enabled) {
      void this.disconnect().catch(() => {});
    }
    this.emitChange();
  }

  async detect(): Promise<DetectedIde[]> {
    if (!this.config.enabled) {
      this.detected = [];
      this.emitChange();
      return [];
    }

    const previousState = this.state;
    if (this.state !== 'connected') this.state = 'detecting';
    this.emitChange();
    try {
      this.detected = await detectIDEs({
        dataDir: this.options.dataDir,
        cwd: this.options.getCwd(),
        config: this.config,
      });
      if (previousState !== 'connected') this.state = 'disconnected';
      this.error = undefined;
      return this.detected;
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
      if (previousState !== 'connected') this.state = 'error';
      return [];
    } finally {
      this.emitChange();
    }
  }

  list(): DetectedIde[] {
    return [...this.detected];
  }

  current(): DetectedIde | undefined {
    return this.connectedIde;
  }

  status(): IdeStatusSnapshot {
    return {
      state: this.state,
      current: this.connectedIde,
      detected: [...this.detected],
      selection: this.selection,
      openedFile: this.openedFile,
      error: this.error,
    };
  }

  async connect(target?: string): Promise<DetectedIde> {
    if (!this.config.enabled) throw new Error('IDE 集成已禁用');
    if (this.detected.length === 0) await this.detect();
    const ide = this.resolveTarget(target);
    if (!ide) {
      throw new Error(target ? `未找到匹配的 IDE：${target}` : '未发现可连接的 IDE');
    }
    if (!ide.isValid) {
      throw new Error(`IDE 工作区与当前 cwd 不匹配：${ide.name} (${ide.port})`);
    }

    await this.disconnect();
    this.state = 'connecting';
    this.error = undefined;
    this.emitChange();

    const client = new IdeRpcClient(ide);
    const disposers = [
      client.on('selection', (selection) => {
        this.selection = selection;
        if (selection.filePath) this.openedFile = selection.filePath;
        this.emitChange();
      }),
      client.on('atMentioned', (payload) => {
        this.events.emit('atMentioned', payload);
      }),
      client.on('close', () => {
        if (this.rpcClient !== client) return;
        this.rpcClient = undefined;
        this.connectedIde = undefined;
        this.selection = undefined;
        this.openedFile = undefined;
        this.state = 'disconnected';
        this.emitChange();
      }),
      client.on('error', (error) => {
        this.error = error.message;
        this.state = 'error';
        this.emitChange();
      }),
    ];

    try {
      await client.connect();
      this.rpcClient = client;
      this.connectedIde = ide;
      this.state = 'connected';
      this.selection = undefined;
      this.openedFile = undefined;
      (client as unknown as { __irisDisposers?: Array<() => void> }).__irisDisposers = disposers;
      this.emitChange();
      return ide;
    } catch (error) {
      for (const dispose of disposers) dispose();
      await client.close().catch(() => {});
      this.state = 'error';
      this.error = error instanceof Error ? error.message : String(error);
      this.emitChange();
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    const client = this.rpcClient;
    this.rpcClient = undefined;
    this.connectedIde = undefined;
    this.selection = undefined;
    this.openedFile = undefined;
    this.state = 'disconnected';
    this.error = undefined;

    const disposers = (client as unknown as { __irisDisposers?: Array<() => void> } | undefined)?.__irisDisposers ?? [];
    for (const dispose of disposers) dispose();
    if (client) {
      try {
        await client.close();
      } catch { /* best-effort disconnect */ }
    }
    this.emitChange();
  }

  async callRpc(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    if (!this.rpcClient) throw new Error('IDE 尚未连接');
    return this.rpcClient.callRpc(method, params);
  }

  async openDiffPreview(preview: ToolDiffPreviewResponseLike, index = 0): Promise<boolean> {
    if (!this.rpcClient || this.state !== 'connected') return false;
    const items = preview.items ?? [];
    const item = items.length > 0 ? items[((index % items.length) + items.length) % items.length] : undefined;
    if (!item?.diff) return false;
    await this.callRpc('openDiff', {
      filePath: item.filePath,
      diff: item.diff,
      title: `${preview.toolLabel ?? preview.toolName}: ${item.filePath || 'diff'}`,
    });
    return true;
  }

  getSelection(): IdeSelection | undefined {
    return this.selection;
  }

  getOpenedFile(): string | undefined {
    return this.openedFile;
  }

  getContextText(): string | undefined {
    if (!this.config.context.enabled || this.state !== 'connected') return undefined;
    const cwd = this.options.getCwd();
    const ideName = this.connectedIde?.name ?? 'IDE';

    if (this.selection?.text && this.selection.filePath && isPathInsideCwd(this.selection.filePath, cwd)) {
      const relative = relativeToCwd(this.selection.filePath, cwd);
      const maxChars = this.config.context.maxSelectedChars;
      const original = this.selection.text;
      const truncated = original.length > maxChars;
      const text = truncated ? `${original.slice(0, maxChars)}\n...[IDE selection truncated]` : original;
      const range = this.selection.lineStart && this.selection.lineEnd
        ? `L${this.selection.lineStart}${this.selection.lineEnd !== this.selection.lineStart ? `-L${this.selection.lineEnd}` : ''}`
        : 'unknown lines';
      return [
        '<ide_context>',
        `IDE: ${ideName}`,
        `Selected file: ${relative}`,
        `Selected range: ${range}`,
        'Selected text:',
        '~~~',
        text,
        '~~~',
        '</ide_context>',
      ].join('\n');
    }

    const filePath = this.openedFile ?? this.selection?.filePath;
    if (this.config.context.includeOpenedFile && filePath && isPathInsideCwd(filePath, cwd)) {
      return [
        '<ide_context>',
        `IDE: ${ideName}`,
        `Active file: ${relativeToCwd(filePath, cwd)}`,
        'No IDE text selection is currently available. Read the file only if relevant.',
        '</ide_context>',
      ].join('\n');
    }

    return undefined;
  }

  onDidChange(listener: () => void): Disposable {
    this.events.on('change', listener);
    return { dispose: () => this.events.off('change', listener) };
  }

  onAtMentioned(listener: (payload: IdeAtMentioned) => void): Disposable {
    this.events.on('atMentioned', listener);
    return { dispose: () => this.events.off('atMentioned', listener) };
  }

  private resolveTarget(target?: string): DetectedIde | undefined {
    const candidates = this.detected.filter((ide) => ide.isValid);
    if (!target) return candidates[0] ?? this.detected[0];

    const normalized = target.trim().toLowerCase();
    return this.detected.find((ide) => (
      ide.id.toLowerCase() === normalized
      || ide.name.toLowerCase() === normalized
      || String(ide.port) === normalized
      || ide.url.toLowerCase() === normalized
    ));
  }

  private emitChange(): void {
    this.events.emit('change');
  }
}
