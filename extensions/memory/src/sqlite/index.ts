/**
 * JSON 文件记忆存储实现
 *
 * 使用单个 JSON 文件持久化，内存中维护完整数据结构。
 * 搜索通过 case-insensitive token 匹配实现，对 <1000 条记忆完全够用。
 *
 * 替代原 SQLite + FTS5 实现，彻底消除原生模块依赖（better-sqlite3），
 * 使 bun / node 双运行时兼容。
 */

import * as fs from 'fs';
import * as path from 'path';
import { MemoryProvider } from '../base.js';
import type { MemoryEntry, MemoryAddInput, MemoryUpdateInput, MemoryType } from '../types.js';
import { parseMemoryType } from '../types.js';

export interface MemoryLogger {
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
}

// ============ 数据结构 ============

interface StoredMemory {
  id: number;
  content: string;
  name: string;
  description: string;
  type: string;
  category: string;
  createdAt: number;
  updatedAt: number;
}

interface ConsolidationMeta {
  lastRun: number;
  pid: number | null;
  lockedAt: number | null;
}

interface SessionNote {
  notes: string;
  updatedAt: number;
}

interface StoreData {
  version: number;
  nextId: number;
  memories: StoredMemory[];
  consolidationMeta: ConsolidationMeta;
  sessionNotes: Record<string, SessionNote>;
}

const CURRENT_VERSION = 2;

function createEmptyStore(): StoreData {
  return {
    version: CURRENT_VERSION,
    nextId: 1,
    memories: [],
    consolidationMeta: { lastRun: 0, pid: null, lockedAt: null },
    sessionNotes: {},
  };
}

// ============ MemoryStore ============

export class MemoryStore extends MemoryProvider {
  private data: StoreData;
  private filePath: string;

  constructor(filePath: string, private logger?: MemoryLogger) {
    super();
    const resolved = path.resolve(filePath);
    this.filePath = resolved;

    // 确保父目录存在
    fs.mkdirSync(path.dirname(resolved), { recursive: true });

    // 加载或创建数据文件
    this.data = this.load();
    this.logger?.info(`记忆存储已初始化: ${filePath} (${this.data.memories.length} 条)`);
  }

  // ============ 文件 I/O ============

  private load(): StoreData {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        const parsed = JSON.parse(raw) as Partial<StoreData>;
        return this.migrate(parsed);
      }
    } catch (err) {
      this.logger?.warn('读取记忆文件失败，将使用空数据:', err);
    }
    return createEmptyStore();
  }

  private save(): void {
    const json = JSON.stringify(this.data, null, 2);
    // 写入临时文件再 rename，防止写到一半断电导致数据损坏
    const tmp = this.filePath + '.tmp';
    fs.writeFileSync(tmp, json, 'utf-8');
    fs.renameSync(tmp, this.filePath);
  }

  private migrate(raw: Partial<StoreData>): StoreData {
    const data = { ...createEmptyStore(), ...raw };

    // 确保字段完整
    if (!Array.isArray(data.memories)) data.memories = [];
    if (!data.consolidationMeta) data.consolidationMeta = { lastRun: 0, pid: null, lockedAt: null };
    if (!data.sessionNotes) data.sessionNotes = {};

    // 计算 nextId（取已有最大 id + 1）
    if (data.memories.length > 0) {
      const maxId = Math.max(...data.memories.map(m => m.id));
      if (maxId >= data.nextId) data.nextId = maxId + 1;
    }

    data.version = CURRENT_VERSION;
    return data as StoreData;
  }

  // ============ CRUD 操作 ============

  async add(input: MemoryAddInput): Promise<number> {
    const now = Math.floor(Date.now() / 1000);
    const type = input.type ?? (input.category ? mapCategoryToType(input.category) : 'reference');
    const id = this.data.nextId++;

    this.data.memories.push({
      id,
      content: input.content,
      name: input.name ?? '',
      description: input.description ?? '',
      type,
      category: input.category ?? type,
      createdAt: now,
      updatedAt: now,
    });

    this.save();
    this.logger?.info(`添加记忆 #${id} [${type}] ${input.name || '(unnamed)'}`);
    return id;
  }

  async update(input: MemoryUpdateInput): Promise<boolean> {
    const idx = this.data.memories.findIndex(m => m.id === input.id);
    if (idx === -1) return false;

    const existing = this.data.memories[idx];
    existing.content = input.content ?? existing.content;
    existing.name = input.name ?? existing.name;
    existing.description = input.description ?? existing.description;
    existing.type = input.type ?? existing.type;
    existing.updatedAt = Math.floor(Date.now() / 1000);

    this.save();
    this.logger?.info(`更新记忆 #${input.id} [${existing.type}] ${existing.name || '(unnamed)'}`);
    return true;
  }

  async search(query: string, limit: number = 5): Promise<MemoryEntry[]> {
    // 分词：提取有意义的 token
    const tokens = query
      .toLowerCase()
      .split(/[\s,.;:!?，。；：！？\-_/\\|]+/)
      .filter(w => w.length > 1);
    if (tokens.length === 0) return [];

    // 对每条记忆计算匹配 token 数
    const scored: Array<{ entry: StoredMemory; score: number }> = [];
    for (const m of this.data.memories) {
      const haystack = `${m.name} ${m.description} ${m.content}`.toLowerCase();
      let score = 0;
      for (const t of tokens) {
        if (haystack.includes(t)) score++;
      }
      if (score > 0) scored.push({ entry: m, score });
    }

    // 按匹配数降序，同分按更新时间降序
    scored.sort((a, b) => b.score - a.score || b.entry.updatedAt - a.entry.updatedAt);

    return scored.slice(0, limit).map(s => toMemoryEntry(s.entry));
  }

  async getByIds(ids: number[]): Promise<MemoryEntry[]> {
    if (ids.length === 0) return [];
    const idSet = new Set(ids);
    return this.data.memories
      .filter(m => idSet.has(m.id))
      .map(toMemoryEntry);
  }

  async list(type?: string, limit: number = 200): Promise<MemoryEntry[]> {
    let items = this.data.memories;
    if (type) {
      items = items.filter(m => m.type === type);
    }
    // 按更新时间降序
    const sorted = [...items].sort((a, b) => b.updatedAt - a.updatedAt);
    return sorted.slice(0, limit).map(toMemoryEntry);
  }

  async count(): Promise<number> {
    return this.data.memories.length;
  }

  async delete(id: number): Promise<boolean> {
    const idx = this.data.memories.findIndex(m => m.id === id);
    if (idx === -1) return false;

    this.data.memories.splice(idx, 1);
    this.save();
    this.logger?.info(`删除记忆 #${id}`);
    return true;
  }

  async clear(): Promise<void> {
    this.data.memories = [];
    this.save();
    this.logger?.info('已清空所有记忆');
  }

  // ============ 归纳锁 ============

  getConsolidationMeta(): { lastRun: number; pid: number | null; lockedAt: number | null } {
    return { ...this.data.consolidationMeta };
  }

  acquireConsolidationLock(pid: number): boolean {
    const now = Math.floor(Date.now() / 1000);
    const LOCK_EXPIRY = 3600; // 1 小时过期
    const meta = this.data.consolidationMeta;

    if (meta.lockedAt !== null && now - meta.lockedAt < LOCK_EXPIRY) {
      return false; // 锁未过期
    }

    meta.pid = pid;
    meta.lockedAt = now;
    this.save();
    return true;
  }

  releaseConsolidationLock(success: boolean = true): void {
    const meta = this.data.consolidationMeta;
    meta.pid = null;
    meta.lockedAt = null;
    if (success) {
      meta.lastRun = Math.floor(Date.now() / 1000);
    }
    this.save();
  }

  // ============ 会话记忆 ============

  getSessionNotes(sessionId: string): string | undefined {
    return this.data.sessionNotes[sessionId]?.notes || undefined;
  }

  saveSessionNotes(sessionId: string, notes: string): void {
    this.data.sessionNotes[sessionId] = {
      notes,
      updatedAt: Math.floor(Date.now() / 1000),
    };
    this.save();
  }
}

// ============ 内部辅助 ============

function toMemoryEntry(m: StoredMemory): MemoryEntry {
  return {
    id: m.id,
    content: m.content,
    name: m.name || '',
    description: m.description || '',
    type: parseMemoryType(m.type) ?? 'reference',
    category: m.category || m.type,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
  };
}

function mapCategoryToType(category: string): MemoryType {
  switch (category) {
    case 'user': return 'user';
    case 'preference': return 'feedback';
    case 'fact': return 'project';
    default: return 'reference';
  }
}

// 向后兼容：保留旧名称导出
export { MemoryStore as SqliteMemory };
