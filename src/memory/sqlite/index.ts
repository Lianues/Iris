/**
 * SQLite 记忆存储实现
 *
 * 使用 better-sqlite3 + FTS5 全文检索。
 * 主表存储记忆条目，FTS5 虚拟表提供全文搜索能力。
 * 通过触发器自动同步主表变更到 FTS 索引。
 */

import * as fs from 'fs';
import * as path from 'path';
import Database from 'better-sqlite3';
import { MemoryProvider } from '../base';
import { MemoryEntry } from '../types';
import { createLogger } from '../../logger';
import { memoryDbPath } from '../../paths';

const logger = createLogger('Memory');

export class SqliteMemory extends MemoryProvider {
  private db: Database.Database;

  constructor(dbPath: string = memoryDbPath) {
    super();

    // 确保父目录存在
    const resolved = path.resolve(dbPath);
    const dir = path.dirname(resolved);
    fs.mkdirSync(dir, { recursive: true });

    this.db = new Database(resolved);

    // 开启 WAL 模式
    this.db.pragma('journal_mode = WAL');

    // 建表 + FTS5 + 触发器
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        content TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'note',
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch())
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
        content,
        content=memories,
        content_rowid=id
      );

      CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
        INSERT INTO memories_fts(rowid, content) VALUES (new.id, new.content);
      END;

      CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, content) VALUES('delete', old.id, old.content);
      END;

      CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, content) VALUES('delete', old.id, old.content);
        INSERT INTO memories_fts(rowid, content) VALUES (new.id, new.content);
      END;
    `);

    logger.info(`记忆存储已初始化: ${dbPath}`);
  }

  async add(content: string, category: string = 'note'): Promise<number> {
    const result = this.db
      .prepare('INSERT INTO memories (content, category) VALUES (?, ?)')
      .run(content, category);
    logger.info(`添加记忆 #${result.lastInsertRowid} [${category}]`);
    return result.lastInsertRowid as number;
  }

  async search(query: string, limit: number = 5): Promise<MemoryEntry[]> {
    // 清洗查询词：剥离 FTS5 特殊语法字符，将每个词用双引号包裹防止误解析
    // 限制最多 10 个 token，避免长消息产生过度严格的 AND 查询导致无法命中
    const tokens = query
      .replace(/["*(){}[\]^~:+\-]/g, ' ')  // 移除 FTS5 特殊字符
      .split(/\s+/)
      .filter(w => w.length > 0 && !['AND', 'OR', 'NOT', 'NEAR'].includes(w.toUpperCase()))
      .slice(0, 10);
    const sanitized = tokens.map(w => `"${w}"`).join(' OR ');
    if (!sanitized) return [];

    const rows = this.db
      .prepare(`
        SELECT m.id, m.content, m.category, m.created_at, m.updated_at
        FROM memories_fts fts
        JOIN memories m ON m.id = fts.rowid
        WHERE memories_fts MATCH ?
        ORDER BY rank
        LIMIT ?
      `)
      .all(sanitized, limit) as Array<{
        id: number;
        content: string;
        category: string;
        created_at: number;
        updated_at: number;
      }>;

    return rows.map(row => ({
      id: row.id,
      content: row.content,
      category: row.category,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  async list(category?: string, limit: number = 20): Promise<MemoryEntry[]> {
    let rows;
    if (category) {
      rows = this.db
        .prepare('SELECT id, content, category, created_at, updated_at FROM memories WHERE category = ? ORDER BY updated_at DESC LIMIT ?')
        .all(category, limit) as Array<{
          id: number;
          content: string;
          category: string;
          created_at: number;
          updated_at: number;
        }>;
    } else {
      rows = this.db
        .prepare('SELECT id, content, category, created_at, updated_at FROM memories ORDER BY updated_at DESC LIMIT ?')
        .all(limit) as Array<{
          id: number;
          content: string;
          category: string;
          created_at: number;
          updated_at: number;
        }>;
    }

    return rows.map(row => ({
      id: row.id,
      content: row.content,
      category: row.category,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  async delete(id: number): Promise<boolean> {
    const result = this.db
      .prepare('DELETE FROM memories WHERE id = ?')
      .run(id);
    if (result.changes > 0) {
      logger.info(`删除记忆 #${id}`);
      return true;
    }
    return false;
  }

  async clear(): Promise<void> {
    this.db.exec('DELETE FROM memories');
    logger.info('已清空所有记忆');
  }
}
