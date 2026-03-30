/**
 * 会话管理 API 处理器
 *
 * GET    /api/sessions                       — 列出所有会话
 * GET    /api/sessions/:id/messages          — 获取会话历史
 * DELETE /api/sessions/:id                   — 清除会话历史
 * DELETE /api/sessions/:id/messages?keepCount=N — 截断会话历史
 */

import * as http from 'http';
import { RouteParams, sendJSON } from '../router';
import type { StorageLike } from '@irises/extension-sdk';
import { formatMessages } from '../message-format';
import type { Content } from '@irises/extension-sdk';

export function createSessionsHandlers(storage: StorageLike) {
  return {
    /** GET /api/sessions */
    async list(_req: http.IncomingMessage, res: http.ServerResponse) {
      const metas = await storage.listSessionMetas();
      const knownIds = new Set(metas.map((meta) => meta.id));
      const orphanIds = (await storage.listSessions()).filter((id) => !knownIds.has(id));
      const sessions = [
        ...metas,
        ...orphanIds.map((id) => ({
          id,
          title: id,
          cwd: '',
          createdAt: '',
          updatedAt: '',
        })),
      ].sort((left, right) => {
        const leftTime = left.updatedAt ? new Date(String(left.updatedAt)).getTime() : 0;
        const rightTime = right.updatedAt ? new Date(String(right.updatedAt)).getTime() : 0;
        return rightTime - leftTime;
      });

      sendJSON(res, 200, { sessions });
    },

    /** GET /api/sessions/:id/messages */
    async getMessages(_req: http.IncomingMessage, res: http.ServerResponse, params: RouteParams) {
      const history = await storage.getHistory(params.id) as Content[];
      sendJSON(res, 200, { messages: formatMessages(history) });
    },

    /** DELETE /api/sessions/:id */
    async remove(_req: http.IncomingMessage, res: http.ServerResponse, params: RouteParams) {
      await storage.clearHistory(params.id);
      sendJSON(res, 200, { ok: true });
    },

    /** DELETE /api/sessions/:id/messages?keepCount=N */
    async truncateMessages(req: http.IncomingMessage, res: http.ServerResponse, params: RouteParams) {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
      const keepCount = parseInt(url.searchParams.get('keepCount') ?? '', 10);
      if (isNaN(keepCount) || keepCount < 0) {
        sendJSON(res, 400, { error: '参数 keepCount 无效' });
        return;
      }
      await storage.truncateHistory(params.id, keepCount);
      sendJSON(res, 200, { ok: true });
    },
  };
}
