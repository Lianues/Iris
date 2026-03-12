/**
 * 聊天 API 处理器
 *
 * POST /api/chat — 通过 SSE 返回 AI 响应
 */

import * as http from 'http';
import * as crypto from 'crypto';
import { Backend, type ImageInput } from '../../../core/backend';
import type { DocumentInput } from '../../../media/document-extract.js';
import { isSupportedDocumentMime } from '../../../media/document-extract.js';
import { readBody, sendJSON } from '../router';
import type { WebPlatform } from '../index';

const MAX_IMAGES = 5;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_DOCUMENTS = 10;
const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024;

function normalizeImages(raw: unknown): ImageInput[] | null {
  if (raw == null) return [];
  if (!Array.isArray(raw) || raw.length > MAX_IMAGES) return null;

  const images: ImageInput[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return null;
    }

    const mimeType = typeof (item as any).mimeType === 'string' ? (item as any).mimeType : '';
    const rawData = typeof (item as any).data === 'string' ? (item as any).data : '';
    const dataUrlMatch = rawData.match(/^data:([^;]+);base64,(.+)$/);
    const normalizedMimeType = dataUrlMatch?.[1] ?? mimeType;
    const normalizedData = dataUrlMatch?.[2] ?? rawData;

    let binarySize = 0;
    try {
      binarySize = Buffer.from(normalizedData, 'base64').byteLength;
    } catch {}

    if (!normalizedMimeType.startsWith('image/') || !normalizedData || binarySize <= 0 || binarySize > MAX_IMAGE_BYTES) {
      return null;
    }

    images.push({
      mimeType: normalizedMimeType,
      data: normalizedData,
    });
  }

  return images;
}

function normalizeDocuments(raw: unknown): DocumentInput[] | null {
  if (raw == null) return [];
  if (!Array.isArray(raw) || raw.length > MAX_DOCUMENTS) return null;

  const documents: DocumentInput[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return null;
    }

    const fileName = typeof (item as any).fileName === 'string' ? (item as any).fileName : '';
    const mimeType = typeof (item as any).mimeType === 'string' ? (item as any).mimeType : '';
    const rawData = typeof (item as any).data === 'string' ? (item as any).data : '';

    // Strip data URL prefix if present
    const dataUrlMatch = rawData.match(/^data:([^;]+);base64,(.+)$/);
    const normalizedMimeType = dataUrlMatch?.[1] ?? mimeType;
    const normalizedData = dataUrlMatch?.[2] ?? rawData;

    if (!fileName || !normalizedData) {
      return null;
    }

    // Validate supported document type
    if (!isSupportedDocumentMime(normalizedMimeType, fileName)) {
      return null;
    }

    // Validate size (same pattern as normalizeImages)
    let binarySize = 0;
    try {
      binarySize = Buffer.from(normalizedData, 'base64').byteLength;
    } catch {}

    if (binarySize <= 0 || binarySize > MAX_DOCUMENT_BYTES) {
      return null;
    }

    documents.push({
      fileName,
      mimeType: normalizedMimeType,
      data: normalizedData,
    });
  }

  return documents;
}

export function createChatSuggestionsHandler(backend: Backend) {
  return async (req: http.IncomingMessage, res: http.ServerResponse) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const sessionId = url.searchParams.get('sessionId');

    try {
      const suggestions = await backend.generateChatSuggestions(sessionId && sessionId.trim() ? sessionId.trim() : null);
      sendJSON(res, 200, { suggestions });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : '生成建议失败';
      sendJSON(res, 500, { error: errorMsg });
    }
  };
}

export function createChatHandler(platform: WebPlatform) {
  return async (req: http.IncomingMessage, res: http.ServerResponse) => {
    let body: any;
    try {
      body = await readBody(req);
    } catch {
      sendJSON(res, 400, { error: '请求体解析失败' });
      return;
    }

    const message = typeof body.message === 'string' ? body.message : '';
    const images = normalizeImages(body.images);
    const documents = normalizeDocuments(body.documents);

    if (images === null) {
      sendJSON(res, 400, { error: '图片参数无效：最多支持 5 张 image/* 图片，且单张不超过 5MB' });
      return;
    }

    if (documents === null) {
      sendJSON(res, 400, { error: '文档参数无效：最多支持 10 个文档（PDF/DOCX/PPTX/XLSX），且单个不超过 50MB' });
      return;
    }

    if (!message.trim() && images.length === 0 && documents.length === 0) {
      sendJSON(res, 400, { error: '消息、图片和文档不能同时为空' });
      return;
    }

    const sessionId = typeof body.sessionId === 'string' && body.sessionId ? body.sessionId : `web-${crypto.randomUUID()}`;

    // 并发控制：同一 session 已有请求时拒绝
    if (platform.hasPending(sessionId)) {
      sendJSON(res, 409, { error: '该会话有正在处理的请求' });
      return;
    }

    // 设置 SSE 响应头
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Session-Id': sessionId,
    });
    res.flushHeaders();

    // 注册到 pending，等待 Orchestrator 处理
    platform.registerPending(sessionId, res);

    // 客户端断开时清理
    res.on('close', () => {
      clearInterval(heartbeat);
      platform.removePending(sessionId);
    });

    // 启动心跳（工具调用可能耗时）
    const heartbeat = setInterval(() => {
      if (!res.writableEnded) res.write(': heartbeat\n\n');
    }, 15000);

    try {
      // 触发消息处理（Orchestrator 会通过 sendMessage/sendMessageStream 回调写入 SSE）
      await platform.dispatchMessage(sessionId, message, images, documents);
      // 发送完成事件
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
      }
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify({ type: 'error', message: errorMsg })}\n\n`);
      }
    } finally {
      clearInterval(heartbeat);
      platform.removePending(sessionId);
      if (!res.writableEnded) res.end();
    }
  };
}
