/**
 * Discord 平台适配器
 *
 * 基于 discord.js 官方 SDK。
 */

import { createExtensionLogger, definePlatformFactory, extractText, PlatformAdapter, splitText, type Content, type ImageInput, type IrisBackendLike, type ToolDefinition } from 'irises-extension-sdk';
import { PairingGuard, PairingStore, type PairingConfig } from 'irises-extension-sdk/pairing';
import { AttachmentBuilder, Client, GatewayIntentBits, Message, Partials } from 'discord.js';
import { existsSync, readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';

const logger = createExtensionLogger('DiscordExtension', 'Discord');

const MESSAGE_MAX_LENGTH = 2000;
const STREAM_EDIT_INTERVAL = 1500; // 流式编辑间隔（ms）

export interface DiscordConfig {
  token: string;
  pairing?: PairingConfig;
}

export class DiscordPlatform extends PlatformAdapter {
  private client: Client;
  private token: string;
  private backend: IrisBackendLike;
  private pendingTexts = new Map<string, string>();
  private typingTimers = new Map<string, ReturnType<typeof setInterval>>();
  private streamMessages = new Map<string, Message>();   // 流式模式：已发送的消息引用（用于编辑）
  private editTimers = new Map<string, ReturnType<typeof setTimeout>>(); // 流式编辑节流定时器
  private pairingStore: PairingStore | null = null;
  private pairingGuard: PairingGuard | null = null;

  constructor(backend: IrisBackendLike, config: DiscordConfig) {
    super();
    this.backend = backend;
    this.token = config.token;
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent,
      ],
      partials: [Partials.Channel],
    });

    // 对码门禁
    if (config.pairing && config.pairing.dmPolicy !== 'open') {
      this.pairingStore = new PairingStore();
      this.pairingGuard = new PairingGuard('discord', config.pairing, this.pairingStore);
    }
  }

  async start(): Promise<void> {
    // 非流式或回退消息：直接发送
    this.backend.on('response', (sid: string, text: string) => {
      this.stopTyping(sid);
      this.clearStreamState(sid);
      this.pendingTexts.delete(sid);
      this.sendToChannel(sid, text);
    });

    // 流式模式：缓存文本 + 定期编辑消息实时展示
    this.backend.on('assistant:content', (sid: string, content: Content) => {
      const text = extractText(content.parts ?? []);
      if (!text) return;
      this.pendingTexts.set(sid, text);

      if (this.backend.isStreamEnabled()) {
        this.scheduleStreamEdit(sid);
      }
    });

    // 工具开始执行 → 当前 turn 文本已完整，定稿当前消息；下个 turn 将发新消息
    this.backend.on('tool:execute', (sid: string) => {
      if (!this.backend.isStreamEnabled()) return;
      const text = this.pendingTexts.get(sid);
      if (!text) return;
      this.pendingTexts.delete(sid);
      // 定稿当前流式消息（finalizeStream 会清除 editTimers / streamMessages）
      this.finalizeStream(sid, text);
    });

    this.backend.on('error', (sid: string, error: string) => {
      this.stopTyping(sid);
      this.clearStreamState(sid);
      this.pendingTexts.delete(sid);
      this.sendToChannel(sid, `错误: ${error}`);
    });

    this.backend.on('done', (sid: string) => {
      this.stopTyping(sid);
      if (!this.backend.isStreamEnabled()) return;

      const text = this.pendingTexts.get(sid);
      if (!text) return;

      this.pendingTexts.delete(sid);
      this.finalizeStream(sid, text);
    });

    this.client.on('ready', () => {
      logger.info(`已连接 | Bot: ${this.client.user?.tag}`);
    });

    this.client.on('messageCreate', (msg) => this.handleMessage(msg));

    await this.client.login(this.token);
    logger.info('平台已启动');

    // 首次使用：输出 Bootstrap 对码
    if (this.pairingGuard && this.pairingStore?.needsBootstrap()) {
      const code = this.pairingStore.getOrCreateBootstrapCode();
      logger.info('╔══════════════════════════════════════════════════════╗');
      logger.info('║  首次使用，请在 Discord 私聊中发送以下对码：           ║');
      logger.info(`║  对码: ${code}                                       ║`);
      logger.info('║  第一个完成对码的用户将成为管理员。                    ║');
      logger.info('╚══════════════════════════════════════════════════════╝');
    }
  }

  async stop(): Promise<void> {
    await this.client.destroy();
    logger.info('平台已停止');
  }

  // ============ 内部方法 ============

  private async sendToChannel(sessionId: string, text: string): Promise<void> {
    const channelId = sessionId.replace('discord-', '');
    const channel = await this.client.channels.fetch(channelId);
    if (!channel?.isTextBased()) return;

    const chunks = splitText(text, MESSAGE_MAX_LENGTH);
    for (const chunk of chunks) {
      await (channel as any).send(chunk);
    }
  }

  /** 开始在指定频道显示"正在输入…" */
  private async startTyping(channelId: string): Promise<void> {
    const channel = this.client.channels.cache.get(channelId);
    if (!channel?.isTextBased()) return;

    // 立即发送一次 typing
    await (channel as any).sendTyping().catch(() => {});

    // 每 8 秒刷新（Discord typing 指示器约 10 秒过期）
    const timer = setInterval(() => {
      (channel as any).sendTyping().catch(() => {});
    }, 8000);
    this.typingTimers.set(channelId, timer);
  }

  /** 收到流式内容时刷新 typing（防止超时消失） */
  private refreshTyping(sid: string): void {
    const channelId = sid.replace('discord-', '');
    // 已有定时器在跑，无需额外操作
    if (this.typingTimers.has(channelId)) return;
    this.startTyping(channelId);
  }

  /** 停止 typing 指示器 */
  private stopTyping(sid: string): void {
    const channelId = sid.replace('discord-', '');
    const timer = this.typingTimers.get(channelId);
    if (!timer) return;
    clearInterval(timer);
    this.typingTimers.delete(channelId);
  }

  /** 节流调度：定期将最新文本编辑到已发送的消息上 */
  private scheduleStreamEdit(sid: string): void {
    // 已有定时器排队中，跳过
    if (this.editTimers.has(sid)) return;

    const timer = setTimeout(async () => {
      this.editTimers.delete(sid);

      const text = this.pendingTexts.get(sid);
      if (!text) return;

      const channelId = sid.replace('discord-', '');
      const sentMsg = this.streamMessages.get(sid);

      if (!sentMsg) {
        // 首次：发送新消息
        try {
          const channel = await this.client.channels.fetch(channelId);
          if (!channel?.isTextBased()) return;

          const displayText = text.length > MESSAGE_MAX_LENGTH
            ? text.slice(0, MESSAGE_MAX_LENGTH - 1) + '…'
            : text;
          const msg = await (channel as any).send(displayText);
          this.streamMessages.set(sid, msg);
          this.stopTyping(sid); // 消息已发出，typing 不再需要
        } catch {
          // ignore
        }
      } else {
        // 后续：编辑已有消息
        const displayText = text.length > MESSAGE_MAX_LENGTH
          ? text.slice(0, MESSAGE_MAX_LENGTH - 1) + '…'
          : text;
        await sentMsg.edit(displayText).catch(() => {});
      }
    }, STREAM_EDIT_INTERVAL);

    this.editTimers.set(sid, timer);
  }

  /** 流式完成：最终编辑消息，超长则拆分发送 */
  private async finalizeStream(sid: string, text: string): Promise<void> {
    // 清除未触发的编辑定时器
    const editTimer = this.editTimers.get(sid);
    if (editTimer) {
      clearTimeout(editTimer);
      this.editTimers.delete(sid);
    }

    const sentMsg = this.streamMessages.get(sid);
    this.streamMessages.delete(sid);

    if (!sentMsg) {
      // 没来得及发流式消息（生成太快），直接发送
      await this.sendToChannel(sid, text);
      return;
    }

    const chunks = splitText(text, MESSAGE_MAX_LENGTH);
    // 编辑第一条消息为最终完整内容
    await sentMsg.edit(chunks[0]).catch(() => {});

    // 超长拆分：发送剩余部分
    if (chunks.length > 1) {
      const channelId = sid.replace('discord-', '');
      const channel = await this.client.channels.fetch(channelId);
      if (channel?.isTextBased()) {
        for (let i = 1; i < chunks.length; i++) {
          await (channel as any).send(chunks[i]);
        }
      }
    }
  }

  /** 清理流式状态 */
  private clearStreamState(sid: string): void {
    const editTimer = this.editTimers.get(sid);
    if (editTimer) {
      clearTimeout(editTimer);
      this.editTimers.delete(sid);
    }
    this.streamMessages.delete(sid);
  }

  // ============ Discord 专属工具 ============

  /** 创建 Discord 专属工具定义（供平台工厂注册） */
  createDiscordTools(): ToolDefinition[] {
    return [
      {
        declaration: {
          name: 'discord_send_file',
          description: '发送文件或图片到当前 Discord 对话（频道或私聊）。可用于向用户展示截图、文档、日志等。',
          parameters: {
            type: 'object',
            properties: {
              file_path: {
                type: 'string',
                description: '要发送的文件路径（绝对路径或相对路径）',
              },
              message: {
                type: 'string',
                description: '随文件一起发送的说明文字（可选）',
              },
            },
            required: ['file_path'],
          },
        },
        handler: async (args: Record<string, unknown>) => {
          return this.executeSendFile(args);
        },
      },
    ];
  }

  /** discord_send_file 工具执行逻辑 */
  private async executeSendFile(args: Record<string, unknown>): Promise<unknown> {
    const filePath = args.file_path as string;
    const message = args.message as string | undefined;

    if (!filePath) return { success: false, error: '缺少 file_path 参数' };

    const sid = this.backend.getActiveSessionId?.();
    if (!sid?.startsWith('discord-')) {
      return { success: false, error: '当前不在 Discord 会话中' };
    }

    const resolved = resolve(filePath);
    if (!existsSync(resolved)) {
      return { success: false, error: `文件不存在: ${filePath}` };
    }

    const data = readFileSync(resolved);
    const fileName = basename(resolved);
    const channelId = sid.replace('discord-', '');

    try {
      const channel = await this.client.channels.fetch(channelId);
      if (!channel?.isTextBased()) {
        return { success: false, error: '无法找到目标频道' };
      }

      const attachment = new AttachmentBuilder(data, { name: fileName });
      await (channel as any).send({
        content: message || undefined,
        files: [attachment],
      });

      return { success: true, fileName, fileSize: data.length };
    } catch (err: any) {
      return { success: false, error: `发送失败: ${err?.message ?? err}` };
    }
  }

  // ============ 对码管理命令 ============

  /** 处理对码管理命令（!invite / !users / !kick / !transfer） */
  private async handlePairingCommand(msg: Message, content: string): Promise<boolean> {
    if (!content.startsWith('!')) return false;

    const userId = msg.author.id;
    const parts = content.slice(1).split(/\s+/);
    const cmd = parts[0]?.toLowerCase();
    const args = parts.slice(1).join(' ').trim();

    switch (cmd) {
      case 'invite': {
        if (!this.pairingGuard!.isAdmin(userId)) {
          await msg.reply('❌ 仅管理员可执行此命令。');
          return true;
        }
        const code = this.pairingGuard!.generateInviteCode();
        await msg.reply(
          `🎫 邀请对码已生成：\`${code}\`（1 小时内有效）\n` +
          '将此对码发送给你信任的用户，对方在私聊中发送即可完成配对。'
        );
        return true;
      }

      case 'users': {
        if (!this.pairingGuard!.isAdmin(userId)) {
          await msg.reply('❌ 仅管理员可执行此命令。');
          return true;
        }
        const users = this.pairingGuard!.listUsers();
        if (users.length === 0) {
          await msg.reply('📋 白名单为空。');
        } else {
          const lines = users.map((u, i) => {
            const name = u.userName || u.userId;
            const time = new Date(u.pairedAt).toLocaleString();
            return `${i + 1}. **${name}** (${u.platform}:${u.userId}) — ${time}`;
          });
          await msg.reply(`📋 **白名单用户** (${users.length}):\n${lines.join('\n')}`);
        }
        return true;
      }

      case 'kick': {
        if (!this.pairingGuard!.isAdmin(userId)) {
          await msg.reply('❌ 仅管理员可执行此命令。');
          return true;
        }
        if (!args) {
          await msg.reply('用法: `!kick <用户ID>`');
          return true;
        }
        const ok = this.pairingGuard!.removeUser('discord', args);
        await msg.reply(ok ? `✅ 已将用户 ${args} 移出白名单。` : `❌ 未找到用户 ${args}。`);
        return true;
      }

      case 'transfer': {
        if (!this.pairingGuard!.isAdmin(userId)) {
          await msg.reply('❌ 仅管理员可执行此命令。');
          return true;
        }
        if (!args) {
          await msg.reply('用法: `!transfer <用户ID>`');
          return true;
        }
        this.pairingGuard!.transferAdmin('discord', args);
        await msg.reply(`✅ 管理员身份已让渡给 ${args}。`);
        return true;
      }

      default:
        return false;
    }
  }

  // ============ 消息处理 ============

  private async handleMessage(msg: Message): Promise<void> {
    if (msg.author.bot) return;

    const isDM = !msg.guild;
    const isMentioned = msg.mentions.has(this.client.user!);
    const isReplyToBot = !!(msg.reference && await this.isReplyToBot(msg));

    if (!isDM && !isMentioned && !isReplyToBot) return;

    let content = msg.content;
    if (isMentioned && this.client.user) {
      content = content.replace(new RegExp(`<@!?${this.client.user.id}>`, 'g'), '').trim();
    }

    // 收集当前消息的附件图片
    const images: ImageInput[] = [];
    await this.collectImages(msg, images);

    // 没有文本也没有图片 → 忽略
    if (!content && images.length === 0) return;
    if (!content) content = '[图片]';

    // ── 对码门禁（仅私聊生效） ──
    if (this.pairingGuard && isDM) {
      const result = this.pairingGuard.check(msg.author.id, content, msg.author.username);

      if (!result.allowed) {
        if (result.replyText) await msg.reply(result.replyText);
        return;
      }

      // 对码成功的消息本身不进 Backend，只回复成功提示
      if (result.reason === 'bootstrap-success' || result.reason === 'pairing-success') {
        if (result.replyText) await msg.reply(result.replyText);
        return;
      }
    }

    // ── 管理命令（私聊中以 ! 开头） ──
    if (isDM && this.pairingGuard && content.startsWith('!')) {
      const handled = await this.handlePairingCommand(msg, content);
      if (handled) return;
    }

    // ── 正常消息 → 进入 AI 对话 ──
    // 回复场景：附带被回复消息的内容作为上下文
    let replyContext = '';
    if (msg.reference?.messageId) {
      try {
        const refMsg = await msg.channel.messages.fetch(msg.reference.messageId);
        if (refMsg) {
          const refName = refMsg.author.id === this.client.user?.id
            ? `${this.client.user.username}:bot`
            : `${refMsg.member?.displayName || refMsg.author.globalName || refMsg.author.username}:${refMsg.author.id}`;

          // 收集被回复消息中的图片，用占位符标记
          const refImageStart = images.length;
          await this.collectImages(refMsg, images);
          const refImageCount = images.length - refImageStart;

          let refText = refMsg.content || '';
          if (refImageCount > 0) {
            const placeholders = Array.from({ length: refImageCount }, (_, i) => `[图片${refImageStart + i + 1}]`).join(' ');
            refText = refText ? `${refText} ${placeholders}` : placeholders;
          }
          if (!refText) refText = '[附件]';

          replyContext = `[回复 ${refName}: ${refText.length > 200 ? refText.slice(0, 200) + '…' : refText}]\n`;
        }
      } catch { /* 消息已删除等 */ }
    }

    const displayName = msg.member?.displayName || msg.author.globalName || msg.author.username;
    const isAdmin = this.pairingGuard?.isAdmin(msg.author.id) ?? false;

    // 当前消息自身的图片占位符
    const ownImageCount = images.length - (images.length - this.countAttachmentImages(msg));
    let imageHint = '';
    if (ownImageCount > 0) {
      const placeholders = Array.from({ length: ownImageCount }, (_, i) => `[图片${images.length - ownImageCount + i + 1}]`).join(' ');
      imageHint = ` ${placeholders}`;
    }

    const identifiedContent = `${replyContext}[${displayName}:${msg.author.id}${isAdmin ? ':admin' : ''}]: ${content}${imageHint}`;

    const sessionId = `discord-${msg.channelId}`;
    try {
      // 立即显示"正在输入…"
      await this.startTyping(msg.channelId);

      await this.backend.chat(sessionId, identifiedContent, images.length > 0 ? images : undefined, undefined, 'discord');
    } catch (err) {
      this.stopTyping(sessionId);
      this.clearStreamState(sessionId);
      logger.error('处理消息时出错:', err);
    }
  }

  /** 检查消息是否是对 Bot 消息的回复 */
  private async isReplyToBot(msg: Message): Promise<boolean> {
    if (!msg.reference?.messageId) return false;
    try {
      const refMsg = await msg.channel.messages.fetch(msg.reference.messageId);
      return refMsg?.author.id === this.client.user?.id;
    } catch {
      return false;
    }
  }

  /** 从 Discord 消息中收集图片附件，下载并转为 ImageInput 追加到 images 数组 */
  private async collectImages(msg: Message, images: ImageInput[]): Promise<void> {
    const imageAttachments = [...msg.attachments.values()].filter(
      a => a.contentType?.startsWith('image/'),
    );

    // 消息嵌入中的图片（如链接预览）
    const embedImages = msg.embeds
      .map(e => e.image?.url || e.thumbnail?.url)
      .filter((url): url is string => !!url);

    const urls = [
      ...imageAttachments.map(a => ({ url: a.url, mime: a.contentType ?? 'image/png' })),
      ...embedImages.map(url => ({ url, mime: 'image/png' })),
    ];

    for (const { url, mime } of urls) {
      try {
        const res = await fetch(url);
        if (!res.ok) continue;
        const buf = Buffer.from(await res.arrayBuffer());

        // 检测实际 MIME
        const mimeType = this.detectImageMime(buf) ?? mime;
        images.push({ mimeType, data: buf.toString('base64') });
      } catch {
        logger.warn(`图片下载失败: ${url}`);
      }
    }
  }

  /** 统计消息自身的图片附件数量 */
  private countAttachmentImages(msg: Message): number {
    const attachCount = [...msg.attachments.values()].filter(a => a.contentType?.startsWith('image/')).length;
    const embedCount = msg.embeds.filter(e => e.image?.url || e.thumbnail?.url).length;
    return attachCount + embedCount;
  }

  /** 通过魔术字节检测图片 MIME 类型 */
  private detectImageMime(buf: Buffer): string | undefined {
    if (buf[0] === 0xFF && buf[1] === 0xD8) return 'image/jpeg';
    if (buf[0] === 0x89 && buf[1] === 0x50) return 'image/png';
    if (buf[0] === 0x47 && buf[1] === 0x49) return 'image/gif';
    if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46) return 'image/webp';
    return undefined;
  }

}

export const createDiscordPlatform = definePlatformFactory<DiscordConfig, DiscordPlatform>({
  platformName: 'discord',
  resolveConfig: (raw) => ({
    token: raw.token ?? '',
    pairing: raw.pairing,
  }),
  create: (backend, config, context) => {
    const platform = new DiscordPlatform(backend, config);

    // 注册 Discord 专属工具
    const api = context.api as { tools?: { registerAll(tools: ToolDefinition[]): void } };
    if (api?.tools?.registerAll) {
      api.tools.registerAll(platform.createDiscordTools());
    }

    return platform;
  },
});

export default createDiscordPlatform;
