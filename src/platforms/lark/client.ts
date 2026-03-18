/**
 * 飞书官方 SDK 客户端封装。
 *
 * 职责：
 *   1. 延迟初始化 OpenAPI Client；
 *   2. 管理 WebSocket Client 生命周期；
 *   3. bot 探测、文本/卡片发送与回复；
 *   4. 多媒体下载（入站）：通过 im.messageResource.get 下载消息中的图片/文件/音频。
 *
 * ## 关于多媒体出站（uploadImage / uploadFile / sendImage / sendFile）
 *
 * 这 4 个方法是为出站媒体发送预留的，当前未被 index.ts 调用。
 * 保留原因：API 封装已写好且通过类型检查，出站媒体是近期计划内的功能。
 * 如果长期不接入，应删除，实现时再添加。
 *
 * ## 延迟加载策略
 *
 * 这里使用延迟加载，而不是顶层直接导入 SDK。
 * 目的：即使尚未安装 @larksuiteoapi/node-sdk，测试中的纯逻辑部分也可以先运行，
 * 同时把真正的 SDK 访问收敛到这一处。
 */

import { createLogger } from '../../logger';
import {
  LarkConfig,
  LarkDownloadedResource,
  LarkProbeResult,
  LarkReplyTextOptions,
  LarkSendMediaOptions,
  LarkSendResult,
  LarkUploadFileResult,
  LarkUploadImageResult,
  LarkTextMessageOptions,
  LarkWebSocketStartOptions,
} from './types';

const logger = createLogger('LarkClient');

import { Readable } from 'node:stream';

const MEDIA_DOWNLOAD_TIMEOUT_MS = 30_000; // 媒体下载超时（ms）

interface LarkSdkClientLike {
  request(args: { method: string; url: string; data?: unknown }): Promise<any>;
  im: {
    message: {
      patch(args: {
        path: Record<string, unknown>;
        data: Record<string, unknown>;
      }): Promise<any>;
      create(args: {
        params?: Record<string, unknown>;
        data: Record<string, unknown>;
      }): Promise<any>;
      reply(args: {
        path: Record<string, unknown>;
        data: Record<string, unknown>;
      }): Promise<any>;
    };
    // Phase 3 新增的 messageResource / image / file 通过 request() 或动态属性访问调用。
    // Phase 5 的 message.delete 也通过此动态属性访问。
    // 目的：避免和 SDK 编译时类型强耦合导致 cast 报错。
    [key: string]: any;
  };
}

interface LarkSdkDispatcherLike {
  register(handlers: Record<string, (data: unknown) => Promise<void> | void>): void;
}

interface LarkSdkWsClientLike {
  start(args: { eventDispatcher: LarkSdkDispatcherLike }): Promise<void> | void;
  close(args?: { force?: boolean }): void;
}

interface LarkSdkModuleLike {
  AppType: { SelfBuild: unknown };
  LoggerLevel: { info: unknown };
  Client: new (options: Record<string, unknown>) => LarkSdkClientLike;
  EventDispatcher: new (options: Record<string, unknown>) => LarkSdkDispatcherLike;
  WSClient: new (options: Record<string, unknown>) => LarkSdkWsClientLike;
}

let larkSdkPromise: Promise<LarkSdkModuleLike> | null = null;

async function loadLarkSdk(): Promise<LarkSdkModuleLike> {
  if (!larkSdkPromise) {
    larkSdkPromise = import('@larksuiteoapi/node-sdk') as Promise<LarkSdkModuleLike>;
  }
  return larkSdkPromise;
}

export class LarkClient {
  private sdkClient: LarkSdkClientLike | null = null;
  private wsClient: LarkSdkWsClientLike | null = null;
  private botOpenId?: string;
  private botName?: string;
  private lastProbeResult: LarkProbeResult | null = null;
  private lastProbeAt = 0;

  constructor(private readonly config: LarkConfig) {}

  async getSdkClient(): Promise<LarkSdkClientLike> {
    if (!this.sdkClient) {
      this.assertCredentials();
      const sdk = await loadLarkSdk();
      this.sdkClient = new sdk.Client({
        appId: this.config.appId,
        appSecret: this.config.appSecret,
        appType: sdk.AppType.SelfBuild,
      });
    }
    return this.sdkClient;
  }

  getBotOpenId(): string | undefined {
    return this.botOpenId;
  }

  getBotName(): string | undefined {
    return this.botName;
  }

  isWebSocketConnected(): boolean {
    return this.wsClient !== null;
  }

  async probeBotInfo(options: { maxAgeMs?: number } = {}): Promise<LarkProbeResult> {
    const maxAgeMs = options.maxAgeMs ?? 0;
    if (maxAgeMs > 0 && this.lastProbeResult && Date.now() - this.lastProbeAt < maxAgeMs) {
      return this.lastProbeResult;
    }

    try {
      const client = await this.getSdkClient();
      const response = await client.request({
        method: 'GET',
        url: '/open-apis/bot/v3/info',
        data: {},
      });

      if (response?.code !== 0) {
        return this.cacheProbeResult({
          ok: false,
          appId: this.config.appId,
          error: response?.msg || `code ${String(response?.code ?? 'unknown')}`,
        });
      }

      const bot = response?.bot ?? response?.data?.bot;
      this.botOpenId = bot?.open_id;
      this.botName = bot?.bot_name;
      return this.cacheProbeResult({
        ok: true,
        appId: this.config.appId,
        botOpenId: this.botOpenId,
        botName: this.botName,
      });
    } catch (error) {
      return this.cacheProbeResult({
        ok: false,
        appId: this.config.appId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async sendText(options: LarkTextMessageOptions): Promise<LarkSendResult> {
    const client = await this.getSdkClient();
    const response = await client.im.message.create({
      params: {
        receive_id_type: options.target.receiveIdType,
      },
      data: {
        receive_id: options.target.receiveId,
        msg_type: 'text',
        content: buildLarkTextContent(options.text),
      },
    });

    return {
      messageId: String(response?.data?.message_id ?? ''),
      chatId: String(response?.data?.chat_id ?? ''),
    };
  }

  async replyText(options: LarkReplyTextOptions): Promise<LarkSendResult> {
    const client = await this.getSdkClient();
    const response = await client.im.message.reply({
      path: {
        message_id: normalizeLarkMessageId(options.messageId),
      },
      data: {
        msg_type: 'text',
        content: buildLarkTextContent(options.text),
        reply_in_thread: options.replyInThread,
      },
    });

    return {
      messageId: String(response?.data?.message_id ?? ''),
      chatId: String(response?.data?.chat_id ?? ''),
    };
  }

  /**
   * 发送飞书 interactive 卡片消息。
   * 目的：流式模式先发一个 thinking 卡片，拿到 messageId 后通过 patchCard 更新。
   */
  async sendCard(options: {
    card: Record<string, unknown>;
    target: Pick<import('./types').LarkSessionTarget, 'receiveId' | 'receiveIdType'>;
  }): Promise<import('./types').LarkSendResult> {
    const client = await this.getSdkClient();
    const response = await client.im.message.create({
      params: {
        receive_id_type: options.target.receiveIdType,
      },
      data: {
        receive_id: options.target.receiveId,
        msg_type: 'interactive',
        content: JSON.stringify(options.card),
      },
    });

    return {
      messageId: String(response?.data?.message_id ?? ''),
      chatId: String(response?.data?.chat_id ?? ''),
    };
  }

  /**
   * 更新已发送的飞书卡片消息。
   * 目的：流式输出期间，通过 PATCH 更新卡片内容实现实时刷新。
   */
  async patchCard(options: {
    messageId: string;
    card: Record<string, unknown>;
  }): Promise<void> {
    const client = await this.getSdkClient();
    await client.im.message.patch({
      path: {
        message_id: normalizeLarkMessageId(options.messageId),
      },
      data: {
        content: JSON.stringify(options.card),
      },
    });
  }

  // ---- Phase 5：消息编辑/撤销 ----

  /**
   * 撤回飞书消息。
   * 目的：用于实现 /undo 命令时撤回机器人发出的上一条消息。
   */
  async deleteMessage(messageId: string): Promise<void> {
    const client = await this.getSdkClient();
    // 通过 request 直接调用飞书撤回消息 API，
    // 避免在 LarkSdkClientLike 接口上对 message.delete 做显式声明导致 cast 失败。
    await client.request({
      method: 'DELETE',
      url: `/open-apis/im/v1/messages/${normalizeLarkMessageId(messageId)}`,
    });
  }

  // ---- Phase 3：多媒体下载 ----

  /**
   * 下载飞书消息中的资源文件（图片/文件/音频）。
   * 目的：将入站消息中的 image_key / file_key 转为可供 Backend 使用的二进制数据。
   */
  async downloadResource(options: {
    messageId: string;
    fileKey: string;
    type: 'image' | 'file';
  }): Promise<LarkDownloadedResource> {
    const client = await this.getSdkClient();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), MEDIA_DOWNLOAD_TIMEOUT_MS);

    try {
      const response = await client.im.messageResource.get({
        path: {
          message_id: normalizeLarkMessageId(options.messageId),
          file_key: options.fileKey,
        },
        params: {
          type: options.type,
        },
      });

      const { buffer, contentType, fileName } = await extractBufferFromLarkResponse(response);
      return { buffer, contentType, fileName };
    } finally {
      clearTimeout(timeout);
    }
  }

  // ---- Phase 3：多媒体上传 ----

  // 以下 4 个方法（uploadImage / uploadFile / sendImage / sendFile）
  // 为出站媒体发送预留，当前未被 index.ts 调用。详见文件头注释。

   /**
   * 上传图片到飞书 IM 存储。
   * 目的：将 AI 生成的图片或需要转发的图片上传为 image_key，用于后续发送。
   */
  async uploadImage(imageBuffer: Buffer): Promise<LarkUploadImageResult> {
    const client = await this.getSdkClient();
    const imageStream = Readable.from(imageBuffer);

    const response = await client.im.image.create({
      data: {
        image_type: 'message',
        image: imageStream as any,
      },
    });

    const imageKey = (response as any)?.data?.image_key ?? (response as any)?.image_key;
    if (!imageKey) {
      throw new Error('飞书图片上传失败：响应中缺少 image_key');
    }

    return { imageKey };
  }

  /**
   * 上传文件到飞书 IM 存储。
   * 目的：将需要发送的文件上传为 file_key，用于后续发送。
   */
  async uploadFile(options: {
    buffer: Buffer;
    fileName: string;
    fileType: 'opus' | 'mp4' | 'pdf' | 'doc' | 'xls' | 'ppt' | 'stream';
  }): Promise<LarkUploadFileResult> {
    const client = await this.getSdkClient();
    const fileStream = Readable.from(options.buffer);

    const response = await client.im.file.create({
      data: {
        file_type: options.fileType,
        file_name: options.fileName,
        file: fileStream,
      } as any,
    });

    const fileKey = (response as any)?.data?.file_key ?? (response as any)?.file_key;
    if (!fileKey) {
      throw new Error(`飞书文件上传失败：响应中缺少 file_key (fileName=${options.fileName})`);
    }

    return { fileKey };
  }

  // ---- Phase 3：多媒体发送 ----

  /**
   * 发送图片消息。
   * 目的：在 AI 回复中需要发送图片时，先上传再发送。
   */
  async sendImage(options: LarkSendMediaOptions & { imageKey: string }): Promise<LarkSendResult> {
    const client = await this.getSdkClient();
    const content = JSON.stringify({ image_key: options.imageKey });

    if (options.replyToMessageId) {
      const response = await client.im.message.reply({
        path: { message_id: normalizeLarkMessageId(options.replyToMessageId) },
        data: { msg_type: 'image', content, reply_in_thread: options.replyInThread },
      });
      return {
        messageId: String(response?.data?.message_id ?? ''),
        chatId: String(response?.data?.chat_id ?? ''),
      };
    }

    const response = await client.im.message.create({
      params: { receive_id_type: options.target.receiveIdType },
      data: { receive_id: options.target.receiveId, msg_type: 'image', content },
    });
    return {
      messageId: String(response?.data?.message_id ?? ''),
      chatId: String(response?.data?.chat_id ?? ''),
    };
  }

  /**
   * 发送文件消息。
   * 目的：在 AI 回复中需要发送文件时，先上传再发送。
   */
  async sendFile(options: LarkSendMediaOptions & { fileKey: string }): Promise<LarkSendResult> {
    const client = await this.getSdkClient();
    const content = JSON.stringify({ file_key: options.fileKey });

    if (options.replyToMessageId) {
      const response = await client.im.message.reply({
        path: { message_id: normalizeLarkMessageId(options.replyToMessageId) },
        data: { msg_type: 'file', content, reply_in_thread: options.replyInThread },
      });
      return {
        messageId: String(response?.data?.message_id ?? ''),
        chatId: String(response?.data?.chat_id ?? ''),
      };
    }

    const response = await client.im.message.create({
      params: { receive_id_type: options.target.receiveIdType },
      data: { receive_id: options.target.receiveId, msg_type: 'file', content },
    });
    return {
      messageId: String(response?.data?.message_id ?? ''),
      chatId: String(response?.data?.chat_id ?? ''),
    };
  }

  async startWebSocket(options: LarkWebSocketStartOptions): Promise<void> {
    this.assertCredentials();
    const sdk = await loadLarkSdk();

    if (options.autoProbe !== false) {
      const probe = await this.probeBotInfo();
      if (!probe.ok) {
        throw new Error(`飞书 bot 探测失败：${probe.error ?? '未知错误'}`);
      }
    }

    if (this.wsClient) {
      logger.warn('检测到旧的飞书 WebSocket 客户端，先执行关闭。');
      this.stopWebSocket();
    }

    const dispatcher = new sdk.EventDispatcher({
      encryptKey: this.config.encryptKey ?? '',
      verificationToken: this.config.verificationToken ?? '',
    });
    dispatcher.register(options.handlers);

    this.wsClient = new sdk.WSClient({
      appId: this.config.appId,
      appSecret: this.config.appSecret,
      loggerLevel: sdk.LoggerLevel.info,
    });

    const currentWsClient = this.wsClient;
    await this.waitForAbort(currentWsClient, dispatcher, options.abortSignal);
  }

  stopWebSocket(): void {
    if (!this.wsClient) return;
    try {
      this.wsClient.close({ force: true });
    } catch {
      // 这里忽略关闭阶段的错误。
      // 目的：确保 stop/dispose 是幂等的，避免二次关闭把流程打断。
    } finally {
      this.wsClient = null;
    }
  }

  dispose(): void {
    this.stopWebSocket();
    this.sdkClient = null;
  }

  private assertCredentials(): void {
    if (!this.config.appId || !this.config.appSecret) {
      throw new Error('LarkClient 初始化失败：缺少 appId 或 appSecret。');
    }
  }

  private cacheProbeResult(result: LarkProbeResult): LarkProbeResult {
    this.lastProbeResult = result;
    this.lastProbeAt = Date.now();
    return result;
  }

  private waitForAbort(
    wsClient: LarkSdkWsClientLike,
    dispatcher: LarkSdkDispatcherLike,
    abortSignal?: AbortSignal,
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (abortSignal?.aborted) {
        this.stopWebSocket();
        resolve();
        return;
      }

      abortSignal?.addEventListener('abort', () => {
        this.stopWebSocket();
        resolve();
      }, { once: true });

      try {
        const maybePromise = wsClient.start({ eventDispatcher: dispatcher });
        Promise.resolve(maybePromise).catch((error) => {
          this.stopWebSocket();
          reject(error);
        });
      } catch (error) {
        this.stopWebSocket();
        reject(error);
      }
    });
  }
}

export function buildLarkTextContent(text: string): string {
  return JSON.stringify({ text });
}

export function normalizeLarkMessageId(messageId: string): string {
  const normalized = String(messageId ?? '').trim();
  const separatorIndex = normalized.indexOf(':');
  return separatorIndex >= 0 ? normalized.slice(0, separatorIndex) : normalized;
}

/**
 * 从飞书 SDK 响应中提取二进制数据。
 *
 * 飞书 Node SDK 在不同版本 / 运行时下返回的数据格式不一致：
 *   - 直接 Buffer
 *   - ArrayBuffer
 *   - { data: Buffer | ArrayBuffer | Readable }
 *   - { getReadableStream(): Readable }
 *   - { writeFile(path): void }
 *   - Readable stream
 *
 * 参考 openclaw-lark 的 extractBufferFromResponse 实现。
 */
async function extractBufferFromLarkResponse(
  response: unknown,
): Promise<{ buffer: Buffer; contentType?: string; fileName?: string }> {
  // 直接 Buffer
  if (Buffer.isBuffer(response)) {
    return { buffer: response };
  }

  // ArrayBuffer
  if (response instanceof ArrayBuffer) {
    return { buffer: Buffer.from(response) };
  }

  if (response == null) {
    throw new Error('飞书资源下载失败：响应为 null/undefined');
  }

  const resp = response as Record<string, any>;
  const contentType: string | undefined =
    resp.headers?.['content-type'] ?? resp.contentType ?? undefined;

  // 从 Content-Disposition 提取文件名
  let fileName: string | undefined;
  const disposition =
    resp.headers?.['content-disposition'] ?? resp.headers?.['Content-Disposition'];
  if (typeof disposition === 'string') {
    const match = disposition.match(/filename[*]?=(?:UTF-8'')?["']?([^"';\n]+)/i);
    if (match) {
      fileName = decodeURIComponent(match[1].trim());
    }
  }

  // .data 可能是 Buffer / ArrayBuffer / Readable
  if (resp.data != null) {
    if (Buffer.isBuffer(resp.data)) {
      return { buffer: resp.data, contentType, fileName };
    }
    if (resp.data instanceof ArrayBuffer) {
      return { buffer: Buffer.from(resp.data), contentType, fileName };
    }
    // .data 是 Readable stream
    if (typeof resp.data.pipe === 'function') {
      const buf = await collectStream(resp.data);
      return { buffer: buf, contentType, fileName };
    }
  }

  // .getReadableStream() 方法
  if (typeof resp.getReadableStream === 'function') {
    const stream = await resp.getReadableStream();
    const buf = await collectStream(stream);
    return { buffer: buf, contentType, fileName };
  }

  // 自身就是 Readable stream
  if (typeof resp.pipe === 'function') {
    const buf = await collectStream(resp as Readable);
    return { buffer: buf, contentType, fileName };
  }

  throw new Error('飞书资源下载失败：无法从响应中提取二进制数据');
}

/** 将 Readable stream 收集为 Buffer */
function collectStream(stream: Readable): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer | Uint8Array) => chunks.push(Buffer.from(chunk)));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

