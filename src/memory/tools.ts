/**
 * 记忆系统 LLM 工具
 *
 * 提供 memory_search / memory_add / memory_delete 三个工具，
 * 让 LLM 自主决定何时读写长期记忆。
 */

import { ToolDefinition } from '../types';
import { MemoryProvider } from './base';

/** 根据 MemoryProvider 实例创建记忆工具数组 */
export function createMemoryTools(provider: MemoryProvider): ToolDefinition[] {
  const memorySearch: ToolDefinition = {
    parallel: true,
    declaration: {
      name: 'memory_search',
      description: '搜索长期记忆中的相关信息。当需要回忆用户偏好、历史事实或之前保存的信息时使用。',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: '搜索关键词',
          },
          limit: {
            type: 'number',
            description: '返回数量，默认 5',
          },
        },
        required: ['query'],
      },
    },
    handler: async (args) => {
      const query = args.query as string;
      const limit = (args.limit as number) || 5;
      const results = await provider.search(query, limit);
      if (results.length === 0) {
        return { message: '未找到相关记忆', results: [] };
      }
      return {
        message: `找到 ${results.length} 条相关记忆`,
        results: results.map(m => ({
          id: m.id,
          content: m.content,
          category: m.category,
        })),
      };
    },
  };

  const memoryAdd: ToolDefinition = {
    declaration: {
      name: 'memory_add',
      description: '将重要信息保存到长期记忆。用于记住用户偏好、重要事实、关键决策等需要跨会话保留的信息。',
      parameters: {
        type: 'object',
        properties: {
          content: {
            type: 'string',
            description: '记忆内容',
          },
          category: {
            type: 'string',
            description: '分类：user / fact / preference / note',
            enum: ['user', 'fact', 'preference', 'note'],
          },
        },
        required: ['content'],
      },
    },
    handler: async (args) => {
      const content = args.content as string;
      const category = (args.category as string) || 'note';
      const id = await provider.add(content, category);
      return { message: `记忆已保存`, id, content, category };
    },
  };

  const memoryDelete: ToolDefinition = {
    declaration: {
      name: 'memory_delete',
      description: '删除一条不再需要的记忆。',
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'number',
            description: '记忆 ID',
          },
        },
        required: ['id'],
      },
    },
    handler: async (args) => {
      const id = args.id as number;
      const success = await provider.delete(id);
      return success
        ? { message: `记忆 #${id} 已删除` }
        : { message: `记忆 #${id} 不存在` };
    },
  };

  return [memorySearch, memoryAdd, memoryDelete];
}
