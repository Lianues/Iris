import { EventEmitter } from 'events';
import type { Disposable } from 'irises-extension-sdk';
import type { ToolDiffPreviewResponseLike } from 'irises-extension-sdk/plugin';
import { IdeRpcClient } from './client.js';
import { detectIDEs, isPathInsideCwd, relativeToCwd } from './detect.js';
import type {
  DetectedIde,
  IdeAtMentioned,
  IdeConfig,
  IdeDebugSnapshot,
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

const STALE_TRANSPORT_ERROR_WINDOW_MS = 15_000;
const STALE_TRANSPORT_ERROR_THRESHOLD = 3;
const STALE_TRANSPORT_ERROR_PATTERN = /Unable to connect|ECONNREFUSED|ECONNRESET|fetch failed|network error|socket hang up|terminated/i;

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
  private readonly debugEvents: IdeDebugSnapshot['recentEvents'] = [];
  private transportErrorCount = 0;
  private lastTransportErrorAt = 0;

  constructor(private readonly options: IdeManagerOptions) {
    this.config = options.config;
    this.logDebug('init', 'IDE manager created', { dataDir: options.dataDir, enabled: options.config.enabled });
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
    this.logDebug('config', 'IDE config updated', { enabled: config.enabled, autoConnect: config.autoConnect, lockDir: config.lockDir });
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
    this.logDebug('detect', 'Scanning IDE lockfiles', { cwd: this.safeCwd(), dataDir: this.options.dataDir });
    this.emitChange();
    try {
      this.detected = await detectIDEs({
        dataDir: this.options.dataDir,
        cwd: this.options.getCwd(),
        config: this.config,
      });
      if (previousState !== 'connected') this.state = 'disconnected';
      this.error = undefined;
      this.logDebug('detect', `Detected ${this.detected.length} IDE session(s)`, { valid: this.detected.filter((ide) => ide.isValid).length });
      return this.detected;
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
      if (previousState !== 'connected') this.state = 'error';
      this.logDebug('error', 'IDE detection failed', { error: this.error });
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

  getDebugSnapshot(): IdeDebugSnapshot {
    return {
      status: this.status(),
      config: this.config,
      cwd: this.safeCwd(),
      dataDir: this.options.dataDir,
      detected: [...this.detected],
      hasRpcClient: !!this.rpcClient,
      currentUrl: this.connectedIde?.url,
      recentEvents: [...this.debugEvents],
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

    this.logDebug('connect', `Connecting to ${ide.name} (${ide.port})`, { target, url: ide.url, transport: ide.transport, lockfilePath: ide.lockfilePath });

    await this.disconnect();
    this.state = 'connecting';
    this.error = undefined;
    this.emitChange();

    const client = new IdeRpcClient(ide);
    const disposers = [
      client.on('selection', (selection) => {
        this.selection = selection;
        this.logDebug('selection', 'Selection changed', {
          filePath: selection.filePath,
          lineStart: selection.lineStart,
          lineEnd: selection.lineEnd,
          lineCount: selection.lineCount,
        });
        if (this.rpcClient === client && this.connectedIde) {
          this.state = 'connected';
          this.error = undefined;
          this.resetTransportErrors();
        }
        if (selection.filePath) this.openedFile = selection.filePath;
        this.emitChange();
      }),
      client.on('atMentioned', (payload) => {
        this.logDebug('atMentioned', 'IDE sent @ mention', payload);
        this.events.emit('atMentioned', payload);
      }),
      client.on('close', () => {
        if (this.rpcClient !== client) return;
        this.rpcClient = undefined;
        this.connectedIde = undefined;
        this.selection = undefined;
        this.openedFile = undefined;
        this.state = 'disconnected';
        this.logDebug('close', 'IDE transport closed');
        this.emitChange();
      }),
      client.on('error', (error) => {
        const active = this.rpcClient === client && !!this.connectedIde;
        const transportError = this.recordTransportError(error);
        this.error = error.message;

        if (active && transportError.shouldDisconnect) {
          this.logDebug('transportError', 'IDE transport appears stale; disconnecting current RPC client', {
            error: error.message,
            count: transportError.count,
          });
          void this.markClientDisconnected(client, `IDE 连接失效：${error.message}`);
          return;
        }

        this.state = active ? 'connected' : 'error';
        this.logDebug('transportError', 'IDE transport reported error', {
          error: error.message,
          count: transportError.count,
          keptState: this.state,
        });
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
      this.resetTransportErrors();
      (client as unknown as { __irisDisposers?: Array<() => void> }).__irisDisposers = disposers;
      this.logDebug('connect', `Connected to ${ide.name} (${ide.port})`);
      this.emitChange();
      return ide;
    } catch (error) {
      for (const dispose of disposers) dispose();
      await client.close().catch(() => {});
      this.state = 'error';
      this.error = error instanceof Error ? error.message : String(error);
      this.logDebug('error', `Failed to connect to ${ide.name} (${ide.port})`, { error: this.error });
      this.emitChange();
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    const client = this.rpcClient;
    if (client || this.connectedIde) this.logDebug('disconnect', 'Disconnecting IDE', { current: this.connectedIde?.id });
    this.rpcClient = undefined;
    this.connectedIde = undefined;
    this.selection = undefined;
    this.openedFile = undefined;
    this.state = 'disconnected';
    this.error = undefined;
    this.resetTransportErrors();

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
    if (!this.rpcClient || !this.connectedIde) return false;
    const items = preview.items ?? [];
    const item = items.length > 0 ? items[((index % items.length) + items.length) % items.length] : undefined;
    if (!item?.diff) return false;
    this.logDebug('openDiff', 'Opening IDE diff preview', { filePath: item.filePath, index, toolName: preview.toolName });
    try {
      await this.callRpc('openDiff', {
        filePath: item.filePath,
        diff: item.diff,
        beforeText: item.beforeText,
        afterText: item.afterText,
        title: `${preview.toolLabel ?? preview.toolName}: ${item.filePath || 'diff'}`,
      });
      this.state = 'connected';
      this.error = undefined;
      this.resetTransportErrors();
      this.logDebug('openDiff', 'IDE diff preview opened', { filePath: item.filePath });
      return true;
    } catch (error) {
      this.logDebug('error', 'Failed to open IDE diff preview', { error: error instanceof Error ? error.message : String(error), filePath: item.filePath });
      throw error;
    }
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

  private safeCwd(): string {
    try {
      return this.options.getCwd();
    } catch (error) {
      return `unknown (${error instanceof Error ? error.message : String(error)})`;
    }
  }

  private resetTransportErrors(): void {
    this.transportErrorCount = 0;
    this.lastTransportErrorAt = 0;
  }

  private recordTransportError(error: Error): { count: number; shouldDisconnect: boolean } {
    const now = Date.now();
    if (now - this.lastTransportErrorAt > STALE_TRANSPORT_ERROR_WINDOW_MS) {
      this.transportErrorCount = 0;
    }
    this.lastTransportErrorAt = now;
    this.transportErrorCount++;

    return {
      count: this.transportErrorCount,
      shouldDisconnect: STALE_TRANSPORT_ERROR_PATTERN.test(error.message)
        && this.transportErrorCount >= STALE_TRANSPORT_ERROR_THRESHOLD,
    };
  }

  private async markClientDisconnected(client: IdeRpcClient, reason: string): Promise<void> {
    if (this.rpcClient !== client) return;

    const disposers = (client as unknown as { __irisDisposers?: Array<() => void> }).__irisDisposers ?? [];
    for (const dispose of disposers) dispose();

    this.rpcClient = undefined;
    this.connectedIde = undefined;
    this.selection = undefined;
    this.openedFile = undefined;
    this.state = 'disconnected';
    this.error = reason;
    this.resetTransportErrors();
    this.logDebug('disconnect', 'Disconnected stale IDE RPC client', { reason });
    this.emitChange();

    try { await client.close(); } catch { /* ignore stale transport close errors */ }

    // Refresh lockfiles after a stale transport. If VS Code has restarted the
    // extension server, this lets the next /ide immediately see the new port.
    await this.detect().catch((error) => {
      this.logDebug('error', 'Failed to refresh IDE lockfiles after stale disconnect', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  private logDebug(kind: string, message: string, data?: unknown): void {
    this.debugEvents.push({
      at: new Date().toISOString(),
      kind,
      message,
      data,
    });
    while (this.debugEvents.length > 80) this.debugEvents.shift();
  }

}
