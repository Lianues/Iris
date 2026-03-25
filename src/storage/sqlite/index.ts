/**
 * SQLite 存储提供商
 *
 * 使用 better-sqlite3（同步 API）实现，包装为 async 接口。
 * 开启 WAL 模式，天然支持并发读写，无需手动加锁。
 *
 * 大型内联二进制数据（截图、用户上传图片等）自动提取到 attachments/ 目录，
 * 数据库中只存储轻量引用，读取历史时按需还原。
 */

import * as fs from 'fs';
import * as path from 'path';
import Database from 'better-sqlite3';
import { StorageProvider, SessionMeta } from '../base';
import { Content } from '../../types';
import { sessionDbPath, attachmentsDir as defaultAttachmentsDir } from '../../paths';
import { extractAttachments, restoreAttachments } from '../attachment';

export class SqliteStorage extends StorageProvider {
  private db: Database.Database;
  private attachmentsDir: string;

  constructor(dbPath: string = sessionDbPath, attachmentsDir?: string) {
    super();

    const resolved = path.resolve(dbPath);
    const dir = path.dirname(resolved);
    fs.mkdirSync(dir, { recursive: true });

    this.db = new Database(resolved);
    this.db.pragma('journal_mode = WAL');
    this.attachmentsDir = attachmentsDir ?? defaultAttachmentsDir;

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
      CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);

      CREATE TABLE IF NOT EXISTS session_meta (
        session_id TEXT PRIMARY KEY,
        title TEXT NOT NULL DEFAULT '',
        cwd TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        platforms TEXT NOT NULL DEFAULT '[]'
      );
    `);

    // 迁移：为已有的 session_meta 表添加 platforms 列
    const columns = this.db.prepare("PRAGMA table_info(session_meta)").all() as { name: string }[];
    if (!columns.some(c => c.name === 'platforms')) {
      this.db.exec("ALTER TABLE session_meta ADD COLUMN platforms TEXT NOT NULL DEFAULT '[]'");
    }
  }

  // ============ 对话历史 ============

  async getHistory(sessionId: string): Promise<Content[]> {
    const rows = this.db
      .prepare('SELECT content FROM messages WHERE session_id = ? ORDER BY id')
      .all(sessionId) as { content: string }[];
    const contents = rows.map(row => JSON.parse(row.content) as Content);
    // 还原附件引用 → 完整 base64
    return Promise.all(contents.map(c => restoreAttachments(c, this.attachmentsDir)));
  }

  async addMessage(sessionId: string, content: Content): Promise<void> {
    // 归一化 + 提取附件
    const extracted = await extractAttachments(this.normalize(content), this.attachmentsDir);
    this.db
      .prepare('INSERT INTO messages (session_id, content) VALUES (?, ?)')
      .run(sessionId, JSON.stringify(extracted));
  }

  async updateLastMessage(sessionId: string, updater: (content: Content) => Content): Promise<void> {
    const row = this.db
      .prepare('SELECT id, content FROM messages WHERE session_id = ? ORDER BY id DESC LIMIT 1')
      .get(sessionId) as { id: number; content: string } | undefined;
    if (!row) return;
    const content = JSON.parse(row.content) as Content;
    const updated = this.normalize(updater(content));
    const extracted = await extractAttachments(updated, this.attachmentsDir);
    this.db
      .prepare('UPDATE messages SET content = ? WHERE id = ?')
      .run(JSON.stringify(extracted), row.id);
  }

  async truncateHistory(sessionId: string, keepCount: number): Promise<void> {
    this.db
      .prepare(
        `DELETE FROM messages WHERE session_id = ? AND id NOT IN (
          SELECT id FROM messages WHERE session_id = ? ORDER BY id LIMIT ?
        )`
      )
      .run(sessionId, sessionId, keepCount);
  }

  async clearHistory(sessionId: string): Promise<void> {
    this.db.prepare('DELETE FROM messages WHERE session_id = ?').run(sessionId);
    this.db.prepare('DELETE FROM session_meta WHERE session_id = ?').run(sessionId);
  }

  async listSessions(): Promise<string[]> {
    const rows = this.db
      .prepare('SELECT DISTINCT session_id FROM messages')
      .all() as { session_id: string }[];
    return rows.map(row => row.session_id);
  }

  // ============ 会话元数据 ============

  async getMeta(sessionId: string): Promise<SessionMeta | null> {
    const row = this.db
      .prepare('SELECT * FROM session_meta WHERE session_id = ?')
      .get(sessionId) as { session_id: string; title: string; cwd: string; created_at: string; updated_at: string; platforms: string } | undefined;
    if (!row) return null;
    return {
      id: row.session_id,
      title: row.title,
      cwd: row.cwd,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      platforms: JSON.parse(row.platforms || '[]'),
    };
  }

  async saveMeta(meta: SessionMeta): Promise<void> {
    this.db
      .prepare(`
        INSERT INTO session_meta (session_id, title, cwd, created_at, updated_at, platforms)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(session_id) DO UPDATE SET
          title = excluded.title,
          cwd = excluded.cwd,
          updated_at = excluded.updated_at,
          platforms = excluded.platforms
      `)
      .run(meta.id, meta.title, meta.cwd, meta.createdAt, meta.updatedAt, JSON.stringify(meta.platforms ?? []));
  }

  async listSessionMetas(): Promise<SessionMeta[]> {
    const rows = this.db
      .prepare('SELECT * FROM session_meta ORDER BY updated_at DESC')
      .all() as { session_id: string; title: string; cwd: string; created_at: string; updated_at: string; platforms: string }[];
    return rows.map(row => ({
      id: row.session_id,
      title: row.title,
      cwd: row.cwd,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      platforms: JSON.parse(row.platforms || '[]'),
    }));
  }
}
