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

// ============ 平台适配器 ============

export class WXWorkPlatform extends PlatformAdapter {
  private wsClient: WSClient;
  private backend: Backend;

  /**
   * 保存每个 sessionId 对应的原始 WsFrame，用于回复。
   * 企微回复必须携带原始帧的 req_id，因此需保留。
   */
  private pendingFrames = new Map<string, WsFrame>();

  /**
   * 流式回复状态。
   * 企微的 replyStream 每次发送的是累积后的完整文本（全量替换），不是增量。
   * 同一个 streamId 贯穿 thinking 占位和后续流式回复，确保最终 finish=true 能关闭 thinking。
   */
  private streamStates = new Map<string, { streamId: string; buffer: string }>();

  constructor(backend: Backend, config: WXWorkConfig) {
    super();
    this.backend = backend;
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
    this.pendingFrames.clear();
    this.streamStates.clear();
    logger.info('平台已停止');
  }

  // ============ Backend 事件监听 ============

  private setupBackendListeners(): void {
    // ---- 流式输出 ----

    this.backend.on('stream:start', (sid: string) => {
      // streamState 已在 handleIncomingMessage 中创建（thinking 占位时），
      // 此处复用同一个 streamId，不再覆盖。
      // 仅在边界情况（如非流式切换）下补建。
      if (!this.streamStates.has(sid)) {
        const frame = this.pendingFrames.get(sid);
        if (!frame) return;
        this.streamStates.set(sid, {
          streamId: generateReqId('stream'),
          buffer: '',
        });
      }
    });

    this.backend.on('stream:chunk', (sid: string, chunk: string) => {
      const frame = this.pendingFrames.get(sid);
      const state = this.streamStates.get(sid);
      if (!frame || !state) return;

      state.buffer += chunk;
      // 企微 replyStream 每次发送完整累积文本（全量替换，与官方插件一致）
      this.wsClient.replyStream(frame, state.streamId, state.buffer, false).catch((err) => {
        logger.error(`流式发送失败 (session=${sid}):`, err);
      });
    });

    // ---- 非流式回复 ----

    this.backend.on('response', (sid: string, text: string) => {
      const frame = this.pendingFrames.get(sid);
      if (!frame) return;

      const state = this.streamStates.get(sid);
      if (state) {
        // 有流式状态说明 thinking 流已启动，用 finish=true 关闭
        this.wsClient.replyStream(frame, state.streamId, text, true).catch((err) => {
          logger.error(`流式关闭失败 (session=${sid}):`, err);
        });
        this.streamStates.delete(sid);
      } else {
        // 纯非流式：直接回复 markdown
        const chunks = splitText(text, MESSAGE_MAX_LENGTH);
        for (const chunk of chunks) {
          this.wsClient.reply(frame, {
            msgtype: 'markdown',
            markdown: { content: chunk },
          }).catch((err) => {
            logger.error(`回复失败 (session=${sid}):`, err);
          });
        }
      }
    });

    // ---- 错误处理 ----

    this.backend.on('error', (sid: string, errorMsg: string) => {
      const frame = this.pendingFrames.get(sid);
      if (!frame) return;

      const state = this.streamStates.get(sid);
      const errorText = `❌ 错误: ${errorMsg}`;

      if (state) {
        this.wsClient.replyStream(frame, state.streamId, errorText, true).catch(() => {});
        this.streamStates.delete(sid);
      } else {
        this.wsClient.reply(frame, {
          msgtype: 'text',
          text: { content: errorText },
        }).catch(() => {});
      }
    });

    // ---- 回合完成：清理状态 + 兆底关闭流 ----

    this.backend.on('done', (sid: string) => {
      const frame = this.pendingFrames.get(sid);
      const state = this.streamStates.get(sid);

      // 流式模式下，done 表示回合结束。
      // 如果流还没关闭（response 未触发 / 工具循环内无文本输出），用累积文本关闭。
      if (frame && state) {
        const finalText = state.buffer || '✅ 处理完成。';
        this.wsClient.replyStream(frame, state.streamId, finalText, true).catch((err) => {
          logger.error(`done 关闭流失败 (session=${sid}):`, err);
        });
        this.streamStates.delete(sid);
      }

      this.pendingFrames.delete(sid);
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

  private async handleIncomingMessage(frame: WsFrame): Promise<void> {
    const body = frame.body as MessageBody;

    // 字段解析与官方插件保持一致：统一用 body.from.userid
    const senderId = body.from.userid;
    const chatId = body.chatid || senderId;
    const chatType = body.chattype ?? 'single';

    if (!chatId) {
      logger.warn('收到无 chatId 的消息，跳过');
      return;
    }

    // sessionId 生成规则
    const sessionId = chatType === 'group'
      ? `wxwork-${chatId}`
      : `wxwork-dm-${senderId}`;

    // 解析消息内容
    const parsed = parseMessageBody(body);

    // 既无文本也无图片则跳过
    if (!parsed.text && parsed.imageUrls.length === 0) {
      logger.debug('空消息，跳过');
      return;
    }

    logger.info(`收到消息 [${sessionId}] from=${senderId}: text="${parsed.text.slice(0, 50)}" images=${parsed.imageUrls.length}`);

    // 保存帧（用于回复）
    this.pendingFrames.set(sessionId, frame);

    // 流式模式下先发 thinking 占位（与官方插件一致）
    if (this.backend.isStreamEnabled()) {
      const streamId = generateReqId('stream');
      this.streamStates.set(sessionId, { streamId, buffer: '' });
      try {
        await this.wsClient.replyStream(frame, streamId, THINKING_PLACEHOLDER, false);
      } catch (err) {
        logger.error('发送思考中占位失败:', err);
      }
    }

    // 下载图片（带超时保护，与官方插件一致）
    let images: ImageInput[] | undefined;
    if (parsed.imageUrls.length > 0) {
      images = await this.downloadImages(parsed.imageUrls, parsed.imageAesKeys);
    }

    // 调用 Backend
    try {
      await this.backend.chat(sessionId, parsed.text, images);
    } catch (err) {
      logger.error(`backend.chat 失败 (session=${sessionId}):`, err);
    }
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
