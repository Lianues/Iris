/**
 * 全局键值存储类型定义
 *
 * 提供跨插件的共享状态存储，支持持久化和变更订阅。
 * 适用于需要在多个插件之间共享数据的场景，如：
 * - 好感度、信任度等角色扮演状态
 * - 跨插件的运行时标志和计数器
 * - 定时任务的条件变量
 *
 * 作用域体系（由粗到细）：
 * - 根级（无前缀）：所有 agent、所有对话共享
 * - agent(agentName)：按 agent 隔离，跨对话持久保留
 * - session(sessionId)：按对话隔离，开新对话即失效
 * - namespace(prefix)：按插件隔离，避免 key 冲突（可与上述任意组合）
 *
 * 使用示例：
 * ```typescript
 * // ══ 真·全局变量 ══
 * api.globalStore.set('app_version', '1.0');
 *
 * // ══ 按 agent 隔离（好感度跨对话持久） ══
 * api.globalStore.agent('alice').set('好感度', 85);
 * api.globalStore.agent('alice').set('信任度', 60);
 * // 开新对话仍然保留
 * api.globalStore.agent('alice').get('好感度'); // → 85
 * // 不同 agent 互不干扰
 * api.globalStore.agent('bob').get('好感度');   // → undefined
 *
 * // ══ 按对话隔离（临时状态） ══
 * api.globalStore.session(sessionId).set('当前话题', '旅行');
 *
 * // ══ agent + 对话 双重隔离 ══
 * api.globalStore.agent('alice').session(sessionId).set('本轮心情', 'happy');
 *
 * // ══ 按插件隔离（避免 key 冲突） ══
 * const myStore = api.globalStore.namespace('myPlugin');
 * myStore.set('counter', 1);  // 实际 key = "myPlugin.counter"
 *
 * // ══ 订阅变量变化 ══
 * api.globalStore.agent('alice').onChange('好感度', (newVal, oldVal) => {
 *   console.log(`好感度: ${oldVal} -> ${newVal}`);
 * });
 * ```
 */

import type { Disposable } from './service.js';

/**
 * 全局键值存储接口
 *
 * 所有插件共享同一个实例，数据自动持久化到磁盘。
 * 变更订阅基于 key 粒度，支持精确监听和全局监听。
 */
export interface GlobalStoreLike {
  /**
   * 获取变量值。
   * @param key 变量名
   * @returns 变量值，不存在时返回 undefined
   */
  get<T = unknown>(key: string): T | undefined;

  /**
   * 设置变量值。触发 onChange / onAnyChange 回调，并自动持久化。
   * @param key 变量名
   * @param value 变量值（必须可 JSON 序列化）
   */
  set(key: string, value: unknown): void;

  /**
   * 删除变量。触发 onChange（newVal=undefined）和 onAnyChange。
   * @returns 是否存在并成功删除
   */
  delete(key: string): boolean;

  /**
   * 检查变量是否存在。
   */
  has(key: string): boolean;

  /**
   * 返回当前作用域下所有变量的 key 列表。
   */
  keys(): string[];

  /**
   * 返回当前作用域下所有变量的快照（浅拷贝）。
   */
  getAll(): Record<string, unknown>;

  /**
   * 批量设置变量。对每个 key 触发 onChange，最后触发一次持久化。
   */
  setMany(entries: Record<string, unknown>): void;

  /**
   * 订阅指定 key 的变更事件。
   * @param key 变量名
   * @param listener 回调函数，参数为 (新值, 旧值)
   * @returns Disposable，调用 dispose() 取消订阅
   */
  onChange(key: string, listener: (newValue: unknown, oldValue: unknown) => void): Disposable;

  /**
   * 订阅任意 key 的变更事件。
   * @param listener 回调函数，参数为 (key, 新值, 旧值)
   * @returns Disposable，调用 dispose() 取消订阅
   */
  onAnyChange(listener: (key: string, newValue: unknown, oldValue: unknown) => void): Disposable;

  /**
   * 创建按 agent 隔离的子存储视图。
   * 变量跨对话持久保留，适合存储好感度、信任度等长期状态。
   * 内部通过 key 前缀 "@a.<agentName>." 实现隔离。
   *
   * @param agentName Agent 名称
   * @returns agent 作用域的子存储视图（与根存储共享同一份数据）
   */
  agent(agentName: string): GlobalStoreLike;

  /**
   * 创建按对话隔离的子存储视图。
   * 每个 sessionId 拥有独立的变量空间，互不干扰。
   * 内部通过 key 前缀 "@s.<sessionId>." 实现隔离。
   *
   * @param sessionId 对话/会话 ID
   * @returns 对话作用域的子存储视图（与根存储共享同一份数据）
   */
  session(sessionId: string): GlobalStoreLike;

  /**
   * 创建按命名空间隔离的子存储视图。
   * 所有操作会自动在 key 前加上 "prefix." 前缀。
   * 适合插件用来隔离自己的变量，避免与其他插件冲突。
   *
   * @param prefix 命名空间前缀
   * @returns 带前缀的子存储视图（与根存储共享同一份数据）
   */
  namespace(prefix: string): GlobalStoreLike;
}
