/**
 * Telegram 平台类型定义。
 *
 * 这里先把会话标识、配置结构、流式状态等基础类型抽出来，
 * 目的：为后续把单文件适配器拆分成多模块做准备，避免状态结构继续散落在 index.ts 中。
 */

export const TELEGRAM_MESSAGE_MAX_LENGTH = 4096;

export interface TelegramConfig {
  token: string;
  /**
   * 是否在 Telegram 输出中展示工具状态。
   * 该字段先在 Phase 0 接入配置，后续 Phase 2/4/6 会逐步真正使用。
   */
  showToolStatus?: boolean;
  /** 群聊中是否要求显式 @ 机器人后才响应，默认 true。 */
  groupMentionRequired?: boolean;
  /** 对码配置（从全局配置与分平台覆盖合并后传入） */
  pairing?: import('../pairing/types').PairingConfig;
}

export interface TelegramPhotoRef {
  fileId: string;
  fileUniqueId?: string;
  width?: number;
  height?: number;
}

export interface TelegramDocumentRef {
  fileId: string;
  fileUniqueId?: string;
  fileName?: string;
  mimeType?: string;
}

export interface TelegramVoiceRef {
  fileId: string;
  fileUniqueId?: string;
  mimeType?: string;
  duration?: number;
}

export interface TelegramReplyRef {
  messageId: number;
  text: string;
  hasPhoto: boolean;
  hasDocument: boolean;
  hasVoice: boolean;
}

export interface TelegramSessionTarget {
  sessionId: string;
  chatId: number;
  threadId?: number;
  chatKey: string;
  scope: 'dm' | 'group';
}

export interface ParsedTelegramMessage {
  session: TelegramSessionTarget;
  /**
   * 归一化后的纯文本。
   * 如果消息只包含媒体而没有 caption，这里允许为空字符串，后续交由 media 阶段处理。
   */
  text: string;
  messageId: number;
  replyToMessageId?: number;
  mentioned: boolean;
  mediaGroupId?: string;
  photo?: TelegramPhotoRef;
  document?: TelegramDocumentRef;
  voice?: TelegramVoiceRef;
  audio?: TelegramVoiceRef;
  reply?: TelegramReplyRef;
}

export interface TelegramPendingMessage {
  session: TelegramSessionTarget;
  text: string;
  hasUnsupportedMedia: boolean;
}

export function buildTelegramSessionTarget(params: {
  chatId: number;
  isPrivate: boolean;
  threadId?: number;
}): TelegramSessionTarget {
  const scope: TelegramSessionTarget['scope'] = params.isPrivate ? 'dm' : 'group';
  const baseSessionId = `telegram-${scope}-${params.chatId}`;
  const sessionId = params.threadId ? `${baseSessionId}-thread-${params.threadId}` : baseSessionId;
  const chatKey = params.threadId ? `${scope}:${params.chatId}:thread:${params.threadId}` : `${scope}:${params.chatId}`;
  return {
    sessionId,
    chatId: params.chatId,
    threadId: params.threadId,
    chatKey,
    scope,
  };
}

export function parseTelegramSessionTarget(sessionId: string): TelegramSessionTarget {
  // 先支持新的 sessionId 结构。
  // 目的：后续引入群聊/话题并发控制时，可以稳定反查 chatId 与 threadId。
  const structured = sessionId.match(/^telegram-(dm|group)-(-?\d+)(?:-thread-(\d+))?$/);
  if (structured) {
    const scope = structured[1] as TelegramSessionTarget['scope'];
    const chatId = Number(structured[2]);
    const threadId = structured[3] ? Number(structured[3]) : undefined;
    return {
      sessionId,
      chatId,
      threadId,
      chatKey: threadId ? `${scope}:${chatId}:thread:${threadId}` : `${scope}:${chatId}`,
      scope,
    };
  }

  // 兼容旧版 telegram-{chatId} 会话格式。
  // 目的：避免历史会话或旧存储在重构后立即失效。
  const legacy = sessionId.match(/^telegram-(-?\d+)$/);
  if (legacy) {
    const chatId = Number(legacy[1]);
    return {
      sessionId,
      chatId,
      chatKey: `legacy:${chatId}`,
      scope: 'group',
    };
  }

  throw new Error(`无法解析 Telegram sessionId: ${sessionId}`);
}
