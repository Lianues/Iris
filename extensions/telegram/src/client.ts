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
import { splitText } from './base';
import { createLogger } from './logger';
import { TELEGRAM_BOT_COMMANDS } from './commands';
import {
  TELEGRAM_MESSAGE_MAX_LENGTH,
  TelegramConfig,
  TelegramSessionTarget,
} from './types';

const logger = createLogger('TelegramClient');

export interface TelegramSendTextOptions {
  parseMode?: 'HTML';
}

export interface TelegramEditTextOptions {
  parseMode?: 'HTML';
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
    const extra: Record<string, unknown> = {};
    if (target.threadId != null) {
      extra.message_thread_id = target.threadId;
    }
    const msg = await this.bot.api.sendMessage(target.chatId, text, extra);
    return msg.message_id;
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
    const chunks = splitText(text, TELEGRAM_MESSAGE_MAX_LENGTH);
    for (const chunk of chunks) {
      const extra: Record<string, unknown> = {};
      if (target.threadId != null) {
        extra.message_thread_id = target.threadId;
      }
      if (options.parseMode) {
        extra.parse_mode = options.parseMode;
      }
      await this.bot.api.sendMessage(target.chatId, chunk, extra);
    }
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
