/**
 * Telegram 多媒体处理模块。
 *
 * Phase 3 实现：
 *   - 图片下载：从 Telegram 获取最高分辨率图片，转为 ImageInput；
 *   - 文件下载：从 Telegram 获取 document，转为 DocumentInput；
 *   - 语音下载：从 Telegram 获取 voice/audio，转为 DocumentInput。
 *
 * 目的：将 Telegram 入站的多媒体消息转化为 Backend.chat() 可消费的格式，
 * 让 LLM 能"看到"图片和"读取"文件内容。
 */

import { createExtensionLogger, type DocumentInput, type ImageInput } from '@irises/extension-sdk';
import type { TelegramClient } from './client';
import type {
  TelegramPhotoRef,
  TelegramDocumentRef,
  TelegramVoiceRef,
} from './types';

const logger = createExtensionLogger('TelegramExtension', 'TelegramMedia');

export class TelegramMediaService {
  /**
   * 标记当前是否支持入站多媒体处理。
   * Phase 3 实现后改为 true。
   */
  supportsInboundMedia(): boolean {
    return true;
  }


  // ---- 图片下载 ----

  /**
   * 下载 Telegram 图片并转为 ImageInput。
   * Telegram photo 数组中最后一个元素是最高分辨率的版本。
   */
  async downloadPhoto(
    client: TelegramClient,
    photo: TelegramPhotoRef,
  ): Promise<ImageInput | null> {
    try {
      const downloaded = await client.downloadFile(photo.fileId);
      const mimeType = detectImageMime(downloaded.buffer) || 'image/jpeg';
      const base64 = downloaded.buffer.toString('base64');
      logger.debug(`图片下载成功: fileId=${photo.fileId}, size=${downloaded.buffer.length}`);
      return { mimeType, data: base64 };
    } catch (err) {
      logger.error(`图片下载失败: fileId=${photo.fileId}`, err);
      return null;
    }
  }

  // ---- 文件下载 ----

  /**
   * 下载 Telegram 文件并转为 DocumentInput。
   * 支持 PDF、Office 文档、文本文件等，由 Backend 内部提取文本。
   */
  async downloadDocument(
    client: TelegramClient,
    doc: TelegramDocumentRef,
  ): Promise<DocumentInput | null> {
    try {
      const downloaded = await client.downloadFile(doc.fileId);
      const fileName = doc.fileName || `document_${doc.fileId}`;
      const mimeType = doc.mimeType || guessMimeByFileName(fileName);
      const base64 = downloaded.buffer.toString('base64');
      logger.debug(`文件下载成功: fileId=${doc.fileId}, fileName=${fileName}, size=${downloaded.buffer.length}`);
      return { fileName, mimeType, data: base64 };
    } catch (err) {
      logger.error(`文件下载失败: fileId=${doc.fileId}`, err);
      return null;
    }
  }

  // ---- 语音/音频下载 ----

  /**
   * 下载 Telegram 语音/音频并转为 DocumentInput。
   * Telegram 语音通常是 OGG Opus 格式。
   */
  async downloadVoice(
    client: TelegramClient,
    voice: TelegramVoiceRef,
  ): Promise<DocumentInput | null> {
    try {
      const downloaded = await client.downloadFile(voice.fileId);
      const mimeType = voice.mimeType || 'audio/ogg';
      // 语音文件用 mimeType 的后缀作扩展名
      const ext = mimeType === 'audio/ogg' ? 'ogg' : mimeType.split('/').pop() || 'audio';
      const fileName = `voice_${voice.fileId}.${ext}`;
      const base64 = downloaded.buffer.toString('base64');
      logger.debug(`语音下载成功: fileId=${voice.fileId}, duration=${voice.duration ?? '?'}s, size=${downloaded.buffer.length}`);
      return { fileName, mimeType, data: base64 };
    } catch (err) {
      logger.error(`语音下载失败: fileId=${voice.fileId}`, err);
      return null;
    }
  }
}

// ---- 辅助函数 ----

/** 根据文件头魔术字节检测图片 MIME 类型 */
function detectImageMime(buffer: Buffer): string | null {
  if (buffer.length < 4) return null;
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) return 'image/jpeg';
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) return 'image/png';
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) return 'image/gif';
  if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46
    && buffer.length >= 12 && buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) return 'image/webp';
  if (buffer[0] === 0x42 && buffer[1] === 0x4D) return 'image/bmp';
  return null;
}

/** 根据文件扩展名猜测 MIME 类型 */
function guessMimeByFileName(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase();
  const MIME_MAP: Record<string, string> = {
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    txt: 'text/plain',
    csv: 'text/csv',
    json: 'application/json',
    xml: 'application/xml',
    html: 'text/html',
    md: 'text/markdown',
    zip: 'application/zip',
    ogg: 'audio/ogg',
    opus: 'audio/opus',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    mp4: 'video/mp4',
  };
  return ext ? (MIME_MAP[ext] ?? 'application/octet-stream') : 'application/octet-stream';
}
