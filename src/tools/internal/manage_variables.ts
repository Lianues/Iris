/**
 * 全局变量管理工具
 *
 * 让 AI 可以读写 GlobalStore 中的变量。
 * 支持 get / set / delete / list 四种操作，
 * 支持 agent / session 作用域隔离。
 *
 * 典型场景：
 *   - AI 在对话中设置好感度：set + scope=agent
 *   - Cron 任务检查好感度：get + scope=agent
 *   - 记录当前对话状态：set + scope=session
 */

import { ToolDefinition } from '../../types';
import type { GlobalStoreLike } from '@irises/extension-sdk';

export interface ManageVariablesDeps {
  getGlobalStore: () => GlobalStoreLike;
  getSessionId: () => string | undefined;
  getAgentName: () => string;
}

export function createManageVariablesTool(deps: ManageVariablesDeps): ToolDefinition {
  return {
    parallel: true,
    declaration: {
      name: 'manage_variables',
      description:
        '读写全局变量存储。变量会自动持久化到磁盘，跨对话保留。\n' +
        '操作类型：\n' +
        '- get: 获取变量值\n' +
        '- set: 设置变量值\n' +
        '- delete: 删除变量\n' +
        '- list: 列出所有变量\n' +
        '作用域：\n' +
        '- global: 所有 agent、所有对话共享\n' +
        '- agent: 按 agent 隔离，跨对话持久保留（适合好感度、信任度等）\n' +
        '- session: 按对话隔离，仅当前对话有效',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['get', 'set', 'delete', 'list'],
            description: '操作类型',
          },
          key: {
            type: 'string',
            description: '变量名（list 时可省略）',
          },
          value: {
            description: '变量值（仅 set 时需要，支持任意可 JSON 序列化的值）',
          },
          scope: {
            type: 'string',
            enum: ['global', 'agent', 'session'],
            description:
              '作用域（默认 agent）。' +
              'global=所有共享；' +
              'agent=按 agent 隔离、跨对话保留；' +
              'session=仅当前对话',
          },
        },
        required: ['action'],
      },
    },

    handler: async (args) => {
      const action = args.action as string;
      const key = args.key as string | undefined;
      const value = args.value;
      const scope = (args.scope as string) ?? 'agent';

      // 解析作用域，得到对应的 store 视图
      const rootStore = deps.getGlobalStore();
      let store: GlobalStoreLike;
      switch (scope) {
        case 'agent':
          store = rootStore.agent(deps.getAgentName());
          break;
        case 'session': {
          const sid = deps.getSessionId();
          if (!sid) return { error: '当前没有活跃会话，无法使用 session 作用域' };
          store = rootStore.session(sid);
          break;
        }
        case 'global':
          store = rootStore;
          break;
        default:
          return { error: `不支持的作用域: "${scope}"，可选: global / agent / session` };
      }

      switch (action) {
        // ── 获取 ──
        case 'get': {
          if (!key) return { error: 'get 操作需要 key 参数' };
          const val = store.get(key);
          return { key, value: val ?? null, exists: val !== undefined, scope };
        }

        // ── 设置 ──
        case 'set': {
          if (!key) return { error: 'set 操作需要 key 参数' };
          if (value === undefined) return { error: 'set 操作需要 value 参数' };
          store.set(key, value);
          return { success: true, key, value, scope };
        }

        // ── 删除 ──
        case 'delete': {
          if (!key) return { error: 'delete 操作需要 key 参数' };
          const deleted = store.delete(key);
          return { success: deleted, key, scope, message: deleted ? '已删除' : '变量不存在' };
        }

        // ── 列出 ──
        case 'list': {
          const all = store.getAll();
          const entries = Object.entries(all);
          return {
            scope,
            count: entries.length,
            variables: entries.length <= 50
              ? Object.fromEntries(entries)
              : Object.fromEntries(entries.slice(0, 50)),
            truncated: entries.length > 50,
          };
        }

        default:
          return { error: `不支持的操作: "${action}"，可选: get / set / delete / list` };
      }
    },
  };
}
