/**
 * 微信平台适配器 (Weixin Platform Adapter)
 *
 * 基于腾讯微信团队官方 ilink 协议 (Long-polling HTTP).
 *
 * 消息流程：
 *   入站：getUpdates (长轮询) -> 解析 item_list -> backend.chat()
 *   出站：微信不支持消息编辑或流式追加，因此累积所有文本块，在 done 时统一发送。
 *   状态：stream:start 时发送 Typing 状态，done 时取消。
 *
 * 并发控制：
 *   每个用户/会话同一时间只处理一条消息。
 *   AI 输出期间用户发的消息暂存到 pendingMessages，等 done 后合并发送。
 *   /stop — 中止当前回复。
 *   /flush — 打断等待，立即发送缓冲消息。
 *
 * 参考：
 *   SDK: temp/openclaw-weixin-tencent/ (官方 @tencent-weixin/openclaw-weixin v2.0.1)
 *   协议文档：https://ilinkai.weixin.qq.com
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { PlatformAdapter, splitText } from '../base';
import { Backend, ImageInput } from '../../core/backend';
import { createLogger } from '../../logger';

const logger = createLogger('Weixin');

/** 微信语音采样率 */
const SILK_SAMPLE_RATE = 24_000;
/** 媒体大小限制 */
const WEIXIN_MEDIA_MAX_BYTES = 100 * 1024 * 1024;

// ============ 常量 ============

/** 微信单条消息长度上限 */
const MESSAGE_MAX_LENGTH = 4000;

/** 轮询重试延迟 */
const CDN_BASE_URL = 'https://novac2c.cdn.weixin.qq.com/c2c';

const POLL_RETRY_DELAY_MS = 2000;
const POLL_MAX_RETRY_DELAY_MS = 30000;

/** 会话失效冷却时间 (1小时) */
const SESSION_COOLDOWN_MS = 3600000;

/** 上传媒体类型 (UploadMediaType) */
const UploadMediaType = {
  IMAGE: 1,
  VIDEO: 2,
  FILE: 3,
  VOICE: 4,
} as const;

/** 消息类型定义 (MessageType) */
const MessageType = {
  USER: 1,
  BOT: 2,
} as const;

/** 消息项类型 (MessageItemType) */
const MessageItemType = {
  TEXT: 1,
  IMAGE: 2,
  VOICE: 3,
  FILE: 4,
  VIDEO: 5,
} as const;

/** 消息状态 (MessageState) */
const MessageState = {
  NEW: 0,
  GENERATING: 1,
  FINISH: 2,
} as const;

/** 输入状态 (TypingStatus) */
const TypingStatus = {
  TYPING: 1,
  CANCEL: 2,
} as const;

// ============ 类型定义 ============

export interface WeixinConfig {
  baseUrl?: string;
  botToken?: string;
  /** 是否在回复中展示工具执行状态 (默认 true) */
  showToolStatus?: boolean;
}

/** 解析后的媒体项 */
interface MediaItemRef {
  type: number;
  encryptQueryParam: string;
  aesKey?: string;
  fileName?: string;
}

interface WeixinMessage {
  seq?: number;
  message_id?: number;
  from_user_id?: string;
  to_user_id?: string;
  client_id?: string;
  create_time_ms?: number;
  session_id?: string;
  message_type?: number;
  message_state?: number;
  item_list?: MessageItem[];
  context_token?: string;
}

interface MessageItem {
  type?: number;
  msg_id?: string;
  text_item?: { text?: string };
  image_item?: { url?: string; aeskey?: string; media?: CDNMedia; hd_size?: number; mid_size?: number };
  voice_item?: { text?: string; media?: CDNMedia; playtime?: number };
  file_item?: { file_name?: string; media?: CDNMedia; len?: string; md5?: string };
  video_item?: { media?: CDNMedia; video_size?: number; play_length?: number };
  ref_msg?: {
    message_item?: MessageItem;
    title?: string;
  };
}

interface CDNMedia {
  encrypt_query_param?: string;
  aes_key?: string;
  encrypt_type?: number;
}

interface ChatState {
  /** 当前是否有 chat 请求在执行 */
  busy: boolean;
  /** 当前正在使用的 sessionId (Iris 内部会话 ID) */
  sessionId: string;
  /** 最近一次收到消息携带的 context_token (回复时必须携带) */
  contextToken: string | null;
  /** 微信侧的 typing_ticket */
  typingTicket: string | null;
  /** 累积的待发送文本 */
  buffer: string;
  /** 工具调用状态 */
  toolBuffer: string;
  /** 已处理的工具 ID */
  committedToolIds: Set<string>;
  /** 是否已被 /stop 标记为中止 */
  stopped: boolean;
  /** AI 输出期间暂存的用户消息 */
  pendingMessages: Array<{ text: string; message: WeixinMessage; mediaItems: MediaItemRef[] }>;
}

// ============ 平台适配器 ============

export class WeixinPlatform extends PlatformAdapter {
  private backend: Backend;
  private config: WeixinConfig;
  private baseUrl: string;

  private polling = false;
  private getUpdatesBuf = '';
  private cooldownUntil = 0;

  /**
   * 每个用户的运行时状态。
   * key = userId
   */
  private chatStates = new Map<string, ChatState>();

  /**
   * 每个用户的 Iris 会话 ID。
   * key = userId
   */
  private activeSessions = new Map<string, string>();

  constructor(backend: Backend, config: WeixinConfig) {
    super();
    this.backend = backend;
    this.config = config;
    this.baseUrl = (config.baseUrl || 'https://ilinkai.weixin.qq.com').replace(/\/$/, '');

    if (!this.config.botToken) {
      this.loadTokenFromCache();
    }
  }

  private loadTokenFromCache() {
    const cachePath = path.join(process.cwd(), 'data', 'configs', 'weixin-auth.json');
    if (fs.existsSync(cachePath)) {
      try {
        const data = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
        if (data.botToken) {
          this.config.botToken = data.botToken;
          if (data.baseUrl) this.baseUrl = data.baseUrl.replace(/\/$/, '');
          logger.info('从本地缓存加载了微信 Token');
        }
      } catch (err) {
        logger.debug('读取微信 Token 缓存失败:', err);
      }
    }
  }

  private saveTokenToCache(botToken: string, baseUrl: string) {
    const dir = path.join(process.cwd(), 'data', 'configs');
    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const cachePath = path.join(dir, 'weixin-auth.json');
      fs.writeFileSync(cachePath, JSON.stringify({ botToken, baseUrl }, null, 2));
      logger.info(`微信 Token 已保存到本地缓存`);
    } catch (err) {
      logger.warn('保存微信 Token 到缓存失败:', err);
    }
  }

  async start(): Promise<void> {
    if (!this.config.botToken) {
      logger.info('未配置 botToken，准备扫码登录...');
      const { botToken, baseUrl } = await this.performQRLogin();
      this.config.botToken = botToken;
      this.baseUrl = baseUrl.replace(/\/$/, '');
      this.saveTokenToCache(botToken, baseUrl);
    }

    this.setupBackendListeners();
    this.polling = true;
    this.runPollingLoop().catch(err => {
      logger.error('长轮询循环异常退出:', err);
    });
    logger.info(`微信平台启动成功 (BaseUrl: ${this.baseUrl})`);
  }

  private async performQRLogin(retryCount = 0): Promise<{ botToken: string; baseUrl: string }> {
    const qrcodeResp = await fetch(`${this.baseUrl}/ilink/bot/get_bot_qrcode?bot_type=3`);
    if (!qrcodeResp.ok) throw new Error(`获取二维码失败: ${await qrcodeResp.text()}`);
    const qrcodeData = (await qrcodeResp.json()) as any;
    const qrcode: string = qrcodeData.qrcode;
    const qrcodeUrl: string = qrcodeData.qrcode_img_content ?? qrcodeData.qrcode_url ?? '';

    logger.info('----------------------------------------');
    logger.info('请在浏览器打开以下链接扫码登录微信：');
    logger.info(`\n${qrcodeUrl}\n`);
    logger.info('----------------------------------------');

    while (true) {
      const statusResp = await fetch(`${this.baseUrl}/ilink/bot/get_qrcode_status?qrcode=${qrcode}`);
      if (!statusResp.ok) throw new Error(`获取二维码状态失败: ${await statusResp.text()}`);
      const statusData = (await statusResp.json()) as any;

      if (statusData.status === 'confirmed') {
        logger.info('扫码登录成功！');
        return {
          botToken: statusData.bot_token,
          baseUrl: statusData.baseurl || this.baseUrl,
        };
      } else if (statusData.status === 'expired') {
        if (retryCount < 3) {
          logger.warn('二维码已过期，正在重新获取...');
          return this.performQRLogin(retryCount + 1);
        }
        throw new Error('二维码已多次过期，请重新启动程序');
      } else if (statusData.status === 'scaned') {
        logger.info('已扫码，请在微信确认...');
      }
      await this.sleep(2000);
    }
  }

  async stop(): Promise<void> {
    this.polling = false;
    this.chatStates.clear();
    logger.info('平台已停止');
  }

  // ============ API 客户端 ============

  private async apiCall<T>(endpoint: string, body: any, label: string): Promise<T> {
    const url = `${this.baseUrl.replace(/\/$/, '')}/${endpoint.replace(/^\//, '')}`;
    const jsonBody = JSON.stringify({
      ...body,
      base_info: { channel_version: '2.0.1' },
    });

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'AuthorizationType': 'ilink_bot_token',
      'Authorization': `Bearer ${(this.config.botToken || '').trim()}`,
      'X-WECHAT-UIN': this.randomWechatUin(),
    };

    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers,
        body: jsonBody,
      });

      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`${label} HTTP ${resp.status}: ${text}`);
      }

      return await resp.json() as T;
    } catch (err) {
      logger.debug(`${label} 失败:`, err);
      throw err;
    }
  }

  private randomWechatUin(): string {
    const uint32 = crypto.randomBytes(4).readUInt32BE(0);
    return Buffer.from(String(uint32), 'utf-8').toString('base64');
  }

  /** 长轮询获取更新 */
  private async getUpdates(buf: string): Promise<any> {
    return this.apiCall('ilink/bot/getupdates', { get_updates_buf: buf }, 'getUpdates');
  }

  /** 发送消息 */
  private async sendMessage(msg: WeixinMessage): Promise<void> {
    await this.apiCall('ilink/bot/sendmessage', { msg }, 'sendMessage');
  }

  /** 发送输入状态 */
  private async sendTyping(userId: string, ticket: string, status: number): Promise<void> {
    await this.apiCall('ilink/bot/sendtyping', {
      ilink_user_id: userId,
      typing_ticket: ticket,
      status,
    }, 'sendTyping');
  }

  /** 获取配置 (获取 typing_ticket) */
  private async getConfig(userId: string): Promise<any> {
    return this.apiCall('ilink/bot/getconfig', {
      ilink_user_id: userId,
    }, 'getConfig');
  }

  /** 获取上传 URL */
  private async getUploadUrl(params: {
    filekey: string;
    media_type: number;
    to_user_id: string;
    rawsize: number;
    rawfilemd5: string;
    filesize: number;
    no_need_thumb?: boolean;
    aeskey?: string;
  }): Promise<{ upload_param: string }> {
    return this.apiCall('ilink/bot/getuploadurl', params, 'getUploadUrl');
  }

  // ============ CDN 媒体处理 ============

  private aesEcbEncrypt(plaintext: Buffer, key: Buffer): Buffer {
    const cipher = crypto.createCipheriv('aes-128-ecb', key, null);
    return Buffer.concat([cipher.update(plaintext), cipher.final()]);
  }

  private aesEcbDecrypt(ciphertext: Buffer, key: Buffer): Buffer {
    const decipher = crypto.createDecipheriv('aes-128-ecb', key, null);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  }

  private aesEcbPaddedSize(plaintextSize: number): number {
    return Math.ceil((plaintextSize + 1) / 16) * 16;
  }

  private parseAesKey(aesKeyBase64: string): Buffer {
    const decoded = Buffer.from(aesKeyBase64, 'base64');
    if (decoded.length === 16) return decoded;
    if (decoded.length === 32 && /^[0-9a-fA-F]{32}$/.test(decoded.toString('ascii'))) {
      return Buffer.from(decoded.toString('ascii'), 'hex');
    }
    throw new Error(`无法解析 AES key: ${aesKeyBase64}`);
  }

  private async downloadMedia(encryptQueryParam: string, aesKey?: string): Promise<Buffer> {
    const key = aesKey ? this.parseAesKey(aesKey) : null;
    const url = `${CDN_BASE_URL}/download?encrypted_query_param=${encodeURIComponent(encryptQueryParam)}`;

    const maxRetries = 3;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30_000);

        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timeout);

        if (!res.ok) {
          const body = await res.text().catch(() => '(unreadable)');
          throw new Error(`CDN download ${res.status}: ${body}`);
        }

        const raw = Buffer.from(await res.arrayBuffer());
        return key ? this.aesEcbDecrypt(raw, key) : raw;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        logger.warn(`下载媒体失败 (attempt ${attempt}/${maxRetries}): ${lastError.message}`);
        if (attempt < maxRetries) {
          await this.sleep(1000 * attempt);
        }
      }
    }

    throw lastError!;
  }

  private async uploadMedia(buffer: Buffer, mediaType: number, userId: string): Promise<{ encryptQueryParam: string; aesKey: string; fileSizeCiphertext: number }> {
    const aesKey = crypto.randomBytes(16);
    const rawsize = buffer.length;
    const rawfilemd5 = crypto.createHash('md5').update(buffer).digest('hex');
    const filesize = this.aesEcbPaddedSize(rawsize);
    const filekey = crypto.randomBytes(16).toString('hex');

    const uploadUrlResp = await this.getUploadUrl({
      filekey,
      media_type: mediaType,
      to_user_id: userId,
      rawsize,
      rawfilemd5,
      filesize,
      no_need_thumb: true,
      aeskey: aesKey.toString('hex'),
    });

    if (!uploadUrlResp.upload_param) {
      throw new Error('获取上传 URL 失败：没有 upload_param');
    }

    const ciphertext = this.aesEcbEncrypt(buffer, aesKey);
    const uploadUrl = `${CDN_BASE_URL}/upload?encrypted_query_param=${encodeURIComponent(uploadUrlResp.upload_param)}&filekey=${encodeURIComponent(filekey)}`;

    const uploadRes = await fetch(uploadUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: new Uint8Array(ciphertext),
    });

    if (!uploadRes.ok) {
      const errMsg = uploadRes.headers.get('x-error-message') || (await uploadRes.text());
      throw new Error(`CDN 上传失败 ${uploadRes.status}: ${errMsg}`);
    }

    const downloadParam = uploadRes.headers.get('x-encrypted-param');
    if (!downloadParam) {
    throw new Error('CDN 响应缺少 x-encrypted-param');
    }

    return {
      encryptQueryParam: downloadParam,
      aesKey: aesKey.toString('hex'), // uploadMedia in prompt expects base64 or hex? reference uses hex in UploadedFileInfo then converts to base64. User says "返回 encrypt_query_param 和 aes_key"
      fileSizeCiphertext: filesize,
    };
  }

  private async silkToWav(silkBuf: Buffer): Promise<Buffer | null> {
    try {
      // @ts-ignore
      const { decode } = await import('silk-wasm');
      logger.debug(`silkToWav: 解码 ${silkBuf.length} 字节 SILK`);
      const result = await decode(silkBuf, SILK_SAMPLE_RATE);
      const wav = pcmBytesToWav(result.data, SILK_SAMPLE_RATE);
      return wav;
    } catch (err) {
      if ((err as any).code === 'MODULE_NOT_FOUND') {
        logger.warn('silk-wasm 未安装，跳过语音转码');
      } else {
        logger.warn('silkToWav 失败:', err);
      }
      return null;
    }
  }

  // ============ 轮询主循环 ============

  private async runPollingLoop() {
    let retryDelay = POLL_RETRY_DELAY_MS;

    while (this.polling) {
      if (Date.now() < this.cooldownUntil) {
        await this.sleep(5000);
        continue;
      }

      try {
        const resp = await this.getUpdates(this.getUpdatesBuf);

        // 处理 API 错误
        const errCode = resp.errcode ?? resp.ret ?? 0;
        if (errCode !== 0) {
          if (errCode === -14) {
            logger.error('微信会话已失效 (Error -14)，进入1小时冷却期');
            this.cooldownUntil = Date.now() + SESSION_COOLDOWN_MS;
            continue;
          }
          throw new Error(`API Error: ${errCode} ${resp.errmsg}`);
        }

        // 更新游标
        if (resp.get_updates_buf) {
          this.getUpdatesBuf = resp.get_updates_buf;
        }

        // 处理消息
        const msgs = (resp.msgs || []) as WeixinMessage[];
        for (const msg of msgs) {
          this.handleIncomingMessage(msg).catch(err => {
            logger.error('消息处理失败:', err);
          });
        }

        // 成功后重置重试延迟
        retryDelay = POLL_RETRY_DELAY_MS;
      } catch (err) {
        logger.warn(`轮询失败: ${err instanceof Error ? err.message : String(err)}，将在 ${retryDelay}ms 后重试`);
        await this.sleep(retryDelay);
        retryDelay = Math.min(retryDelay * 2, POLL_MAX_RETRY_DELAY_MS);
      }
    }
  }

  private sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ============ 入站消息处理 ============

  private getChatState(userId: string): ChatState {
    let cs = this.chatStates.get(userId);
    if (!cs) {
      cs = {
        busy: false,
        sessionId: this.getSessionId(userId),
        contextToken: null,
        typingTicket: null,
        buffer: '',
        toolBuffer: '',
        committedToolIds: new Set(),
        stopped: false,
        pendingMessages: [],
      };
      this.chatStates.set(userId, cs);
    }
    // 同步 Iris sessionId
    cs.sessionId = this.getSessionId(userId);
    return cs;
  }

  private getSessionId(userId: string): string {
    let sid = this.activeSessions.get(userId);
    if (!sid) {
      sid = `weixin-${userId}-${Date.now()}`;
      this.activeSessions.set(userId, sid);
    }
    return sid;
  }

  private async handleIncomingMessage(msg: WeixinMessage) {
    // 过滤机器人自己的消息 (message_type 2)
    if (msg.message_type === MessageType.BOT) return;

    const userId = msg.from_user_id;
    if (!userId) return;

    const parsed = parseMessageBody(msg);
    if (!parsed.text && parsed.imageUrls.length === 0 && parsed.mediaItems.length === 0) return;

    logger.info(`[${userId}] 收到消息: text="${parsed.text.slice(0, 50)}${parsed.text.length > 50 ? '...' : ''}" images=${parsed.imageUrls.length}`);

    // 指令处理
    if (parsed.text.startsWith('/')) {
      const handled = await this.handleCommand(parsed.text, msg, userId);
      if (handled) return;
    }

    const cs = this.getChatState(userId);
    cs.contextToken = msg.context_token || cs.contextToken;

    // 如果当前正忙，暂存消息
    if (cs.busy) {
      cs.pendingMessages.push({ text: parsed.text, message: msg, mediaItems: parsed.mediaItems });
      const count = cs.pendingMessages.length;
      await this.reply(userId, cs.contextToken,
        `📥 消息已暂存 (共 ${count} 条)，等 AI 回复结束后自动发送。\n发送 /flush 可立即处理，/stop 可中止。`);
      return;
    }

    const images: ImageInput[] = [];
    for (const item of parsed.mediaItems) {
      try {
        const buf = await this.downloadMedia(item.encryptQueryParam, item.aesKey);
        if (item.type === MessageItemType.IMAGE) {
          images.push({
            data: buf.toString('base64'),
            mimeType: 'image/jpeg',
          });
        } else if (item.type === MessageItemType.VOICE) {
          const wav = await this.silkToWav(buf);
          if (wav) {
            // 语音转文字逻辑一般由微信完成，这里解密主要是为了可能的语音直接转发或存档
            // 目前 Iris 主要是文字处理，暂不传音频给 backend
            logger.debug(`[${userId}] 成功解密并转码语音: ${wav.length} 字节`);
          }
        }
      } catch (err) {
        logger.error(`[${userId}] 下载/解密媒体失败:`, err);
      }
    }

    // 更新一次 typing ticket (如果还没有)
    if (!cs.typingTicket) {
      this.getConfig(userId).then(resp => {
        if (resp.typing_ticket) cs.typingTicket = resp.typing_ticket;
      }).catch(() => {});
    }

    // Determine the text to send to backend
    let chatText = parsed.text;
    if (!chatText && images.length > 0) {
      chatText = '[图片消息]';
    } else if (!chatText && parsed.mediaItems.length > 0 && images.length === 0) {
      // All media downloads failed — still need a non-empty message for the LLM
      chatText = '[媒体消息（下载失败）]';
    }

    if (!chatText) {
      // No text and no media — nothing to process
      return;
    }

    await this.dispatchChat(cs, chatText, msg, images.length > 0 ? images : undefined);
  }

  private async dispatchChat(cs: ChatState, text: string, msg: WeixinMessage, images?: ImageInput[]) {
    cs.busy = true;
    cs.stopped = false;
    cs.buffer = '';
    cs.toolBuffer = '';
    cs.committedToolIds.clear();

    try {
      await this.backend.chat(cs.sessionId, text, images, undefined, 'weixin');
    } catch (err) {
      logger.error(`backend.chat 失败 (session=${cs.sessionId}):`, err);
      cs.busy = false; // 异常时立即释放
    }
  }

  // ============ Backend 事件监听 ============

  private findUserIdBySid(sid: string): string | undefined {
    for (const [userId, cs] of this.chatStates.entries()) {
      if (cs.sessionId === sid) return userId;
    }
    return undefined;
  }

  private setupBackendListeners() {
    this.backend.on('stream:start', (sid: string) => {
      const userId = this.findUserIdBySid(sid);
      if (!userId) return;
      const cs = this.getChatState(userId);
      if (cs.typingTicket) {
        this.sendTyping(userId, cs.typingTicket, TypingStatus.TYPING).catch(() => {});
      }
    });

    this.backend.on('stream:chunk', (sid: string, chunk: string) => {
      const userId = this.findUserIdBySid(sid);
      if (!userId) return;
      const cs = this.getChatState(userId);
      if (cs.stopped) return;
      cs.buffer += chunk;
    });

    this.backend.on('response', (sid: string, text: string) => {
      const userId = this.findUserIdBySid(sid);
      if (!userId) return;
      const cs = this.getChatState(userId);
      if (cs.stopped) return;
      cs.buffer = text;
    });

    this.backend.on('tool:update', (sid: string, invocations: any[]) => {
      if (this.config.showToolStatus === false) return;
      const userId = this.findUserIdBySid(sid);
      if (!userId) return;
      const cs = this.getChatState(userId);
      if (cs.stopped) return;

      const sorted = [...invocations].sort((a, b) => a.createdAt - b.createdAt);
      let activeToolsText = '';

      for (const inv of sorted) {
        const isDone = inv.status === 'success' || inv.status === 'error';
        const line = formatToolLine(inv);

        if (isDone) {
          if (!cs.committedToolIds.has(inv.id)) {
            cs.committedToolIds.add(inv.id);
            cs.toolBuffer += `${line}\n`;
          }
        } else {
          activeToolsText += `${line}\n`;
        }
      }

      // 微信不支持流式更新，工具状态只在本地累积。
      // 如果需要实时反馈，可以在此处发送一条临时消息，但微信会刷屏。
      // 因此 Phase 1 选择在最终回复中一并展示。
    });

    this.backend.on('error', (sid: string, errorMsg: string) => {
      const userId = this.findUserIdBySid(sid);
      if (!userId) return;
      const cs = this.getChatState(userId);
      if (cs.stopped) return;
      this.reply(userId, cs.contextToken, `❌ 错误: ${errorMsg}`).catch(() => {});
    });

    this.backend.on('attachments', async (sid: string, attachments: Array<{ type: string; mimeType: string; data: Buffer; fileName?: string }>) => {
      const userId = this.findUserIdBySid(sid);
      if (!userId) return;
      const cs = this.getChatState(userId);
      
      for (const attachment of attachments) {
        try {
          const isImage = attachment.type.startsWith('image/');
          const mediaType = isImage ? UploadMediaType.IMAGE : UploadMediaType.FILE;
          
          const uploaded = await this.uploadMedia(attachment.data, mediaType, userId);
          
          const item: MessageItem = {};
          if (isImage) {
            item.type = MessageItemType.IMAGE;
            item.image_item = {
              media: {
                encrypt_query_param: uploaded.encryptQueryParam,
                aes_key: Buffer.from(uploaded.aesKey, 'hex').toString('base64'),
              },
              hd_size: uploaded.fileSizeCiphertext,
            };
          } else {
            item.type = MessageItemType.FILE;
            item.file_item = {
              media: {
                encrypt_query_param: uploaded.encryptQueryParam,
                aes_key: Buffer.from(uploaded.aesKey, 'hex').toString('base64'),
              },
              file_name: attachment.fileName || 'file.bin',
              len: String(attachment.data.length),
            };
          }

          await this.sendMessage({
            to_user_id: userId,
            message_type: MessageType.BOT,
            item_list: [item],
            context_token: cs.contextToken || undefined,
          });
        } catch (err) {
          logger.error(`[${userId}] 发送附件失败:`, err);
        }
      }
    });

    this.backend.on('done', (sid: string) => {
      const userId = this.findUserIdBySid(sid);
      if (!userId) return;
      const cs = this.getChatState(userId);

      if (cs.typingTicket) {
        this.sendTyping(userId, cs.typingTicket, TypingStatus.CANCEL).catch(() => {});
      }

      if (!cs.stopped) {
        const finalContent = [
          cs.toolBuffer.trim(),
          cs.buffer.trim(),
        ].filter(Boolean).join('\n\n') || '✅ 处理完成。';

        this.reply(userId, cs.contextToken, finalContent).catch(err => {
          logger.error(`最终消息发送失败 (userId=${userId}):`, err);
        });
      }

      // 状态重置
      cs.busy = false;
      cs.stopped = false;

      // 处理缓冲消息
      if (cs.pendingMessages.length > 0) {
        this.flushPendingMessages(cs, userId);
      }
    });
  }

  // ============ 出站消息处理 ============

  private async reply(userId: string, contextToken: string | null, text: string) {
    if (!text) return;

    // 转换 Markdown 为纯文本
    const plainText = markdownToPlainText(text);

    // 分块发送
    const chunks = splitText(plainText, MESSAGE_MAX_LENGTH);
    for (const chunk of chunks) {
      await this.sendMessage({
        to_user_id: userId,
        client_id: `iris-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        message_type: MessageType.BOT,
        message_state: MessageState.FINISH,
        context_token: contextToken || undefined,
        item_list: [{
          type: MessageItemType.TEXT,
          text_item: { text: chunk },
        }],
      });
    }
  }

  private flushPendingMessages(cs: ChatState, userId: string) {
    if (cs.pendingMessages.length === 0) return;

    const messages = cs.pendingMessages.splice(0);
    const combinedText = messages.map(m => m.text).join('\n');
    const { message: latestMsg } = messages[messages.length - 1];

    logger.info(`[${userId}] 合并 ${messages.length} 条缓冲消息发送`);
    this.handleIncomingMessage({ ...latestMsg, item_list: [{ type: MessageItemType.TEXT, text_item: { text: combinedText } }] }).catch(() => {});
  }

  // ============ 指令处理 ============

  private async handleCommand(text: string, msg: WeixinMessage, userId: string): Promise<boolean> {
    const cmd = text.trim().toLowerCase();
    const cs = this.getChatState(userId);
    const ctxToken = msg.context_token || cs.contextToken;

    const fastReply = (content: string) => this.reply(userId, ctxToken, content);

    if (cmd === '/new') {
      const newSid = `weixin-${userId}-${Date.now()}`;
      this.activeSessions.set(userId, newSid);
      await fastReply('✅ 已新建对话，上下文已清空。');
      return true;
    }

    if (cmd === '/stop') {
      if (!cs.busy) {
        await fastReply('ℹ️ 当前没有正在进行的回复。');
        return true;
      }
      cs.stopped = true;
      this.backend.abortChat(cs.sessionId);
      await fastReply('⏹ 已中止回复。');
      return true;
    }

    if (cmd === '/flush') {
      if (!cs.busy && cs.pendingMessages.length === 0) {
        await fastReply('ℹ️ 当前没有正在进行的回复或缓冲中的消息。');
        return true;
      }
      if (cs.busy) {
        cs.stopped = true;
        this.backend.abortChat(cs.sessionId);
        // 等待 done 事件自动触发 flush
      } else {
        this.flushPendingMessages(cs, userId);
      }
      await fastReply('⏹ 已中止当前任务并处理缓冲消息。');
      return true;
    }

    if (cmd === '/help') {
      await fastReply([
        '📋 可用指令',
        '/new — 新建对话',
        '/stop — 中止回复',
        '/flush — 立即处理缓冲消息',
        '/model — 查看/切换模型',
        '/help — 帮助',
      ].join('\n'));
      return true;
    }

    if (cmd === '/model' || cmd === '/models') {
      const models = this.backend.listModels();
      const lines = models.map(m =>
        `${m.current ? '👉 ' : '　 '}**${m.modelName}** → \`${m.modelId}\``
      );
      await fastReply(`当前可用模型：\n${lines.join('\n')}\n\n切换模型请发送 /model 模型名`);
      return true;
    }

    if (cmd.startsWith('/model ')) {
      const modelName = text.slice('/model '.length).trim();
      try {
        const result = this.backend.switchModel(modelName, 'weixin');
        await fastReply(`✅ 模型已切换为 **${result.modelName}**`);
      } catch {
        await fastReply(`❌ 未找到模型 "${modelName}"`);
      }
      return true;
    }

    return false;
  }
}

// ============ 工具函数 ============

/**
 * 从微信消息体中提取文本。
 */
function parseMessageBody(msg: WeixinMessage): { text: string, imageUrls: string[], mediaItems: MediaItemRef[] } {
  const parts: string[] = [];
  const imageUrls: string[] = [];
  const mediaItems: MediaItemRef[] = [];

  if (msg.item_list && msg.item_list.length > 0) {
    for (const item of msg.item_list) {
      if (item.type === MessageItemType.TEXT && item.text_item?.text) {
        parts.push(item.text_item.text);
      } else if (item.type === MessageItemType.IMAGE && item.image_item?.url) {
        imageUrls.push(item.image_item.url);
        logger.debug(`收到图片消息: ${item.image_item.url}`);
      } else if (item.type === MessageItemType.VOICE) {
        if (item.voice_item?.text) parts.push(item.voice_item.text);
      } else if (item.type === MessageItemType.FILE) {
        if (item.file_item?.file_name) parts.push(`[文件: ${item.file_item.file_name}]`);
      }

      // 提取 CDN 媒体
      if (item.type === MessageItemType.IMAGE && item.image_item?.media?.encrypt_query_param) {
        const img = item.image_item;
        const aesKey = img.aeskey ? Buffer.from(img.aeskey, 'hex').toString('base64') : img.media!.aes_key;
        mediaItems.push({
          type: MessageItemType.IMAGE,
          encryptQueryParam: img.media!.encrypt_query_param!,
          aesKey: aesKey || undefined,
        });
      } else if (item.type === MessageItemType.VOICE && item.voice_item?.media?.encrypt_query_param && item.voice_item.media.aes_key) {
        mediaItems.push({
          type: MessageItemType.VOICE,
          encryptQueryParam: item.voice_item.media.encrypt_query_param,
          aesKey: item.voice_item.media.aes_key,
        });
      } else if (item.type === MessageItemType.FILE && item.file_item?.media?.encrypt_query_param && item.file_item.media.aes_key) {
        mediaItems.push({
          type: MessageItemType.FILE,
          encryptQueryParam: item.file_item.media.encrypt_query_param,
          aesKey: item.file_item.media.aes_key,
          fileName: item.file_item.file_name,
        });
      } else if (item.type === MessageItemType.VIDEO && item.video_item?.media?.encrypt_query_param && item.video_item.media.aes_key) {
        mediaItems.push({
          type: MessageItemType.VIDEO,
          encryptQueryParam: item.video_item.media.encrypt_query_param,
          aesKey: item.video_item.media.aes_key,
        });
      }

      // 处理引用消息中的媒体
      if (item.ref_msg?.message_item) {
        const ref = item.ref_msg.message_item;
        if (ref.type === MessageItemType.IMAGE && ref.image_item?.media?.encrypt_query_param) {
          const aesKey = ref.image_item.aeskey ? Buffer.from(ref.image_item.aeskey, 'hex').toString('base64') : ref.image_item.media!.aes_key;
          mediaItems.push({
            type: MessageItemType.IMAGE,
            encryptQueryParam: ref.image_item.media!.encrypt_query_param!,
            aesKey: aesKey || undefined,
          });
        } else if (ref.type === MessageItemType.VOICE && ref.voice_item?.media?.encrypt_query_param && ref.voice_item.media.aes_key) {
          mediaItems.push({
            type: MessageItemType.VOICE,
            encryptQueryParam: ref.voice_item.media.encrypt_query_param,
            aesKey: ref.voice_item.media.aes_key,
          });
        } else if (ref.type === MessageItemType.FILE && ref.file_item?.media?.encrypt_query_param && ref.file_item.media.aes_key) {
          mediaItems.push({
            type: MessageItemType.FILE,
            encryptQueryParam: ref.file_item.media.encrypt_query_param,
            aesKey: ref.file_item.media.aes_key,
            fileName: ref.file_item.file_name,
          });
        }
      }

      // 引用消息处理
      if (item.ref_msg?.message_item) {
        const ref = item.ref_msg.message_item;
        if (ref.type === MessageItemType.TEXT && ref.text_item?.text) {
          parts.unshift(`[引用] ${ref.text_item.text}`);
        } else if (ref.type === MessageItemType.VOICE && ref.voice_item?.text) {
          parts.unshift(`[引用] ${ref.voice_item.text}`);
        }
      }
    }
  }

  return {
    text: parts.join('\n').trim(),
    imageUrls,
    mediaItems,
  };
}

/**
 * 格式化 Markdown 为纯文本。
 */
function markdownToPlainText(text: string): string {
  let result = text;
  // Code blocks: strip fences, keep code content
  result = result.replace(/```[^\n]*\n?([\s\S]*?)```/g, (_, code: string) => code.trim());
  // Images: remove entirely
  result = result.replace(/!\[[^\]]*\]\([^)]*\)/g, '');
  // Links: keep display text only
  result = result.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  // Tables: remove separator rows, then strip leading/trailing pipes and convert inner pipes to spaces
  result = result.replace(/^\|[\s:|-]+\|$/gm, "");
  result = result.replace(/^\|(.+)\|$/gm, (_, inner: string) =>
    inner.split("|").map((cell) => cell.trim()).join("  "),
  );
  // 粗体/斜体
  result = result.replace(/(\*\*|__)(.*?)\1/g, '$2');
  result = result.replace(/(\*|_)(.*?)\1/g, '$2');
  // 行内代码
  result = result.replace(/`([^`]+)`/g, '$1');
  return result;
}

/** 工具状态图标 */
const STATUS_ICONS: Record<string, string> = {
  queued: '⏳',
  executing: '🔧',
  success: '✅',
  error: '❌',
  awaiting_approval: '🔐',
};

/** 工具状态中文 */
const STATUS_LABELS: Record<string, string> = {
  queued: '等待中',
  executing: '执行中',
  success: '成功',
  error: '失败',
  awaiting_approval: '等待审批',
};

function formatToolLine(inv: { toolName: string; status: string }): string {
  const icon = STATUS_ICONS[inv.status] || '⏳';
  const label = STATUS_LABELS[inv.status] || inv.status;
  return `${icon} ${inv.toolName} ${label}`;
}

function pcmBytesToWav(pcm: Uint8Array, sampleRate: number): Buffer {
  const pcmBytes = pcm.byteLength;
  const totalSize = 44 + pcmBytes;
  const buf = Buffer.allocUnsafe(totalSize);
  let offset = 0;

  buf.write('RIFF', offset);
  offset += 4;
  buf.writeUInt32LE(totalSize - 8, offset);
  offset += 4;
  buf.write('WAVE', offset);
  offset += 4;

  buf.write('fmt ', offset);
  offset += 4;
  buf.writeUInt32LE(16, offset);
  offset += 4; // fmt chunk size
  buf.writeUInt16LE(1, offset);
  offset += 2; // PCM format
  buf.writeUInt16LE(1, offset);
  offset += 2; // mono
  buf.writeUInt32LE(sampleRate, offset);
  offset += 4;
  buf.writeUInt32LE(sampleRate * 2, offset);
  offset += 4; // byte rate (mono 16-bit)
  buf.writeUInt16LE(2, offset);
  offset += 2; // block align
  buf.writeUInt16LE(16, offset);
  offset += 2; // bits per sample

  buf.write('data', offset);
  offset += 4;
  buf.writeUInt32LE(pcmBytes, offset);
  offset += 4;

  Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength).copy(buf, offset);

  return buf;
}

