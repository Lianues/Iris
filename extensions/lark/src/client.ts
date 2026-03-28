import { Readable } from 'node:stream';
import { createExtensionLogger } from '@irises/extension-sdk';
import type {
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

const logger = createExtensionLogger('LarkExtension', 'LarkClient');
const MEDIA_DOWNLOAD_TIMEOUT_MS = 30_000;

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

  async sendCard(options: {
    card: Record<string, unknown>;
    target: { receiveId: string; receiveIdType: string };
  }): Promise<LarkSendResult> {
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

  async deleteMessage(messageId: string): Promise<void> {
    const client = await this.getSdkClient();
    await client.request({
      method: 'DELETE',
      url: `/open-apis/im/v1/messages/${normalizeLarkMessageId(messageId)}`,
    });
  }

  async downloadResource(options: {
    messageId: string;
    fileKey: string;
    type: 'image' | 'file';
  }): Promise<LarkDownloadedResource> {
    const client = await this.getSdkClient();
    const timeout = setTimeout(() => {
      logger.warn(`飞书资源下载超时: ${options.type}:${options.fileKey}`);
    }, MEDIA_DOWNLOAD_TIMEOUT_MS);

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
      // ignore
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

async function extractBufferFromLarkResponse(
  response: unknown,
): Promise<{ buffer: Buffer; contentType?: string; fileName?: string }> {
  if (Buffer.isBuffer(response)) {
    return { buffer: response };
  }

  if (response instanceof ArrayBuffer) {
    return { buffer: Buffer.from(response) };
  }

  if (response == null) {
    throw new Error('飞书资源下载失败：响应为 null/undefined');
  }

  const resp = response as Record<string, any>;
  const contentType: string | undefined = resp.headers?.['content-type'] ?? resp.contentType ?? undefined;

  let fileName: string | undefined;
  const disposition = resp.headers?.['content-disposition'] ?? resp.headers?.['Content-Disposition'];
  if (typeof disposition === 'string') {
    const match = disposition.match(/filename[*]?=(?:UTF-8'')?["']?([^"';\n]+)/i);
    if (match) {
      fileName = decodeURIComponent(match[1].trim());
    }
  }

  if (resp.data != null) {
    if (Buffer.isBuffer(resp.data)) {
      return { buffer: resp.data, contentType, fileName };
    }
    if (resp.data instanceof ArrayBuffer) {
      return { buffer: Buffer.from(resp.data), contentType, fileName };
    }
    if (typeof resp.data.pipe === 'function') {
      const buffer = await collectStream(resp.data as Readable);
      return { buffer, contentType, fileName };
    }
  }

  if (typeof resp.getReadableStream === 'function') {
    const stream = await resp.getReadableStream();
    const buffer = await collectStream(stream as Readable);
    return { buffer, contentType, fileName };
  }

  if (typeof resp.pipe === 'function') {
    const buffer = await collectStream(resp as Readable);
    return { buffer, contentType, fileName };
  }

  throw new Error('飞书资源下载失败：无法从响应中提取二进制数据');
}

function collectStream(stream: Readable): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer | Uint8Array) => chunks.push(Buffer.from(chunk)));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}
