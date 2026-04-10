/**
 * 全局键值存储实现
 *
 * 全局单例，所有插件共享同一个实例。
 * 在 PluginManager 构造时创建，通过 PluginContext 注入到每个插件。
 *
 * 生命周期：
 *   1. 构造时：纯内存模式（插件 activate() 时即可注册订阅）
 *   2. initPersistence(dataDir) 调用后：加载磁盘文件 + 开启自动持久化
 *   3. 此后每次 set/delete 都会 debounce 写盘
 *
 * 作用域实现（均通过 ScopedStore 前缀代理，底层共享同一个 Map）：
 *   - agent('name')        → key 前缀 "@a.name."
 *   - session('id')        → key 前缀 "@s.id."
 *   - namespace('prefix')  → key 前缀 "prefix."
 *   - 可任意组合叠加，如 agent('a').session('s').namespace('p') → "@a.a.@s.s.p."
 */

import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';
import type { GlobalStoreLike } from '@irises/extension-sdk';
import type { Disposable } from '@irises/extension-sdk';
import { createLogger } from '../logger';

const logger = createLogger('GlobalStore');

/** 持久化文件名 */
const STORE_FILENAME = 'global-variables.json';

/** 作用域 key 前缀标记 */
const AGENT_PREFIX = '@a.';
const SESSION_PREFIX = '@s.';

/**
 * 全局键值存储
 *
 * 基于内存 Map + JSON 文件持久化。
 * 变更通知基于 EventEmitter，支持 per-key 和全局监听。
 */
export class GlobalStore extends EventEmitter implements GlobalStoreLike {
  /** 内存数据 */
  private data: Map<string, unknown> = new Map();
  /** 持久化文件路径（initPersistence 后才有值） */
  private filePath?: string;
  /** debounce 定时器 */
  private persistTimer: NodeJS.Timeout | null = null;

  // ──────────── 生命周期 ────────────

  /**
   * 启用持久化：设置数据目录并从磁盘加载已有数据。
   *
   * 由 PluginManager 在 notifyReady 前调用，保证插件 onReady 时数据已就绪。
   *
   * @param dataDir 数据目录路径（如 ~/.iris/ 或 ~/.iris/agents/<name>/）
   */
  initPersistence(dataDir: string): void {
    this.filePath = path.join(dataDir, STORE_FILENAME);
    this.loadFromFile();
    logger.info(`持久化已启用: ${this.filePath}，已加载 ${this.data.size} 个变量`);
  }

  // ──────────── 基本 CRUD ────────────

  get<T = unknown>(key: string): T | undefined {
    return this.data.get(key) as T | undefined;
  }

  set(key: string, value: unknown): void {
    const oldValue = this.data.get(key);
    this.data.set(key, value);
    this.emit(`change:${key}`, value, oldValue);
    this.emit('change', key, value, oldValue);
    this.debouncePersist();
  }

  delete(key: string): boolean {
    if (!this.data.has(key)) return false;
    const oldValue = this.data.get(key);
    this.data.delete(key);
    this.emit(`change:${key}`, undefined, oldValue);
    this.emit('change', key, undefined, oldValue);
    this.debouncePersist();
    return true;
  }

  has(key: string): boolean {
    return this.data.has(key);
  }

  keys(): string[] {
    return Array.from(this.data.keys());
  }

  getAll(): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [k, v] of this.data) {
      result[k] = v;
    }
    return result;
  }

  setMany(entries: Record<string, unknown>): void {
    for (const [key, value] of Object.entries(entries)) {
      const oldValue = this.data.get(key);
      this.data.set(key, value);
      this.emit(`change:${key}`, value, oldValue);
      this.emit('change', key, value, oldValue);
    }
    // 批量操作只触发一次持久化
    this.debouncePersist();
  }

  // ──────────── 变更订阅 ────────────

  onChange(key: string, listener: (newValue: unknown, oldValue: unknown) => void): Disposable {
    this.on(`change:${key}`, listener);
    return { dispose: () => this.off(`change:${key}`, listener) };
  }

  onAnyChange(listener: (key: string, newValue: unknown, oldValue: unknown) => void): Disposable {
    this.on('change', listener);
    return { dispose: () => this.off('change', listener) };
  }

  // ──────────── 作用域 ────────────

  agent(agentName: string): GlobalStoreLike {
    return new ScopedStore(this, `${AGENT_PREFIX}${agentName}.`);
  }

  session(sessionId: string): GlobalStoreLike {
    return new ScopedStore(this, `${SESSION_PREFIX}${sessionId}.`);
  }

  namespace(prefix: string): GlobalStoreLike {
    return new ScopedStore(this, prefix + '.');
  }

  // ──────────── 作用域清理 ────────────

  /**
   * 清除指定 agent 的所有变量。
   * @returns 被清除的变量数量
   */
  clearAgent(agentName: string): number {
    return this.clearByPrefix(`${AGENT_PREFIX}${agentName}.`);
  }

  /**
   * 清除指定会话的所有变量。
   * 适合在对话被删除/清空时调用，避免残留数据。
   * @returns 被清除的变量数量
   */
  clearSession(sessionId: string): number {
    return this.clearByPrefix(`${SESSION_PREFIX}${sessionId}.`);
  }

  /**
   * 列出所有拥有变量的 agent 名称。
   */
  listAgents(): string[] {
    return this.listScopeIds(AGENT_PREFIX);
  }

  /**
   * 列出所有拥有变量的会话 ID。
   */
  listSessions(): string[] {
    return this.listScopeIds(SESSION_PREFIX);
  }

  // ──────────── 内部辅助 ────────────

  /** 按前缀批量删除 key，对每个删除触发变更事件 */
  private clearByPrefix(prefix: string): number {
    const toDelete: string[] = [];
    for (const key of this.data.keys()) {
      if (key.startsWith(prefix)) {
        toDelete.push(key);
      }
    }
    for (const key of toDelete) {
      const oldValue = this.data.get(key);
      this.data.delete(key);
      this.emit(`change:${key}`, undefined, oldValue);
      this.emit('change', key, undefined, oldValue);
    }
    if (toDelete.length > 0) {
      this.debouncePersist();
      logger.info(`已清除前缀 "${prefix}" 下的 ${toDelete.length} 个变量`);
    }
    return toDelete.length;
  }

  /** 从 key 前缀中提取去重的 scope ID 列表 */
  private listScopeIds(scopePrefix: string): string[] {
    const ids = new Set<string>();
    for (const key of this.data.keys()) {
      if (key.startsWith(scopePrefix)) {
        // key = "@a.agentName.varName" 或 "@s.sessionId.varName"
        const rest = key.slice(scopePrefix.length);
        const dotIdx = rest.indexOf('.');
        if (dotIdx > 0) {
          ids.add(rest.slice(0, dotIdx));
        }
      }
    }
    return Array.from(ids);
  }

  // ──────────── 持久化 ────────────

  /** debounce 500ms 写盘 */
  private debouncePersist(): void {
    if (!this.filePath) return;
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      this.persistSync();
      this.persistTimer = null;
    }, 500);
  }

  /** 同步写入文件 */
  private persistSync(): void {
    if (!this.filePath) return;
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const obj: Record<string, unknown> = {};
      for (const [k, v] of this.data) {
        obj[k] = v;
      }
      fs.writeFileSync(this.filePath, JSON.stringify(obj, null, 2), 'utf-8');
    } catch (err) {
      logger.error(`持久化写入失败: ${err}`);
    }
  }

  /** 从文件加载数据 */
  private loadFromFile(): void {
    if (!this.filePath) return;
    try {
      if (!fs.existsSync(this.filePath)) return;
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        for (const [k, v] of Object.entries(parsed)) {
          this.data.set(k, v);
        }
      }
    } catch (err) {
      logger.error(`从文件加载失败: ${err}`);
    }
  }

  /** 强制立即写盘（用于进程退出前） */
  flush(): void {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    this.persistSync();
  }
}

/**
 * 带作用域前缀的子存储视图
 *
 * 统一实现 agent() / session() / namespace() 的前缀隔离。
 * 所有 key 操作自动加上 prefix，但底层共享同一个根 GlobalStore。
 * keys() / getAll() 只返回本作用域下的变量（去掉前缀后返回）。
 */
class ScopedStore implements GlobalStoreLike {
  constructor(
    private root: GlobalStoreLike,
    private prefix: string,
  ) {}

  private prefixed(key: string): string {
    return this.prefix + key;
  }

  get<T = unknown>(key: string): T | undefined {
    return this.root.get<T>(this.prefixed(key));
  }

  set(key: string, value: unknown): void {
    this.root.set(this.prefixed(key), value);
  }

  delete(key: string): boolean {
    return this.root.delete(this.prefixed(key));
  }

  has(key: string): boolean {
    return this.root.has(this.prefixed(key));
  }

  keys(): string[] {
    return this.root.keys()
      .filter(k => k.startsWith(this.prefix))
      .map(k => k.slice(this.prefix.length));
  }

  getAll(): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const k of this.root.keys()) {
      if (k.startsWith(this.prefix)) {
        result[k.slice(this.prefix.length)] = this.root.get(k);
      }
    }
    return result;
  }

  setMany(entries: Record<string, unknown>): void {
    const prefixed: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(entries)) {
      prefixed[this.prefixed(k)] = v;
    }
    this.root.setMany(prefixed);
  }

  onChange(key: string, listener: (newValue: unknown, oldValue: unknown) => void): Disposable {
    return this.root.onChange(this.prefixed(key), listener);
  }

  onAnyChange(listener: (key: string, newValue: unknown, oldValue: unknown) => void): Disposable {
    const wrapper = (k: string, newVal: unknown, oldVal: unknown) => {
      if (k.startsWith(this.prefix)) {
        listener(k.slice(this.prefix.length), newVal, oldVal);
      }
    };
    return this.root.onAnyChange(wrapper);
  }

  agent(agentName: string): GlobalStoreLike {
    return new ScopedStore(this.root, this.prefix + `${AGENT_PREFIX}${agentName}.`);
  }

  session(sessionId: string): GlobalStoreLike {
    return new ScopedStore(this.root, this.prefix + `${SESSION_PREFIX}${sessionId}.`);
  }

  namespace(prefix: string): GlobalStoreLike {
    return new ScopedStore(this.root, this.prefix + prefix + '.');
  }
}
