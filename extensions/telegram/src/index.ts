/**
 * Telegram 平台适配器
 *
 * 输出策略：
 *   - 私聊 rich 模式使用 Telegram 官方 sendRichMessageDraft 预览，完成后 sendRichMessage 持久化；
 *   - 群聊 auto 模式保留 legacy editMessageText 预览，最终可编辑为 Rich Message；
 *   - Backend 历史保持平台无关，Telegram rich / trace 只存在于平台渲染层。
 */

import { PairingGuard, PairingStore } from 'irises-extension-sdk/pairing';
import {
  DELIVERY_REGISTRY_SERVICE_ID,
  PlatformAdapter,
  autoApproveHandle,
  createExtensionLogger,
  definePlatformFactory,
  type DeliveryRegistryService,
  type DeliveryTarget,
  type Disposable,
  type DocumentInput,
  type ImageInput,
  type IrisAPI,
  type IrisBackendLike,
  type Content,
  type Part,
  type PlatformDeliveryProvider,
  type ToolAttachment,
  type ToolExecutionHandleLike,
} from 'irises-extension-sdk';
import { TelegramClient } from './client';
import { TelegramCommandRouter } from './commands';
import { TelegramMediaService } from './media';
import { TelegramMessageBuilder, formatTelegramToolLine } from './message-builder';
import { TelegramMessageHandler } from './message-handler';
import { renderTelegramDraftTurn, renderTelegramRichTurn, type TelegramTraceSection } from './rich-message';
import { TelegramTurnTraceCollector } from './turn-trace';
import {
  ParsedTelegramMessage,
  TelegramConfig,
  TelegramOutputFormat,
  TelegramPendingMessage,
  TelegramSessionTarget,
  TelegramStreamMode,
  buildTelegramSessionTarget,
  parseTelegramSessionTarget,
} from './types';

const logger = createExtensionLogger('TelegramExtension', 'Telegram');

/** 流式编辑节流间隔（ms）。Telegram 对 editMessageText 有频率限制，1500ms 较安全。 */
const STREAM_THROTTLE_MS = 1500;
/** Telegram typing 状态最多维持 5 秒，4 秒刷新一次可避免长回合中断。 */
const TYPING_REFRESH_MS = 4_000;

const UNSUPPORTED_MEDIA_NOTICE = '当前阶段暂不支持直接处理图片、文件或语音消息，请附带文字说明后再次发送。';
const BUFFERED_NOTICE = '📥 消息已暂存，等 AI 回复结束后自动发送。\n发送 /flush 可立即处理，/stop 可中止当前回复。';
const BUSY_COMMAND_NOTICE = 'ℹ️ 当前正在回复中，请先 /stop。';

// ---- Phase 7：健壮性常量 ----

/** 消息去重缓存最大容量 */
const MESSAGE_DEDUP_MAX_SIZE = 500;
/** 消息过期阈值（ms）。丢弃 date 超过此值的 update，避免 bot 重启后处理旧消息。 */
const MESSAGE_EXPIRE_MS = 30_000;
/** 去重缓存清理间隔（ms） */
const DEDUP_CLEANUP_INTERVAL_MS = 60_000;

// ---- 流式状态（内嵌在 ChatState 中） ----

type TelegramStreamKind = 'draft' | 'edit' | 'silent';

interface TelegramStreamState {
  /** draft=官方 Rich Message draft，edit=legacy editMessageText，silent=只收集最终文本 */
  kind: TelegramStreamKind;
  /** legacy edit 模式的占位消息 message_id */
  placeholderMessageId?: number;
  /** official draft 模式的 draft_id */
  draftId?: number;
  /** 累积的 AI 文本 buffer */
  buffer: string;
  /** 已固化到 buffer 中的工具调用 ID */
  committedToolIds: Set<string>;
  /** legacy edit 模式的工具状态展示行，不写入最终正文 */
  committedToolLines: string[];
  activeToolLine?: string;
  /** buffer 是否有未发送的更新 */
  dirty: boolean;
  /** 节流定时器 */
  throttleTimer: ReturnType<typeof setTimeout> | null;
  /** 防止 response/done 双路径重复发送最终消息 */
  finalized: boolean;
}

interface TelegramBotMessageGroup {
  messageIds: number[];
}

interface TelegramFinalDeliveryOptions {
  editMessageId?: number;
}

interface TelegramChatState {
  busy: boolean;
  sessionId: string;
  target: TelegramSessionTarget;
  pendingMessages: TelegramPendingMessage[];
  stopped: boolean;
  lastInboundMessageId?: number;
  /**
   * bot 回复消息组栈（LIFO）。
   * 一个 Backend turn 未来可能对应多条 Telegram 消息，undo 时必须按组处理。
   */
  botMessageGroups: TelegramBotMessageGroup[];
  /** 当前 turn 的 Telegram 展示 trace，只用于渲染，不写入 Backend 历史。 */
  turnTrace: TelegramTurnTraceCollector | null;
  /** 流式输出状态，非流式模式时为 null */
  stream: TelegramStreamState | null;
  /** 当前 turn 的 sendChatAction('typing') 刷新定时器。 */
  typingTimer: ReturnType<typeof setInterval> | null;
}

export class TelegramPlatform extends PlatformAdapter {
  private readonly client: TelegramClient;
  private readonly messageHandler: TelegramMessageHandler;
  private readonly messageBuilder: TelegramMessageBuilder;
  private readonly commandRouter: TelegramCommandRouter;
  private readonly mediaService: TelegramMediaService;
  private readonly outputFormat: TelegramOutputFormat;
  private readonly streamMode: TelegramStreamMode;
  private readonly showToolStatus: boolean;
  private readonly pairingStore: PairingStore | null;
  private readonly pairingGuard: PairingGuard | null;
  private deliveryProviderDisposable?: Disposable;

  private readonly chatStates = new Map<string, TelegramChatState>();
  /** chatKey → sessionId 映射，/new 时更新 */
  private readonly activeSessions = new Map<string, string>();
  /** Phase 7：消息去重集合（chatKey + message_id）。避免重复处理同一条消息。 */
  private readonly messageDedup = new Set<string>();
  /** Phase 7：去重集合上次清理时间 */
  private lastDedupCleanup = Date.now();
  private backendListenersReady = false;
  private taskResultListenerReady = false;
  private clientHandlersReady = false;
  private started = false;

  constructor(private readonly backend: IrisBackendLike, private readonly config: TelegramConfig, private readonly api?: IrisAPI) {
    super();
    this.client = new TelegramClient(config);
    this.messageHandler = new TelegramMessageHandler(config);
    this.messageBuilder = new TelegramMessageBuilder();
    this.commandRouter = new TelegramCommandRouter();
    this.mediaService = new TelegramMediaService();
    this.outputFormat = parseTelegramOutputFormat(config.outputFormat);
    this.streamMode = parseTelegramStreamMode(config.streamMode);
    if (this.outputFormat === 'plain' && this.streamMode === 'draft') {
      throw new Error('telegram.streamMode=draft 需要 telegram.outputFormat=rich');
    }
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
    if (this.started) return;
    this.started = true;

    this.setupBackendListeners();
    if (!this.clientHandlersReady) {
      this.client.onMessage((ctx) => this.handleMessage(ctx));
      this.client.onCallbackQuery((ctx) => this.handleCallbackQuery(ctx));
      this.clientHandlersReady = true;
    }
    await this.client.start();
    this.registerDeliveryProvider();
    logger.info('Telegram 平台已启动');

    // ── 轻量级任务结果广播：通用的 task:result 通道 ──
    // 所有终态任务都会 emit 此事件，不绑定 silent 或任务类型。
    // 当前策略：仅 silent 任务渲染通知推送（非 silent 由 LLM 通过 stream 事件回复）。
    if (!this.taskResultListenerReady) {
      this.backend.on('task:result' as any, (
        sid: string, _taskId: string, status: string,
        description: string, _taskType?: string, silent?: boolean, result?: string,
      ) => {
        // 非 silent 任务的结果由 LLM 通过 stream 事件回复，不在此推送
        if (!silent) return;

        // 按聊天身份定向投递：只发送到创建该任务的聊天，而非广播所有聊天。
        // 使用 chatKey 前缀匹配（而非精确 sessionId），
        // 因为用户 /new 新建对话后 sessionId 的时间戳部分会变更。
        const targetCs = this.findChatStateByChatOrigin(sid);
        if (!targetCs || targetCs.stopped) {
          logger.info(`task:result 未找到匹配的聊天 (sid=${sid})，跳过`);
          return;
        }

        let text: string;
        if (status === 'completed') {
          // Telegram 限制消息长度，截断结果摘要到 1000 字符
          const preview = (result ?? '').slice(0, 1000);
          text = `⏰ ${description} 完成：\n${preview}`;
        } else if (status === 'killed') {
          text = `⏰ ${description} 被中止`;
        } else {
          text = `⏰ ${description} 失败：${result ?? '未知错误'}`;
        }

        // 定向推送到创建任务的聊天
        void this.sendToChat(targetCs, text, { trackMessage: false });
      });
      this.taskResultListenerReady = true;
      logger.info('已通过 task:result 监听任务结果（按聊天定向投递）');
    }

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
    this.deliveryProviderDisposable?.dispose();
    this.deliveryProviderDisposable = undefined;
    // 清理所有节流定时器
    for (const cs of this.chatStates.values()) {
      if (cs.stream?.throttleTimer) clearTimeout(cs.stream.throttleTimer);
      this.stopTypingIndicator(cs);
    }
    this.chatStates.clear();
    this.messageDedup.clear();
    await this.client.stop();
    this.started = false;
    logger.info('Telegram 平台已停止');
  }

  private registerDeliveryProvider(): void {
    if (this.deliveryProviderDisposable) return;
    const registry = this.api?.services.get<DeliveryRegistryService>(DELIVERY_REGISTRY_SERVICE_ID);
    if (!registry) {
      logger.warn('delivery.registry service 不可用，Telegram 主动投递能力未注册');
      return;
    }

    const provider: PlatformDeliveryProvider = {
      platform: 'telegram',
      capabilities: {
        text: true,
        image: true,
        audio: true,
        file: true,
      },
      sendText: async ({ target, text, sessionId }) => {
        const telegramTarget = this.resolveDeliveryTarget(target, sessionId);
        await this.client.sendText(telegramTarget, text);
        return {
          ok: true,
          platform: 'telegram',
          raw: { target: telegramTarget },
        };
      },
      sendAttachment: async ({ target, attachment, caption, sessionId }) => {
        const telegramTarget = this.resolveDeliveryTarget(target, sessionId);
        const fileName = attachment.fileName ?? attachment.filename;
        const finalCaption = caption ?? attachment.caption;
        let messageId: number;
        const attachmentType = String(attachment.type ?? '').toLowerCase();
        const mimeType = String(attachment.mimeType ?? '').toLowerCase();
        if (attachmentType === 'image' || mimeType.startsWith('image/')) {
          messageId = await this.client.sendPhoto(telegramTarget, attachment.data, finalCaption);
        } else if (attachmentType === 'voice' || mimeType.includes('ogg')) {
          messageId = await this.client.sendVoice(telegramTarget, attachment.data, fileName, finalCaption);
        } else if (attachmentType === 'audio' || mimeType.startsWith('audio/')) {
          messageId = await this.client.sendAudio(telegramTarget, attachment.data, fileName, finalCaption);
        } else {
          messageId = await this.client.sendDocument(telegramTarget, attachment.data, fileName, finalCaption);
        }
        return { ok: true, platform: 'telegram', messageId: String(messageId), raw: { target: telegramTarget } };
      },
    };

    this.deliveryProviderDisposable = registry.registerProvider(provider);
    logger.info('Telegram delivery provider 已注册（text/image/audio/file）');
  }

  private resolveDeliveryTarget(target: DeliveryTarget, sessionId?: string): TelegramSessionTarget {
    if (sessionId) {
      try {
        return parseTelegramSessionTarget(sessionId);
      } catch {
        // sessionId 不可解析时继续使用显式 target。
      }
    }
    const chatId = Number(target.id);
    if (!Number.isFinite(chatId)) {
      throw new Error(`Telegram delivery target.id 不是有效 chatId: ${target.id}`);
    }
    const threadId = typeof target.threadId === 'string' && target.threadId.trim() ? Number(target.threadId) : undefined;
    if (threadId !== undefined && !Number.isFinite(threadId)) {
      throw new Error(`Telegram delivery target.threadId 无效: ${target.threadId}`);
    }
    return buildTelegramSessionTarget({ chatId, isPrivate: target.kind === 'user', threadId });
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
        botMessageGroups: [],
        turnTrace: null,
        stream: null,
        typingTimer: null,
      };
      this.chatStates.set(target.chatKey, cs);
    }
    cs.sessionId = this.getSessionId(target.chatKey);
    cs.target = target;
    return cs;
  }

  /**
   * 通过 sessionId 的聊天身份前缀查找 chatState。
   *
   * 与 findChatStateBySid() 的精确匹配不同，此方法只比对 sid 中
   * 标识聊天身份的部分（telegram-<chatKey>-），忽略尾部时间戳。
   *
   * 用途：定时任务（cron）的 sourceSessionId 在创建时就固定了，
   * 但用户后续可能通过 /new 生成新 sessionId（时间戳不同）。
   * 此方法确保通知仍然能路由回原聊天，而不会因为 sessionId 变更而丢失。
   */
  private findChatStateByChatOrigin(sid: string): TelegramChatState | undefined {
    for (const [chatKey, cs] of this.chatStates.entries()) {
      // sessionId 格式: telegram-<chatKey.replace(/:/g, '-')>-<timestamp>
      // 只要 sid 以 chatKey 派生的前缀开头，就认为属于该聊天
      const prefix = `telegram-${chatKey.replace(/:/g, '-')}-`;
      if (sid.startsWith(prefix)) return cs;
    }
    return undefined;
  }

  private findChatStateBySid(sid: string): TelegramChatState | undefined {
    for (const cs of this.chatStates.values()) {
      if (cs.sessionId === sid) return cs;
    }
    return undefined;
  }

  // ---- Backend 事件监听 ----

  private setupBackendListeners(): void {
    if (this.backendListenersReady) return;
    this.backendListenersReady = true;
    // ---- 工具状态 ----
    this.backend.on('tool:execute' as any, (sid: string, handle: ToolExecutionHandleLike) => {
      autoApproveHandle(handle);

      const cs = this.findChatStateBySid(sid);
      if (!cs || cs.stopped) return;

      if (this.showToolStatus) {
        this.bindTraceToolHandle(cs, handle);
      }

      if (!this.showToolStatus || !cs.stream || cs.stream.kind !== 'edit') return;

      // 完成时固化状态行
      handle.on('done', () => {
        if (!cs.stream) return;
        if (!cs.stream.committedToolIds.has(handle.id)) {
          cs.stream.committedToolIds.add(handle.id);
          const line = formatTelegramToolLine({ toolName: handle.toolName, status: handle.status });
          cs.stream.committedToolLines.push(line);
          cs.stream.activeToolLine = undefined;
          this.scheduleStreamUpdate(cs);
        }
      });

      // 状态变化时更新活跃行
      handle.on('state', () => {
        if (!cs.stream || cs.stopped) return;
        // 只在非终态时显示临时状态
        if (handle.status !== 'success' && handle.status !== 'error' && handle.status !== 'warning') {
          const line = formatTelegramToolLine({ toolName: handle.toolName, status: handle.status });
          cs.stream.activeToolLine = line;
          this.scheduleStreamUpdate(cs);
        }
      });
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
        void this.initStream(cs);
      }
    });

    this.backend.on('stream:parts', (sid: string, parts: Part[]) => {
      const cs = this.findChatStateBySid(sid);
      if (!cs || cs.stopped) return;
      if (this.appendTraceParts(cs, parts) && cs.stream?.kind === 'draft') {
        this.scheduleStreamUpdate(cs);
      }
    });

    this.backend.on('stream:chunk', (sid: string, chunk: string) => {
      const cs = this.findChatStateBySid(sid);
      if (!cs?.stream || cs.stopped) return;

      cs.stream.buffer += chunk;
      this.scheduleStreamUpdate(cs);
    });

    this.backend.on('assistant:content', (sid: string, content: Content) => {
      const cs = this.findChatStateBySid(sid);
      if (!cs || cs.stopped || cs.stream) return;
      this.appendTraceParts(cs, content.parts);
    });

    // ---- 非流式回复 ----
    this.backend.on('response', (sid: string, text: string) => {
      const cs = this.findChatStateBySid(sid);
      if (!cs || cs.stopped) return;

      // Telegram 客户端会在收到 bot 消息后清掉 typing；这里先停 heartbeat，避免后续 interval 又重新点亮。
      this.stopTypingIndicator(cs);
      if (cs.stream) {
        void this.finalizeStream(cs, text).catch((err) => logger.error('流式关闭失败:', err));
      } else {
        void this.sendAssistantFinal(cs, this.messageBuilder.buildResponseText(text))
          .catch((err) => logger.error('发送 Telegram 回复失败:', err));
      }
    });

    // ---- 错误 ----
    this.backend.on('error', (sid: string, errorMsg: string) => {
      const cs = this.findChatStateBySid(sid);
      if (!cs) return;
      // 错误消息也是本回合的最终可见输出，发送前同样结束临时 typing 状态。
      this.stopTypingIndicator(cs);
      const errorText = this.messageBuilder.buildErrorText(errorMsg);
      if (cs.stream) {
        void this.finalizeStream(cs, errorText).catch((err) => logger.error('流式错误消息发送失败:', err));
      } else {
        void this.sendToChat(cs, errorText).catch((err) => logger.error('发送 Telegram 错误消息失败:', err));
      }
    });

    // ---- 回合完成 ----
    this.backend.on('done', (sid: string) => {
      void this.handleDone(sid);
    });
  }

  // ---- 流式辅助方法 ----

  /**
   * 启动 Telegram typing heartbeat。
   *
   * typing 是平台侧临时 UI 状态，不进入 Backend 历史，也不替代 Rich draft / legacy edit；
   * 它只覆盖首 token、长工具调用、streamMode=off 等没有可见内容更新的空窗。
   */
  private startTypingIndicator(cs: TelegramChatState): void {
    if (cs.typingTimer) return;

    const sendTyping = () => {
      void this.client.sendTyping(cs.target).catch((err) => {
        // typing 失败通常是协议/权限/目标类型问题；停止辅助 heartbeat，但不影响主回复投递。
        this.stopTypingIndicator(cs);
        logger.debug('Telegram typing 状态发送失败，已停止本回合 typing heartbeat:', err);
      });
    };

    cs.typingTimer = setInterval(sendTyping, TYPING_REFRESH_MS);
    sendTyping();
  }

  /** 停止当前聊天的 typing heartbeat；所有回合收尾路径都调用它以保证幂等清理。 */
  private stopTypingIndicator(cs: TelegramChatState): void {
    if (!cs.typingTimer) return;
    clearInterval(cs.typingTimer);
    cs.typingTimer = null;
  }

  /** 初始化流式状态。私聊 rich 使用官方 draft；其他场景使用 legacy edit 或静默收集。 */
  private async initStream(cs: TelegramChatState, message?: ParsedTelegramMessage): Promise<void> {
    const kind = this.resolveStreamKind(cs);
    cs.stream = {
      kind,
      draftId: kind === 'draft' ? this.createDraftId(message) : undefined,
      buffer: '',
      committedToolIds: new Set(),
      committedToolLines: [],
      dirty: false,
      throttleTimer: null,
      finalized: false,
    };

    if (kind === 'draft') {
      await this.updateDraftStream(cs);
      return;
    }

    if (kind === 'edit') {
      const messageId = await this.client.sendMessageReturningId(
        cs.target,
        this.messageBuilder.buildThinkingText(),
      );
      cs.stream.placeholderMessageId = messageId;
      this.trackBotMessageGroup(cs, [messageId]);
    }
  }

  private resolveStreamKind(cs: TelegramChatState): TelegramStreamKind {
    // auto 是推荐默认值：私聊可用官方 draft，群聊仍保留可编辑占位消息。
    if (this.streamMode === 'off') return 'silent';
    if (this.streamMode === 'edit') return 'edit';
    if (this.streamMode === 'draft') {
      if (cs.target.scope !== 'dm') {
        throw new Error('telegram.streamMode=draft 仅支持 Telegram 私聊');
      }
      return 'draft';
    }
    return this.outputFormat === 'rich' && cs.target.scope === 'dm' ? 'draft' : 'edit';
  }

  /**
   * Telegram draft_id 只要求同一聊天内非零即可。
   * 优先复用用户消息 ID，便于同一个 inbound turn 的 draft 多次更新覆盖同一预览。
   */
  private createDraftId(message?: ParsedTelegramMessage): number {
    if (message?.messageId && Number.isInteger(message.messageId)) return message.messageId;
    const draftId = Date.now() % 2147483647;
    return draftId === 0 ? 1 : draftId;
  }

  /** 收集 trace part 仅用于 Telegram 展示层，不写入 Backend 对话历史或 undo 栈。 */
  private appendTraceParts(cs: TelegramChatState, parts: Part[]): boolean {
    if (!cs.turnTrace) return false;
    return cs.turnTrace.appendParts(parts, { includeTools: this.showToolStatus });
  }

  private bindTraceToolHandle(cs: TelegramChatState, handle: ToolExecutionHandleLike): void {
    const trace = cs.turnTrace;
    if (!trace) return;

    trace.bindToolHandle(handle);
    const refreshTrace = () => {
      if (cs.turnTrace !== trace) return;
      trace.updateToolHandle(handle);
      if (cs.stream?.kind === 'draft') this.scheduleStreamUpdate(cs);
    };

    handle.on('state', () => refreshTrace());
    handle.on('progress', () => refreshTrace());
    handle.on('output', () => refreshTrace());
    handle.on('done', () => refreshTrace());
    handle.on('child', (childHandle) => {
      if (cs.turnTrace !== trace) return;
      this.bindTraceToolHandle(cs, childHandle);
      refreshTrace();
    });
  }

  private scheduleStreamUpdate(cs: TelegramChatState): void {
    if (!cs.stream || cs.stream.finalized) return;
    cs.stream.dirty = true;
    if (cs.stream.throttleTimer) return;
    cs.stream.throttleTimer = setTimeout(() => {
      void this.flushStreamUpdate(cs).catch((err) => logger.error('流式更新失败:', err));
    }, STREAM_THROTTLE_MS);
  }

  private async flushStreamUpdate(cs: TelegramChatState): Promise<void> {
    const stream = cs.stream;
    if (!stream || stream.finalized) return;
    stream.throttleTimer = null;
    if (!stream.dirty) return;
    stream.dirty = false;

    if (stream.kind === 'draft') {
      await this.updateDraftStream(cs);
      return;
    }
    if (stream.kind === 'edit') {
      if (stream.placeholderMessageId == null) {
        throw new Error('Telegram legacy stream 缺少 placeholderMessageId');
      }
      await this.client.editText(cs.target, stream.placeholderMessageId, this.buildLegacyStreamText(stream));
    }
  }

  /** 将当前流式 buffer 渲染为官方 Rich Message draft。 */
  private async updateDraftStream(cs: TelegramChatState): Promise<void> {
    const stream = cs.stream;
    if (!stream || stream.kind !== 'draft') return;
    if (stream.draftId == null) {
      throw new Error('Telegram rich draft stream 缺少 draftId');
    }
    const richMessage = renderTelegramDraftTurn({
      answerMarkdown: stream.buffer,
      traceSections: this.buildTraceSections(cs),
      thinkingText: this.messageBuilder.buildThinkingText(),
    });
    await this.client.sendRichMessageDraft(cs.target, stream.draftId, richMessage);
  }

  private buildLegacyStreamText(stream: TelegramStreamState): string {
    const statusLines = [
      ...stream.committedToolLines,
      stream.activeToolLine,
    ].filter((line): line is string => Boolean(line));
    const sections = [...statusLines, stream.buffer].filter((section) => section.trim());
    return sections.join('\n\n') || this.messageBuilder.buildThinkingText();
  }

  /** 最终更新流式消息并清理定时器；draft 会发送新消息，legacy edit 会替换占位消息。 */
  private async finalizeStream(cs: TelegramChatState, text: string): Promise<void> {
    const stream = cs.stream;
    if (!stream || stream.finalized) return;
    // 流式最终投递会产生真实消息或编辑占位消息，typing 状态必须先停止。
    this.stopTypingIndicator(cs);
    stream.finalized = true;
    if (stream.throttleTimer) {
      clearTimeout(stream.throttleTimer);
      stream.throttleTimer = null;
    }

    const finalText = text.trim() ? text : stream.buffer || '✅ 处理完成。';
    if (stream.kind === 'edit') {
      if (stream.placeholderMessageId == null) {
        throw new Error('Telegram legacy stream 缺少 placeholderMessageId');
      }
      await this.deliverAssistantFinal(cs, finalText, { editMessageId: stream.placeholderMessageId });
      return;
    }

    await this.deliverAssistantFinal(cs, finalText);
  }

  /** 清理流式状态 */
  private cleanupStream(cs: TelegramChatState): void {
    if (cs.stream?.throttleTimer) {
      clearTimeout(cs.stream.throttleTimer);
    }
    cs.stream = null;
  }

  private async handleDone(sid: string): Promise<void> {
    const cs = this.findChatStateBySid(sid);
    if (!cs) return;

    try {
      if (cs.stream && !cs.stopped) {
        const finalText = cs.stream.buffer || '✅ 处理完成。';
        await this.finalizeStream(cs, finalText);
      }
    } catch (err) {
      logger.error('Telegram 回合收尾失败:', err);
    } finally {
      // done 是最终兜底清理点，覆盖 abort、无 response、finalizeStream 失败等边界情况。
      this.stopTypingIndicator(cs);
      if (cs.stream) this.cleanupStream(cs);
      cs.turnTrace = null;
      cs.busy = false;
      cs.stopped = false;

      if (cs.pendingMessages.length > 0) {
        this.flushPendingMessages(cs);
      }
    }
  }

  // ---- 发送消息 ----

  /**
   * 向聊天室发送消息。
   * @param cs 聊天状态
   * @param text 消息内容
   * @param options 发送选项。trackMessage 为 false 时，该消息不会进入 bot 消息组栈，不参与 undo 时的 UI 撤销逻辑。
   */
  private async sendToChat(cs: TelegramChatState, text: string, options?: { trackMessage?: boolean }): Promise<void> {
    const msgId = await this.client.sendMessageReturningId(cs.target, text);
    // 默认追踪 bot 消息 ID，用于 undo 时逐条编辑/删除
    if (options?.trackMessage !== false) {
      this.trackBotMessageGroup(cs, [msgId]);
    }
  }

  private async sendAssistantFinal(cs: TelegramChatState, text: string): Promise<void> {
    await this.deliverAssistantFinal(cs, text);
  }

  /**
   * Assistant 最终投递的唯一入口。
   *
   * rich 投递失败时不在 renderer 层猜测原因，也不改写用户正文；这里统一回落为纯文本，
   * 保证 Telegram 用户至少能看到错误原因和原始内容。
   */
  private async deliverAssistantFinal(cs: TelegramChatState, text: string, options: TelegramFinalDeliveryOptions = {}): Promise<void> {
    const traceSections = this.buildTraceSections(cs);
    if (this.outputFormat !== 'rich') {
      if (options.editMessageId != null) {
        await this.replacePlainAssistantFinal(cs, options.editMessageId, text);
      } else {
        await this.sendPlainAssistantFinal(cs, text);
      }
      return;
    }

    try {
      const richMessage = this.renderFinalRichMessage(text, traceSections);
      if (options.editMessageId != null) {
        await this.client.editRichMessage(cs.target, options.editMessageId, richMessage);
      } else {
        const msgId = await this.client.sendRichMessageReturningId(cs.target, richMessage);
        this.trackBotMessageGroup(cs, [msgId]);
      }
      return;
    } catch (err) {
      logger.warn(`Telegram Rich Message 投递失败，回落为纯文本: ${formatTelegramErrorSummary(err)}`);
      const fallbackText = this.buildRichFallbackText(text, traceSections, err);
      if (options.editMessageId != null) {
        await this.replacePlainAssistantFinal(cs, options.editMessageId, fallbackText);
      } else {
        await this.sendPlainAssistantFinal(cs, fallbackText);
      }
    }
  }

  /** 发送纯文本最终回复，并将所有分片归入同一个 undo 消息组。 */
  private async sendPlainAssistantFinal(cs: TelegramChatState, text: string): Promise<void> {
    const appendMessageId = this.createBotMessageGroupAppender(cs);
    const messageIds = await this.client.sendTextReturningIds(cs.target, text, {}, { onMessageId: appendMessageId });
    for (const messageId of messageIds) appendMessageId(messageId);
  }

  /** 用纯文本 fallback 替换既有占位消息，后续分片仍归入同一个 undo 消息组。 */
  private async replacePlainAssistantFinal(cs: TelegramChatState, messageId: number, text: string): Promise<void> {
    const appendMessageId = this.createBotMessageGroupAppender(cs, messageId);
    const messageIds = await this.client.replaceMessageTextReturningIds(cs.target, messageId, text, {}, { onMessageId: appendMessageId });
    for (const nextMessageId of messageIds) appendMessageId(nextMessageId);
  }

  private renderFinalRichMessage(text: string, traceSections: TelegramTraceSection[]) {
    return renderTelegramRichTurn({
      answerMarkdown: text,
      traceSections,
    });
  }

  /** 构造用户可见的 Rich Message 失败说明，保留 trace 和原始正文供排查。 */
  private buildRichFallbackText(text: string, traceSections: TelegramTraceSection[], error: unknown): string {
    const sections = [
      `⚠️ Telegram Rich Message 投递失败，已改用纯文本显示。\n原因：${formatTelegramErrorSummary(error)}`,
      ...traceSections.map((section) => this.renderPlainTraceSection(section)).filter((section) => section.trim()),
      text,
    ].filter((section) => section.trim());
    return sections.join('\n\n');
  }

  private renderPlainTraceSection(section: TelegramTraceSection): string {
    const content = section.content.trim();
    if (!content) return '';
    return `${section.title}\n\n${content}`;
  }

  private buildTraceSections(cs: TelegramChatState): TelegramTraceSection[] {
    return cs.turnTrace?.toTraceSections() ?? [];
  }

  /** 将一个 Backend turn 对应的一组 Telegram 消息压入 undo 栈。 */
  private trackBotMessageGroup(cs: TelegramChatState, messageIds: number[]): TelegramBotMessageGroup | undefined {
    if (messageIds.length === 0) return undefined;
    const group = { messageIds: [...messageIds] };
    cs.botMessageGroups.push(group);
    return group;
  }

  /**
   * 创建幂等的消息组追加器。
   *
   * client 可能在成功返回前通过 observer 先报告 message_id；成功返回后这里会再扫一遍结果，
   * 因此追加器必须去重，才能同时覆盖成功路径和中途失败路径。
   */
  private createBotMessageGroupAppender(cs: TelegramChatState, primaryMessageId?: number): (messageId: number) => void {
    let group = primaryMessageId == null ? undefined : this.findBotMessageGroup(cs, primaryMessageId);
    return (messageId: number) => {
      if (!group) {
        group = this.trackBotMessageGroup(cs, [messageId]);
        return;
      }
      if (!group.messageIds.includes(messageId)) {
        group.messageIds.push(messageId);
      }
    };
  }

  private findBotMessageGroup(cs: TelegramChatState, primaryMessageId: number): TelegramBotMessageGroup | undefined {
    for (let i = cs.botMessageGroups.length - 1; i >= 0; i -= 1) {
      const group = cs.botMessageGroups[i];
      if (group.messageIds[0] === primaryMessageId) return group;
    }
    return undefined;
  }

  /**
   * undo 时处理 bot 消息的 UI 标记（编辑为"已撤销"或删除）。
   * 采用消息组栈支持连续撤销：从栈顶弹出一个 turn 的 Telegram 消息组进行处理。
   */
  private async markBotMessageAsUndone(cs: TelegramChatState): Promise<void> {
    const group = cs.botMessageGroups.pop();
    const [primaryMessageId, ...extraMessageIds] = group?.messageIds ?? [];
    if (primaryMessageId != null) {
      try {
        await this.client.editText(cs.target, primaryMessageId, '已撤销');
      } catch (e) {
        logger.warn(`Telegram 消息编辑为已撤销失败 (${primaryMessageId})，尝试删除:`, e);
        try {
          await this.client.deleteMessage(cs.target, primaryMessageId);
        } catch (err) {
          logger.warn(`Telegram deleteMessage 也失败了:`, err);
        }
      }
      for (const messageId of extraMessageIds) {
        try {
          await this.client.deleteMessage(cs.target, messageId);
        } catch (err) {
          logger.warn(`Telegram deleteMessage 失败 (${messageId}):`, err);
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
      await this.sendAssistantFinal(cs, assistantText);
      return;
    }
    await this.sendToChat(cs, '✅ 上一轮对话已恢复。', { trackMessage: false });
  }


  // ---- 入站消息处理 ----

  private async handleMessage(ctx: any): Promise<void> {
    try {
      const parsed = this.messageHandler.parseIncomingText(ctx);
      if (!parsed) return;

      // ---- Phase 7：消息去重 ----
      // 目的：避免 bot 重启或网络抖动导致重复处理同一条消息。
      // Telegram 的 message_id 只在单个 chat 内唯一，必须带上 chatKey 才能避免跨私聊/群聊误去重。
      const dedupKey = `${parsed.session.chatKey}:${parsed.messageId}`;
      if (this.messageDedup.has(dedupKey)) {
        logger.debug(`跳过重复消息: ${dedupKey}`);
        return;
      }
      this.messageDedup.add(dedupKey);
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

      this.api?.services.get<DeliveryRegistryService>(DELIVERY_REGISTRY_SERVICE_ID)?.recordActivity({
        platform: 'telegram',
        target: {
          // Telegram 的 delivery target 约定使用 kind=chat/room + chatId。
          // 私聊同样使用 chatId 作为投递目标，保持与 delivery binding 的默认写法一致。
          kind: 'chat',
          id: String(parsed.session.chatId),
          threadId: parsed.session.threadId != null ? String(parsed.session.threadId) : undefined,
        },
        label: parsed.session.scope === 'dm'
          ? `Telegram DM ${parsed.session.chatId}`
          : `Telegram Chat ${parsed.session.chatId}`,
        occurredAt: Date.now(),
        metadata: { sessionId: parsed.session.sessionId },
      });

      // 命令优先处理；busy 时 handleCommand 只放行不改变 turn 身份的安全命令。
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
        await this.sendToChat(cs, BUFFERED_NOTICE, { trackMessage: false });
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

      const activeCs = this.chatStates.get(target.chatKey);
      let resultText = '';

      if (activeCs?.busy) {
        // Inline keyboard 可能来自旧菜单；busy 期间不允许按钮切换 session/model/mode，
        // 否则当前 turn 的 response/done 将无法再按原 sessionId 精确收口。
        resultText = BUSY_COMMAND_NOTICE;
      } else {
        switch (command) {
          case 'model': {
            try {
              const result = this.backend.switchModel(arg, 'telegram');
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
            const ok = this.backend.switchMode?.(arg);
            resultText = ok ? `✅ 已切换到 Mode "${arg}"。` : `❌ 未找到 Mode "${arg}"。`;
            break;
          }

          default:
            resultText = `❌ 未知操作: ${command}`;
        }
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

    const reply = (content: string) => this.sendToChat(cs, content, { trackMessage: false });
    if (cs.busy && cmd.name !== 'stop' && cmd.name !== 'flush' && cmd.name !== 'help') {
      // Telegram 现在会在长回合中继续接收命令；busy 期间只放行不会改变 turn 身份的命令。
      await reply(BUSY_COMMAND_NOTICE);
      return true;
    }

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
            const result = this.backend.switchModel(cmd.args, 'telegram');
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
      case 'load':
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
        // /stop 的语义是“停下并丢弃已缓冲输入”；/flush 才负责“停下并继续处理缓冲”。
        cs.pendingMessages.splice(0);
        cs.stopped = true;
        this.stopTypingIndicator(cs);
        this.backend.abortChat(cs.sessionId);
        if (cs.stream) {
          const stopText = this.messageBuilder.buildAbortedText(cs.stream.buffer);
          await this.finalizeStream(cs, stopText);
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
          this.stopTypingIndicator(cs);
          this.backend.abortChat(cs.sessionId);
          if (cs.stream) {
            const stopText = this.messageBuilder.buildAbortedText(cs.stream.buffer);
            await this.finalizeStream(cs, stopText);
            this.cleanupStream(cs);
          }
          // 等 done 事件自然释放 busy 并触发 flushPendingMessages
        } else {
          this.flushPendingMessages(cs);
        }
        return true;
      }

      case 'undo': {
        if (typeof this.backend.undo !== 'function') {
          await reply('❌ 当前宿主未提供撤销能力。');
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
        if (typeof this.backend.redo !== 'function') {
          await reply('❌ 当前宿主未提供恢复能力。');
          return true;
        }
        const redoResult = await this.backend.redo(cs.sessionId);
        if (!redoResult) {
          await reply('ℹ️ 没有可以恢复的对话。');
          return true;
        }

        // 平台 UI 只回放最终可见文本，不重新调 LLM。
        // redoResult.assistantText 可能为 undefined（例如 redo 恢复的轮次没有助手回复），兜底为空字符串。
        await this.replayRedoResult(cs, redoResult.assistantText ?? '');
        return true;
      }

      case 'skill':
      case 'skills': {
        const skills = this.backend.listSkills?.() ?? [];
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
        const modes = this.backend.listModes?.() ?? [];
        if (modes.length === 0) {
          await reply('ℹ️ 未配置任何 Mode。请在 modes.yaml 中添加。');
          return true;
        }
        if (cmd.args) {
          const ok = this.backend.switchMode?.(cmd.args);
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
      await this.sendToChat(cs, UNSUPPORTED_MEDIA_NOTICE, { trackMessage: false });
      return;
    }

    cs.busy = true;
    cs.stopped = false;
    cs.sessionId = this.getSessionId(cs.target.chatKey);
    cs.target = message.session;
    cs.turnTrace = new TelegramTurnTraceCollector();

    try {
      // 流式模式先建立 Telegram 展示状态。
      if (this.backend.isStreamEnabled()) {
        await this.initStream(cs, message);
      }
      // 生产路径 start() 会先注册 Backend 监听；测试中直接调用 handleMessage 时避免启动无法自然停止的 timer。
      if (this.backendListenersReady) this.startTypingIndicator(cs);

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

      const sessionId = cs.sessionId;
      const turnTrace = cs.turnTrace;
      // grammY 的 simple long polling 会等待 middleware resolve；这里不能 await 整个 Backend turn，
      // 否则后续 /stop update 进不了 handler。最终回复和清理由 response/error/done 事件收口。
      void this.backend.chat(sessionId, message.text, images, documents, 'telegram').catch((err) => {
        logger.error(`Telegram 回合执行失败 (session=${sessionId}):`, err);
        if (cs.sessionId !== sessionId || cs.turnTrace !== turnTrace) return;
        this.stopTypingIndicator(cs);
        this.cleanupStream(cs);
        cs.turnTrace = null;
        cs.busy = false;
      });
    } catch (err) {
      logger.error(`Telegram 回合分发失败 (session=${cs.sessionId}):`, err);
      this.stopTypingIndicator(cs);
      this.cleanupStream(cs);
      cs.turnTrace = null;
      cs.busy = false;
      cs.stopped = false;
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

function parseTelegramOutputFormat(value: unknown): TelegramOutputFormat {
  if (value == null) return 'rich';
  if (value === 'plain' || value === 'rich') return value;
  throw new Error(`telegram.outputFormat 无效: ${String(value)}`);
}

function parseTelegramStreamMode(value: unknown): TelegramStreamMode {
  if (value == null) return 'auto';
  if (value === 'auto' || value === 'draft' || value === 'edit' || value === 'off') return value;
  throw new Error(`telegram.streamMode 无效: ${String(value)}`);
}

function formatTelegramErrorSummary(error: unknown): string {
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    const description = nonEmptyString(record.description);
    const message = nonEmptyString(record.message);
    const errorCode = nonEmptyString(record.error_code);
    const text = description ?? message;
    if (errorCode && text) return `${errorCode}: ${text}`;
    if (text) return text;
  }
  return String(error);
}

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const text = String(value).trim();
  return text ? text : undefined;
}

export const createTelegramPlatform = definePlatformFactory<TelegramConfig, TelegramPlatform>({
  platformName: 'telegram',
  resolveConfig: (raw, context) => ({
    token: raw.token ?? '',
    outputFormat: raw.outputFormat,
    streamMode: raw.streamMode,
    showToolStatus: raw.showToolStatus,
    groupMentionRequired: raw.groupMentionRequired,
    pairing: raw.pairing,
    // [cron 重构] eventBus 仍保留在 config 中供其他插件使用。
    // cron 通知已改走 backend agent:notification 事件，不再依赖 eventBus。
    eventBus: (context as any).eventBus,
  }),
  create: (backend, config, context) => new TelegramPlatform(backend, config, context.api as IrisAPI | undefined),
});

export default createTelegramPlatform;
