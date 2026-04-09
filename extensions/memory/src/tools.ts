/**
 * 记忆系统 LLM 工具
 *
 * 提供 memory_search / memory_add / memory_update / memory_delete 四个工具，
 * 让 LLM 自主决定何时读写长期记忆。
 */

import type { ToolDefinition } from '@irises/extension-sdk';
import type { MemoryProvider } from './base.js';
import type { MemoryType } from './types.js';
import { MEMORY_TYPES, parseMemoryType } from './types.js';
import { memoryAge } from './utils/age.js';

/** memory 工具名称集合，供外部引用 */
export const MEMORY_TOOL_NAMES = new Set([
  'memory_search', 'memory_add', 'memory_update', 'memory_delete',
]);

/** 根据 MemoryProvider 实例创建记忆工具数组 */
export function createMemoryTools(provider: MemoryProvider): ToolDefinition[] {
  const memorySearch: ToolDefinition = {
    parallel: true,
    declaration: {
      name: 'memory_search',
      description: 'Search long-term memory for relevant information. Use when you need to recall user preferences, past decisions, project context, or previously saved knowledge.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search keywords or natural language query' },
          type: {
            type: 'string',
            description: 'Filter by memory type',
            enum: [...MEMORY_TYPES],
          },
          limit: { type: 'number', description: 'Max results (default 10)' },
        },
        required: ['query'],
      },
    },
    handler: async (args) => {
      const query = args.query as string;
      const typeFilter = parseMemoryType(args.type);
      // 当有 type 过滤时多取一些，补偿 post-filter 损耗
      const requestLimit = (args.limit as number) || 10;
      const fetchLimit = typeFilter ? requestLimit * 3 : requestLimit;
      const results = await provider.search(query, fetchLimit);

      // 按 type 过滤后截断到请求的 limit
      const filtered = typeFilter
        ? results.filter(m => m.type === typeFilter).slice(0, requestLimit)
        : results.slice(0, requestLimit);

      if (filtered.length === 0) {
        return { message: 'No relevant memories found.', results: [] };
      }
      return {
        message: `Found ${filtered.length} relevant memories.`,
        results: filtered.map(m => ({
          id: m.id,
          name: m.name || undefined,
          type: m.type,
          content: m.content,
          age: memoryAge(m.updatedAt),
        })),
      };
    },
  };

  const memoryAdd: ToolDefinition = {
    declaration: {
      name: 'memory_add',
      description: [
        'Save important information to long-term memory for cross-session persistence.',
        'Use for: user preferences/profile (type=user), behavioral guidance (type=feedback),',
        'project context/decisions (type=project), external references (type=reference).',
        'Before adding, search existing memories to avoid duplicates — update instead if a related memory exists.',
      ].join(' '),
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string', description: 'Memory content (the actual information to remember)' },
          name: { type: 'string', description: 'Short identifier (e.g. "user_role", "feedback_testing"). Used for indexing.' },
          description: { type: 'string', description: 'One-line description — used for relevance matching in future conversations' },
          type: {
            type: 'string',
            description: 'Memory type: user (profile/preferences), feedback (behavioral guidance), project (context/decisions), reference (external pointers)',
            enum: [...MEMORY_TYPES],
          },
        },
        required: ['content'],
      },
    },
    handler: async (args) => {
      const content = args.content as string;
      const name = (args.name as string) || '';
      const description = (args.description as string) || '';
      const type = parseMemoryType(args.type) ?? 'reference';

      const id = await provider.add({ content, name, description, type });
      return { message: 'Memory saved.', id, name, type };
    },
  };

  const memoryUpdate: ToolDefinition = {
    declaration: {
      name: 'memory_update',
      description: 'Update an existing memory. Use when information has changed or needs correction. Prefer updating over creating duplicates.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'number', description: 'Memory ID to update' },
          content: { type: 'string', description: 'New content (omit to keep current)' },
          name: { type: 'string', description: 'New name (omit to keep current)' },
          description: { type: 'string', description: 'New description (omit to keep current)' },
          type: {
            type: 'string',
            description: 'New type (omit to keep current)',
            enum: [...MEMORY_TYPES],
          },
        },
        required: ['id'],
      },
    },
    handler: async (args) => {
      const id = args.id as number;
      const input: Record<string, unknown> = { id };
      if (args.content !== undefined) input.content = args.content;
      if (args.name !== undefined) input.name = args.name;
      if (args.description !== undefined) input.description = args.description;
      if (args.type !== undefined) input.type = parseMemoryType(args.type);

      const success = await provider.update(input as any);
      return success
        ? { message: `Memory #${id} updated.` }
        : { message: `Memory #${id} not found.` };
    },
  };

  const memoryDelete: ToolDefinition = {
    declaration: {
      name: 'memory_delete',
      description: 'Delete a memory that is no longer relevant or accurate.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'number', description: 'Memory ID to delete' },
        },
        required: ['id'],
      },
    },
    handler: async (args) => {
      const id = args.id as number;
      const success = await provider.delete(id);
      return success
        ? { message: `Memory #${id} deleted.` }
        : { message: `Memory #${id} not found.` };
    },
  };

  return [memorySearch, memoryAdd, memoryUpdate, memoryDelete];
}
