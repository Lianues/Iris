/**
 * Diff 预览 API 处理器
 *
 * 仅作为 Web HTTP 层薄封装：真正的 session-aware preview 生成在核心
 * Backend.getToolDiffPreview 中完成，避免 Web/Console 重复实现和 cwd 漂移。
 */

import type { IncomingMessage, ServerResponse } from 'http';
import type { IrisBackendLike } from 'irises-extension-sdk';
import { sendJSON } from '../router';

export function createDiffPreviewHandler(backend: IrisBackendLike) {
  return async (_req: IncomingMessage, res: ServerResponse, params: Record<string, string>) => {
    const toolId = params.id;
    if (!toolId) {
      sendJSON(res, 400, { error: '缺少工具 ID' });
      return;
    }

    const getPreview = backend.getToolDiffPreview;
    if (typeof getPreview !== 'function') {
      sendJSON(res, 503, { error: '当前 Backend 不支持 diff 预览' });
      return;
    }

    try {
      const preview = await getPreview.call(backend, toolId);
      sendJSON(res, 200, preview);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '生成 diff 预览失败';
      const status = message.includes('未找到工具调用') ? 404 : 500;
      sendJSON(res, status, { error: message });
    }
  };
}
