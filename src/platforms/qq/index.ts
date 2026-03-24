/**
 * QQ 平台适配器
 *
 * 基于 OneBot v11 协议，通过 NapCat 框架连接个人 QQ 账号。
 * 使用正向 WebSocket 长连接模式。
 *
 * 消息流程：
 *   入站：QQ消息 → NapCat → OneBot WS事件 → 解析内容 → backend.chat()
 *   出站：response → sendMessage() → callAction(send_*_msg) → NapCat → QQ
 *
 * 并发控制（与 WXWork 一致）：
 *   每个 chatKey（私聊/群聊）同一时间只处理一条消息。
 *   AI 输出期间用户发的消息暂存到消息缓冲区，等 done 后合并为一条发送。
 *   /stop — 中止当前回复。
 *   /flush — 打断等待，立即将缓冲消息发送给 AI。
 *
 * 不支持流式输出（QQ 不支持消息编辑），所有回复等 response 事件后一次性发送。
 *
 * NapCat 参考：https://github.com/NapNeko/NapCatQQ
 * OneBot v11 参考：https://github.com/botuniverse/onebot-11
 */

import WebSocket from 'ws';
import { PlatformAdapter, splitText } from '../base';
import { Backend, ImageInput } from '../../core/backend';
import { createLogger } from '../../logger';

const logger = createLogger('QQ');

// ============ 常量 ============

/** QQ 单条消息长度上限 */
const MESSAGE_MAX_LENGTH = 4500;

/** 图片下载超时（毫秒） */
const IMAGE_DOWNLOAD_TIMEOUT_MS = 30_000;

/** WebSocket 重连间隔（毫秒） */
const WS_RECONNECT_INTERVAL_MS = 5_000;

/** WebSocket 最大重连次数 */
const WS_MAX_RECONNECT_ATTEMPTS = 100;

/** OneBot Action 请求超时（毫秒） */
const ACTION_TIMEOUT_MS = 30_000;

// ============ 配置类型 ============

export interface QQConfig {
  /** NapCat OneBot v11 正向 WebSocket 地址 */
  wsUrl: string;
  /** OneBot access_token（可选，用于鉴权） */
  accessToken?: string;
  /** 机器人自身 QQ 号（用于群聊 @ 判断） */
  selfId: string;
  /** 群聊响应模式：'at' = 只响应 @机器人（默认），'all' = 响应所有消息，'off' = 不响应群聊 */
  groupMode?: 'at' | 'all' | 'off';
  /** 是否在回复中展示工具执行状态（默认 true） */
  showToolStatus?: boolean;
}

// ============ OneBot v11 类型 ============

/** OneBot 消息段 */
interface OneBotSegment {
  type: string;
  data: Record<string, any>;
}

/** OneBot 消息事件 */
interface OneBotMessageEvent {
  post_type: 'message';
  message_type: 'private' | 'group';
  sub_type: string;
  message_id: number;
  user_id: number;
  group_id?: number;
  message: OneBotSegment[];
  raw_message: string;
  self_id: number;
}

/** OneBot 元事件 */
interface OneBotMetaEvent {
  post_type: 'meta_event';
  meta_event_type: string;
  sub_type?: string;
}

/** OneBot Action 响应 */
interface OneBotActionResponse {
  status: string;
  retcode: number;
  data: any;
  msg?: string;
  wording?: string;
  echo?: string;
}

// ============ 消息解析 ============

interface ParsedMessage {
  text: string;
  imageUrls: string[];
  /** 是否 @了机器人（群聊用） */
  isMentioned: boolean;
}

/**
 * 从 OneBot 消息段数组中提取文本和图片。
 * 支持：纯文本、图片、@、引用消息（忽略内容）。
 */
function parseOneBotMessage(segments: OneBotSegment[], selfId: string): ParsedMessage {
  const textParts: string[] = [];
  const imageUrls: string[] = [];
  let isMentioned = false;

  for (const seg of segments) {
    switch (seg.type) {
      case 'text':
        textParts.push(seg.data.text ?? '');
        break;
      case 'image':
        if (seg.data.url) imageUrls.push(seg.data.url);
        break;
      case 'at':
        if (String(seg.data.qq) === selfId) isMentioned = true;
        break;
      // reply / face / record 等类型暂不处理
    }
  }

  return {
    text: textParts.join('').trim(),
    imageUrls,
    isMentioned,
  };
}

// ============ 消息发送目标 ============

interface MessageTarget {
  userId?: number;
  groupId?: number;
}

// ============ 并发控制 ============

/**
 * 每个 chatKey 的运行时状态。
 *
 * 一个 chatKey 同一时间只有一个 chat 请求在执行。
 * AI 输出期间用户发的后续消息暂存到 pendingMessages 数组。
 * 当前轮 done 后，pendingMessages 合并为一条用户消息发送给 AI。
 */
interface ChatState {
  /** 当前是否有 chat 请求在执行 */
  busy: boolean;
  /** 流式模式下累积的回复内容 */
  streamBuffer: string;
  /** 当前正在使用的 sessionId */
  sessionId: string;
  /** 当前消息的回复目标 */
  target: MessageTarget | null;
  /** 是否已被 /stop 标记为中止 */
  stopped: boolean;
  /** AI 输出期间暂存的用户消息 */
  pendingMessages: Array<{ text: string; target: MessageTarget }>;
}

// ============ 平台适配器 ============

export class QQPlatform extends PlatformAdapter {
  private ws: WebSocket | null = null;
  private backend: Backend;
  private config: QQConfig;

  /** 是否在回复中展示工具执行状态 */
  private showToolStatus: boolean;

  /**
   * 每个用户/群的当前 sessionId。
   * key = chatKey（私聊 `dm:{userId}`，群聊 `group:{groupId}`）
   * 用 /new 时生成新 sessionId，实现多会话管理。
   */
  private activeSessions = new Map<string, string>();

  /**
   * 每个 chatKey 的运行时状态，负责并发控制。
   * 用于实现：busy 锁、消息缓冲、/stop 中止、/flush 立即推送。
   */
  private chatStates = new Map<string, ChatState>();

  /** WS 重连次数 */
  private reconnectAttempts = 0;
  /** 重连定时器 */
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  /** 是否正在主动停止（防止 close 事件触发重连） */
  private stopping = false;

  /** Action 请求计数器（用于生成 echo） */
  private echoCounter = 0;
  /** 等待响应的 Action 请求 */
  private pendingActions = new Map<string, {
    resolve: (data: any) => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();

  /** 已通知的工具调用 ID（避免重复通知） */
  private notifiedToolIds = new Set<string>();

  constructor(backend: Backend, config: QQConfig) {
    super();
    this.backend = backend;
    this.config = config;
    this.showToolStatus = config.showToolStatus !== false;
  }

  async start(): Promise<void> {
    this.setupBackendListeners();
    this.connect();
    logger.info('平台启动中，正在连接 NapCat...');
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    // 清理所有 pending action
    for (const [echo, pending] of this.pendingActions) {
      clearTimeout(pending.timer);
      pending.reject(new Error('平台正在停止'));
      this.pendingActions.delete(echo);
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.chatStates.clear();
    logger.info('平台已停止');
  }

  // ============ WS 连接管理 ============

  private connect(): void {
    const url = this.config.accessToken
      ? `${this.config.wsUrl}?access_token=${encodeURIComponent(this.config.accessToken)}`
      : this.config.wsUrl;

    this.ws = new WebSocket(url);

    this.ws.on('open', () => {
      logger.info('✅ WebSocket 已连接到 NapCat');
      this.reconnectAttempts = 0;
    });

    this.ws.on('message', (raw: WebSocket.Data) => {
      try {
        this.handleWsMessage(String(raw));
      } catch (err) {
        logger.error('处理 WS 消息失败:', err);
      }
    });

    this.ws.on('close', (code: number, reason: Buffer) => {
      logger.warn(`WebSocket 断开: code=${code} reason=${reason.toString()}`);
      if (!this.stopping) {
        this.scheduleReconnect();
      }
    });

    this.ws.on('error', (err: Error) => {
      logger.error(`WebSocket 错误: ${err.message}`);
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= WS_MAX_RECONNECT_ATTEMPTS) {
      logger.error(`达到最大重连次数 (${WS_MAX_RECONNECT_ATTEMPTS})，停止重连`);
      return;
    }
    this.reconnectAttempts++;
    logger.info(`正在重连 (第 ${this.reconnectAttempts} 次)...`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, WS_RECONNECT_INTERVAL_MS);
  }

  // ============ OneBot Action 请求 ============

  /**
   * 通过 WS 发送 OneBot action 请求并等待响应。
   * 使用 echo 字段匹配请求/响应。
   */
  private callAction(action: string, params: Record<string, unknown>): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('WebSocket 未连接'));
        return;
      }

      const echo = `iris_${++this.echoCounter}`;
      const timer = setTimeout(() => {
        this.pendingActions.delete(echo);
        reject(new Error(`Action ${action} 超时 (${ACTION_TIMEOUT_MS}ms)`));
      }, ACTION_TIMEOUT_MS);

      this.pendingActions.set(echo, { resolve, reject, timer });

      this.ws.send(JSON.stringify({ action, params, echo }), (err) => {
        if (err) {
          clearTimeout(timer);
          this.pendingActions.delete(echo);
          reject(err);
        }
      });
    });
  }

  // ============ WS 消息分发 ============

  private handleWsMessage(raw: string): void {
    let data: any;
    try {
      data = JSON.parse(raw);
    } catch {
      logger.warn('收到非 JSON 消息，忽略');
      return;
    }

    // Action 响应（有 echo 字段）
    if (data.echo) {
      const pending = this.pendingActions.get(data.echo);
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingActions.delete(data.echo);
        if (data.retcode === 0) {
          pending.resolve(data.data);
        } else {
          pending.reject(new Error(
            `Action failed [${data.retcode}]: ${data.msg || data.wording || 'unknown'}`
          ));
        }
      }
      return;
    }

    // 事件分发
    switch (data.post_type) {
      case 'message':
        this.handleIncomingMessage(data as OneBotMessageEvent).catch((err) => {
          logger.error('处理入站消息失败:', err);
        });
        break;

      case 'meta_event': {
        const meta = data as OneBotMetaEvent;
        if (meta.meta_event_type === 'lifecycle' && meta.sub_type === 'connect') {
          logger.info('✅ NapCat 生命周期事件: 连接成功');
        }
        // heartbeat 等其他元事件忽略
        break;
      }

      // notice / request 等其他事件暂不处理
    }
  }

  // ============ ChatState 管理 ============

  /** 获取或创建 chatKey 对应的 ChatState */
  private getChatState(ck: string): ChatState {
    let cs = this.chatStates.get(ck);
    if (!cs) {
      cs = {
        busy: false,
        streamBuffer: '',
        sessionId: this.getSessionId(ck),
        target: null,
        stopped: false,
        pendingMessages: [],
      };
      this.chatStates.set(ck, cs);
    }
    // 同步 sessionId（可能被 /new、/session 改过）
    cs.sessionId = this.getSessionId(ck);
    return cs;
  }

  // ============ Backend 事件监听 ============

  /**
   * 根据 sessionId 找到对应的 ChatState。
   * Backend 事件按 sessionId 发送，需要反向查找。
   */
  private findChatStateBySid(sid: string): ChatState | undefined {
    for (const cs of this.chatStates.values()) {
      if (cs.sessionId === sid) return cs;
    }
    return undefined;
  }

  private setupBackendListeners(): void {
    // ──────────────────────────────────────────────────────────
    // ⚠️ 工具调用审批：自动批准所有工具调用。
    // QQ 不支持消息编辑/卡片交互，无法实现交互式审批 UI。
    // ──────────────────────────────────────────────────────────
    this.backend.on('tool:update', (sid: string, invocations: Array<{
      id: string;
      toolName: string;
      status: string;
      args: Record<string, unknown>;
      createdAt: number;
    }>) => {
      // 自动批准所有等待审批的工具
      for (const inv of invocations) {
        if (inv.status === 'awaiting_approval') {
          try {
            this.backend.approveTool(inv.id, true);
          } catch {
            // 状态可能已被并发转换，忽略
          }
        }
      }

      if (!this.showToolStatus) return;

      const cs = this.findChatStateBySid(sid);
      if (!cs || !cs.target || cs.stopped) return;

      // 对新出现的执行中工具发送独立通知消息（避免重复）
      for (const inv of invocations) {
        if (inv.status === 'executing' && !this.notifiedToolIds.has(inv.id)) {
          this.notifiedToolIds.add(inv.id);
          const line = formatToolLine(inv);
          this.sendMessage(line, cs.target).catch((err) => {
            logger.error(`工具状态通知失败 (session=${sid}):`, err);
          });
        }
      }
    });

    // ---- 流式输出：累积到 buffer，等 response 或 done 时一次性发送 ----

    this.backend.on('stream:chunk', (sid: string, chunk: string) => {
      const cs = this.findChatStateBySid(sid);
      if (!cs || cs.stopped) return;
      cs.streamBuffer += chunk;
    });

    // ---- 非流式回复 / 流式结束 ----

    this.backend.on('response', (sid: string, text: string) => {
      const cs = this.findChatStateBySid(sid);
      if (!cs || !cs.target || cs.stopped) return;

      // 优先用 response 文本（非流式模式），流式模式下 response 也会带完整文本
      const finalText = text || cs.streamBuffer;
      cs.streamBuffer = '';
      if (!finalText) return;

      this.sendMessage(finalText, cs.target).catch((err) => {
        logger.error(`回复失败 (session=${sid}):`, err);
      });
    });

    // ---- 错误处理 ----

    this.backend.on('error', (sid: string, errorMsg: string) => {
      const cs = this.findChatStateBySid(sid);
      if (!cs || !cs.target) return;

      this.sendMessage(`❌ 错误: ${errorMsg}`, cs.target).catch(() => {});
    });

    // ---- 回合完成：清理状态 + 处理缓冲消息 ----

    this.backend.on('done', (sid: string) => {
      const cs = this.findChatStateBySid(sid);
      if (!cs) return;

      // 兜底：如果 response 事件没触发（或被 stopped 跳过），
      // 但 streamBuffer 有内容，在 done 时发送
      if (cs.streamBuffer && cs.target && !cs.stopped) {
        const text = cs.streamBuffer;
        cs.streamBuffer = '';
        this.sendMessage(text, cs.target).catch((err) => {
          logger.error(`done 兜底发送失败 (session=${sid}):`, err);
        });
      }

      // 释放 busy 锁
      cs.busy = false;
      cs.stopped = false;
      cs.target = null;

      // 清理本轮的工具通知 ID
      this.notifiedToolIds.clear();

      // 处理缓冲消息
      if (cs.pendingMessages.length > 0) {
        this.flushPendingMessages(cs);
      }
    });
  }

  // ============ 入站消息处理 ============

  /**
   * 生成 chatKey（用于 activeSessions 的 key）
   * 私聊: `dm:{userId}`  群聊: `group:{groupId}`
   */
  private chatKey(messageType: string, userId: number, groupId?: number): string {
    return messageType === 'group' ? `group:${groupId}` : `dm:${userId}`;
  }

  /**
   * 获取或创建当前 chatKey 对应的 sessionId
   */
  private getSessionId(chatKey: string): string {
    let sid = this.activeSessions.get(chatKey);
    if (!sid) {
      sid = `qq-${chatKey}-${Date.now()}`;
      this.activeSessions.set(chatKey, sid);
    }
    return sid;
  }

  /**
   * 处理 slash 指令。返回 true 表示已处理，不需要再发给 Backend。
   */
  private async handleCommand(
    text: string,
    ck: string,
    target: MessageTarget,
  ): Promise<boolean> {
    const cmd = text.trim().toLowerCase();
    const reply = (content: string) => this.sendMessage(content, target);

    if (cmd === '/new') {
      const newSid = `qq-${ck}-${Date.now()}`;
      this.activeSessions.set(ck, newSid);
      await reply('✅ 已新建对话，上下文已清空。');
      return true;
    }

    if (cmd === '/clear') {
      const sid = this.activeSessions.get(ck);
      if (sid) {
        await this.backend.clearSession(sid);
      }
      await reply('✅ 当前对话历史已清空。');
      return true;
    }

    if (cmd === '/model' || cmd === '/models') {
      const models = this.backend.listModels();
      const lines = models.map(m =>
        `${m.current ? '👉 ' : '　 '}${m.modelName} → ${m.modelId}`
      );
      await reply(`当前可用模型：\n${lines.join('\n')}\n\n切换模型请发送 /model 模型名`);
      return true;
    }

    if (cmd.startsWith('/model ')) {
      const modelName = text.slice('/model '.length).trim();
      try {
        const result = this.backend.switchModel(modelName);
        await reply(`✅ 模型已切换为 ${result.modelName} → ${result.modelId}`);
      } catch {
        await reply(`❌ 未找到模型 "${modelName}"。发送 /model 查看可用列表。`);
      }
      return true;
    }

    if (cmd === '/help') {
      await reply([
        '📋 可用指令',
        '/new — 新建对话（清空上下文）',
        '/clear — 清空当前对话历史',
        '/session — 列出历史会话',
        '/session 编号 — 切换到指定会话',
        '/model — 查看可用模型',
        '/model 模型名 — 切换模型',
        '/stop — 中止当前 AI 回复',
        '/flush — 立即发送缓冲中的消息',
        '/help — 显示本帮助',
      ].join('\n'));
      return true;
    }

    // /session — 列出历史会话 或 切换到指定会话
    if (cmd === '/session' || cmd === '/sessions') {
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
        const current = m.id === this.activeSessions.get(ck) ? ' 👈' : '';
        return `${i + 1}. ${m.title || '(无标题)'}  ${date}${current}`;
      });
      const footer = metas.length > 20 ? `\n\n(共 ${metas.length} 条，仅显示最近 20 条)` : '';
      await reply(`📋 历史会话\n\n${lines.join('\n')}${footer}\n\n发送 /session 编号 切换`);
      return true;
    }

    if (cmd.startsWith('/session ') || cmd.startsWith('/sessions ')) {
      const arg = text.replace(/^\/(sessions?)\s+/i, '').trim();
      const index = parseInt(arg, 10);
      if (isNaN(index) || index < 1) {
        await reply('❌ 请输入有效的会话编号，例如 /session 3');
        return true;
      }
      const metas = await this.backend.listSessionMetas();
      if (index > metas.length) {
        await reply(`❌ 编号 ${index} 超出范围（共 ${metas.length} 条会话）`);
        return true;
      }
      const t = metas[index - 1];
      this.activeSessions.set(ck, t.id);
      const date = t.updatedAt
        ? new Date(t.updatedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
        : '';
      await reply(`✅ 已切换到会话：${t.title || '(无标题)'}\n${date}`);
      return true;
    }

    // /stop — 中止当前 AI 回复
    if (cmd === '/stop') {
      const cs = this.chatStates.get(ck);
      if (!cs || !cs.busy) {
        await reply('ℹ️ 当前没有正在进行的回复。');
        return true;
      }
      cs.stopped = true;
      this.backend.abortChat(cs.sessionId);
      logger.info(`[${cs.sessionId}] 用户中止了 AI 回复`);
      await reply('⏹ 已中止回复。');
      return true;
    }

    // /flush — 打断等待，立即推送缓冲消息
    if (cmd === '/flush') {
      const cs = this.chatStates.get(ck);
      if (!cs || (!cs.busy && cs.pendingMessages.length === 0)) {
        await reply('ℹ️ 当前没有正在进行的回复或缓冲中的消息。');
        return true;
      }
      // 先中止当前回复
      if (cs.busy) {
        cs.stopped = true;
        this.backend.abortChat(cs.sessionId);
        // 不手动释放 busy —— 等 done 事件自然触发。
        // done 事件会释放 busy、重置 stopped，
        // 并自动调用 flushPendingMessages 处理缓冲消息。
      } else {
        // 不 busy 但有 pending 消息（边界情况）→ 直接发送
        this.flushPendingMessages(cs);
      }
      logger.info(`[${cs.sessionId}] 用户 /flush：${cs.busy ? '已中止当前回复，等待 done 后自动处理缓冲' : '直接处理缓冲消息'}`);
      return true;
    }

    return false;
  }

  /**
   * 将 pendingMessages 合并为一条消息发送给 AI
   */
  private flushPendingMessages(cs: ChatState): void {
    if (cs.pendingMessages.length === 0) return;

    // 取出所有缓冲消息
    const messages = cs.pendingMessages.splice(0);
    // 合并文本（多条消息用换行分隔）
    const combinedText = messages.map(m => m.text).join('\n');
    // 使用最后一条消息的 target
    const latestTarget = messages[messages.length - 1].target;

    logger.info(`[${cs.sessionId}] 合并 ${messages.length} 条缓冲消息发送`);

    this.dispatchChat(cs, combinedText, latestTarget).catch((err) => {
      logger.error('处理缓冲消息失败:', err);
    });
  }

  /**
   * 实际执行 chat 请求。
   * 设置 busy=true，调用 backend.chat()。
   * done 事件到来时会释放 busy 锁。
   */
  private async dispatchChat(
    cs: ChatState,
    text: string,
    target: MessageTarget,
    images?: ImageInput[],
  ): Promise<void> {
    cs.busy = true;
    cs.stopped = false;
    cs.target = target;

    try {
      await this.backend.chat(cs.sessionId, text, images);
    } catch (err) {
      logger.error(`backend.chat 失败 (session=${cs.sessionId}):`, err);
    }
  }

  private async handleIncomingMessage(event: OneBotMessageEvent): Promise<void> {
    const senderId = event.user_id;
    const groupId = event.group_id;
    const messageType = event.message_type;

    const parsed = parseOneBotMessage(event.message, this.config.selfId);

    // 群聊过滤
    if (messageType === 'group') {
      const mode = this.config.groupMode ?? 'at';
      if (mode === 'off') return;
      if (mode === 'at' && !parsed.isMentioned) return;
    }

    if (!parsed.text && parsed.imageUrls.length === 0) {
      return;
    }

    // TODO: 对码门禁 — 后续接入 PairingGuard，当前未实现。
    // 设计文档：.limcode/design/对码系统设计.md

    const ck = this.chatKey(messageType, senderId, groupId);
    const target: MessageTarget = messageType === 'group'
      ? { groupId }
      : { userId: senderId };

    logger.info(`[${ck}] from=${senderId}: text="${parsed.text.slice(0, 50)}" images=${parsed.imageUrls.length}`);

    // 指令处理（任何时候都能用，不受 busy 影响）
    if (parsed.text.startsWith('/')) {
      const handled = await this.handleCommand(parsed.text, ck, target);
      if (handled) return;
    }

    const cs = this.getChatState(ck);

    // 如果当前正忙，暂存消息到缓冲区
    if (cs.busy) {
      cs.pendingMessages.push({ text: parsed.text, target });
      const count = cs.pendingMessages.length;
      this.sendMessage(
        `📥 消息已暂存（共 ${count} 条），等 AI 回复结束后自动发送。\n发送 /flush 可立即处理，/stop 可中止当前回复。`,
        target,
      ).catch(() => {});
      logger.info(`[${cs.sessionId}] 消息已暂存 (共 ${count} 条)`);
      return;
    }

    // 下载图片（如有）
    let images: ImageInput[] | undefined;
    if (parsed.imageUrls.length > 0) {
      images = await this.downloadImages(parsed.imageUrls);
    }

    await this.dispatchChat(cs, parsed.text, target, images);
  }

  // ============ 消息发送 ============

  /**
   * 统一发送消息方法。
   * 自动处理长消息分段。
   */
  private async sendMessage(text: string, target: MessageTarget): Promise<void> {
    const chunks = splitText(text, MESSAGE_MAX_LENGTH);

    for (const chunk of chunks) {
      const message: OneBotSegment[] = [{ type: 'text', data: { text: chunk } }];

      try {
        if (target.groupId) {
          await this.callAction('send_group_msg', {
            group_id: target.groupId,
            message,
          });
        } else if (target.userId) {
          await this.callAction('send_private_msg', {
            user_id: target.userId,
            message,
          });
        }
      } catch (err) {
        logger.error('发送消息失败:', err);
      }
    }
  }

  // ============ 图片下载 ============

  /**
   * 下载图片。
   * OneBot v11 中图片 URL 是明文 HTTP 地址（NapCat 已处理），无需 AES 解密。
   * 带超时保护。
   */
  private async downloadImages(urls: string[]): Promise<ImageInput[]> {
    const results: ImageInput[] = [];

    for (const url of urls) {
      try {
        const response = await fetch(url, {
          signal: AbortSignal.timeout(IMAGE_DOWNLOAD_TIMEOUT_MS),
        });
        if (!response.ok) {
          logger.error(`图片下载 HTTP 错误: ${response.status} ${url}`);
          continue;
        }
        const buffer = Buffer.from(await response.arrayBuffer());
        const mimeType = detectImageMime(buffer) || 'image/jpeg';
        results.push({ mimeType, data: buffer.toString('base64') });
        logger.debug(`图片下载成功: size=${buffer.length} bytes`);
      } catch (err) {
        logger.error(`图片下载失败: ${url}`, err);
      }
    }

    return results;
  }
}

// ============ 工具函数 ============

/** 工具状态图标映射 */
const STATUS_ICONS: Record<string, string> = {
  queued: '⏳',
  executing: '🔧',
  success: '✅',
  error: '❌',
  streaming: '📡',
  awaiting_approval: '🔐',
  awaiting_apply: '📋',
  warning: '⚠️',
};

/** 工具状态中文标签映射 */
const STATUS_LABELS: Record<string, string> = {
  queued: '等待中',
  executing: '执行中',
  success: '成功',
  error: '失败',
  streaming: '输出中',
  awaiting_approval: '等待审批',
  awaiting_apply: '等待应用',
  warning: '警告',
};

/** 格式化单个工具行 */
function formatToolLine(inv: { toolName: string; status: string }): string {
  const icon = STATUS_ICONS[inv.status] || '⏳';
  const label = STATUS_LABELS[inv.status] || inv.status;
  return `${icon} ${inv.toolName} ${label}`;
}

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
