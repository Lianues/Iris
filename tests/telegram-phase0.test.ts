/**
 * Telegram Phase 0 测试
 *
 * 目标：验证目录重构后最基础的配置解析和 session 归一化行为。
 * 这里只覆盖无副作用的纯逻辑，避免在 Phase 0 引入真实 Telegram 运行时依赖。
 */

import { describe, expect, it } from 'vitest';
import { parsePlatformConfig } from '../src/config/platform';
import { TelegramClient } from '../src/platforms/telegram/client';
import {
  TelegramMessageHandler,
  extractTelegramText,
  stripBotMention,
} from '../src/platforms/telegram/message-handler';
import { buildTelegramSessionTarget, parseTelegramSessionTarget } from '../src/platforms/telegram/types';

describe('Telegram Phase 0: parsePlatformConfig', () => {
  it('解析 telegram 行为开关并提供默认值', () => {
    const config = parsePlatformConfig({
      type: 'telegram',
      telegram: {
        token: 'bot-token',
      },
    });

    expect(config.telegram.token).toBe('bot-token');
    expect(config.telegram.showToolStatus).toBe(true);
    expect(config.telegram.groupMentionRequired).toBe(true);
  });
});

describe('Telegram Phase 0: session target', () => {
  it('构造并解析新的私聊 sessionId', () => {
    const target = buildTelegramSessionTarget({ chatId: 12345, isPrivate: true });
    expect(target.sessionId).toBe('telegram-dm-12345');
    expect(parseTelegramSessionTarget(target.sessionId)).toMatchObject({
      chatId: 12345,
      scope: 'dm',
      threadId: undefined,
    });
  });

  it('兼容旧版 telegram-{chatId} sessionId', () => {
    expect(parseTelegramSessionTarget('telegram--1001234567890')).toMatchObject({
      chatId: -1001234567890,
      scope: 'group',
    });
  });
});

describe('Telegram Phase 1.1: client primitives', () => {
  it('按 Bot API 规则构造文件下载地址', () => {
    const client = new TelegramClient({ token: '123:abc' });
    expect(client.buildFileDownloadUrl('documents/file.txt')).toBe(
      'https://api.telegram.org/file/bot123:abc/documents/file.txt',
    );
  });
});

describe('Telegram Phase 0: message handler', () => {
  it('在群聊中要求显式 @ 机器人', () => {
    const handler = new TelegramMessageHandler({
      token: 'bot-token',
      groupMentionRequired: true,
    });

    const ignored = handler.parseIncomingText({
      chat: { id: -1001, type: 'group' },
      me: { username: 'iris_bot' },
      message: { message_id: 1, text: '普通群消息' },
    } as any);
    expect(ignored).toBeNull();

    const accepted = handler.parseIncomingText({
      chat: { id: -1001, type: 'group' },
      me: { username: 'iris_bot' },
      message: {
        message_id: 2,
        text: '@iris_bot 请继续',
        entities: [{ type: 'mention', offset: 0, length: 9 }],
      },
    } as any);

    expect(accepted?.session.sessionId).toBe('telegram-group--1001');
    expect(accepted?.mentioned).toBe(true);
    expect(accepted?.text).toBe('请继续');
  });

  it('统一提取 text / caption 文本', () => {
    expect(extractTelegramText({ text: ' hello ' })).toBe('hello');
    expect(extractTelegramText({ caption: ' caption ' })).toBe('caption');
  });

  it('解析 photo/document/voice/reply/topic 信息', () => {
    const handler = new TelegramMessageHandler({
      token: 'bot-token',
      groupMentionRequired: false,
    });

    const parsed = handler.parseIncomingText({
      chat: { id: -2001, type: 'supergroup' },
      me: { username: 'iris_bot' },
      message: {
        message_id: 12,
        caption: '查看附件',
        message_thread_id: 77,
        media_group_id: 'mg-1',
        photo: [
          { file_id: 'small-photo', width: 320, height: 240 },
          { file_id: 'large-photo', width: 1280, height: 720 },
        ],
        document: { file_id: 'doc-1', file_name: 'a.txt', mime_type: 'text/plain' },
        voice: { file_id: 'voice-1', duration: 3, mime_type: 'audio/ogg' },
        reply_to_message: {
          message_id: 9,
          caption: '上一个图片',
          photo: [{ file_id: 'reply-photo' }],
        },
      },
    } as any);

    expect(parsed?.session.sessionId).toBe('telegram-group--2001-thread-77');
    expect(parsed?.mediaGroupId).toBe('mg-1');
    expect(parsed?.photo?.fileId).toBe('large-photo');
    expect(parsed?.document?.fileId).toBe('doc-1');
    expect(parsed?.voice?.fileId).toBe('voice-1');
    expect(parsed?.reply).toMatchObject({
      messageId: 9,
      text: '上一个图片',
      hasPhoto: true,
    });
  });

  it('清理 /command@bot 与 @bot mention', () => {
    expect(stripBotMention('@iris_bot 你好', 'iris_bot')).toBe('你好');
    expect(stripBotMention('/help@iris_bot more', 'iris_bot')).toBe('/help more');
  });
});
