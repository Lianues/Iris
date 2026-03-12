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
}

export abstract class StorageProvider {
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

  /** 获取所有会话的元数据列表，按更新时间降序 */
  abstract listSessionMetas(): Promise<SessionMeta[]>;

  /** 存储提供商名称 */
  get name(): string {
    return this.constructor.name;
  }

  /** 统一 Content 的字段顺序：role → parts → usageMetadata → durationMs → streamOutputDurationMs → 其余 */
  protected normalize(content: Content): Content {
    const known = new Set(['role', 'parts', 'usageMetadata', 'durationMs', 'streamOutputDurationMs']);
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
    for (const [k, v] of Object.entries(content)) {
      if (!known.has(k)) {
        (normalized as unknown as Record<string, unknown>)[k] = v;
      }
    }
    return normalized;
  }
}
