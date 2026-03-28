/**
 * Telegram 入站消息解析器。
 *
 * 当前阶段先完成最基础的文本解析与 session 归一化，
 * 目的：把“从 Context 里读字段”的细节从平台主类中拆出去。
 * 后续 Phase 1.2 会在此处继续补齐图片、文件、语音、reply、topic、mention 等能力。
 */

import type { Context } from 'grammy';
import { createExtensionLogger } from '@irises/extension-sdk';
import {
  ParsedTelegramMessage,
  TelegramConfig,
  TelegramDocumentRef,
  TelegramPhotoRef,
  TelegramReplyRef,
  TelegramVoiceRef,
  buildTelegramSessionTarget,
} from './types';

const logger = createExtensionLogger('TelegramExtension', 'TelegramMessageHandler');

type TelegramEntityLike = { type?: string; offset?: number; length?: number };
type TelegramPhotoLike = {
  file_id?: string;
  file_unique_id?: string;
  width?: number;
  height?: number;
};
type TelegramDocumentLike = {
  file_id?: string;
  file_unique_id?: string;
  file_name?: string;
  mime_type?: string;
};
type TelegramVoiceLike = {
  file_id?: string;
  file_unique_id?: string;
  mime_type?: string;
  duration?: number;
};

interface TelegramMessageLike {
  message_id: number;
  text?: string;
  caption?: string;
  entities?: TelegramEntityLike[];
  caption_entities?: TelegramEntityLike[];
  message_thread_id?: number;
  media_group_id?: string;
  photo?: TelegramPhotoLike[];
  document?: TelegramDocumentLike;
  voice?: TelegramVoiceLike;
  audio?: TelegramVoiceLike;
  reply_to_message?: TelegramMessageLike;
}

export class TelegramMessageHandler {
  constructor(private readonly config: TelegramConfig) {}

  parseIncomingText(ctx: Context): ParsedTelegramMessage | null {
    const message = ctx.message as TelegramMessageLike | undefined;
    if (!message) return null;

    const chatId = ctx.chat?.id;
    if (chatId == null) return null;

    const username = String((ctx as { me?: { username?: string } }).me?.username ?? '').trim();
    const text = extractTelegramText(message);
    const mentioned = !isBlankTelegramUsername(username) && this.isExplicitlyMentioned(message, text, username);

    const isPrivate = ctx.chat?.type === 'private';
    if (!isPrivate && this.config.groupMentionRequired !== false && !mentioned) {
      // 这里先实现最保守的群聊策略：要求显式 @ 机器人再响应。
      // 目的：在 Telegram 群聊中避免机器人误响应普通群消息。
      return null;
    }

    const photo = pickLargestPhoto(message.photo);
    const document = normalizeDocumentRef(message.document);
    const voice = normalizeVoiceRef(message.voice);
    const audio = normalizeVoiceRef(message.audio);
    const reply = extractReplyRef(message.reply_to_message);

    // 这里允许“无文本但有媒体”的消息通过。
    // 目的：为 Phase 3 的图片/文件/语音接入做好准备，避免解析层先把媒体消息过滤掉。
    if (!text && !photo && !document && !voice && !audio) {
      return null;
    }

    const threadId = typeof (message as { message_thread_id?: number }).message_thread_id === 'number'
      ? (message as { message_thread_id?: number }).message_thread_id
      : undefined;

    return {
      session: buildTelegramSessionTarget({ chatId, isPrivate, threadId }),
      text: stripBotMention(text, username),
      messageId: message.message_id,
      replyToMessageId: message.reply_to_message?.message_id,
      mentioned,
      mediaGroupId: message.media_group_id,
      photo,
      document,
      voice,
      audio,
      reply,
    };
  }

  private isExplicitlyMentioned(message: TelegramMessageLike, text: string, username: string): boolean {
    if (isBlankTelegramUsername(username)) {
      logger.debug('当前 update 未拿到 bot username，暂时放行群聊消息');
      return true;
    }

    if (text.includes(`@${username}`)) return true;

    const entities = [...(message.entities ?? []), ...(message.caption_entities ?? [])];
    return entities.some((entity) => {
      if (entity.type !== 'mention' && entity.type !== 'bot_command') return false;
      if (typeof entity.offset !== 'number' || typeof entity.length !== 'number') return false;
      const token = text.slice(entity.offset, entity.offset + entity.length);
      return token === `@${username}` || token.includes(`@${username}`);
    });
  }
}

export function extractTelegramText(message: {
  text?: string;
  caption?: string;
}): string {
  // 这里优先读取 text，后续在图片/文件消息里会自然回退到 caption。
  // 目的：让文字解析规则在一个函数内统一维护。
  return String(message.text ?? message.caption ?? '').trim();
}

function pickLargestPhoto(photos?: TelegramPhotoLike[]): TelegramPhotoRef | undefined {
  if (!Array.isArray(photos) || photos.length === 0) return undefined;
  return normalizePhotoRef(photos[photos.length - 1]);
}

function normalizePhotoRef(photo?: TelegramPhotoLike): TelegramPhotoRef | undefined {
  if (!photo?.file_id) return undefined;
  return {
    fileId: photo.file_id,
    fileUniqueId: photo.file_unique_id,
    width: photo.width,
    height: photo.height,
  };
}

function normalizeDocumentRef(document?: TelegramDocumentLike): TelegramDocumentRef | undefined {
  if (!document?.file_id) return undefined;
  return {
    fileId: document.file_id,
    fileUniqueId: document.file_unique_id,
    fileName: document.file_name,
    mimeType: document.mime_type,
  };
}

function normalizeVoiceRef(voice?: TelegramVoiceLike): TelegramVoiceRef | undefined {
  if (!voice?.file_id) return undefined;
  return {
    fileId: voice.file_id,
    fileUniqueId: voice.file_unique_id,
    mimeType: voice.mime_type,
    duration: voice.duration,
  };
}

function extractReplyRef(reply?: TelegramMessageLike): TelegramReplyRef | undefined {
  if (!reply) return undefined;
  return {
    messageId: reply.message_id,
    text: extractTelegramText(reply),
    hasPhoto: Array.isArray(reply.photo) && reply.photo.length > 0,
    hasDocument: Boolean(reply.document),
    hasVoice: Boolean(reply.voice ?? reply.audio),
  };
}

function isBlankTelegramUsername(username: string): boolean {
  return !username.trim();
}

export function stripBotMention(text: string, username: string): string {
  const normalized = text.trim();
  if (!normalized || isBlankTelegramUsername(username)) return normalized;

  const normalizedLower = normalized.toLowerCase();
  const mentionPrefix = `@${username}`.toLowerCase();
  if (normalizedLower.startsWith(mentionPrefix)) {
    return normalized.slice(mentionPrefix.length).trim();
  }

  if (normalized.startsWith('/')) {
    const firstSpace = normalized.indexOf(' ');
    const commandToken = firstSpace >= 0 ? normalized.slice(0, firstSpace) : normalized;
    const loweredCommandToken = commandToken.toLowerCase();
    const botSuffix = `@${username}`.toLowerCase();
    if (loweredCommandToken.endsWith(botSuffix)) {
      const bareCommand = commandToken.slice(0, commandToken.length - botSuffix.length);
      const rest = firstSpace >= 0 ? normalized.slice(firstSpace + 1).trim() : '';
      return [bareCommand, rest].filter(Boolean).join(' ').trim();
    }
  }

  // 这里先做最常见的 mention 清理：
  //   1. 开头的 @bot 文本
  //   2. /command@bot 形式的命令目标后缀
  // 目的：让后续命令路由和普通聊天都能拿到更干净的文本输入。
  return normalized;
}
