/**
 * 记忆类型定义
 */

/** 记忆类型枚举 */
export const MEMORY_TYPES = ['user', 'feedback', 'project', 'reference'] as const;
export type MemoryType = (typeof MEMORY_TYPES)[number];

/** 解析原始字符串为 MemoryType，无效值返回 undefined */
export function parseMemoryType(raw: unknown): MemoryType | undefined {
  if (typeof raw !== 'string') return undefined;
  return MEMORY_TYPES.find(t => t === raw);
}

/** 一条记忆条目 */
export interface MemoryEntry {
  /** 唯一 ID */
  id: number;
  /** 记忆内容 */
  content: string;
  /** 简短标题（如 "user_role"） */
  name: string;
  /** 一行描述 — 用于清单展示和相关性判断 */
  description: string;
  /** 记忆类型 */
  type: MemoryType;
  /** 向后兼容分类字段 */
  category: string;
  /** 创建时间戳（秒） */
  createdAt: number;
  /** 更新时间戳（秒） */
  updatedAt: number;
}

/** 添加记忆的输入参数 */
export interface MemoryAddInput {
  content: string;
  name?: string;
  description?: string;
  type?: MemoryType;
  /** 向后兼容：旧 category 字段 */
  category?: string;
}

/** 更新记忆的输入参数 */
export interface MemoryUpdateInput {
  id: number;
  content?: string;
  name?: string;
  description?: string;
  type?: MemoryType;
}

/** 记忆清单条目（用于 manifest 展示，不含完整 content） */
export interface MemoryManifestEntry {
  id: number;
  name: string;
  description: string;
  type: MemoryType;
  age: string;
  updatedAt: number;
}
