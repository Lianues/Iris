import { createExtensionLogger, definePlatformFactory } from '@irises/extension-sdk';
import { buildLarkCard, formatLarkToolLine, type LarkToolStatusEntry } from './card-builder';
import { LarkClient } from './client';
import { LarkCommandRouter } from './commands';
import { LarkMessageHandler } from './message-handler';
import type {
  DocumentInputLike,
  ImageInputLike,
  IrisBackendLike,
  IrisPlatformFactoryContextLike,
  IrisToolInvocationLike,
  LarkConfig,
  LarkSessionTarget,
  ParsedLarkMessage,
  LarkResourceRef,
} from './types';

const logger = createExtensionLogger('LarkExtension', 'Lark');
const STREAM_THROTTLE_MS = 1000;
const BUFFERED_NOTICE = '📥 消息已暂存，等 AI 回复结束后自动发送。\n发送 /flush 可立即处理，/stop 可中止当前回复。';
const MESSAGE_DEDUP_MAX_SIZE = 500;
const MESSAGE_EXPIRE_MS = 30_000;
const DEDUP_CLEANUP_INTERVAL_MS = 60_000;

interface LarkPendingMessage {
  session: LarkSessionTarget;
  text: string;
  messageId: string;
}

interface LarkStreamState {
  cardMessageId: string;
  buffer: string;
  committedToolIds: Set<string>;
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
  lastBotMessageId?: string;
  stream: LarkStreamState | null;
}

export class LarkPlatform {
  private client: LarkClient;
  private readonly messageHandler = new LarkMessageHandler();
  private readonly commandRouter = new LarkCommandRouter();
  private readonly showToolStatus: boolean;
  private readonly chatStates = new Map<string, LarkChatState>();
  private readonly activeSessions = new Map<string, string>();
  private wsAbortController?: AbortController;
  private readonly messageDedup = new Set<string>();
  private lastDedupCleanup = Date.now();
  private backendListenersReady = false;

  constructor(
    private readonly backend: IrisBackendLike,
    private readonly config: LarkConfig,
  ) {
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

  private getSessionId(chatKey: string): string {
    let sid = this.activeSessions.get(chatKey);
    if (!sid) {
      sid = `lark-${chatKey.replace(/:/g, '-')}-${Date.now()}`;
      this.activeSessions.set(chatKey, sid);
    }
    return sid;
  }

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

  private setupBackendListeners(): void {
    if (this.backendListenersReady) return;
    this.backendListenersReady = true;

    this.backend.on('tool:update', (sid: string, invocations: IrisToolInvocationLike[]) => {
      for (const inv of invocations) {
        if (inv.status === 'awaiting_approval' && typeof this.backend.approveTool === 'function') {
          try {
            this.backend.approveTool(inv.id, true);
          } catch {
            // ignore
          }
        }
      }

      if (!this.showToolStatus) return;
      const cs = this.findChatStateBySid(sid);
      if (!cs?.stream || cs.stopped) return;

      const sorted = [...invocations].sort((a, b) => a.createdAt - b.createdAt);

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

      cs.stream.activeToolEntries = sorted
        .filter((inv) => !cs.stream!.committedToolIds.has(inv.id))
        .map((inv) => ({
          id: inv.id,
          toolName: inv.toolName,
          status: inv.status,
          createdAt: inv.createdAt,
        }));

      this.patchStreamCard(cs);
    });

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

    this.backend.on('response', (sid: string, text: string) => {
      const cs = this.findChatStateBySid(sid);
      if (!cs || cs.stopped) return;

      if (cs.stream) {
        this.finalizeStreamCard(cs, text);
      } else {
        void this.sendTextToChat(cs, text);
      }
    });

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

  private async initStream(cs: LarkChatState): Promise<void> {
    try {
      const card = buildLarkCard('thinking');
      const result = await this.client.sendCard({ card, target: cs.target });
      cs.lastBotMessageId = result.messageId;
      cs.stream = {
        cardMessageId: result.messageId,
        buffer: '',
        committedToolIds: new Set(),
        activeToolEntries: [],
        dirty: false,
        throttleTimer: null,
      };
    } catch (error) {
      logger.warn('发送占位卡片失败，降级为非流式模式:', error);
    }
  }

  private patchStreamCard(cs: LarkChatState): void {
    if (!cs.stream) return;
    const card = buildLarkCard('streaming', {
      text: cs.stream.buffer,
      toolEntries: cs.stream.activeToolEntries,
    });
    this.client.patchCard({ messageId: cs.stream.cardMessageId, card }).catch((error) => {
      logger.error('流式卡片更新失败:', error);
    });
  }

  private finalizeStreamCard(cs: LarkChatState, text: string, isError?: boolean): void {
    if (!cs.stream) return;
    if (cs.stream.throttleTimer) {
      clearTimeout(cs.stream.throttleTimer);
      cs.stream.throttleTimer = null;
    }
    const card = buildLarkCard('complete', { text, isError });
    this.client.patchCard({ messageId: cs.stream.cardMessageId, card }).catch((error) => {
      logger.error('流式卡片关闭失败:', error);
    });
  }

  private cleanupStream(cs: LarkChatState): void {
    if (cs.stream?.throttleTimer) clearTimeout(cs.stream.throttleTimer);
    cs.stream = null;
  }

  private async sendTextToChat(cs: LarkChatState, text: string): Promise<void> {
    if (cs.lastInboundMessageId) {
      const res = await this.client.replyText({
        messageId: cs.lastInboundMessageId,
        text,
        replyInThread: Boolean(cs.target.threadId),
      });
      cs.lastBotMessageId = res.messageId;
    } else {
      const res = await this.client.sendText({ text, target: cs.target });
      cs.lastBotMessageId = res.messageId;
    }
  }

  private async handleIncomingEvent(payload: unknown): Promise<void> {
    const parsed = this.messageHandler.parseIncomingMessage(payload);
    if (!parsed) return;

    if (this.messageDedup.has(parsed.messageId)) {
      logger.debug(`跳过重复消息: ${parsed.messageId}`);
      return;
    }
    this.messageDedup.add(parsed.messageId);
    this.cleanupDedupIfNeeded();

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

    if (parsed.text.startsWith('/')) {
      const handled = await this.handleCommand(parsed.text, cs);
      if (handled) return;
    }

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
        if (typeof this.backend.clearSession !== 'function') {
          await reply('❌ 当前宿主未提供清空会话能力。');
          return true;
        }
        await this.backend.clearSession(cs.sessionId);
        await reply('✅ 当前对话历史已清空。');
        return true;
      }

      case 'model':
      case 'models': {
        if (cmd.args) {
          if (typeof this.backend.switchModel !== 'function') {
            await reply('❌ 当前宿主未提供模型切换能力。');
            return true;
          }
          try {
            const result = this.backend.switchModel(cmd.args, 'lark');
            await reply(`✅ 模型已切换为 ${result.modelName} → ${result.modelId}`);
          } catch {
            await reply(`❌ 未找到模型 "${cmd.args}"。发送 /model 查看可用列表。`);
          }
        } else {
          const models = typeof this.backend.listModels === 'function' ? this.backend.listModels() : [];
          const lines = models.map((model) => `${model.current ? '👉 ' : '   '}${model.modelName} → ${model.modelId}`);
          await reply(`当前可用模型：\n${lines.join('\n')}\n\n切换模型请发送 /model 模型名`);
        }
        return true;
      }

      case 'session':
      case 'sessions': {
        if (typeof this.backend.listSessionMetas !== 'function') {
          await reply('❌ 当前宿主未提供会话列表能力。');
          return true;
        }
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
          const lines = display.map((meta, index) => {
            const date = meta.updatedAt
              ? new Date(meta.updatedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
              : '未知时间';
            const current = meta.id === cs.sessionId ? ' 👈' : '';
            return `${index + 1}. ${meta.title || '(无标题)'}  ${date}${current}`;
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
        this.backend.abortChat?.(cs.sessionId);
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
          this.backend.abortChat?.(cs.sessionId);
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
        if (typeof this.backend.undo !== 'function') {
          await reply('❌ 当前宿主未提供撤销能力。');
          return true;
        }
        const undoResult = await this.backend.undo(cs.sessionId, 'last-turn');
        if (!undoResult) {
          await reply('ℹ️ 没有可以撤销的对话。');
          return true;
        }
        await this.markBotMessageAsUndone(cs, reply);
        return true;
      }

      case 'redo': {
        if (cs.busy) {
          await reply('ℹ️ 当前正在回复中，请先 /stop。');
          return true;
        }
        if (typeof this.backend.redo !== 'function') {
          await reply('❌ 当前宿主未提供恢复能力。');
          return true;
        }
        const redoResult = await this.backend.redo(cs.sessionId);
        if (!redoResult) {
          await reply('ℹ️ 没有可以恢复的对话。');
          return true;
        }
        await this.replayRedoResult(cs, redoResult.assistantText ?? '');
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

  private async markBotMessageAsUndone(
    cs: LarkChatState,
    reply: (text: string) => Promise<void>,
  ): Promise<void> {
    if (cs.lastBotMessageId) {
      try {
        await this.client.deleteMessage(cs.lastBotMessageId);
      } catch (error) {
        logger.warn(`飞书消息撤回失败 (${cs.lastBotMessageId})，尝试用 patchCard 更新:`, error);
        try {
          await this.client.patchCard({
            messageId: cs.lastBotMessageId,
            card: buildLarkCard('complete', { text: '~~已撤销~~' }),
          });
        } catch (patchError) {
          logger.warn('patchCard 也失败了:', patchError);
        }
      }
      cs.lastBotMessageId = undefined;
    } else {
      await reply('✅ 上一轮对话已撤销。');
    }
  }

  private async replayRedoResult(cs: LarkChatState, assistantText: string): Promise<void> {
    if (assistantText.trim()) {
      await this.sendTextToChat(cs, assistantText);
      return;
    }
    await this.sendTextToChat(cs, '✅ 上一轮对话已恢复。');
  }

  private async dispatchChat(cs: LarkChatState, message: ParsedLarkMessage): Promise<void> {
    cs.busy = true;
    cs.stopped = false;
    cs.sessionId = this.getSessionId(message.session.chatKey);
    cs.target = message.session;
    cs.lastInboundMessageId = message.messageId;

    if (this.backend.isStreamEnabled()) {
      await this.initStream(cs);
    }

    let images: ImageInputLike[] | undefined;
    let documents: DocumentInputLike[] | undefined;
    if (message.resources.length > 0) {
      const result = await this.downloadMessageResources(message.messageId, message.resources);
      if (result.images.length > 0) images = result.images;
      if (result.documents.length > 0) documents = result.documents;
    }

    try {
      await this.backend.chat(cs.sessionId, message.text, images, documents, 'lark');
    } catch (error) {
      logger.error(`backend.chat 失败 (session=${cs.sessionId}):`, error);
    }
  }

  private flushPendingMessages(cs: LarkChatState): void {
    const messages = cs.pendingMessages.splice(0);
    if (messages.length === 0) return;

    const latest = messages[messages.length - 1];
    const combinedText = messages.map((message) => message.text).filter(Boolean).join('\n').trim();

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

  private async downloadMessageResources(
    messageId: string,
    resources: LarkResourceRef[],
  ): Promise<{ images: ImageInputLike[]; documents: DocumentInputLike[] }> {
    const images: ImageInputLike[] = [];
    const documents: DocumentInputLike[] = [];

    for (const resource of resources) {
      try {
        const resourceType = resource.type === 'image' ? 'image' as const : 'file' as const;
        const downloaded = await this.client.downloadResource({
          messageId,
          fileKey: resource.fileKey,
          type: resourceType,
        });

        if (resource.type === 'image') {
          const mimeType = downloaded.contentType || detectImageMime(downloaded.buffer) || 'image/jpeg';
          const base64 = downloaded.buffer.toString('base64');
          images.push({ mimeType, data: base64 });
          logger.debug(`图片下载成功: fileKey=${resource.fileKey}, size=${downloaded.buffer.length}`);
        } else {
          const fileName = resource.fileName || downloaded.fileName || `file_${resource.fileKey}`;
          const mimeType = downloaded.contentType || guessMimeByFileName(fileName);
          const base64 = downloaded.buffer.toString('base64');
          documents.push({ fileName, mimeType, data: base64 });
          logger.debug(`文件下载成功: fileKey=${resource.fileKey}, fileName=${fileName}, size=${downloaded.buffer.length}`);
        }
      } catch (error) {
        logger.error(`资源下载失败: type=${resource.type}, fileKey=${resource.fileKey}`, error);
      }
    }

    return { images, documents };
  }

  private cleanupDedupIfNeeded(): void {
    const now = Date.now();
    if (this.messageDedup.size > MESSAGE_DEDUP_MAX_SIZE || now - this.lastDedupCleanup > DEDUP_CLEANUP_INTERVAL_MS) {
      this.messageDedup.clear();
      this.lastDedupCleanup = now;
    }
  }
}

export const createLarkPlatform = definePlatformFactory<LarkConfig, LarkPlatform>({
  platformName: 'lark',
  resolveConfig: (raw) => ({
    appId: String(raw.appId ?? ''),
    appSecret: String(raw.appSecret ?? ''),
    verificationToken: normalizeOptionalString(raw.verificationToken),
    encryptKey: normalizeOptionalString(raw.encryptKey),
    showToolStatus: raw.showToolStatus !== false,
  }),
  create: (backend, config) => new LarkPlatform(backend, config),
});

export const platform = createLarkPlatform;
export default createLarkPlatform;

export * from './types';
export * from './client';
export * from './message-handler';
export * from './commands';
export * from './card-builder';

function detectImageMime(buffer: Buffer): string | null {
  if (buffer.length < 4) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'image/png';
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) return 'image/gif';
  if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46
    && buffer.length >= 12 && buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) return 'image/webp';
  if (buffer[0] === 0x42 && buffer[1] === 0x4d) return 'image/bmp';
  return null;
}

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
    return Number.isNaN(ms) ? 0 : ms;
  }
  if (typeof createTime === 'number') return createTime;
  return 0;
}

function normalizeOptionalString(value: unknown): string | undefined {
  const normalized = String(value ?? '').trim();
  return normalized || undefined;
}
