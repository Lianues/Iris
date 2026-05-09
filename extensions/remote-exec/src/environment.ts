/**
 * environment.ts
 *
 * 维护"当前活动服务器"的状态。
 *
 * 状态作用域：按对话（session）隔离。
 * 通过 SessionMeta.remoteExecEnvironment 持久化，与对话历史天然一致。
 *
 * 暴露 EnvironmentManager 给 wrap.ts 和 switch_server 工具调用。
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

export class EnvironmentManager {
  /** per-session 内存缓存：避免每次工具调用都读存储 */
  private sessionCache = new Map<string, string>();

  constructor(
    private api: IrisAPI,
    private getServers: () => Map<string, ServerEntry>,
    private getConfig: () => RemoteExecConfig,
  ) {}

  /** 
   * 获取当前会话的服务器（同步）。
   * 调用前需确保 onBeforeLLMCall hook 已调用 ensureLoaded() 预加载。
   */
  getActive(): string {
    const sid = this.api.agentManager?.getActiveSessionId?.();
    if (!sid) return this.getConfig().defaultEnvironment ?? LOCAL_ENV;

    const cached = this.sessionCache.get(sid);
    if (cached) {
      // 验证服务器仍存在（可能被用户从配置中删除）
      if (cached === LOCAL_ENV || this.getServers().has(cached)) return cached;
      // 服务器已被删除，自动回退
      this.sessionCache.set(sid, LOCAL_ENV);
      return LOCAL_ENV;
    }

    // 缓存未命中：不应该发生（onBeforeLLMCall 会预加载），兜底用 default
    return this.getConfig().defaultEnvironment ?? LOCAL_ENV;
  }

  /**
   * 预加载当前会话的服务器（由 onBeforeLLMCall hook 在 turn 开始时调用）。
   * 从 session meta 中读取 remoteExecEnvironment，验证服务器仍存在后写入缓存。
   */
  async ensureLoaded(sessionId: string): Promise<void> {
    if (this.sessionCache.has(sessionId)) return;

    try {
      const meta = await this.api.storage.getMeta?.(sessionId);
      const stored = (meta as any)?.remoteExecEnvironment as string | undefined;
      if (stored && (stored === LOCAL_ENV || this.getServers().has(stored))) {
        this.sessionCache.set(sessionId, stored);
      }
    } catch {
      // 读取失败，留空（getActive 会走 fallback）
    }
  }

  /**
   * 切换活动服务器（写入 session meta，立即持久化）。
   * switch_server 工具和 /env 命令调用。
   */
  async setActive(name: string): Promise<{ previous: string; current: string }> {
    const previous = this.getActive();

    if (name !== LOCAL_ENV && !this.getServers().has(name)) {
      throw new Error(`未知服务器 "${name}"。可用服务器：${this.listEnvs().map(e => e.name).join(', ')}`);
    }

    const sid = this.api.agentManager?.getActiveSessionId?.();
    if (sid) {
      this.sessionCache.set(sid, name);
      // 持久化到 session meta（无 debounce，立即写入）
      try {
        const meta = await this.api.storage.getMeta?.(sid);
        if (meta) {
          (meta as any).remoteExecEnvironment = name;
          await this.api.storage.saveMeta?.(meta);
        }
      } catch {
        // 持久化失败不影响当前 turn 运行时状态
      }
    }

    return { previous, current: name };
  }

  /** 清除指定会话的缓存（对话关闭/清理时调用，防止内存泄漏） */
  clearSession(sessionId: string): void {
    this.sessionCache.delete(sessionId);
  }

  /** 当前活动服务器对应的 ServerEntry；返回 null 表示本机 */
  getActiveServer(): ServerEntry | null {
    const name = this.getActive();
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
        workdir: s.workdir,
      });
    }
    return list;
  }
}
