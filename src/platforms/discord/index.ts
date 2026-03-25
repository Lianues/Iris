/**
 * Discord 平台适配器
 *
 * 基于 discord.js 官方 SDK。
 */

import { Client, GatewayIntentBits, Message, Partials } from 'discord.js';
import { PlatformAdapter, splitText } from '../base';
import { Backend } from '../../core/backend';
import { createLogger } from '../../logger';
import { Content, extractText } from '../../types';

const logger = createLogger('Discord');

const MESSAGE_MAX_LENGTH = 2000;

export interface DiscordConfig {
  token: string;
}

export class DiscordPlatform extends PlatformAdapter {
  private client: Client;
  private token: string;
  private backend: Backend;
  private pendingTexts = new Map<string, string>();

  constructor(backend: Backend, config: DiscordConfig) {
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
  }

  async start(): Promise<void> {
    // 非流式或回退消息：直接发送
    this.backend.on('response', (sid: string, text: string) => {
      this.pendingTexts.delete(sid);
      this.sendToChannel(sid, text);
    });

    // 流式模式下缓存每轮完整 assistant 文本，待 done 时一次性发送
    this.backend.on('assistant:content', (sid: string, content: Content) => {
      const text = extractText(content.parts);
      if (!text) return;
      this.pendingTexts.set(sid, text);
    });

    this.backend.on('error', (sid: string, error: string) => {
      this.pendingTexts.delete(sid);
      this.sendToChannel(sid, `错误: ${error}`);
    });

    this.backend.on('done', (sid: string) => {
      if (!this.backend.isStreamEnabled()) return;

      const text = this.pendingTexts.get(sid);
      if (!text) return;

      this.pendingTexts.delete(sid);
      this.sendToChannel(sid, text);
    });

    this.client.on('ready', () => {
      logger.info(`已连接 | Bot: ${this.client.user?.tag}`);
    });

    this.client.on('messageCreate', (msg) => this.handleMessage(msg));

    await this.client.login(this.token);
    logger.info('平台已启动');
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

  private async handleMessage(msg: Message): Promise<void> {
    if (msg.author.bot) return;
    if (!msg.content) return;

    // TODO: 对码门禁 — 后续接入 PairingGuard，当前未实现。
    // 设计文档：.limcode/design/对码系统设计.md

    const isDM = !msg.guild;
    const isMentioned = msg.mentions.has(this.client.user!);

    if (!isDM && !isMentioned) return;

    let content = msg.content;
    if (isMentioned && this.client.user) {
      content = content.replace(new RegExp(`<@!?${this.client.user.id}>`, 'g'), '').trim();
    }
    if (!content) return;

    const sessionId = `discord-${msg.channelId}`;
    try {
      await this.backend.chat(sessionId, content, undefined, undefined, 'discord');
    } catch (err) {
      logger.error('处理消息时出错:', err);
    }
  }
}
