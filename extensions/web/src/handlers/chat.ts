/**
 * 聊天 API 处理器
 *
 * POST /api/chat — 通过 SSE 返回 AI 响应
 */

import * as http from 'http';
import * as crypto from 'crypto';
import type { ImageInput, DocumentInput } from '@irises/extension-sdk';
import { CHAT_ATTACHMENT_LIMITS, formatAttachmentBytes } from '../chat-attachments';
import { readBody, readRawBody, sendJSON } from '../router';
import type { WebPlatform } from '../web-platform';

// ── 内联自 src/media/document-extract.ts（避免耦合内部模块）──
const SUPPORTED_BINARY_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
]);
const SUPPORTED_TEXT_MIME_TYPES = new Set([
  'text/markdown', 'text/x-markdown', 'application/json', 'application/ld+json',
  'application/xml', 'image/svg+xml', 'application/x-yaml', 'text/yaml',
  'text/x-yaml', 'application/toml', 'text/x-toml', 'application/javascript',
  'text/javascript', 'application/x-javascript', 'application/x-sh',
  'application/x-shellscript', 'application/sql',
]);
const EXTENSION_TO_MIME: Record<string, string> = {
  '.md': 'text/markdown', '.json': 'application/json', '.xml': 'application/xml',
  '.yaml': 'application/x-yaml', '.yml': 'application/x-yaml', '.toml': 'application/toml',
  '.csv': 'text/csv', '.tsv': 'text/tab-separated-values',
  '.js': 'application/javascript', '.mjs': 'application/javascript', '.cjs': 'application/javascript',
  '.ts': 'text/x-typescript', '.tsx': 'text/x-typescript', '.jsx': 'application/javascript',
  '.py': 'text/x-python', '.rb': 'text/x-ruby', '.rs': 'text/x-rust',
  '.go': 'text/x-go', '.java': 'text/x-java', '.kt': 'text/x-kotlin',
  '.c': 'text/x-c', '.cpp': 'text/x-c++', '.h': 'text/x-c', '.hpp': 'text/x-c++',
  '.cs': 'text/x-csharp', '.swift': 'text/x-swift', '.php': 'text/x-php',
  '.sh': 'application/x-sh', '.bash': 'application/x-sh', '.zsh': 'application/x-sh',
  '.sql': 'application/sql', '.html': 'text/html', '.htm': 'text/html', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.txt': 'text/plain', '.log': 'text/plain', '.cfg': 'text/plain',
  '.ini': 'text/plain', '.env': 'text/plain', '.conf': 'text/plain',
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls': 'application/vnd.ms-excel',
};
function isSupportedTextMime(mimeType: string): boolean {
  return mimeType.startsWith('text/') || SUPPORTED_TEXT_MIME_TYPES.has(mimeType);
}
function isSupportedDocumentMime(mimeType: string, fileName?: string): boolean {
  const normalized = mimeType.split(';', 1)[0].trim().toLowerCase();
  if (SUPPORTED_BINARY_MIME_TYPES.has(normalized) || isSupportedTextMime(normalized)) return true;
  const ext = fileName?.toLowerCase().match(/\.[^.]+$/)?.[0] ?? '';
  if (!ext) return false;
  return !!EXTENSION_TO_MIME[ext];
}

class ChatRequestError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ChatRequestError';
    this.status = status;
  }
}

interface NormalizedAttachmentResult<T> {
  items: T[];
  totalBytes: number;
}

interface ParsedChatRequest {
  sessionId: string | null;
  message: string;
  images: ImageInput[];
  documents: DocumentInput[];
}

function normalizeMimeType(mimeType: string): string {
  return mimeType.split(';', 1)[0].trim().toLowerCase();
}

function getContentType(req: http.IncomingMessage): string {
  const header = req.headers['content-type'];
  return normalizeMimeType(Array.isArray(header) ? (header[0] ?? '') : (header ?? ''));
}

function buildImageLimitError(): string {
  return `图片参数无效：最多支持 ${CHAT_ATTACHMENT_LIMITS.maxImages} 张 image/* 图片，且单张不超过 ${formatAttachmentBytes(CHAT_ATTACHMENT_LIMITS.maxImageBytes)}`;
}

function buildDocumentLimitError(): string {
  return `文档参数无效：最多支持 ${CHAT_ATTACHMENT_LIMITS.maxDocuments} 个文档（PDF / Office / Markdown / JSON / XML / Python 等文本代码文件），且单个不超过 ${formatAttachmentBytes(CHAT_ATTACHMENT_LIMITS.maxDocumentBytes)}`;
}

function buildTotalLimitError(): string {
  return `附件总量过大：图片与文档合计不能超过 ${formatAttachmentBytes(CHAT_ATTACHMENT_LIMITS.maxTotalBytes)}`;
}

function decodeBase64ByteLength(base64: string): number {
  try {
    return Buffer.from(base64, 'base64').byteLength;
  } catch {
    return 0;
  }
}

function toRequestHeaders(headers: http.IncomingHttpHeaders): Headers {
  const normalized = new Headers();

  for (const [key, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        normalized.append(key, item);
      }
      continue;
    }

    if (typeof value === 'string') {
      normalized.set(key, value);
    }
  }

  return normalized;
}

function normalizeImages(raw: unknown): NormalizedAttachmentResult<ImageInput> | null {
  if (raw == null) return { items: [], totalBytes: 0 };
  if (!Array.isArray(raw) || raw.length > CHAT_ATTACHMENT_LIMITS.maxImages) return null;

  const images: ImageInput[] = [];
  let totalBytes = 0;

  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return null;
    }

    const mimeType = typeof (item as any).mimeType === 'string' ? (item as any).mimeType : '';
    const rawData = typeof (item as any).data === 'string' ? (item as any).data : '';
    const dataUrlMatch = rawData.match(/^data:([^;]+);base64,(.+)$/);
    const normalizedMimeType = normalizeMimeType(dataUrlMatch?.[1] ?? mimeType);
    const normalizedData = dataUrlMatch?.[2] ?? rawData;
    const binarySize = decodeBase64ByteLength(normalizedData);

    if (!normalizedMimeType.startsWith('image/') || !normalizedData || binarySize <= 0 || binarySize > CHAT_ATTACHMENT_LIMITS.maxImageBytes) {
      return null;
    }

    totalBytes += binarySize;
    images.push({
      mimeType: normalizedMimeType,
      data: normalizedData,
    });
  }

  return { items: images, totalBytes };
}

function normalizeDocuments(raw: unknown): NormalizedAttachmentResult<DocumentInput> | null {
  if (raw == null) return { items: [], totalBytes: 0 };
  if (!Array.isArray(raw) || raw.length > CHAT_ATTACHMENT_LIMITS.maxDocuments) return null;

  const documents: DocumentInput[] = [];
  let totalBytes = 0;

  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return null;
    }

    const fileName = typeof (item as any).fileName === 'string' ? (item as any).fileName : '';
    const mimeType = typeof (item as any).mimeType === 'string' ? (item as any).mimeType : '';
    const rawData = typeof (item as any).data === 'string' ? (item as any).data : '';
    const dataUrlMatch = rawData.match(/^data:([^;]+);base64,(.+)$/);
    const normalizedMimeType = normalizeMimeType(dataUrlMatch?.[1] ?? mimeType);
    const normalizedData = dataUrlMatch?.[2] ?? rawData;
    const binarySize = decodeBase64ByteLength(normalizedData);

    if (!fileName || !normalizedData || !isSupportedDocumentMime(normalizedMimeType, fileName) || binarySize <= 0 || binarySize > CHAT_ATTACHMENT_LIMITS.maxDocumentBytes) {
      return null;
    }

    totalBytes += binarySize;
    documents.push({
      fileName,
      mimeType: normalizedMimeType || 'application/octet-stream',
      data: normalizedData,
    });
  }

  return { items: documents, totalBytes };
}

function assertTotalAttachmentBytes(totalBytes: number): void {
  if (totalBytes > CHAT_ATTACHMENT_LIMITS.maxTotalBytes) {
    throw new ChatRequestError(413, buildTotalLimitError());
  }
}

function resolveOptionalSessionId(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  return value ? value : null;
}

async function parseJsonChatRequest(req: http.IncomingMessage): Promise<ParsedChatRequest> {
  let body: any;
  try {
    body = await readBody(req);
  } catch (error) {
    if (error instanceof Error && error.message === '请求体过大') {
      throw new ChatRequestError(413, buildTotalLimitError());
    }
    throw new ChatRequestError(400, '请求体解析失败');
  }

  const message = typeof body.message === 'string' ? body.message : '';
  const imagesResult = normalizeImages(body.images);
  const documentsResult = normalizeDocuments(body.documents);

  if (imagesResult === null) {
    throw new ChatRequestError(400, buildImageLimitError());
  }

  if (documentsResult === null) {
    throw new ChatRequestError(400, buildDocumentLimitError());
  }

  assertTotalAttachmentBytes(imagesResult.totalBytes + documentsResult.totalBytes);

  return {
    sessionId: resolveOptionalSessionId(body.sessionId),
    message,
    images: imagesResult.items,
    documents: documentsResult.items,
  };
}

async function parseMultipartChatRequest(req: http.IncomingMessage): Promise<ParsedChatRequest> {
  let rawBody: Buffer;
  try {
    rawBody = await readRawBody(req, CHAT_ATTACHMENT_LIMITS.maxMultipartBodyBytes);
  } catch (error) {
    if (error instanceof Error && error.message === '请求体过大') {
      throw new ChatRequestError(413, buildTotalLimitError());
    }
    throw new ChatRequestError(400, '请求体解析失败');
  }

  let formData: FormData;
  try {
    const request = new Request('http://localhost/api/chat', {
      method: req.method ?? 'POST',
      headers: toRequestHeaders(req.headers),
      body: rawBody,
    });
    formData = await request.formData();
  } catch {
    throw new ChatRequestError(400, 'multipart/form-data 解析失败');
  }

  const rawMessage = formData.get('message');
  if (rawMessage != null && typeof rawMessage !== 'string') {
    throw new ChatRequestError(400, 'message 参数无效');
  }

  const rawSessionId = formData.get('sessionId');
  if (rawSessionId != null && typeof rawSessionId !== 'string') {
    throw new ChatRequestError(400, 'sessionId 参数无效');
  }

  const imageEntries = formData.getAll('images');
  const documentEntries = formData.getAll('documents');

  if (imageEntries.length > CHAT_ATTACHMENT_LIMITS.maxImages) {
    throw new ChatRequestError(400, buildImageLimitError());
  }

  if (documentEntries.length > CHAT_ATTACHMENT_LIMITS.maxDocuments) {
    throw new ChatRequestError(400, buildDocumentLimitError());
  }

  const images: ImageInput[] = [];
  const documents: DocumentInput[] = [];
  let totalBytes = 0;

  for (const entry of imageEntries) {
    if (!(entry instanceof File)) {
      throw new ChatRequestError(400, '图片参数无效：请使用 multipart 文件字段 images');
    }

    const mimeType = normalizeMimeType(entry.type);
    if (!mimeType.startsWith('image/')) {
      throw new ChatRequestError(400, buildImageLimitError());
    }

    if (entry.size <= 0) {
      throw new ChatRequestError(400, `${entry.name || '图片'} 为空文件，无法上传`);
    }
    if (entry.size > CHAT_ATTACHMENT_LIMITS.maxImageBytes) {
      throw new ChatRequestError(413, `${entry.name || '图片'} 超过 ${formatAttachmentBytes(CHAT_ATTACHMENT_LIMITS.maxImageBytes)} 限制`);
    }

    totalBytes += entry.size;
    assertTotalAttachmentBytes(totalBytes);

    const buffer = Buffer.from(await entry.arrayBuffer());
    images.push({
      mimeType,
      data: buffer.toString('base64'),
    });
  }

  for (const entry of documentEntries) {
    if (!(entry instanceof File)) {
      throw new ChatRequestError(400, '文档参数无效：请使用 multipart 文件字段 documents');
    }

    const fileName = entry.name || 'document';
    const mimeType = normalizeMimeType(entry.type) || 'application/octet-stream';
    if (!isSupportedDocumentMime(mimeType, fileName)) {
      throw new ChatRequestError(400, `${fileName}: 不支持的文档类型`);
    }

    if (entry.size <= 0) {
      throw new ChatRequestError(400, `${fileName} 为空文件，无法上传`);
    }
    if (entry.size > CHAT_ATTACHMENT_LIMITS.maxDocumentBytes) {
      throw new ChatRequestError(413, `${fileName} 超过 ${formatAttachmentBytes(CHAT_ATTACHMENT_LIMITS.maxDocumentBytes)} 限制`);
    }

    totalBytes += entry.size;
    assertTotalAttachmentBytes(totalBytes);

    const buffer = Buffer.from(await entry.arrayBuffer());
    documents.push({
      fileName,
      mimeType,
      data: buffer.toString('base64'),
    });
  }

  return {
    sessionId: resolveOptionalSessionId(rawSessionId),
    message: typeof rawMessage === 'string' ? rawMessage : '',
    images,
    documents,
  };
}

async function parseChatRequest(req: http.IncomingMessage): Promise<ParsedChatRequest> {
  const contentType = getContentType(req);

  if (!contentType || contentType === 'application/json') {
    return parseJsonChatRequest(req);
  }

  if (contentType === 'multipart/form-data') {
    return parseMultipartChatRequest(req);
  }

  throw new ChatRequestError(415, '仅支持 application/json 或 multipart/form-data 请求');
}

export function createChatHandler(platform: WebPlatform) {
  return async (req: http.IncomingMessage, res: http.ServerResponse) => {
    let parsedRequest: ParsedChatRequest;
    try {
      parsedRequest = await parseChatRequest(req);
    } catch (error) {
      if (error instanceof ChatRequestError) {
        sendJSON(res, error.status, { error: error.message });
        return;
      }

      sendJSON(res, 400, { error: '请求体解析失败' });
      return;
    }

    const { message, images, documents } = parsedRequest;

    if (!message.trim() && images.length === 0 && documents.length === 0) {
      sendJSON(res, 400, { error: '消息、图片和文档不能同时为空' });
      return;
    }

    const sessionId = parsedRequest.sessionId ?? `web-${crypto.randomUUID()}`;

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
      'X-Accel-Buffering': 'no',
      'X-Session-Id': sessionId,
    });
    res.flushHeaders();

    // 禁用 Nagle 算法，确保每次 res.write() 立即发送，避免 SSE 事件被合并
    res.socket?.setNoDelay(true);

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

    // 解析 agent 名称
    const agentName = typeof req.headers['x-agent-name'] === 'string' ? req.headers['x-agent-name'] : undefined;

    try {
      // 触发消息处理（Orchestrator 会通过 sendMessage/sendMessageStream 回调写入 SSE）
      await platform.dispatchMessage(sessionId, message, images, documents, agentName);
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
