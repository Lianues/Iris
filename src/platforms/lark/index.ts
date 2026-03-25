/**
 * 飞书平台适配器入口。
 *
 * ## 流式输出方案
 *
 * 通过 sendCard + patchCard 实现卡片实时更新（非 CardKit 2.0）。
 * 技术选型详见 card-builder.ts 文件头注释。
 *
 * ## 工具审批
 *
 * 当前自动批准所有工具调用（与企微一致）。飞书卡片支持按钮回调，
 * 理论上可实现交互式审批，但 Phase 4.1 尚未排期。
 *
 * ## 其他能力
 *
 *   - 工具状态展示：监听 tool:update 事件，自动批准并格式化状态行；
 *   - 完整 Slash 命令：/new /clear /model /session /stop /flush /help；
 *   - 并发控制：ChatState + busy 锁 + pendingMessages 缓冲。
 */

import { Backend } from '../../core/backend';
import { createLogger } from '../../logger';
import type { ImageInput, DocumentInput } from '../../core/backend';
import { PlatformAdapter } from '../base';
import { buildLarkCard, formatLarkToolLine, type LarkToolStatusEntry } from './card-builder';
import { LarkClient } from './client';
import { LarkCommandRouter } from './commands';
import { LarkMessageHandler } from './message-handler';
import { LarkConfig, LarkSessionTarget, ParsedLarkMessage } from './types';

const logger = createLogger('Lark');

/** 流式卡片更新节流间隔（ms）。飞书 API 频率限制比 Telegram 宽松，用 1000ms。 */
const STREAM_THROTTLE_MS = 1000;

const BUFFERED_NOTICE = '📥 消息已暂存，等 AI 回复结束后自动发送。\n发送 /flush 可立即处理，/stop 可中止当前回复。';

// ---- Phase 7：健壮性常量 ----

/** 消息去重缓存最大容量 */
const MESSAGE_DEDUP_MAX_SIZE = 500;
/** 消息过期阈值（ms）。丢弃 create_time 超过此值的旧消息，避免重连重放。 */
const MESSAGE_EXPIRE_MS = 30_000;
/** 去重缓存清理间隔（ms） */
const DEDUP_CLEANUP_INTERVAL_MS = 60_000;

// ---- 内部类型 ----

interface LarkPendingMessage {
  session: LarkSessionTarget;
  text: string;
  messageId: string;
}

interface LarkStreamState {
  /** 卡片消息的 message_id */
  cardMessageId: string;
  /** 累积的 AI 文本 buffer */
  buffer: string;
  /** 已固化的工具调用 ID */
  committedToolIds: Set<string>;
  /** 当前活跃的工具条目（用于流式卡片展示） */
  activeToolEntries: LarkToolStatusEntry[];
  dirty: boolean;
  throttleTimer: ReturnType<typeof setTimeout> | null;
}

interface LarkChatState {
  busy: boolean;
  sessionId: string;
  target: LarkSessionTarget;
  lastInboundMessageId?: string;
  stopped: boolean;
  pendingMessages: LarkPendingMessage[];
  lastBotMessageId?: string; // 用于 undo/redo 时处理平台侧最后一条机器人消息的 UI 状态
  stream: LarkStreamState | null;
}

export class LarkPlatform extends PlatformAdapter {
  private readonly client: LarkClient;
  private readonly messageHandler = new LarkMessageHandler();
  private readonly commandRouter = new LarkCommandRouter();
  private readonly showToolStatus: boolean;

  private readonly chatStates = new Map<string, LarkChatState>();
  private readonly activeSessions = new Map<string, string>();
  private wsAbortController?: AbortController;
  /** Phase 7：消息去重集合。存放已处理的 messageId，避免 WebSocket 重连时重放消息。 */
  private readonly messageDedup = new Set<string>();
  /** Phase 7：去重集合上次清理时间 */
  private lastDedupCleanup = Date.now();

  constructor(
    private readonly backend: Backend,
    private readonly config: LarkConfig,
  ) {
    super();
    this.client = new LarkClient(config);
    this.showToolStatus = config.showToolStatus !== false;
  }

  async start(): Promise<void> {
    if (!this.config.appId || !this.config.appSecret) {
      throw new Error('Lark 平台启动失败：缺少 appId 或 appSecret。');
    }

    const probe = await this.client.probeBotInfo();
    if (!probe.ok) {
      throw new Error(`Lark 平台启动失败：${probe.error ?? 'bot 探测失败。'}`);
    }

    this.messageHandler.setBotOpenId(probe.botOpenId);
    this.setupBackendListeners();

    this.wsAbortController = new AbortController();
    void this.client.startWebSocket({
      handlers: {
        'im.message.receive_v1': (data) => this.handleIncomingEvent(data),
      },
      abortSignal: this.wsAbortController.signal,
      autoProbe: false,
    }).catch((error) => {
      logger.error('飞书 WebSocket 监听失败:', error);
    });

    logger.info(`飞书平台已启动 | Bot: ${probe.botName ?? probe.botOpenId ?? 'unknown'}`);
  }

  async stop(): Promise<void> {
    this.wsAbortController?.abort();
    this.wsAbortController = undefined;
    for (const cs of this.chatStates.values()) {
      if (cs.stream?.throttleTimer) clearTimeout(cs.stream.throttleTimer);
    }
    this.chatStates.clear();
    this.messageDedup.clear();
    this.client.dispose();
    logger.info('Lark 平台已停止');
  }

  // ---- Session 管理 ----

  private getSessionId(chatKey: string): string {
    let sid = this.activeSessions.get(chatKey);
    if (!sid) {
      sid = `lark-${chatKey.replace(/:/g, '-')}-${Date.now()}`;
      this.activeSessions.set(chatKey, sid);
    }
    return sid;
  }

  // ---- ChatState 管理 ----

  private getChatState(target: LarkSessionTarget): LarkChatState {
    let cs = this.chatStates.get(target.chatKey);
    if (!cs) {
      cs = {
        busy: false,
        sessionId: this.getSessionId(target.chatKey),
        target,
        pendingMessages: [],
        stopped: false,
        stream: null,
      };
      this.chatStates.set(target.chatKey, cs);
    }
    cs.sessionId = this.getSessionId(target.chatKey);
    cs.target = target;
    return cs;
  }

  private findChatStateBySid(sid: string): LarkChatState | undefined {
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
      for (const inv of invocations) {
        if (inv.status === 'awaiting_approval') {
          try { this.backend.approveTool(inv.id, true); } catch { /* 忽略 */ }
        }
      }

      if (!this.showToolStatus) return;
      const cs = this.findChatStateBySid(sid);
      if (!cs?.stream || cs.stopped) return;

      const sorted = [...invocations].sort((a, b) => a.createdAt - b.createdAt);

      // 将完成的工具固化到 buffer
      for (const inv of sorted) {
        const isDone = inv.status === 'success' || inv.status === 'error';
        if (isDone && !cs.stream.committedToolIds.has(inv.id)) {
          cs.stream.committedToolIds.add(inv.id);
          const line = formatLarkToolLine(inv);
          cs.stream.buffer = cs.stream.buffer
            ? `${cs.stream.buffer}\n\n${line}\n\n`
            : `${line}\n\n`;
        }
      }

      // 更新活跃工具条目
      cs.stream.activeToolEntries = sorted
        .filter((inv) => !cs.stream!.committedToolIds.has(inv.id))
        .map((inv) => ({ id: inv.id, toolName: inv.toolName, status: inv.status, createdAt: inv.createdAt }));

      this.patchStreamCard(cs);
    });

    // ---- 流式输出 ----
    this.backend.on('stream:start', (sid: string) => {
      const cs = this.findChatStateBySid(sid);
      if (!cs || cs.stopped || cs.stream) return;
      void this.initStream(cs);
    });

    this.backend.on('stream:chunk', (sid: string, chunk: string) => {
      const cs = this.findChatStateBySid(sid);
      if (!cs?.stream || cs.stopped) return;

      cs.stream.buffer += chunk;
      cs.stream.dirty = true;

      if (!cs.stream.throttleTimer) {
        cs.stream.throttleTimer = setTimeout(() => {
          if (!cs.stream) return;
          cs.stream.throttleTimer = null;
          if (!cs.stream.dirty) return;
          cs.stream.dirty = false;
          this.patchStreamCard(cs);
        }, STREAM_THROTTLE_MS);
      }
    });

    // ---- 非流式回复 ----
    this.backend.on('response', (sid: string, text: string) => {
      const cs = this.findChatStateBySid(sid);
      if (!cs || cs.stopped) return;

      if (cs.stream) {
        this.finalizeStreamCard(cs, text);
      } else {
        void this.sendTextToChat(cs, text);
      }
    });

    // ---- 错误 ----
    this.backend.on('error', (sid: string, errorMsg: string) => {
      const cs = this.findChatStateBySid(sid);
      if (!cs) return;
      const errorText = `❌ 错误: ${errorMsg}`;
      if (cs.stream) {
        this.finalizeStreamCard(cs, errorText, true);
      } else {
        void this.sendTextToChat(cs, errorText);
      }
    });

    // ---- 回合完成 ----
    this.backend.on('done', (sid: string) => {
      const cs = this.findChatStateBySid(sid);
      if (!cs) return;

      if (cs.stream && !cs.stopped) {
        const finalText = cs.stream.buffer || '✅ 处理完成。';
        this.finalizeStreamCard(cs, finalText);
      }
      this.cleanupStream(cs);

      cs.busy = false;
      cs.stopped = false;

      if (cs.pendingMessages.length > 0) {
        this.flushPendingMessages(cs);
      }
    });
  }

  // ---- 流式辅助方法 ----

  private async initStream(cs: LarkChatState): Promise<void> {
    try {
      const card = buildLarkCard('thinking');
      const result = await this.client.sendCard({ card, target: cs.target });
      cs.lastBotMessageId = result.messageId; // 记录用于 undo
      cs.stream = {
        cardMessageId: result.messageId,
        buffer: '',
        committedToolIds: new Set(),
        activeToolEntries: [],
        dirty: false,
        throttleTimer: null,
      };
    } catch (err) {
      // Phase 7：卡片发送失败时降级，不初始化流式状态。
      // 后续 stream:chunk / response 事件会走非流式路径（直接发文本消息）。
      logger.warn('发送占位卡片失败，降级为非流式模式:', err);
    }
  }

  private patchStreamCard(cs: LarkChatState): void {
    if (!cs.stream) return;
    const card = buildLarkCard('streaming', {
      text: cs.stream.buffer,
      toolEntries: cs.stream.activeToolEntries,
    });
    this.client.patchCard({ messageId: cs.stream.cardMessageId, card }).catch((err) => {
      logger.error('流式卡片更新失败:', err);
    });
  }

  private finalizeStreamCard(cs: LarkChatState, text: string, isError?: boolean): void {
    if (!cs.stream) return;
    if (cs.stream.throttleTimer) {
      clearTimeout(cs.stream.throttleTimer);
      cs.stream.throttleTimer = null;
    }
    const card = buildLarkCard('complete', { text, isError });
    this.client.patchCard({ messageId: cs.stream.cardMessageId, card }).catch((err) => {
      logger.error('流式卡片关闭失败:', err);
    });
  }

  private cleanupStream(cs: LarkChatState): void {
    if (cs.stream?.throttleTimer) clearTimeout(cs.stream.throttleTimer);
    cs.stream = null;
  }

  // ---- 发送消息 ----

  private async sendTextToChat(cs: LarkChatState, text: string): Promise<void> {
    if (cs.lastInboundMessageId) {
      const res = await this.client.replyText({
        messageId: cs.lastInboundMessageId,
        text,
        replyInThread: Boolean(cs.target.threadId),
      });
      cs.lastBotMessageId = res.messageId; // 记录用于 undo
    } else {
      const res = await this.client.sendText({ text, target: cs.target });
      cs.lastBotMessageId = res.messageId; // 记录用于 undo
    }
  }

  // ---- 入站消息处理 ----

  private async handleIncomingEvent(payload: unknown): Promise<void> {
    const parsed = this.messageHandler.parseIncomingMessage(payload);
    if (!parsed) return;

    // ---- Phase 7：消息去重 ----
    // 目的：WebSocket 重连时飞书可能重放已处理的消息，通过 messageId 去重避免重复处理。
    if (this.messageDedup.has(parsed.messageId)) {
      logger.debug(`跳过重复消息: ${parsed.messageId}`);
      return;
    }
    this.messageDedup.add(parsed.messageId);
    this.cleanupDedupIfNeeded();

    // ---- Phase 7：消息过期检测 ----
    // 目的：丢弃 create_time 过旧的消息，避免重连后处理大量历史消息。
    const createTimeMs = extractCreateTimeMs(payload);
    if (createTimeMs > 0) {
      const age = Date.now() - createTimeMs;
      if (age > MESSAGE_EXPIRE_MS) {
        logger.debug(`跳过过期消息: ${parsed.messageId} (age=${Math.round(age / 1000)}s)`);
        return;
      }
    }

    const cs = this.getChatState(parsed.session);
    cs.lastInboundMessageId = parsed.messageId;

    // TODO: 对码门禁 — 后续接入 PairingGuard，当前未实现。
    // 设计文档：.limcode/design/对码系统设计.md

    // 命令处理
    if (parsed.text.startsWith('/')) {
      const handled = await this.handleCommand(parsed.text, cs);
      if (handled) return;
    }

    // 如果当前正忙，暂存消息
    if (cs.busy) {
      cs.pendingMessages.push({
        session: parsed.session,
        text: parsed.text,
        messageId: parsed.messageId,
      });
      await this.client.replyText({
        messageId: parsed.messageId,
        text: BUFFERED_NOTICE,
        replyInThread: Boolean(parsed.threadId),
      });
      return;
    }

    await this.dispatchChat(cs, parsed);
  }

  // ---- Slash 命令 ----

  private async handleCommand(text: string, cs: LarkChatState): Promise<boolean> {
    const cmd = this.commandRouter.parse(text);
    if (!cmd) return false;

    const reply = (content: string) => this.sendTextToChat(cs, content);

    switch (cmd.name) {
      case 'new': {
        const newSid = `lark-${cs.target.chatKey.replace(/:/g, '-')}-${Date.now()}`;
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
          const lines = models.map((m) =>
            `${m.current ? '👉 ' : '   '}${m.modelName} → ${m.modelId}`
          );
          await reply(`当前可用模型：\n${lines.join('\n')}\n\n切换模型请发送 /model 模型名`);
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
          const lines = display.map((m, i) => {
            const date = m.updatedAt
              ? new Date(m.updatedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
              : '未知时间';
            const current = m.id === cs.sessionId ? ' 👈' : '';
            return `${i + 1}. ${m.title || '(无标题)'}  ${date}${current}`;
          });
          await reply(`📋 历史会话\n\n${lines.join('\n')}\n\n发送 /session 编号 切换`);
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
          const stopText = cs.stream.buffer
            ? `${cs.stream.buffer}\n\n⏹ （已中止）`
            : '⏹ 已中止回复。';
          this.finalizeStreamCard(cs, stopText);
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
            const stopText = cs.stream.buffer
              ? `${cs.stream.buffer}\n\n⏹ （已中止，处理新消息）`
              : '⏹ 已中止，处理新消息。';
            this.finalizeStreamCard(cs, stopText);
            this.cleanupStream(cs);
          }
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

        // 平台 UI 操作：撤回/标记 bot 消息
        await this.markBotMessageAsUndone(cs, reply);

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

      case 'help': {
        await reply(this.commandRouter.buildHelpText());
        return true;
      }

      default:
        return false;
    }
  }


  /**
   * undo 时处理 bot 消息的 UI 标记（撤回或更新为"已撤销"）。
   * 从 undo 命令处理中提取出来，保持命令逻辑简洁。
   */
  private async markBotMessageAsUndone(
    cs: LarkChatState,
    reply: (text: string) => Promise<void>,
  ): Promise<void> {
    if (cs.lastBotMessageId) {
      try {
        await this.client.deleteMessage(cs.lastBotMessageId);
      } catch (e) {
        logger.warn(`飞书消息撤回失败 (${cs.lastBotMessageId})，尝试用 patchCard 更新:`, e);
        try {
          await this.client.patchCard({
            messageId: cs.lastBotMessageId,
            card: buildLarkCard('complete', { text: '~~已撤销~~' })
          });
        } catch (err) {
          logger.warn(`patchCard 也失败了:`, err);
        }
      }
      cs.lastBotMessageId = undefined;
    } else {
      await reply('✅ 上一轮对话已撤销。');
    }
  }

  /**
   * redo 后在飞书侧补发可见 assistant 文本。
   * Backend 恢复的是原始历史；平台层只负责把最终可见文本重新展示出来。
   */
  private async replayRedoResult(cs: LarkChatState, assistantText: string): Promise<void> {
    if (assistantText.trim()) {
      await this.sendTextToChat(cs, assistantText);
      return;
    }
    await this.sendTextToChat(cs, '✅ 上一轮对话已恢复。');
  }


  // ---- 消息分发 ----

  private async dispatchChat(cs: LarkChatState, message: ParsedLarkMessage): Promise<void> {
    cs.busy = true;
    cs.stopped = false;
    cs.sessionId = this.getSessionId(cs.target.chatKey);
    cs.target = message.session;
    cs.lastInboundMessageId = message.messageId;

    // 流式模式先发占位卡片
    if (this.backend.isStreamEnabled()) {
      await this.initStream(cs);
    }

    // Phase 3：下载消息中的多媒体资源


    let images: ImageInput[] | undefined;
    let documents: DocumentInput[] | undefined;
    if (message.resources.length > 0) {
      const result = await this.downloadMessageResources(message.messageId, message.resources);
      if (result.images.length > 0) images = result.images;
      if (result.documents.length > 0) documents = result.documents;
    }

    try {
      // 将文本和下载后的媒体一并传给 Backend。
      // 目的：让 LLM 能"看到"图片、读取文件内容。
      await this.backend.chat(cs.sessionId, message.text, images, documents, 'lark');
    } catch (err) {
      logger.error(`backend.chat 失败 (session=${cs.sessionId}):`, err);
    }
  }

  private flushPendingMessages(cs: LarkChatState): void {
    const messages = cs.pendingMessages.splice(0);
    if (messages.length === 0) return;

    const latest = messages[messages.length - 1];
    const combinedText = messages.map((m) => m.text).filter(Boolean).join('\n').trim();

    logger.info(`[${cs.sessionId}] 合并 ${messages.length} 条缓冲消息发送`);

    void this.dispatchChat(cs, {
      session: latest.session,
      text: combinedText,
      messageId: latest.messageId,
      chatId: latest.session.chatId,
      threadId: latest.session.threadId,
      senderOpenId: latest.session.userOpenId ?? '',
      messageType: 'text',
      mentioned: false,
      resources: [],
    });
  }

  // ---- Phase 3：多媒体下载 ----

  /**
   * 下载消息中的所有资源引用，分类为图片和文档。
   *
   * 对于 image 类型：下载后转为 base64 ImageInput，供 LLM 视觉理解。
   * 对于 file/audio 类型：下载后转为 base64 DocumentInput，供文档提取。
   */
  private async downloadMessageResources(
    messageId: string,
    resources: import('./types').LarkResourceRef[],
  ): Promise<{ images: ImageInput[]; documents: DocumentInput[] }> {
    const images: ImageInput[] = [];
    const documents: DocumentInput[] = [];

    for (const res of resources) {
      try {
        const resourceType = res.type === 'image' ? 'image' as const : 'file' as const;
        const downloaded = await this.client.downloadResource({
          messageId,
          fileKey: res.fileKey,
          type: resourceType,
        });

        if (res.type === 'image') {
          // 图片：检测 MIME 并转为 base64 ImageInput
          const mimeType = downloaded.contentType || detectImageMime(downloaded.buffer) || 'image/jpeg';
          const base64 = downloaded.buffer.toString('base64');
          images.push({ mimeType, data: base64 });
          logger.debug(`图片下载成功: fileKey=${res.fileKey}, size=${downloaded.buffer.length}`);
        } else {
          // 文件/音频：转为 DocumentInput，由 Backend 内部提取文本
          const fileName = res.fileName || downloaded.fileName || `file_${res.fileKey}`;
          const mimeType = downloaded.contentType || guessMimeByFileName(fileName);
          const base64 = downloaded.buffer.toString('base64');
          documents.push({ fileName, mimeType, data: base64 });
          logger.debug(`文件下载成功: fileKey=${res.fileKey}, fileName=${fileName}, size=${downloaded.buffer.length}`);
        }
      } catch (err) {
        logger.error(`资源下载失败: type=${res.type}, fileKey=${res.fileKey}`, err);
      }
    }

    return { images, documents };
  }

  // ---- Phase 7：去重清理 ----

  /**
   * 定期清理去重集合，避免内存无限增长。
   * 策略：当集合超过阈值时，清空整个集合（简单有效，最多漏掉极少量消息）。
   */
  private cleanupDedupIfNeeded(): void {
    const now = Date.now();
    if (this.messageDedup.size > MESSAGE_DEDUP_MAX_SIZE || now - this.lastDedupCleanup > DEDUP_CLEANUP_INTERVAL_MS) {
      this.messageDedup.clear();
      this.lastDedupCleanup = now;
    }
  }
}

export { LarkPlatform as default };

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
    opus: 'audio/opus',
    ogg: 'audio/ogg',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    mp4: 'video/mp4',
  };
  return ext ? (MIME_MAP[ext] ?? 'application/octet-stream') : 'application/octet-stream';
}

/**
 * 从飞书 WebSocket 事件 payload 中提取消息创建时间（毫秒）。
 *
 * 飞书消息事件的 message.create_time 是毫秒级时间戳字符串。
 * 返回 0 表示无法提取（不阻塞消息处理）。
 */
function extractCreateTimeMs(payload: unknown): number {
  if (!payload || typeof payload !== 'object') return 0;
  const envelope = payload as Record<string, unknown>;
  const event = (envelope.event ?? payload) as Record<string, unknown> | undefined;
  if (!event || typeof event !== 'object') return 0;
  const message = event.message as Record<string, unknown> | undefined;
  if (!message) return 0;

  const createTime = message.create_time;
  if (typeof createTime === 'string') {
    const ms = parseInt(createTime, 10);
    return isNaN(ms) ? 0 : ms;
  }
  if (typeof createTime === 'number') return createTime;
  return 0;
}
