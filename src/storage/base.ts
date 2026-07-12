/**
 * 聊天记录存储层 —— 存储提供商基类
 *
 * 所有存储实现（JSON 文件、数据库等）均需继承此基类。
 * 存储层负责：
 *   1. 按 sessionId管理聊天记录
 *   2. 以 Gemini Content 格式存取消息
 *   3. 存储包括用户消息、模型回复、工具调用及结果
 *   4. 管理会话元数据（标题、工作目录、时间等）
 */

import { Content } from '../types';

/** 会话元数据 */
export interface SessionMeta {
  /** 会话 ID */
  id: string;
  /** 对话标题（默认取用户首条消息） */
  title:string;
  /** 对话所在的工作目录 */
  cwd: string;
  /** 创建时间（ISO 8601） */
  createdAt: string;
  /** 最后活跃时间（ISO 8601） */
  updatedAt: string;
  /** 使用过该会话的平台列表（��� ['console', 'web', 'telegram']） */
  platforms?: string[];
  /** remote-exec 扩展：该对话的当前执行环境名（local 或服务器别名） */
  remoteExecEnvironment?: string;
  /** 扩展自有会话级状态（不发送给 LLM）。key 建议使用 extension 名称或服务 ID。 */
  extensionState?: Record<string, unknown>;
}

export type SessionMetaUpdater = (
  current: SessionMeta | null,
) => SessionMeta | null | undefined | Promise<SessionMeta | null | undefined>;

export abstract class StorageProvider {
  /** per-session meta 写锁，保护 read-modify-write 型元数据更新。 */
  private metaUpdateLocks = new Map<string, Promise<void>>();

  /** 获取指定会话的全部历史消息 */
  abstract getHistory(sessionId: string): Promise<Content[]>;

  /** 向指定会话追加一条消息 */
  abstract addMessage(sessionId: string, content: Content): Promise<void>;

  /** 清空指定会话的历史 */
  abstract clearHistory(sessionId: string): Promise<void>;

  /** 更新指定会话最后一条消息（用于补充 durationMs 等元信息） */
  abstract updateLastMessage(sessionId: string, updater: (content: Content) => Content): Promise<void>;

  /** 截断历史：只保留前 keepCount 条消息，删除之后的所有消息 */
  abstract truncateHistory(sessionId: string, keepCount: number): Promise<void>;

  /** 列出所有会话 ID */
  abstract listSessions(): Promise<string[]>;

  /** 获取会话元数据 */
  abstract getMeta(sessionId: string): Promise<SessionMeta | null>;

  /** 保存会话元数据 */
  abstract saveMeta(meta: SessionMeta): Promise<void>;

  /**
   * 原子更新会话元数据。
   *
   * 所有需要 read-modify-write 的调用方应优先使用此方法，避免多个扩展
   * 分别 getMeta() 后 saveMeta() 导致 extensionState / updatedAt 等字段互相覆盖。
   *
   * updater 返回：
   * - SessionMeta：写回该 meta；
   * - undefined/null：不写回，返回当前 meta。
   */
  async updateMeta(sessionId: string, updater: SessionMetaUpdater): Promise<SessionMeta | null> {
    let result: SessionMeta | null = null;
    await this.withMetaUpdateLock(sessionId, async () => {
      const existing = await this.getMeta(sessionId);
      const next = await updater(existing ? this.cloneMeta(existing) : null);
      if (next) {
        await this.saveMeta(next);
        result = this.cloneMeta(next);
      } else {
        result = existing ? this.cloneMeta(existing) : null;
      }
    });
    return result;
  }

  /** 供存储实现将 clearHistory 等元数据删除操作纳入同一把 meta 锁。 */
  protected async withMetaUpdateLock<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.metaUpdateLocks.get(sessionId) ?? Promise.resolve();
    let result!: T;
    const current = previous.catch(() => undefined).then(async () => {
      result = await fn();
    });
    const settled = current.then(() => undefined, () => undefined);
    this.metaUpdateLocks.set(sessionId, settled);
    try {
      await current;
      return result;
    } finally {
      if (this.metaUpdateLocks.get(sessionId) === settled) {
        this.metaUpdateLocks.delete(sessionId);
      }
    }
  }

  /** 获取所有会话的元数据列表，按更新时间降序 */
  abstract listSessionMetas(): Promise<SessionMeta[]>;

  /** 存储提供商名称 */
  get name(): string {
    return this.constructor.name;
  }

  /** 关闭存储连接（如数据库连接池等）。默认空实现，子类按需重写。 */
  async close(): Promise<void> {
    // 默认无操作
  }

  /** 统一 Content 的字段顺序：role → parts → usageMetadata → durationMs → streamOutputDurationMs → 其余 */
  protected normalize(content: Content): Content {
    const known = new Set(['role', 'parts', 'usageMetadata', 'durationMs', 'streamOutputDurationMs', 'isSummary', 'compactedContextTokenCount']);
    const normalized: Content = {
      role: content.role,
  parts: content.parts,
    };
    if (content.usageMetadata) {
      normalized.usageMetadata = content.usageMetadata;
    }
    if (content.durationMs != null) {
      normalized.durationMs = content.durationMs;
    }
    if (content.streamOutputDurationMs != null) {
      normalized.streamOutputDurationMs = content.streamOutputDurationMs;
    }
    if (content.modelName) {
      normalized.modelName = content.modelName;
    }
    if (content.isSummary) {
      normalized.isSummary = true;
    }
    if (content.compactedContextTokenCount != null) {
      normalized.compactedContextTokenCount = content.compactedContextTokenCount;
    }
    for (const [k, v] of Object.entries(content)) {
      if (!known.has(k)) {
        (normalized as unknown as Record<string, unknown>)[k] = v;
      }
    }
    return normalized;
  }

  protected cloneMeta(meta: SessionMeta): SessionMeta {
    return JSON.parse(JSON.stringify(meta)) as SessionMeta;
  }
}
