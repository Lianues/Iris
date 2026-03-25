/**
 * Telegram 平台适配器
 *
 * Phase 2 升级：
 *   - 真流式输出：通过 sendMessage + editMessageText 实现实时更新；
 *   - 工具状态展示：监听 tool:update 事件，自动批准并格式化状态行；
 *   - 完整 Slash 命令：/new /clear /model /session /stop /flush /help；
 *   - 并发控制：ChatState + busy 锁 + pendingMessages 缓冲。
 */

import { PlatformAdapter } from '../base';
import { Backend } from '../../core/backend';
import type { ImageInput, DocumentInput } from '../../core/backend';
import { createLogger } from '../../logger';
import { PairingGuard, PairingStore } from '../pairing';
import { dataDir } from '../../paths';
import { TelegramClient } from './client';
import { TelegramCommandRouter } from './commands';
import { TelegramMediaService } from './media';
import { TelegramMessageBuilder, formatTelegramToolLine } from './message-builder';
import { TelegramMessageHandler } from './message-handler';
import {
  ParsedTelegramMessage,
  TelegramConfig,
  TelegramPendingMessage,
  TelegramSessionTarget,
  buildTelegramSessionTarget,
} from './types';
import type { ToolAttachment } from '../../types';

const logger = createLogger('Telegram');

/** 流式编辑节流间隔（ms）。Telegram 对 editMessageText 有频率限制，1500ms 较安全。 */
const STREAM_THROTTLE_MS = 1500;

const UNSUPPORTED_MEDIA_NOTICE = '当前阶段暂不支持直接处理图片、文件或语音消息，请附带文字说明后再次发送。';
const BUFFERED_NOTICE = '📥 消息已暂存，等 AI 回复结束后自动发送。\n发送 /flush 可立即处理，/stop 可中止当前回复。';

// ---- Phase 7：健壮性常量 ----

/** 消息去重缓存最大容量 */
const MESSAGE_DEDUP_MAX_SIZE = 500;
/** 消息过期阈值（ms）。丢弃 date 超过此值的 update，避免 bot 重启后处理旧消息。 */
const MESSAGE_EXPIRE_MS = 30_000;
/** 去重缓存清理间隔（ms） */
const DEDUP_CLEANUP_INTERVAL_MS = 60_000;

// ---- 流式状态（内嵌在 ChatState 中） ----

interface TelegramStreamState {
  /** 占位消息的 message_id，用于后续 editMessageText */
  placeholderMessageId: number;
  /** 累积的 AI 文本 buffer */
  buffer: string;
  /** 已固化到 buffer 中的工具调用 ID */
  committedToolIds: Set<string>;
  /** buffer 是否有未发送的更新 */
  dirty: boolean;
  /** 节流定时器 */
  throttleTimer: ReturnType<typeof setTimeout> | null;
}

interface TelegramChatState {
  busy: boolean;
  sessionId: string;
  target: TelegramSessionTarget;
  pendingMessages: TelegramPendingMessage[];
  stopped: boolean;
  lastInboundMessageId?: number;
  /**
   * bot 消息 ID 栈（LIFO）。
   * 每次 bot 发消息时 push，每次 undo 时 pop。
   * 支持连续 undo 逐条编辑/删除对应的 bot 消息。
   */
  botMessageIdStack: number[];
  /** 流式输出状态，非流式模式时为 null */
  stream: TelegramStreamState | null;
}

export class TelegramPlatform extends PlatformAdapter {
  private readonly client: TelegramClient;
  private readonly messageHandler: TelegramMessageHandler;
  private readonly messageBuilder: TelegramMessageBuilder;
  private readonly commandRouter: TelegramCommandRouter;
  private readonly mediaService: TelegramMediaService;
  private readonly showToolStatus: boolean;
  private readonly pairingStore: PairingStore | null;
  private readonly pairingGuard: PairingGuard | null;

  private readonly chatStates = new Map<string, TelegramChatState>();
  /** chatKey → sessionId 映射，/new 时更新 */
  private readonly activeSessions = new Map<string, string>();
  /** Phase 7：消息去重集合（update_id 或 message_id）。避免重复处理同一条消息。 */
  private readonly messageDedup = new Set<number>();
  /** Phase 7：去重集合上次清理时间 */
  private lastDedupCleanup = Date.now();

  constructor(private readonly backend: Backend, private readonly config: TelegramConfig) {
    super();
    this.client = new TelegramClient(config);
    this.messageHandler = new TelegramMessageHandler(config);
    this.messageBuilder = new TelegramMessageBuilder();
    this.commandRouter = new TelegramCommandRouter();
    this.mediaService = new TelegramMediaService();
    this.showToolStatus = config.showToolStatus !== false;

    // 对码门禁初始化（仅在配置了 pairing 且 dmPolicy !== 'open' 时创建）
    if (config.pairing && config.pairing.dmPolicy !== 'open') {
      this.pairingStore = new PairingStore();
      this.pairingGuard = new PairingGuard('telegram', config.pairing, this.pairingStore);
    } else {
      this.pairingStore = null;
      this.pairingGuard = null;
    }
  }

  async start(): Promise<void> {
    this.setupBackendListeners();
    this.client.onMessage((ctx) => this.handleMessage(ctx));
    this.client.onCallbackQuery((ctx) => this.handleCallbackQuery(ctx));
    await this.client.start();
    logger.info('Telegram 平台已启动');

    // 启动对码输出
    if (this.pairingGuard && this.pairingStore?.needsBootstrap()) {
      const code = this.pairingStore.getOrCreateBootstrapCode();
      logger.info('');
      logger.info('╔════════════════════════════════════════════════════════╗');
      logger.info('║  首次使用，请在 Telegram 发送以下对码完成管理员绑定：    ║');
      logger.info(`║  对码：${code}                                          ║`);
      logger.info('║  第一个完成对码的用户将成为管理员。                      ║');
      logger.info('╚════════════════════════════════════════════════════════╝');
      logger.info('');
    }
  }

  async stop(): Promise<void> {
    // 清理所有节流定时器
    for (const cs of this.chatStates.values()) {
      if (cs.stream?.throttleTimer) clearTimeout(cs.stream.throttleTimer);
    }
    this.chatStates.clear();
    this.messageDedup.clear();
    await this.client.stop();
    logger.info('Telegram 平台已停止');
  }

  // ---- Session 管理 ----

  private getSessionId(chatKey: string): string {
    let sid = this.activeSessions.get(chatKey);
    if (!sid) {
      sid = `telegram-${chatKey.replace(/:/g, '-')}-${Date.now()}`;
      this.activeSessions.set(chatKey, sid);
    }
    return sid;
  }

  // ---- ChatState 管理 ----

  private getChatState(target: TelegramSessionTarget): TelegramChatState {
    let cs = this.chatStates.get(target.chatKey);
    if (!cs) {
      cs = {
        busy: false,
        sessionId: this.getSessionId(target.chatKey),
        target,
        pendingMessages: [],
        stopped: false,
        botMessageIdStack: [],
        stream: null,
      };
      this.chatStates.set(target.chatKey, cs);
    }
    cs.sessionId = this.getSessionId(target.chatKey);
    cs.target = target;
    return cs;
  }

  private findChatStateBySid(sid: string): TelegramChatState | undefined {
    for (const cs of this.chatStates.values()) {
      if (cs.sessionId === sid) return cs;
    }
    return undefined;
  }

  // ---- Backend 事件监听 ----

  private setupBackendListeners(): void {
    // ---- 工具状态 ----
    this.backend.on('tool:update', (sid: string, invocations: Array<{
      id: string; toolName: string; status: string; args: Record<string, unknown>; createdAt: number;
    }>) => {
      // 自动批准所有等待审批的工具
      for (const inv of invocations) {
        if (inv.status === 'awaiting_approval') {
          try { this.backend.approveTool(inv.id, true); } catch { /* 忽略 */ }
        }
      }

      if (!this.showToolStatus) return;
      const cs = this.findChatStateBySid(sid);
      if (!cs?.stream || cs.stopped) return;

      const sorted = [...invocations].sort((a, b) => a.createdAt - b.createdAt);

      // 将已完成的工具固化到 buffer
      for (const inv of sorted) {
        const isDone = inv.status === 'success' || inv.status === 'error';
        if (isDone && !cs.stream.committedToolIds.has(inv.id)) {
          cs.stream.committedToolIds.add(inv.id);
          const line = formatTelegramToolLine(inv);
          cs.stream.buffer = cs.stream.buffer
            ? `${cs.stream.buffer}\n\n${line}\n\n`
            : `${line}\n\n`;
        }
      }

      // 仍在执行中的工具临时追加
      const activeLines = sorted
        .filter((inv) => !cs.stream!.committedToolIds.has(inv.id))
        .map((inv) => formatTelegramToolLine(inv))
        .join('\n\n');

      const displayText = activeLines
        ? (cs.stream.buffer ? `${cs.stream.buffer}\n\n${activeLines}` : activeLines)
        : cs.stream.buffer;

      if (!displayText) return;
      this.editStreamMessage(cs, displayText);
    });

    // ---- 工具附件（图片等） ----
    this.backend.on('attachments', (sid: string, attachments: ToolAttachment[]) => {
      const cs = this.findChatStateBySid(sid);
      // 调试日志：确认 attachments 事件是否到达 Telegram 平台层
      logger.info(`[attachments] 收到附件事件: sid=${sid}, count=${attachments.length}, cs=${!!cs}, stopped=${cs?.stopped}`);
      if (!cs || cs.stopped || attachments.length === 0) {
        logger.info(`[attachments] 跳过: cs=${!!cs}, stopped=${cs?.stopped}, count=${attachments.length}`);
        return;
      }

      // 附件是平台级能力，不进入 LLM 上下文。
      // 这里直接把图片发给用户，文本摘要仍会通过后续 response 事件送出。
      void (async () => {
        for (const att of attachments) {
          if (att.type !== 'image') continue;
          try {
            logger.info(`[attachments] 正在发送图片到 Telegram: chatId=${cs.target.chatId}, dataSize=${att.data.length}`);
            await this.client.sendPhoto(cs.target, att.data, att.caption);
          } catch (err) {
            logger.error('发送图片失败:', err);
          }
        }
      })();
    });

    // ---- 流式输出 ----
    this.backend.on('stream:start', (sid: string) => {
      const cs = this.findChatStateBySid(sid);
      if (!cs || cs.stopped) return;
      // stream 已在 dispatchChat 中创建，此处仅处理边界情况
      if (!cs.stream && cs.target) {
        this.initStream(cs);
      }
    });

    this.backend.on('stream:chunk', (sid: string, chunk: string) => {
      const cs = this.findChatStateBySid(sid);
      if (!cs?.stream || cs.stopped) return;

      cs.stream.buffer += chunk;
      cs.stream.dirty = true;

      // 节流发送
      if (!cs.stream.throttleTimer) {
        cs.stream.throttleTimer = setTimeout(() => {
          if (!cs.stream) return;
          cs.stream.throttleTimer = null;
          if (!cs.stream.dirty) return;
          cs.stream.dirty = false;
          this.editStreamMessage(cs, cs.stream.buffer);
        }, STREAM_THROTTLE_MS);
      }
    });

    // ---- 非流式回复 ----
    this.backend.on('response', (sid: string, text: string) => {
      const cs = this.findChatStateBySid(sid);
      if (!cs || cs.stopped) return;

      if (cs.stream) {
        this.finalizeStream(cs, text);
      } else {
        void this.sendToChat(cs, this.messageBuilder.buildResponseText(text));
      }
    });

    // ---- 错误 ----
    this.backend.on('error', (sid: string, errorMsg: string) => {
      const cs = this.findChatStateBySid(sid);
      if (!cs) return;
      const errorText = this.messageBuilder.buildErrorText(errorMsg);
      if (cs.stream) {
        this.finalizeStream(cs, errorText);
      } else {
        void this.sendToChat(cs, errorText);
      }
    });

    // ---- 回合完成 ----
    this.backend.on('done', (sid: string) => {
      const cs = this.findChatStateBySid(sid);
      if (!cs) return;

      // 兜底关闭流
      if (cs.stream) {
        if (!cs.stopped) {
          const finalText = cs.stream.buffer || '✅ 处理完成。';
          this.finalizeStream(cs, finalText);
        }
        this.cleanupStream(cs);
      }

      cs.busy = false;
      cs.stopped = false;

      if (cs.pendingMessages.length > 0) {
        this.flushPendingMessages(cs);
      }
    });
  }

  // ---- 流式辅助方法 ----

  /** 初始化流式状态并发送占位消息 */
  private async initStream(cs: TelegramChatState): Promise<void> {
    try {
      const messageId = await this.client.sendMessageReturningId(
        cs.target,
        this.messageBuilder.buildThinkingText(),
      );
      // 将 bot 消息 ID 压入栈，支持后续 undo 时的 UI 处理
      cs.botMessageIdStack.push(messageId);
      cs.stream = {
        placeholderMessageId: messageId,
        buffer: '',
        committedToolIds: new Set(),
        dirty: false,
        throttleTimer: null,
      };
    } catch (err) {
      // Phase 7：占位消息发送失败时降级，不初始化流式状态。
      // 后续 stream:chunk / response 事件会走非流式路径。
      logger.warn('发送占位消息失败，降级为非流式模式:', err);
    }
  }

  /** 编辑流式消息（吞掉错误避免中断流程） */
  private editStreamMessage(cs: TelegramChatState, text: string): void {
    if (!cs.stream) return;
    this.client.editText(cs.target, cs.stream.placeholderMessageId, text).catch((err) => {
      logger.error(`流式编辑失败:`, err);
    });
  }

  /** 最终更新流式消息并清理定时器 */
  private finalizeStream(cs: TelegramChatState, text: string): void {
    if (!cs.stream) return;
    if (cs.stream.throttleTimer) {
      clearTimeout(cs.stream.throttleTimer);
      cs.stream.throttleTimer = null;
    }
    this.client.editText(cs.target, cs.stream.placeholderMessageId, text).catch((err) => {
      logger.error('流式关闭失败:', err);
    });
  }

  /** 清理流式状态 */
  private cleanupStream(cs: TelegramChatState): void {
    if (cs.stream?.throttleTimer) {
      clearTimeout(cs.stream.throttleTimer);
    }
    cs.stream = null;
  }

  // ---- 发送消息 ----

  /**
   * 向聊天室发送消息。
   * @param cs 聊天状态
   * @param text 消息内容
   * @param options 发送选项。trackMessage 为 false 时，该消息不会进入 botMessageIdStack，不参与 undo 时的 UI 撤销逻辑。
   */
  private async sendToChat(cs: TelegramChatState, text: string, options?: { trackMessage?: boolean }): Promise<void> {
    const msgId = await this.client.sendMessageReturningId(cs.target, text);
    // 默认追踪 bot 消息 ID，用于 undo 时逐条编辑/删除
    if (options?.trackMessage !== false) {
      cs.botMessageIdStack.push(msgId);
    }
  }

  /**
   * undo 时处理 bot 消息的 UI 标记（编辑为"已撤销"或删除）。
   * 采用栈结构支持连续撤销：从栈顶弹出一个消息 ID 进行处理。
   */
  private async markBotMessageAsUndone(cs: TelegramChatState): Promise<void> {
    const messageId = cs.botMessageIdStack.pop();
    if (messageId != null) {
      try {
        await this.client.editText(cs.target, messageId, '~~已撤销~~');
      } catch (e) {
        logger.warn(`Telegram 消息编辑为已撤销失败 (${messageId})，尝试删除:`, e);
        try {
          await this.client.deleteMessage(cs.target, messageId);
        } catch (err) {
          logger.warn(`Telegram deleteMessage 也失败了:`, err);
        }
      }
    } else {
      // 栈为空，没有可操作的 bot 消息（例如已被撤销完，或者是非 LLM 回复的消息）
      // 发送提示但不追踪到栈中，避免干扰正常的回复追踪
      await this.sendToChat(cs, '✅ 上一轮对话已撤销。', { trackMessage: false });
    }
  }

  /**
   * redo 后在 Telegram 侧补发可见 assistant 文本。
   * Backend 恢复的是原始历史；平台层只负责把最终可见文本重新展示出来。
   */
  private async replayRedoResult(cs: TelegramChatState, assistantText: string): Promise<void> {
    if (assistantText.trim()) {
      await this.sendToChat(cs, assistantText);
      return;
    }
    await this.sendToChat(cs, '✅ 上一轮对话已恢复。');
  }


  // ---- 入站消息处理 ----

  private async handleMessage(ctx: any): Promise<void> {
    try {
      const parsed = this.messageHandler.parseIncomingText(ctx);
      if (!parsed) return;

      // ---- Phase 7：消息去重 ----
      // 目的：避免 bot 重启或网络抖动导致重复处理同一条消息。
      if (this.messageDedup.has(parsed.messageId)) {
        logger.debug(`跳过重复消息: message_id=${parsed.messageId}`);
        return;
      }
      this.messageDedup.add(parsed.messageId);
      this.cleanupDedupIfNeeded();

      // ---- Phase 7：消息过期检测 ----
      // Telegram 消息的 date 是秒级 Unix 时间戳，ctx.message.date。
      const messageDate = typeof ctx.message?.date === 'number' ? ctx.message.date * 1000 : 0;
      if (messageDate > 0) {
        const age = Date.now() - messageDate;
        if (age > MESSAGE_EXPIRE_MS) {
          logger.debug(`跳过过期消息: message_id=${parsed.messageId} (age=${Math.round(age / 1000)}s)`);
          return;
        }
      }

      // 群聊中检查 mention（如果配置要求）
      if (parsed.session.scope === 'group' && this.config.groupMentionRequired !== false && !parsed.mentioned) {
        return;
      }

      // ---- 对码门禁 ----
      // 目的：在消息进入 Backend 之前，检查用户是否有权使用 Bot。
      // 仅对私聊生效；群聊在上方 mention 检查中已处理。
      // 对码系统与 Backend 完全无关，纯平台层访问控制。
      if (this.pairingGuard && parsed.session.scope === 'dm') {
        const senderId = String(ctx.from?.id ?? '');
        const senderName = ctx.from?.username || ctx.from?.first_name || '';
        const result = this.pairingGuard.check(senderId, parsed.text, senderName);
        if (!result.allowed) {
          if (result.replyText) {
            await this.client.sendText(parsed.session, result.replyText);
          }
          return;
        }
        // 对码成功消息也需要回复但不进入 Backend
        if (result.reason === 'bootstrap-success' || result.reason === 'pairing-success') {
          if (result.replyText) {
            await this.client.sendText(parsed.session, result.replyText);
          }
          return;
        }
      }

      const cs = this.getChatState(parsed.session);
      cs.lastInboundMessageId = parsed.messageId;

      // 命令处理（任何时候都能用，不受 busy 影响）
      if (parsed.text.startsWith('/')) {
        const handled = await this.handleCommand(parsed.text, cs);
        if (handled) return;
      }

      // 如果当前正忙，暂存消息
      if (cs.busy) {
        cs.pendingMessages.push({
          session: parsed.session,
          text: parsed.text,
          hasUnsupportedMedia: hasTelegramUnsupportedMedia(parsed) && !this.mediaService.supportsInboundMedia(),
        });
        await this.sendToChat(cs, BUFFERED_NOTICE);
        return;
      }

      await this.dispatchChat(cs, parsed);
    } catch (err) {
      logger.error('处理消息时出错:', err);
    }
  }

  /**
   * 处理 inline keyboard 按钮点击。
   * callback_data 格式：`命令:参数`，例如 `model:gpt-4`、`session:3`、`skill:code-review`、`mode:code`。
   */
  private async handleCallbackQuery(ctx: any): Promise<void> {
    try {
      const data = ctx.callbackQuery?.data as string | undefined;
      const chat = ctx.callbackQuery?.message?.chat;
      const messageId = ctx.callbackQuery?.message?.message_id;
      const callbackQueryId = ctx.callbackQuery?.id;
      const threadId = ctx.callbackQuery?.message?.message_thread_id;

      if (!data || !chat || !messageId || !callbackQueryId) return;

      const target = buildTelegramSessionTarget({
        chatId: chat.id,
        isPrivate: chat.type === 'private',
        threadId: typeof threadId === 'number' ? threadId : undefined,
      });

      const colonIdx = data.indexOf(':');
      if (colonIdx < 0) return;
      const command = data.substring(0, colonIdx);
      const arg = data.substring(colonIdx + 1);

      let resultText = '';

      switch (command) {
        case 'model': {
          try {
            const result = this.backend.switchModel(arg);
            resultText = `✅ 模型已切换为 ${result.modelName} → ${result.modelId}`;
          } catch {
            resultText = `❌ 未找到模型 "${arg}"。`;
          }
          break;
        }

        case 'session': {
          const index = parseInt(arg, 10);
          const metas = await this.backend.listSessionMetas();
          if (isNaN(index) || index < 1 || index > metas.length) {
            resultText = `❌ 会话编号无效。`;
          } else {
            const meta = metas[index - 1];
            this.activeSessions.set(target.chatKey, meta.id);
            resultText = `✅ 已切换到会话：${meta.title || '(无标题)'}`;
          }
          break;
        }

        case 'mode': {
          const ok = this.backend.switchMode(arg);
          resultText = ok ? `✅ 已切换到 Mode "${arg}"。` : `❌ 未找到 Mode "${arg}"。`;
          break;
        }

        default:
          resultText = `❌ 未知操作: ${command}`;
      }

      // 编辑原消息为结果文本（去掉 inline keyboard）
      await this.client.editText(target, messageId, resultText);
      // 回答 callback query
      await this.client.answerCallbackQuery(callbackQueryId);
    } catch (err) {
      logger.error('处理 callback query 时出错:', err);
    }
  }

  // ---- Slash 命令 ----

  private async handleCommand(text: string, cs: TelegramChatState): Promise<boolean> {
    const cmd = this.commandRouter.parse(text);
    if (!cmd) return false;

    const reply = (content: string) => this.sendToChat(cs, content);

    switch (cmd.name) {
      case 'new': {
        const newSid = `telegram-${cs.target.chatKey.replace(/:/g, '-')}-${Date.now()}`;
        this.activeSessions.set(cs.target.chatKey, newSid);
        await reply('✅ 已新建对话，上下文已清空。');
        return true;
      }

      case 'clear': {
        await this.backend.clearSession(cs.sessionId);
        await reply('✅ 当前对话历史已清空。');
        return true;
      }

      case 'model':
      case 'models': {
        if (cmd.args) {
          try {
            const result = this.backend.switchModel(cmd.args);
            await reply(`✅ 模型已切换为 ${result.modelName} → ${result.modelId}`);
          } catch {
            await reply(`❌ 未找到模型 "${cmd.args}"。发送 /model 查看可用列表。`);
          }
        } else {
          const models = this.backend.listModels();
          // 构建 inline keyboard：每个模型一个按钮，每行一个
          const keyboard = models.map(m => [{
            text: `${m.current ? '👉 ' : ''}${m.modelName}`,
            callback_data: `model:${m.modelName}`,
          }]);
          const currentModel = models.find(m => m.current);
          await this.client.sendMessageWithKeyboard(
            cs.target,
            `🤖 当前模型：${currentModel?.modelName ?? '未知'}\n选择要切换的模型：`,
            keyboard,
          );
        }
        return true;
      }

      case 'session':
      case 'sessions': {
        if (cmd.args) {
          const index = parseInt(cmd.args, 10);
          if (isNaN(index) || index < 1) {
            await reply('❌ 请输入有效的会话编号，例如 /session 3');
            return true;
          }
          const metas = await this.backend.listSessionMetas();
          if (index > metas.length) {
            await reply(`❌ 编号 ${index} 超出范围（共 ${metas.length} 条会话）`);
            return true;
          }
          const target = metas[index - 1];
          this.activeSessions.set(cs.target.chatKey, target.id);
          await reply(`✅ 已切换到会话：${target.title || '(无标题)'}`);
        } else {
          const metas = await this.backend.listSessionMetas();
          if (metas.length === 0) {
            await reply('📭 暂无历史会话。');
            return true;
          }
          const display = metas.slice(0, 20);
          // 构建 inline keyboard：每个会话一个按钮
          const keyboard = display.map((m, i) => [{
            text: `${m.id === cs.sessionId ? '👉 ' : ''}${m.title || '(无标题)'}`,
            callback_data: `session:${i + 1}`,
          }]);
          await this.client.sendMessageWithKeyboard(
            cs.target,
            '📋 选择要切换的会话：',
            keyboard,
          );
        }
        return true;
      }

      case 'stop': {
        if (!cs.busy) {
          await reply('ℹ️ 当前没有正在进行的回复。');
          return true;
        }
        cs.stopped = true;
        this.backend.abortChat(cs.sessionId);
        if (cs.stream) {
          const stopText = this.messageBuilder.buildAbortedText(cs.stream.buffer);
          this.finalizeStream(cs, stopText);
          this.cleanupStream(cs);
        }
        return true;
      }

      case 'flush': {
        if (!cs.busy && cs.pendingMessages.length === 0) {
          await reply('ℹ️ 当前没有正在进行的回复或缓冲中的消息。');
          return true;
        }
        if (cs.busy) {
          cs.stopped = true;
          this.backend.abortChat(cs.sessionId);
          if (cs.stream) {
            const stopText = this.messageBuilder.buildAbortedText(cs.stream.buffer);
            this.finalizeStream(cs, stopText);
            this.cleanupStream(cs);
          }
          // 等 done 事件自然释放 busy 并触发 flushPendingMessages
        } else {
          this.flushPendingMessages(cs);
        }
        return true;
      }

      case 'undo': {
        if (cs.busy) {
          await reply('ℹ️ 当前正在回复中，请先 /stop。');
          return true;
        }
        // undo 由 Backend 统一处理，平台层只负责 UI。
        const undoResult = await this.backend.undo(cs.sessionId, 'last-turn');
        if (!undoResult) {
          await reply('ℹ️ 没有可以撤销的对话。');
          return true;
        }

        // 平台 UI 操作：标记/删除 bot 消息
        await this.markBotMessageAsUndone(cs);
        return true;
      }

      case 'redo': {
        if (cs.busy) {
          await reply('ℹ️ 当前正在回复中，请先 /stop。');
          return true;
        }
        const redoResult = await this.backend.redo(cs.sessionId);
        if (!redoResult) {
          await reply('ℹ️ 没有可以恢复的对话。');
          return true;
        }

        // 平台 UI 只回放最终可见文本，不重新调 LLM。
        await this.replayRedoResult(cs, redoResult.assistantText);
        return true;
      }

      case 'skill':
      case 'skills': {
        const skills = this.backend.listSkills();
        if (skills.length === 0) {
          await reply('ℹ️ 未配置任何 Skill。请在 system.yaml 中添加。');
          return true;
        }

        if (cmd.args) {
          const skill = skills.find((item) => item.name === cmd.args);
          if (!skill) {
            await reply(`❌ 未找到 Skill "${cmd.args}"。发送 /skill 查看可用列表。`);
          } else {
            await reply([
              `🧩 Skill：${skill.name}`,
              skill.description ? `说明：${skill.description}` : undefined,
              `路径：${skill.path}`,
              '提示：在当前架构下，Skill 通过 read_skill 工具按需读取，不再支持在 Telegram 中切换启用状态。',
            ].filter(Boolean).join('\n'));
          }
        } else {
          await reply([
            '🧩 已配置的 Skill：',
            ...skills.map((skill) => [
              `- ${skill.name}`,
              skill.description ? `  说明：${skill.description}` : undefined,
              `  路径：${skill.path}`,
            ].filter(Boolean).join('\n')),
            '',
            '提示：发送 /skill <name> 可查看单个 Skill 的路径详情。Skill 内容会由模型通过 read_skill 工具按需读取。',
          ].join('\n'));
        }
        return true;
      }

      case 'mode':
      case 'modes': {
        const modes = this.backend.listModes();
        if (modes.length === 0) {
          await reply('ℹ️ 未配置任何 Mode。请在 modes.yaml 中添加。');
          return true;
        }
        if (cmd.args) {
          const ok = this.backend.switchMode(cmd.args);
          if (!ok) {
            await reply(`❌ 未找到 Mode "${cmd.args}"。发送 /mode 查看可用列表。`);
          } else {
            await reply(`✅ 已切换到 Mode "${cmd.args}"。`);
          }
        } else {
          const keyboard = modes.map(m => [{
            text: `${m.current ? '👉 ' : ''}${m.name}${m.description ? ` — ${m.description}` : ''}`,
            callback_data: `mode:${m.name}`,
          }]);
          await this.client.sendMessageWithKeyboard(
            cs.target,
            '🎭 选择要切换的 Mode：',
            keyboard,
          );
        }
        return true;
      }

      case 'invite': {
        const userId = String(cs.target.chatId);
        if (!this.pairingGuard?.isAdmin(userId)) {
          await reply('❌ 仅管理员可使用此命令。');
          return true;
        }
        const code = this.pairingGuard.generateInviteCode();
        await reply(`🎫 对码已生成：\`${code}\`（1 小时内有效）`);
        return true;
      }

      case 'users': {
        const userId = String(cs.target.chatId);
        if (!this.pairingGuard?.isAdmin(userId)) {
          await reply('❌ 仅管理员可使用此命令。');
          return true;
        }
        const users = this.pairingGuard.listUsers();
        if (users.length === 0) {
          await reply('ℹ️ 当前白名单为空。');
        } else {
          const list = users.map(u => `- ${u.userName || '未知'}(${u.platform}:${u.userId}) 于 ${new Date(u.pairedAt).toLocaleString()} 加入`).join('\n');
          await reply(`👥 白名单用户：\n${list}`);
        }
        return true;
      }

      case 'kick': {
        const userId = String(cs.target.chatId);
        if (!this.pairingGuard?.isAdmin(userId)) {
          await reply('❌ 仅管理员可使用此命令。');
          return true;
        }
        if (!cmd.args) {
          await reply('❌ 请提供要移除的用户 ID。格式：/kick <userId>');
          return true;
        }
        const ok = this.pairingGuard.removeUser('telegram', cmd.args);
        await reply(ok ? `✅ 用户 ${cmd.args} 已从白名单移除。` : `❌ 未找到用户 ${cmd.args}。`);
        return true;
      }

      case 'transfer': {
        const userId = String(cs.target.chatId);
        if (!this.pairingGuard?.isAdmin(userId)) {
          await reply('❌ 仅管理员可使用此命令。');
          return true;
        }
        if (!cmd.args) {
          await reply('❌ 请提供新的管理员 ID。格式：/transfer <userId>');
          return true;
        }
        this.pairingGuard.transferAdmin('telegram', cmd.args);
        await reply(`✅ 管理员身份已让渡给用户 ${cmd.args}。`);
        return true;
      }

      case 'help': {
        await reply(this.commandRouter.buildHelpText());
        return true;
      }

      default:
        return false;
    }
  }

  // ---- 消息分发 ----

  private async dispatchChat(cs: TelegramChatState, message: ParsedTelegramMessage): Promise<void> {
    const hasUnsupportedMedia = hasTelegramUnsupportedMedia(message) && !this.mediaService.supportsInboundMedia();
    // Phase 3：如果 mediaService 支持入站多媒体，就不再判定为 unsupported。
    // 如果不支持，且只有媒体没有文本，则提示用户。
    if (!message.text && hasUnsupportedMedia) {
      await this.sendToChat(cs, UNSUPPORTED_MEDIA_NOTICE);
      return;
    }

    cs.busy = true;
    cs.stopped = false;
    cs.sessionId = this.getSessionId(cs.target.chatKey);
    cs.target = message.session;

    // 流式模式先发占位消息
    if (this.backend.isStreamEnabled()) {
      await this.initStream(cs);
    }

    // Phase 3：下载入站消息中的多媒体资源
    let images: ImageInput[] | undefined;
    let documents: DocumentInput[] | undefined;

    if (this.mediaService.supportsInboundMedia()) {
      if (message.photo) {
        const img = await this.mediaService.downloadPhoto(this.client, message.photo);
        if (img) images = [img];
      }
      if (message.document) {
        const doc = await this.mediaService.downloadDocument(this.client, message.document);
        if (doc) documents = [doc];
      }
      if (message.voice || message.audio) {
        const voice = await this.mediaService.downloadVoice(this.client, (message.voice || message.audio)!);
        if (voice) documents = [...(documents || []), voice];
      }
    }

    try {
      await this.backend.chat(cs.sessionId, message.text, images, documents, 'telegram');
    } catch (err) {
      logger.error(`backend.chat 失败 (session=${cs.sessionId}):`, err);
    }
  }

  private flushPendingMessages(cs: TelegramChatState): void {
    const messages = cs.pendingMessages.splice(0);
    if (messages.length === 0) return;

    const combinedText = messages.map((m) => m.text).filter(Boolean).join('\n').trim();
    const latest = messages[messages.length - 1];

    logger.info(`[${cs.sessionId}] 合并 ${messages.length} 条缓冲消息发送`);

    void this.dispatchChat(cs, {
      session: latest.session,
      text: combinedText,
      messageId: cs.lastInboundMessageId ?? 0,
      mentioned: false,
      mediaGroupId: undefined,
    } as ParsedTelegramMessage);
  }

  // ---- Phase 7：去重清理 ----

  /**
   * 定期清理去重集合，避免内存无限增长。
   * 策略：当集合超过阈值时，清空整个集合。
   */
  private cleanupDedupIfNeeded(): void {
    const now = Date.now();
    if (this.messageDedup.size > MESSAGE_DEDUP_MAX_SIZE || now - this.lastDedupCleanup > DEDUP_CLEANUP_INTERVAL_MS) {
      this.messageDedup.clear();
      this.lastDedupCleanup = now;
    }
  }
}

function hasTelegramUnsupportedMedia(message: ParsedTelegramMessage): boolean {
  return Boolean(message.photo || message.document || message.voice || message.audio);
}
