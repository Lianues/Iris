/**
 * TelegramClient：对 grammY Bot 的轻量封装。
 *
 * 职责：
 * 1. 统一创建 Bot 实例；
 * 2. 收口所有发送 / 编辑 / 删除消息的逻辑；
 * 3. 启动时向 Telegram 服务端同步命令菜单（setMyCommands）；
 * 4. 为文件下载、回调按钮等能力预留稳定边界。
 */

import { Bot, Context, InputFile } from 'grammy';
import type { InputRichMessage } from 'grammy/types';
import { createExtensionLogger, splitText } from 'irises-extension-sdk';
import { TELEGRAM_BOT_COMMANDS } from './commands';
import {
  TELEGRAM_MESSAGE_MAX_LENGTH,
  TelegramConfig,
  TelegramSessionTarget,
} from './types';

const logger = createExtensionLogger('TelegramExtension', 'TelegramClient');

export interface TelegramSendTextOptions {
  parseMode?: 'HTML';
}

export interface TelegramEditTextOptions {
  parseMode?: 'HTML';
}

type TelegramTextOptions = TelegramSendTextOptions | TelegramEditTextOptions;

/**
 * 批量发送纯文本时的轻量回调。
 *
 * TelegramClient 只负责把消息发出去；undo 栈属于平台状态机。observer 让平台层
 * 在每个分片成功后立刻记录 message_id，避免后续分片失败时丢失已发送消息。
 */
export interface TelegramMessageIdObserver {
  onMessageId?: (messageId: number) => void;
}

export interface TelegramDownloadedFile {
  fileId: string;
  filePath: string;
  buffer: Buffer;
}

export class TelegramClient {
  private bot: Bot;

  constructor(private readonly config: TelegramConfig) {
    this.bot = new Bot(config.token);
  }

  getBot(): Bot {
    return this.bot;
  }

  onMessage(handler: (ctx: Context) => Promise<void> | void): void {
    // 统一监听所有 message update，让图片、文件、语音等非文本消息也进入同一条解析链路。
    this.bot.on('message', handler);
  }

  async start(): Promise<void> {
    // 发起长轮询，不阻塞启动流程。
    this.bot.start({
      onStart: (info) => {
        logger.info(`已连接 | Bot: ${info.username}`);
      },
    });

    // 启动后立即向 Telegram 服务端注册命令菜单，覆盖旧 bot 遗留的 slash command。
    // 原因：Telegram 的 setMyCommands 是全量覆盖语义——不主动调用就永远保留上次注册的列表。
    // 老 bot 或旧框架曾注册过一批命令（如旧版 /skill 切换、/status、/approve 等），
    // 必须在启动时用当前命令列表覆盖，否则用户看到的菜单与实际支持的命令不一致。
    try {
      await this.bot.api.setMyCommands(TELEGRAM_BOT_COMMANDS);
      logger.info(`已注册 Telegram 命令菜单 (${TELEGRAM_BOT_COMMANDS.length} 条)`);
    } catch (err) {
      logger.warn('注册 Telegram 命令菜单失败:', err);
    }
  }

  async stop(): Promise<void> {
    this.bot.stop();
  }

  /**
   * 发送消息并返回 message_id。
   * 流式模式需要先发送占位消息，拿到 message_id 后再通过 editText 更新。
   */
  async sendMessageReturningId(target: TelegramSessionTarget, text: string): Promise<number> {
    return await this.sendMessageChunkReturningId(target, text);
  }

  /**
   * 按 Telegram 4096 字符限制拆分发送纯文本，并返回所有成功发送的 message_id。
   * 若中途失败，Promise 会按原错误失败；已成功发送的 ID 会先通过 observer 暴露给调用方。
   */
  async sendTextReturningIds(target: TelegramSessionTarget, text: string, options: TelegramSendTextOptions = {}, observer: TelegramMessageIdObserver = {}): Promise<number[]> {
    const chunks = splitText(text, TELEGRAM_MESSAGE_MAX_LENGTH);
    const messageIds: number[] = [];
    for (const chunk of chunks) {
      const messageId = await this.sendMessageChunkReturningId(target, chunk, options);
      messageIds.push(messageId);
      observer.onMessageId?.(messageId);
    }
    return messageIds;
  }

  /** 发送 Telegram Rich Message，并返回持久化消息的 message_id。 */
  async sendRichMessageReturningId(target: TelegramSessionTarget, richMessage: InputRichMessage): Promise<number> {
    const extra = this.buildThreadExtra(target);
    const msg = await this.bot.api.sendRichMessage(target.chatId, richMessage, extra);
    return msg.message_id;
  }

  /**
   * 发送官方 private draft 预览。
   *
   * Bot API 要求 draft_id 为非零整数，且 draft 只用于私聊里的临时预览；
   * 最终消息仍必须通过 sendRichMessage/editMessageText 持久化。
   */
  async sendRichMessageDraft(target: TelegramSessionTarget, draftId: number, richMessage: InputRichMessage): Promise<void> {
    if (target.scope !== 'dm') {
      throw new Error('Telegram rich message draft 仅支持私聊');
    }
    if (!Number.isInteger(draftId) || draftId === 0) {
      throw new Error(`Telegram draft_id 必须是非零整数: ${draftId}`);
    }
    const extra = this.buildThreadExtra(target);
    await this.bot.api.sendRichMessageDraft(target.chatId, draftId, richMessage, extra);
  }

  /**
   * 发送带 inline keyboard 的消息，返回 message_id。
   * 用于 /model、/session、/mode 命令的列表展示。
   */
  async sendMessageWithKeyboard(
    target: TelegramSessionTarget,
    text: string,
    keyboard: Array<Array<{ text: string; callback_data: string }>>,
  ): Promise<number> {
    const extra: Record<string, unknown> = {
      reply_markup: { inline_keyboard: keyboard },
    };
    if (target.threadId != null) {
      extra.message_thread_id = target.threadId;
    }
    const msg = await this.bot.api.sendMessage(target.chatId, text, extra);
    return msg.message_id;
  }

  /** 注册 callback_query 处理器 */
  onCallbackQuery(handler: (ctx: any) => void): void {
    this.bot.on('callback_query:data', handler);
  }

  /** 回答 callback_query（消除 loading 动画） */
  async answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
    await this.bot.api.answerCallbackQuery(callbackQueryId, text ? { text } : {});
  }

  async sendText(target: TelegramSessionTarget, text: string, options: TelegramSendTextOptions = {}): Promise<void> {
    await this.sendTextReturningIds(target, text, options);
  }

  async editText(target: TelegramSessionTarget, messageId: number, text: string, options: TelegramEditTextOptions = {}): Promise<void> {
    const extra: Record<string, unknown> = {};
    if (options.parseMode) {
      extra.parse_mode = options.parseMode;
    }
    // editMessageText 是流式更新中最频繁的调用，最容易触发 429。
    // 捕获 "message is not modified" 错误并静默忽略（文本未变化时 Telegram 会报错）。
    try {
      await this.bot.api.editMessageText(target.chatId, messageId, text, extra);
    } catch (err: any) {
      const errMsg = String(err?.message ?? err?.description ?? '');
      if (errMsg.includes('message is not modified')) return;
      // 429 由 grammY 内置 auto-retry 处理，这里只重新抛出
      throw err;
    }
  }

  /** 用 Rich Message 替换既有文本消息，主要用于群聊 legacy stream 的最终 rich 化。 */
  async editRichMessage(target: TelegramSessionTarget, messageId: number, richMessage: InputRichMessage): Promise<void> {
    try {
      await this.bot.api.editMessageText(target.chatId, messageId, richMessage);
    } catch (err: any) {
      const errMsg = String(err?.message ?? err?.description ?? '');
      if (errMsg.includes('message is not modified')) return;
      throw err;
    }
  }

  /**
   * 将一条既有 Telegram 文本消息替换为可能跨多条消息的纯文本结果。
   * 第一片通过 editMessageText 覆盖原消息，剩余分片继续 sendMessage。
   */
  async replaceMessageTextReturningIds(target: TelegramSessionTarget, messageId: number, text: string, options: TelegramEditTextOptions = {}, observer: TelegramMessageIdObserver = {}): Promise<number[]> {
    const chunks = splitText(text, TELEGRAM_MESSAGE_MAX_LENGTH);
    const [firstChunk, ...restChunks] = chunks;
    await this.editText(target, messageId, firstChunk, options);

    const messageIds = [messageId];
    observer.onMessageId?.(messageId);
    for (const chunk of restChunks) {
      const nextMessageId = await this.sendMessageChunkReturningId(target, chunk, options);
      messageIds.push(nextMessageId);
      observer.onMessageId?.(nextMessageId);
    }
    return messageIds;
  }

  private async sendMessageChunkReturningId(target: TelegramSessionTarget, text: string, options: TelegramTextOptions = {}): Promise<number> {
    const extra = this.buildTextExtra(target, options);
    const msg = await this.bot.api.sendMessage(target.chatId, text, extra);
    return msg.message_id;
  }

  /** message_thread_id 是 sendMessage/sendRichMessage/sendRichMessageDraft 共享的 Telegram 话题参数。 */
  private buildThreadExtra(target: TelegramSessionTarget): Record<string, unknown> {
    const extra: Record<string, unknown> = {};
    if (target.threadId != null) {
      extra.message_thread_id = target.threadId;
    }
    return extra;
  }

  private buildTextExtra(target: TelegramSessionTarget, options: TelegramTextOptions = {}): Record<string, unknown> {
    const extra = this.buildThreadExtra(target);
    if (options.parseMode) {
      extra.parse_mode = options.parseMode;
    }
    return extra;
  }

  async deleteMessage(target: TelegramSessionTarget, messageId: number): Promise<void> {
    await this.bot.api.deleteMessage(target.chatId, messageId);
  }

  /**
   * 直接向 Telegram 发送图片。
   *
   * 这里使用 InputFile 包装 Buffer，避免先落盘再读取，减少一次不必要的 I/O。
   * 这条链路是附件旁路的终点：图片不进 LLM 上下文，直接给用户看。
   */
  async sendPhoto(target: TelegramSessionTarget, photo: Buffer, caption?: string): Promise<number> {
    const extra: Record<string, unknown> = {};
    if (target.threadId != null) {
      extra.message_thread_id = target.threadId;
    }
    if (caption) {
      extra.caption = caption;
    }
    const inputFile = new InputFile(photo);
    const msg = await this.bot.api.sendPhoto(target.chatId, inputFile, extra);
    return msg.message_id;
  }

  async sendDocument(target: TelegramSessionTarget, file: Buffer, fileName?: string, caption?: string): Promise<number> {
    const extra: Record<string, unknown> = {};
    if (target.threadId != null) {
      extra.message_thread_id = target.threadId;
    }
    if (caption) {
      extra.caption = caption;
    }
    const inputFile = fileName ? new InputFile(file, fileName) : new InputFile(file);
    const msg = await this.bot.api.sendDocument(target.chatId, inputFile, extra);
    return msg.message_id;
  }

  async sendAudio(target: TelegramSessionTarget, audio: Buffer, fileName?: string, caption?: string): Promise<number> {
    const extra: Record<string, unknown> = {};
    if (target.threadId != null) {
      extra.message_thread_id = target.threadId;
    }
    if (caption) {
      extra.caption = caption;
    }
    const inputFile = fileName ? new InputFile(audio, fileName) : new InputFile(audio);
    const msg = await this.bot.api.sendAudio(target.chatId, inputFile, extra);
    return msg.message_id;
  }

  async sendVoice(target: TelegramSessionTarget, voice: Buffer, fileName?: string, caption?: string): Promise<number> {
    const extra: Record<string, unknown> = {};
    if (target.threadId != null) {
      extra.message_thread_id = target.threadId;
    }
    if (caption) {
      extra.caption = caption;
    }
    const inputFile = fileName ? new InputFile(voice, fileName) : new InputFile(voice);
    const msg = await this.bot.api.sendVoice(target.chatId, inputFile, extra);
    return msg.message_id;
  }

  async getFile(fileId: string) {
    return this.bot.api.getFile(fileId);
  }

  async downloadFile(fileId: string): Promise<TelegramDownloadedFile> {
    const file = await this.getFile(fileId);
    if (!file.file_path) {
      throw new Error(`Telegram 文件缺少 file_path: ${fileId}`);
    }

    // 按 Bot API 规则拼接下载地址
    const url = this.buildFileDownloadUrl(file.file_path);
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`下载 Telegram 文件失败: ${response.status} ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return {
      fileId,
      filePath: file.file_path,
      buffer: Buffer.from(arrayBuffer),
    };
  }

  buildFileDownloadUrl(filePath: string): string {
    return `https://api.telegram.org/file/bot${this.config.token}/${filePath}`;
  }

}
