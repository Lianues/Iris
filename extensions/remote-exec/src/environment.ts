/**
 * environment.ts
 *
 * 维护"当前活动服务器"的状态。
 *
 * 状态作用域：按对话（session）隔离。
 * 通过 SessionMeta.remoteExecEnvironment 持久化，与对话历史天然一致。
 *
 * 暴露 EnvironmentManager 给 wrap.ts、switch_server 工具和 Console 集成调用。
 */

import type { IrisAPI } from 'irises-extension-sdk';
import { LOCAL_ENV, type RemoteExecConfig } from './config.js';
import type { ServerEntry } from './ssh-config.js';

export interface EnvSummary {
  name: string;
  isLocal: boolean;
  description?: string;
  hostName?: string;
  os?: string;
  user?: string;
  workdir?: string;
}

export interface EnvironmentSwitchOptions {
  /** 显式指定 sessionId；Console /env 不在 turn 上下文内，必须传入 */
  sessionId?: string;
  /** 切换到远端前是否验证 SSH 连接/认证，默认 true */
  validate?: boolean;
  /** 是否写入 SessionMeta.remoteExecEnvironment，默认 true */
  persist?: boolean;
  source?: 'tool' | 'slash' | 'session-load' | 'preload';
}

export interface EnvironmentSwitchResult {
  previous: string;
  current: string;
  persisted: boolean;
  warning?: string;
}

export interface EnvironmentRestoreResult {
  ok: boolean;
  sessionId: string;
  source: 'metadata' | 'default' | 'cache';
  requested?: string;
  previous: string;
  current: string;
  message: string;
  error?: string;
}

export interface EnvironmentState {
  name: string;
  isLocal: boolean;
  summary?: EnvSummary;
  error?: string;
}

type EnvironmentValidator = (name: string) => Promise<void>;
type EnvironmentChangeListener = () => void;

export class EnvironmentManager {
  /** per-session 内存缓存：避免每次工具调用都读存储 */
  private sessionCache = new Map<string, string>();
  /** per-session 最近一次恢复/切换错误；用于状态栏显示 ⚠ */
  private sessionErrors = new Map<string, string>();
  private listeners = new Set<EnvironmentChangeListener>();

  constructor(
    private api: IrisAPI,
    private getServers: () => Map<string, ServerEntry>,
    private getConfig: () => RemoteExecConfig,
    private validateRemote?: EnvironmentValidator,
  ) {}

  /** 订阅环境变化（Console 状态栏使用） */
  onDidChange(listener: EnvironmentChangeListener): { dispose(): void } {
    this.listeners.add(listener);
    return { dispose: () => { this.listeners.delete(listener); } };
  }

  private emitChange(): void {
    for (const listener of [...this.listeners]) {
      try { listener(); } catch { /* ignore */ }
    }
  }

  private resolveSessionId(sessionId?: string): string | undefined {
    return sessionId ?? this.api.agentManager?.getActiveSessionId?.();
  }

  private isKnownEnvironment(name: string): boolean {
    return name === LOCAL_ENV || this.getServers().has(name);
  }

  private getFallbackEnvironment(): string {
    const configured = this.getConfig().defaultEnvironment ?? LOCAL_ENV;
    return this.isKnownEnvironment(configured) ? configured : LOCAL_ENV;
  }

  /**
   * 获取当前会话的服务器（同步）。
   *
   * 工具执行时可不传 sessionId（走 AsyncLocalStorage active session）；
   * Console UI 命令/状态栏必须显式传入当前 Console sessionId。
   */
  getActive(sessionId?: string): string {
    const sid = this.resolveSessionId(sessionId);
    if (!sid) return this.getFallbackEnvironment();

    const cached = this.sessionCache.get(sid);
    if (cached) {
      // 只返回仍存在的环境；配置热重载删除服务器时同步回退到 local。
      if (this.isKnownEnvironment(cached)) return cached;
      return LOCAL_ENV;
    }

    return this.getFallbackEnvironment();
  }

  getActiveState(sessionId?: string): EnvironmentState {
    const sid = this.resolveSessionId(sessionId);
    const name = this.getActive(sid);
    return {
      name,
      isLocal: name === LOCAL_ENV,
      summary: this.listEnvs().find((env) => env.name === name),
      error: sid ? this.sessionErrors.get(sid) : undefined,
    };
  }

  /**
   * 预加载当前会话的服务器（由 onBeforeLLMCall hook 在 turn 开始时调用）。
   * 从 session meta 中读取 remoteExecEnvironment，验证服务器仍存在后写入缓存。
   */
  async ensureLoaded(sessionId: string): Promise<void> {
    if (this.sessionCache.has(sessionId)) return;
    await this.restoreForSession(sessionId, { validate: true, source: 'preload' });
  }

  /**
   * 从会话元数据恢复环境。
   * Console /load 会调用该方法并把 result.message 作为临时命令消息展示给用户。
   */
  async restoreForSession(
    sessionId: string,
    options: { validate?: boolean; source?: 'session-load' | 'preload' } = {},
  ): Promise<EnvironmentRestoreResult> {
    const previous = this.getActive(sessionId);
    const fallback = this.getFallbackEnvironment();
    const validate = options.validate !== false;

    let stored: string | undefined;
    try {
      const meta = await this.api.storage.getMeta?.(sessionId);
      const raw = (meta as any)?.remoteExecEnvironment;
      stored = typeof raw === 'string' && raw.trim() ? raw.trim() : undefined;
    } catch (err) {
      const message = `读取对话 remote-exec 环境失败：${errorMessage(err)}。当前使用：${fallback}`;
      this.sessionCache.set(sessionId, fallback);
      this.sessionErrors.set(sessionId, message);
      this.emitChange();
      return { ok: false, sessionId, source: 'metadata', previous, current: fallback, message, error: errorMessage(err) };
    }

    if (!stored) {
      this.sessionCache.set(sessionId, fallback);
      this.sessionErrors.delete(sessionId);
      this.emitChange();
      return {
        ok: true,
        sessionId,
        source: 'default',
        previous,
        current: fallback,
        message: `该对话没有记录 remote-exec 环境，当前使用：${this.formatEnvironmentLabel(fallback)}`,
      };
    }

    if (!this.isKnownEnvironment(stored)) {
      const message = `对话记录的 remote-exec 环境为 ${stored}，但该服务器不存在。已回退到：${LOCAL_ENV}`;
      this.sessionCache.set(sessionId, LOCAL_ENV);
      this.sessionErrors.set(sessionId, message);
      this.emitChange();
      return { ok: false, sessionId, source: 'metadata', requested: stored, previous, current: LOCAL_ENV, message, error: 'unknown-environment' };
    }

    if (stored !== LOCAL_ENV && validate) {
      try {
        await this.validateTarget(stored);
      } catch (err) {
        const msg = errorMessage(err);
        const message = `对话记录的 remote-exec 环境为 ${this.formatEnvironmentLabel(stored)}，但连接失败：${msg}\n已回退到：${LOCAL_ENV}`;
        this.sessionCache.set(sessionId, LOCAL_ENV);
        this.sessionErrors.set(sessionId, message);
        this.emitChange();
        return { ok: false, sessionId, source: 'metadata', requested: stored, previous, current: LOCAL_ENV, message, error: msg };
      }
    }

    this.sessionCache.set(sessionId, stored);
    this.sessionErrors.delete(sessionId);
    this.emitChange();
    return {
      ok: true,
      sessionId,
      source: 'metadata',
      requested: stored,
      previous,
      current: stored,
      message: `已从对话元数据恢复 remote-exec 环境：${this.formatEnvironmentLabel(stored)}`,
    };
  }

  /**
   * 切换活动服务器（验证成功后写入 session meta，立即持久化）。
   * switch_server 工具和 /env 命令调用。
   */
  async setActive(name: string, options: EnvironmentSwitchOptions = {}): Promise<EnvironmentSwitchResult> {
    const target = name.trim();
    if (!target) throw new Error('服务器名不能为空');

    const sid = this.resolveSessionId(options.sessionId);
    const previous = this.getActive(sid);

    if (!this.isKnownEnvironment(target)) {
      throw new Error(`未知服务器 "${target}"。可用服务器：${this.listEnvs().map(e => e.name).join(', ')}`);
    }

    if (target !== LOCAL_ENV && options.validate !== false) {
      try {
        await this.validateTarget(target);
      } catch (err) {
        throw new Error(`无法切换到服务器 "${target}"：${errorMessage(err)}。当前仍为 "${previous}"。`);
      }
    }

    let persisted = false;
    let warning: string | undefined;

    if (sid) {
      this.sessionCache.set(sid, target);
      this.sessionErrors.delete(sid);

      if (options.persist !== false) {
        try {
          const meta = this.api.storage.updateMeta
            ? await this.api.storage.updateMeta(sid, (current) => {
              if (!current) return undefined;
              (current as any).remoteExecEnvironment = target;
              return current;
            })
            : await this.api.storage.getMeta?.(sid);
          if (meta) {
            if (this.api.storage.updateMeta) {
              persisted = true;
            } else if (this.api.storage.saveMeta) {
              (meta as any).remoteExecEnvironment = target;
              await this.api.storage.saveMeta(meta);
              persisted = true;
            } else {
              warning = '当前存储后端不支持保存会话元数据，环境仅在本次运行中生效';
            }
          } else {
            warning = `未找到会话元数据，当前环境仅在本次运行中生效 (session=${sid})`;
          }
        } catch (err) {
          warning = `保存 remote-exec 环境到会话元数据失败：${errorMessage(err)}`;
        }
      }
    }

    this.emitChange();
    return { previous, current: target, persisted, warning };
  }

  /** 清除指定会话的缓存（对话关闭/清理时调用，防止内存泄漏） */
  clearSession(sessionId: string): void {
    this.sessionCache.delete(sessionId);
    this.sessionErrors.delete(sessionId);
    this.emitChange();
  }

  /** 当前活动服务器对应的 ServerEntry；返回 null 表示本机 */
  getActiveServer(sessionId?: string): ServerEntry | null {
    const name = this.getActive(sessionId);
    if (name === LOCAL_ENV) return null;
    return this.getServers().get(name) ?? null;
  }

  /** 列出所有可用服务器（local + 所有 Host） */
  listEnvs(): EnvSummary[] {
    const list: EnvSummary[] = [
      { name: LOCAL_ENV, isLocal: true, description: '本机（不通过 SSH，直接在本地执行所有工具）' },
    ];
    for (const s of this.getServers().values()) {
      list.push({
        name: s.host,
        isLocal: false,
        description: s.description ? `${s.description} (transport=${s.transport ?? 'auto'})` : `transport=${s.transport ?? 'auto'}`,
        os: s.os,
        hostName: s.hostName,
        user: s.user,
        workdir: s.workdir ?? this.getConfig().remoteWorkdir,
      });
    }
    return list;
  }

  private async validateTarget(name: string): Promise<void> {
    if (name === LOCAL_ENV || !this.validateRemote) return;
    await this.validateRemote(name);
  }

  private formatEnvironmentLabel(name: string): string {
    if (name === LOCAL_ENV) return LOCAL_ENV;
    const server = this.getServers().get(name);
    if (!server) return name;
    const userHost = server.hostName ? `${server.user ?? '?'}@${server.hostName}` : undefined;
    return userHost ? `${name} (${userHost})` : name;
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
