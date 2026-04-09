/**
 * 记忆提供商抽象基类
 *
 * 定义记忆系统的核心接口，所有记忆存储实现继承此类。
 */

import type { MemoryEntry, MemoryAddInput, MemoryUpdateInput, MemoryManifestEntry } from './types.js';
import { memoryAge, memoryFreshnessNote } from './utils/age.js';

export abstract class MemoryProvider {
  /** 添加一条记忆，返回记忆 ID */
  abstract add(input: MemoryAddInput): Promise<number>;

  /** 更新一条记忆，返回是否成功 */
  abstract update(input: MemoryUpdateInput): Promise<boolean>;

  /** 全文搜索记忆 */
  abstract search(query: string, limit?: number): Promise<MemoryEntry[]>;

  /** 按 ID 批量获取记忆 */
  abstract getByIds(ids: number[]): Promise<MemoryEntry[]>;

  /** 列出记忆（可按类型过滤） */
  abstract list(type?: string, limit?: number): Promise<MemoryEntry[]>;

  /** 获取记忆总数 */
  abstract count(): Promise<number>;

  /** 删除一条记忆，返回是否成功 */
  abstract delete(id: number): Promise<boolean>;

  /** 清空所有记忆 */
  abstract clear(): Promise<void>;

  /**
   * 构建记忆清单（不含完整内容，用于 manifest / LLM 选择）。
   */
  async buildManifest(limit: number = 200): Promise<MemoryManifestEntry[]> {
    const entries = await this.list(undefined, limit);
    return entries.map(m => ({
      id: m.id,
      name: m.name || `memory_${m.id}`,
      description: m.description || m.content.slice(0, 80),
      type: m.type,
      age: memoryAge(m.updatedAt),
      updatedAt: m.updatedAt,
    }));
  }

  /**
   * 根据用户输入构建记忆上下文文本，供注入系统提示词。
   * 返回 undefined 表示无相关记忆。
   */
  async buildContext(userText: string, limit: number = 5): Promise<string | undefined> {
    if (!userText) return undefined;
    const memories = await this.search(userText, limit);
    if (memories.length === 0) return undefined;

    const lines = memories.map(m => {
      const header = m.name ? `**${m.name}** [${m.type}]` : `[${m.type}]`;
      const freshness = memoryFreshnessNote(m.updatedAt);
      const freshnessLine = freshness ? `\n  ${freshness}` : '';
      return `- ${header}: ${m.content}${freshnessLine}`;
    }).join('\n');

    return `\n\n## Long-term Memory\nThe following memories may be relevant to the current conversation:\n${lines}`;
  }
}
