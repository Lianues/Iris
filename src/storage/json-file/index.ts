/**
 * JSON 文件存储提供商
 *
 * 每个 session 对应两个文件：
 *   - {sessionId}.json       对话历史（Content[]）
 *   - {sessionId}.meta.json会话元数据（SessionMeta）
 *
 * 数据存储为原始 Gemini 格式，可直接人工阅读、编辑、调试。
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { StorageProvider, SessionMeta } from '../base';
import { Content } from '../../types';
import { sessionsDir } from '../../paths';

export class JsonFileStorage extends StorageProvider {
  private dir: string;
  /** per-session 写锁，防止并发 read-modify-write竞争 */
  private locks = new Map<string, Promise<void>>();

  constructor(dir: string = sessionsDir) {
    super();
    this.dir = path.resolve(dir);
  }

  // ============ 对话历史 ============

  async getHistory(sessionId: string): Promise<Content[]> {
    try {
      const data = await fs.readFile(this.historyPath(sessionId), 'utf-8');
      return JSON.parse(data) as Content[];
    } catch (err: unknown) {
      if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw err;
    }
  }

  async addMessage(sessionId: string, content: Content): Promise<void> {
    await this.withLock(sessionId, async () => {
      const history = await this.getHistory(sessionId);
      history.push(this.normalize(content));
      await this.ensureDir();
      await fs.writeFile(this.historyPath(sessionId), JSON.stringify(history, null, 2), 'utf-8');
    });
  }

  async updateLastMessage(sessionId: string, updater: (content: Content) => Content): Promise<void> {
    await this.withLock(sessionId, async () => {
      const history = await this.getHistory(sessionId);
      if (history.length === 0) return;
      history[history.length - 1] = this.normalize(updater(history[history.length - 1]));
      await this.ensureDir();
      await fs.writeFile(this.historyPath(sessionId), JSON.stringify(history, null, 2), 'utf-8');
    });
  }

  async truncateHistory(sessionId: string, keepCount: number): Promise<void> {
    await this.withLock(sessionId, async () => {
      const history = await this.getHistory(sessionId);
      if (history.length <= keepCount) return;
      const truncated = history.slice(0, keepCount);
      await this.ensureDir();
      await fs.writeFile(this.historyPath(sessionId), JSON.stringify(truncated, null, 2), 'utf-8');
    });
  }

  async clearHistory(sessionId:string): Promise<void> {
    await this.withLock(sessionId, async () => {
      try {
        await fs.unlink(this.historyPath(sessionId));
      } catch { /* 文件不存在则忽略 */ }
      try {
        await fs.unlink(this.metaPath(sessionId));
      } catch { /* 文件不存在则忽略 */ }
    });
  }

  async listSessions(): Promise<string[]> {
    try {
      const files = await fs.readdir(this.dir);
      return files
        .filter(f => f.endsWith('.json') && !f.endsWith('.meta.json'))
        .map(f => f.replace(/\.json$/, ''));
    } catch {
 return [];
    }
  }

  // ============ 会话元数据 ============

  async getMeta(sessionId: string): Promise<SessionMeta | null> {
    try {
      const data = await fs.readFile(this.metaPath(sessionId), 'utf-8');
      return JSON.parse(data) as SessionMeta;
    } catch {
      return null;
    }
  }

  async saveMeta(meta: SessionMeta): Promise<void> {
    await this.ensureDir();
    await fs.writeFile(this.metaPath(meta.id), JSON.stringify(meta, null, 2), 'utf-8');
  }

  async listSessionMetas(): Promise<SessionMeta[]> {
    const sessionIds = await this.listSessions();
    const metas: SessionMeta[] = [];
    for (const id of sessionIds) {
      const meta = await this.getMeta(id);
      if (meta) metas.push(meta);
    }
    // 按更新时间降序
    metas.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    return metas;
  }

  // ============ 内部方法 ============

  private historyPath(sessionId: string): string {
    const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(this.dir, `${safe}.json`);
  }

  private metaPath(sessionId: string): string {
    const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(this.dir, `${safe}.meta.json`);
  }

  private async ensureDir(): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
  }

  /** 对同一 sessionId 的写操作串行化，完成后清理锁避免内存泄漏 */
  private async withLock(sessionId: string, fn: () => Promise<void>): Promise<void> {
    const prev = this.locks.get(sessionId) ?? Promise.resolve();
    const current = prev.then(fn, fn);
    this.locks.set(sessionId, current);
    await current;
    if (this.locks.get(sessionId) === current) {
      this.locks.delete(sessionId);
    }
  }
}
