/**
 * 企业微信平台适配器
 *
 * 基于 @wecom/aibot-node-sdk 官方 SDK，使用 WebSocket 长连接模式。
 *
 * 消息流程：
 *   入站：企微消息 → 解析内容 → backend.chat()
 *   出站（流式）：stream:chunk → replyStream(累积文本, finish=false)
 *                 done → replyStream(最终文本, finish=true)
 *   出站（非流式）：response → reply(markdown)
 *
 * 并发控制：
 *   每个 chatKey（私聊/群聊）同一时间只处理一条消息。
 *   AI 输出期间用户发的消息暂存到消息缓冲区，等 done 后合并为一条发送。
 *   /stop — 中止当前回复，关闭流式消息。
 *   /flush — 打断等待，立即将缓冲消息发送给 AI。
 *
 * SDK 参考：https://github.com/WecomTeam/aibot-node-sdk
 * 官方插件参考：https://github.com/WecomTeam/wecom-openclaw-plugin
 */

import { WSClient, generateReqId } from '@wecom/aibot-node-sdk';
import type { WsFrame } from '@wecom/aibot-node-sdk';
import { PlatformAdapter, splitText } from '../base';
import { Backend, ImageInput } from '../../core/backend';
import { createLogger } from '../../logger';

const logger = createLogger('WXWork');

// ============ 常量 ============

/** 流式发送节流间隔（毫秒）— 避免每个 token 都发一次导致队列堆积 */
const STREAM_THROTTLE_MS = 300;

/** 企微单条消息长度上限 */
const MESSAGE_MAX_LENGTH = 4000;

/** 流式"思考中"占位内容 */
const THINKING_PLACEHOLDER = '<think></think>';

/** WebSocket 心跳间隔（毫秒） */
const WS_HEARTBEAT_INTERVAL_MS = 30_000;

/** WebSocket 最大重连次数 */
const WS_MAX_RECONNECT_ATTEMPTS = 100;

/** 图片下载超时（毫秒） */
const IMAGE_DOWNLOAD_TIMEOUT_MS = 30_000;

// ============ 配置类型 ============

export interface WXWorkConfig {
  botId: string;
  secret: string;
  /** 是否在流式回复中展示工具执行状态（默认 true） */
  showToolStatus?: boolean;
}

// ============ 消息解析 ============

/**
 * 企微消息体类型（来自 SDK WsFrame.body）
 * 字段命名与官方 SDK 保持一致。
 */
interface MessageBody {
  msgid: string;
  aibotid?: string;
  chatid?: string;
  chattype: 'single' | 'group';
  from: {
    userid: string;
  };
  response_url?: string;
  msgtype: string;
  text?: { content: string };
  image?: { url?: string; aeskey?: string };
  voice?: { content?: string };
  mixed?: {
    msg_item: Array<{
      msgtype: 'text' | 'image';
      text?: { content: string };
      image?: { url?: string; aeskey?: string };
    }>;
  };
  file?: { url?: string; aeskey?: string };
  quote?: {
    msgtype: string;
    text?: { content: string };
    voice?: { content: string };
    image?: { url?: string; aeskey?: string };
    file?: { url?: string; aeskey?: string };
  };
}

interface ParsedMessage {
  text: string;
  imageUrls: string[];
  imageAesKeys: Map<string, string>;
}

/**
 * 从企微消息体中提取文本和图片。
 * 支持：纯文本、图片、图文混排、语音（转文字）、引用消息。
 * 字段解析逻辑参考官方插件 message-parser.ts。
 */
function parseMessageBody(body: MessageBody): ParsedMessage {
  const textParts: string[] = [];
  const imageUrls: string[] = [];
  const imageAesKeys = new Map<string, string>();

  // 图文混排
  if (body.msgtype === 'mixed' && body.mixed?.msg_item) {
    for (const item of body.mixed.msg_item) {
      if (item.msgtype === 'text' && item.text?.content) {
        textParts.push(item.text.content);
      } else if (item.msgtype === 'image' && item.image?.url) {
        imageUrls.push(item.image.url);
        if (item.image.aeskey) imageAesKeys.set(item.image.url, item.image.aeskey);
      }
    }
  } else {
    // 纯文本
    if (body.text?.content) {
      textParts.push(body.text.content);
    }
    // 语音（已转文字）
    if (body.msgtype === 'voice' && body.voice?.content) {
      textParts.push(body.voice.content);
    }
    // 图片
    if (body.image?.url) {
      imageUrls.push(body.image.url);
      if (body.image.aeskey) imageAesKeys.set(body.image.url, body.image.aeskey);
    }
  }

  // 引用消息
  if (body.quote) {
    if (body.quote.msgtype === 'text' && body.quote.text?.content) {
      textParts.unshift(`[引用] ${body.quote.text.content}`);
    } else if (body.quote.msgtype === 'voice' && body.quote.voice?.content) {
      textParts.unshift(`[引用] ${body.quote.voice.content}`);
    } else if (body.quote.msgtype === 'image' && body.quote.image?.url) {
      imageUrls.push(body.quote.image.url);
      if (body.quote.image.aeskey) imageAesKeys.set(body.quote.image.url, body.quote.image.aeskey);
    }
  }

  return {
    text: textParts.join('\n').trim(),
    imageUrls,
    imageAesKeys,
  };
}

// ============ 超时工具 ============

/** 为 Promise 添加超时保护（参考官方插件 timeout.ts） */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  if (timeoutMs <= 0) return promise;
  let timeoutId: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutId));
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
  /** 当前正在使用的 sessionId */
  sessionId: string;
  /** 当前流式回复的原始帧（回复时需要） */
  frame: WsFrame | null;
  /** 流式回复状态 */
  stream: {
    streamId: string;
    buffer: string;
    /** 已固化到 buffer 中的工具调用 ID 集合 */
    committedToolIds: Set<string>;
    dirty: boolean;
    throttleTimer: ReturnType<typeof setTimeout> | null;
  } | null;
  /** 是否已被 /stop 标记为中止 */
  stopped: boolean;
  /** AI 输出期间暂存的用户消息 */
  pendingMessages: Array<{ text: string; frame: WsFrame }>;
}

// ============ 平台适配器 ============

export class WXWorkPlatform extends PlatformAdapter {
  private wsClient: WSClient;
  private backend: Backend;

  /** 是否在流式回复中展示工具执行状态 */
  private showToolStatus: boolean;

  /**
   * 每个用户/群的当前 sessionId。
   * key = chatKey（私聊 `dm:{userId}`，群聊 `group:{chatId}`）
   * 用 /new 时生成新 sessionId，实现多会话管理。
   */
  private activeSessions = new Map<string, string>();

  /**
   * 每个 chatKey 的运行时状态，负责并发控制。
   * 用于实现：busy 锁、消息缓冲、/stop 中止、/flush 立即推送。
   */
  private chatStates = new Map<string, ChatState>();

  constructor(backend: Backend, config: WXWorkConfig) {
    super();
    this.backend = backend;
    this.showToolStatus = config.showToolStatus !== false;
    // 构造参数与官方插件保持一致
    this.wsClient = new WSClient({
      botId: config.botId,
      secret: config.secret,
      heartbeatInterval: WS_HEARTBEAT_INTERVAL_MS,
      maxReconnectAttempts: WS_MAX_RECONNECT_ATTEMPTS,
    });
  }

  async start(): Promise<void> {
    this.setupBackendListeners();
    this.setupWsListeners();
    this.wsClient.connect();
    logger.info('平台启动中，正在连接企业微信...');
  }

  async stop(): Promise<void> {
    this.wsClient.disconnect();
    // 清理所有节流定时器
    for (const cs of this.chatStates.values()) {
      if (cs.stream?.throttleTimer) clearTimeout(cs.stream.throttleTimer);
    }
    this.chatStates.clear();
    logger.info('平台已停止');
  }

  // ============ ChatState 管理 ============

  /** 获取或创建 chatKey 对应的 ChatState */
  private getChatState(ck: string): ChatState {
    let cs = this.chatStates.get(ck);
    if (!cs) {
      cs = {
        busy: false,
        sessionId: this.getSessionId(ck),
        frame: null,
        stream: null,
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
    // ⚠️ TODO: 实现企业微信工具调用审批功能
    //
    // 当前实现：自动批准所有工具调用（方案 A）。
    // 企业微信 AI Bot API 不支持消息编辑/撤回，无法实现交互式审批 UI。
    // 未来如果企微 SDK 支持卡片消息交互或回调按钮，应在此处实现：
    //   1. 向用户发送包含「批准/拒绝」按钮的卡片消息
    //   2. 收到用户点击回调后调用 this.backend.approveTool(id, approved)
    // ──────────────────────────────────────────────────────────
    this.backend.on('tool:update', (sid: string, invocations: Array<{
      id: string;
      toolName: string;
      status: string;
      args: Record<string, unknown>;
      createdAt: number;
    }>) => {
      // ⚠️ 临时方案：自动批准所有等待审批的工具（跳过人工审批）
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
      if (!cs || !cs.frame || !cs.stream || cs.stopped) return;

      // 按创建时间排序
      const sorted = [...invocations].sort((a, b) => a.createdAt - b.createdAt);

      // 将新完成的工具状态固化到 buffer 中（按时间顺序嵌入 AI 文本之间）
      for (const inv of sorted) {
        const isDone = inv.status === 'success' || inv.status === 'error';
        if (isDone && !cs.stream.committedToolIds.has(inv.id)) {
          cs.stream.committedToolIds.add(inv.id);
          const line = formatToolLine(inv);
          // 末尾留 \n\n，让后续 stream:chunk 的 AI 文本自然另起一段
          cs.stream.buffer = cs.stream.buffer
            ? `${cs.stream.buffer}\n\n${line}\n\n` : `${line}\n\n`;
        }
      }

      // 仍在执行中的工具：临时追加在 buffer 末尾（不固化）
      const activeLine = sorted
        .filter(inv => !cs.stream!.committedToolIds.has(inv.id))
        .map(inv => formatToolLine(inv))
        .join('\n\n');

      const displayText = activeLine
        ? (cs.stream.buffer ? `${cs.stream.buffer}\n\n${activeLine}` : activeLine)
        : cs.stream.buffer;

      if (!displayText) return;
      this.wsClient.replyStream(cs.frame, cs.stream.streamId, displayText, false).catch(err => {
        logger.error(`工具状态更新失败 (session=${sid}):`, err);
      });
    });

    // ---- 流式输出 ----

    this.backend.on('stream:start', (sid: string) => {
      const cs = this.findChatStateBySid(sid);
      if (!cs || cs.stopped) return;
      // stream 已在 dispatchChat 中创建（thinking 占位时），此处复用，仅补建边界情况
      if (!cs.stream && cs.frame) {
        cs.stream = {
          streamId: generateReqId('stream'),
          buffer: '',
          committedToolIds: new Set(),
          dirty: false,
          throttleTimer: null,
        };
      }
    });

    this.backend.on('stream:chunk', (sid: string, chunk: string) => {
      const cs = this.findChatStateBySid(sid);
      if (!cs || !cs.frame || !cs.stream || cs.stopped) return;

      cs.stream.buffer += chunk;
      cs.stream.dirty = true;

      // 节流：STREAM_THROTTLE_MS 内只发一次，避免队列堆积
      if (!cs.stream.throttleTimer) {
        cs.stream.throttleTimer = setTimeout(() => {
          if (!cs.stream) return;
          cs.stream.throttleTimer = null;
          if (!cs.stream.dirty || !cs.frame) return;
          cs.stream.dirty = false;
          this.wsClient.replyStream(cs.frame, cs.stream.streamId, cs.stream.buffer, false).catch((err) => {
            logger.error(`流式发送失败 (session=${sid}):`, err);
          });
        }, STREAM_THROTTLE_MS);
      }
    });

    // ---- 非流式回复 ----

    this.backend.on('response', (sid: string, text: string) => {
      const cs = this.findChatStateBySid(sid);
      if (!cs || !cs.frame || cs.stopped) return;

      if (cs.stream) {
        if (cs.stream.throttleTimer) {
          clearTimeout(cs.stream.throttleTimer);
          cs.stream.throttleTimer = null;
        }
        this.wsClient.replyStream(cs.frame, cs.stream.streamId, text, true).catch((err) => {
          logger.error(`流式关闭失败 (session=${sid}):`, err);
        });
        cs.stream = null;
      } else {
        const streamId = generateReqId('stream');
        this.wsClient.replyStream(cs.frame, streamId, text, true).catch((err) => {
          logger.error(`回复失败 (session=${sid}):`, err);
        });
      }
    });

    // ---- 错误处理 ----

    this.backend.on('error', (sid: string, errorMsg: string) => {
      const cs = this.findChatStateBySid(sid);
      if (!cs || !cs.frame) return;

      const errorText = `❌ 错误: ${errorMsg}`;

      if (cs.stream) {
        if (cs.stream.throttleTimer) {
          clearTimeout(cs.stream.throttleTimer);
          cs.stream.throttleTimer = null;
        }
        this.wsClient.replyStream(cs.frame, cs.stream.streamId, errorText, true).catch(() => {});
        cs.stream = null;
      } else {
        const streamId = generateReqId('stream');
        this.wsClient.replyStream(cs.frame, streamId, errorText, true).catch(() => {});
      }
    });

    // ---- 回合完成：清理状态 + 兜底关闭流 + 处理缓冲消息 ----

    this.backend.on('done', (sid: string) => {
      const cs = this.findChatStateBySid(sid);
      if (!cs) return;

      // 兜底关闭流
      if (cs.frame && cs.stream) {
        if (cs.stream.throttleTimer) {
          clearTimeout(cs.stream.throttleTimer);
          cs.stream.throttleTimer = null;
        }
        if (!cs.stopped) {
          const finalText = cs.stream.buffer || '✅ 处理完成。';
          this.wsClient.replyStream(cs.frame, cs.stream.streamId, finalText, true).catch((err) => {
            logger.error(`done 关闭流失败 (session=${sid}):`, err);
          });
        }
        cs.stream = null;
      }

      // 释放 busy 锁
      cs.busy = false;
      cs.stopped = false;
      cs.frame = null;

      // 处理缓冲消息
      if (cs.pendingMessages.length > 0) {
        this.flushPendingMessages(cs);
      }
    });
  }

  // ============ 企微 WebSocket 事件监听 ============

  private setupWsListeners(): void {
    this.wsClient.on('authenticated', () => {
      logger.info('✅ 企业微信机器人已连接并认证成功');
    });

    this.wsClient.on('disconnected', (reason: string) => {
      logger.warn(`连接断开: ${reason}`);
    });

    this.wsClient.on('reconnecting', (attempt: number) => {
      logger.info(`正在重连 (第 ${attempt} 次)...`);
    });

    this.wsClient.on('error', (error: Error) => {
      logger.error(`WebSocket 错误: ${error.message}`);
    });

    // 统一监听 message 事件（与官方插件一致，消息体内 msgtype 字段区分类型）
    this.wsClient.on('message', (frame: WsFrame) => {
      this.handleIncomingMessage(frame).catch((err) => {
        logger.error('处理入站消息失败:', err);
      });
    });

    // 欢迎语
    this.wsClient.on('event.enter_chat', (frame: WsFrame) => {
      this.wsClient.replyWelcome(frame, {
        msgtype: 'text',
        text: { content: '👋 你好！我是 Iris 助手，有什么可以帮你的？' },
      }).catch((err) => {
        logger.error('发送欢迎语失败:', err);
      });
    });
  }

  // ============ 入站消息处理 ============

  /**
   * 生成 chatKey（用于 activeSessions 的 key）
   * 私聊: `dm:{userId}`  群聊: `group:{chatId}`
   */
  private chatKey(chatType: string, chatId: string, senderId: string): string {
    return chatType === 'group' ? `group:${chatId}` : `dm:${senderId}`;
  }

  /**
   * 获取或创建当前 chatKey 对应的 sessionId
   */
  private getSessionId(chatKey: string): string {
    let sid = this.activeSessions.get(chatKey);
    if (!sid) {
      sid = `wxwork-${chatKey}-${Date.now()}`;
      this.activeSessions.set(chatKey, sid);
    }
    return sid;
  }

  /**
   * 处理 slash 指令。返回 true 表示已处理，不需要再发给 Backend。
   */
  private async handleCommand(
    text: string,
    frame: WsFrame,
    ck: string,
  ): Promise<boolean> {
    const cmd = text.trim().toLowerCase();
    const reply = (content: string) => {
      const streamId = generateReqId('stream');
      return this.wsClient.replyStream(frame, streamId, content, true);
    };

    if (cmd === '/new') {
      const newSid = `wxwork-${ck}-${Date.now()}`;
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
        `${m.current ? '👉 ' : '　 '}**${m.modelName}** → \`${m.modelId}\``
      );
      await reply(`当前可用模型：\n${lines.join('\n')}\n\n切换模型请发送 \`/model 模型名\``);
      return true;
    }

    if (cmd.startsWith('/model ')) {
      const modelName = text.slice('/model '.length).trim();
      try {
        const result = this.backend.switchModel(modelName, 'wxwork');
        await reply(`✅ 模型已切换为 **${result.modelName}** → \`${result.modelId}\``);
      } catch {
        await reply(`❌ 未找到模型 "${modelName}"。发送 /model 查看可用列表。`);
      }
      return true;
    }

    if (cmd === '/help') {
      await reply([
        '📋 **可用指令**',
        '`/new` — 新建对话（清空上下文）',
        '`/clear` — 清空当前对话历史',
        '`/session` — 列出历史会话',
        '`/session 编号` — 切换到指定会话',
        '`/model` — 查看可用模型',
        '`/model 模型名` — 切换模型',
        '`/stop` — 中止当前 AI 回复',
        '`/flush` — 立即发送缓冲中的消息',
        '`/help` — 显示本帮助',
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
      // 只显示最近 20 条，避免消息过长
      const display = metas.slice(0, 20);
      const lines = display.map((m, i) => {
        const date = m.updatedAt
          ? new Date(m.updatedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
          : '未知时间';
        const current = m.id === this.activeSessions.get(ck) ? ' 👈' : '';
        return `**${i + 1}.** ${m.title || '(无标题)'}  _${date}_${current}`;
      });
      const footer = metas.length > 20 ? `\n\n_(共 ${metas.length} 条，仅显示最近 20 条)_` : '';
      await reply(`📋 **历史会话**\n\n${lines.join('\n')}${footer}\n\n发送 \`/session 编号\` 切换`);
      return true;
    }

    if (cmd.startsWith('/session ') || cmd.startsWith('/sessions ')) {
      const arg = text.replace(/^\/(sessions?)\s+/i, '').trim();
      const index = parseInt(arg, 10);
      if (isNaN(index) || index < 1) {
        await reply('❌ 请输入有效的会话编号，例如 `/session 3`');
        return true;
      }
      const metas = await this.backend.listSessionMetas();
      if (index > metas.length) {
        await reply(`❌ 编号 ${index} 超出范围（共 ${metas.length} 条会话）`);
        return true;
      }
      const target = metas[index - 1];
      this.activeSessions.set(ck, target.id);
      const date = target.updatedAt
        ? new Date(target.updatedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
        : '';
      await reply(`✅ 已切换到会话：**${target.title || '(无标题)'}**\n_${date}_`);
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
      // 立即关闭流式消息
      if (cs.frame && cs.stream) {
        if (cs.stream.throttleTimer) {
          clearTimeout(cs.stream.throttleTimer);
          cs.stream.throttleTimer = null;
        }
        const stopText = cs.stream.buffer
          ? `${cs.stream.buffer}\n\n⏹ _（已中止）_`
          : '⏹ 已中止回复。';
        this.wsClient.replyStream(cs.frame, cs.stream.streamId, stopText, true).catch(() => {});
        cs.stream = null;
      }
      logger.info(`[${cs.sessionId}] 用户中止了 AI 回复`);
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
        if (cs.frame && cs.stream) {
          if (cs.stream.throttleTimer) {
            clearTimeout(cs.stream.throttleTimer);
            cs.stream.throttleTimer = null;
          }
          const stopText = cs.stream.buffer
            ? `${cs.stream.buffer}\n\n⏹ _（已中止，处理新消息）_`
            : '⏹ 已中止，处理新消息。';
          this.wsClient.replyStream(cs.frame, cs.stream.streamId, stopText, true).catch(() => {});
          cs.stream = null;
        }
        // 不手动释放 busy —— 等 done 事件自然触发。
        // done 事件会释放 busy、重置 stopped、清空 frame，
        // 并自动调用 flushPendingMessages 处理缓冲消息。
        // 如果在此处手动释放，会在 abort 清理（truncateHistory）完成前
        // 就启动新的 chat，导致读到未清理的历史（孤立 tool_call）。
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
    // 使用最后一条消息的 frame（最新的 req_id）
    const latestFrame = messages[messages.length - 1].frame;

    logger.info(`[${cs.sessionId}] 合并 ${messages.length} 条缓冲消息发送`);

    this.dispatchChat(cs, combinedText, latestFrame).catch((err) => {
      logger.error(`处理缓冲消息失败:`, err);
    });
  }

  /**
   * 实际执行 chat 请求。
   * 设置 busy=true，发送 thinking 占位，调用 backend.chat()。
   * done 事件到来时会释放 busy 锁。
   */
  private async dispatchChat(cs: ChatState, text: string, frame: WsFrame, images?: ImageInput[]): Promise<void> {
    cs.busy = true;
    cs.stopped = false;
    cs.frame = frame;

    // 流式模式先发 thinking 占位
    if (this.backend.isStreamEnabled()) {
      const streamId = generateReqId('stream');
      cs.stream = { streamId, buffer: '', committedToolIds: new Set(), dirty: false, throttleTimer: null };
      try {
        await this.wsClient.replyStream(frame, streamId, THINKING_PLACEHOLDER, false);
      } catch (err) {
        logger.error('发送思考中占位失败:', err);
      }
    }

    try {
      await this.backend.chat(cs.sessionId, text, images, undefined, 'wxwork');
    } catch (err) {
      logger.error(`backend.chat 失败 (session=${cs.sessionId}):`, err);
    }
  }

  private async handleIncomingMessage(frame: WsFrame): Promise<void> {
    const body = frame.body as MessageBody;
    const senderId = body.from.userid;
    const chatId = body.chatid || senderId;
    const chatType = body.chattype ?? 'single';

    const parsed = parseMessageBody(body);
    if (!parsed.text && parsed.imageUrls.length === 0) {
      return;
    }

    const ck = this.chatKey(chatType, chatId, senderId);

    // TODO: 对码门禁 — 后续接入 PairingGuard，当前未实现。
    // 设计文档：.limcode/design/对码系统设计.md

    logger.info(`[${ck}] from=${senderId}: text="${parsed.text.slice(0, 50)}" images=${parsed.imageUrls.length}`);

    // 指令处理（任何时候都能用，不受 busy 影响）
    if (parsed.text.startsWith('/')) {
      const handled = await this.handleCommand(parsed.text, frame, ck);
      if (handled) return;
    }

    const cs = this.getChatState(ck);

    // 如果当前正忙，暂存消息到缓冲区
    if (cs.busy) {
      cs.pendingMessages.push({ text: parsed.text, frame });
      const count = cs.pendingMessages.length;
      // 通过主动推送告知用户消息已暂存
      const noticeStreamId = generateReqId('stream');
      this.wsClient.replyStream(frame, noticeStreamId,
        `📥 消息已暂存（共 ${count} 条），等 AI 回复结束后自动发送。\n发送 \`/flush\` 可立即处理，\`/stop\` 可中止当前回复。`,
        true,
      ).catch(() => {});
      logger.info(`[${cs.sessionId}] 消息已暂存 (共 ${count} 条)`);
      return;
    }

    // 下载图片（如有）
    let images: ImageInput[] | undefined;
    if (parsed.imageUrls.length > 0) {
      images = await this.downloadImages(parsed.imageUrls, parsed.imageAesKeys);
    }

    await this.dispatchChat(cs, parsed.text, frame, images);
  }

  // ============ 图片下载 ============

  /**
   * 下载企微图片。
   * SDK 的 downloadFile 方法内置 AES-256-CBC 解密。
   * 带超时保护（参考官方插件 media-handler.ts）。
   */
  private async downloadImages(
    urls: string[],
    aesKeys: Map<string, string>,
  ): Promise<ImageInput[]> {
    const results: ImageInput[] = [];

    for (const url of urls) {
      try {
        const aesKey = aesKeys.get(url);
        const result = await withTimeout(
          this.wsClient.downloadFile(url, aesKey),
          IMAGE_DOWNLOAD_TIMEOUT_MS,
          `图片下载超时: ${url}`,
        );
        const buffer: Buffer = result.buffer;

        const mimeType = detectImageMime(buffer) || 'image/jpeg';
        const base64 = buffer.toString('base64');

        results.push({ mimeType, data: base64 });
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
  return `${icon} \`${inv.toolName}\` ${label}`;
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
