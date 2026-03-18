/**
 * Phase 7 健壮性测试。
 *
 * 覆盖飞书和 Telegram 的消息去重、过期检测、降级保护等健壮性功能。
 */

import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

// ---- 飞书健壮性测试 ----

describe('Lark Phase 7: 消息去重', () => {
  it('相同 messageId 的消息只处理一次', async () => {
    const { LarkPlatform } = await import('../src/platforms/lark');

    class FakeBackend extends EventEmitter {
      chats: any[] = [];
      async chat(sid: string, text: string, images?: any[], documents?: any[]) {
        this.chats.push({ sid, text });
      }
      isStreamEnabled() { return false; }
    }

    const backend = new FakeBackend();
    const platform = new LarkPlatform(backend as any, {
      appId: 'cli_test',
      appSecret: 'secret_test',
    });

    // 跳过 start，直接测试 handleIncomingEvent
    // mock client 以避免触发真正的 SDK 调用
    // 手动注册 Backend 事件监听，让 done 事件能释放 busy 锁
    (platform as any).setupBackendListeners();
    (platform as any).client = {
      replyText: vi.fn(async () => ({ messageId: 'mock_msg', chatId: 'mock_chat' })),
      sendText: vi.fn(async () => ({ messageId: 'mock_msg', chatId: 'mock_chat' })),
      sendCard: vi.fn(async () => ({ messageId: 'mock_msg', chatId: 'mock_chat' })),
      patchCard: vi.fn(async () => {}),
    };
    // 设置 messageHandler 的 botOpenId 以避免自我过滤
    (platform as any).messageHandler.setBotOpenId('ou_bot');
    const makePayload = (msgId: string, text: string) => ({
      event: {
        sender: { sender_id: { open_id: 'ou_user1' } },
        message: {
          message_id: msgId,
          chat_id: 'oc_chat1',
          chat_type: 'p2p' as const,
          message_type: 'text',
          content: JSON.stringify({ text }),
          create_time: String(Date.now()),
        },
      },
    });

    // 第一次处理
    const payload1 = makePayload('msg_dedup_001', '第一次');
    await (platform as any).handleIncomingEvent(payload1);
    expect(backend.chats).toHaveLength(1);

    // 释放 busy 锁
    const sid = backend.chats[0].sid;
    backend.emit('done', sid);
    await new Promise((r) => setTimeout(r, 20));

    // 同一条消息再次到达（模拟重连重放）—— 应被去重
    await (platform as any).handleIncomingEvent(makePayload('msg_dedup_001', '第一次'));
    expect(backend.chats).toHaveLength(1);

    // 不同的消息应正常处理
    backend.emit('done', sid);
    await new Promise((r) => setTimeout(r, 20));
    await (platform as any).handleIncomingEvent(makePayload('msg_dedup_002', '第二次'));
    expect(backend.chats).toHaveLength(2);
  });
});

describe('Lark Phase 7: 消息过期', () => {
  it('丢弃 create_time 超过 30s 的旧消息', async () => {
    const { LarkPlatform } = await import('../src/platforms/lark');

    class FakeBackend extends EventEmitter {
      chats: any[] = [];
      async chat(sid: string, text: string) { this.chats.push({ sid, text }); }
      isStreamEnabled() { return false; }
    }

    const backend = new FakeBackend();
    const platform = new LarkPlatform(backend as any, {
      appId: 'cli_test',
      appSecret: 'secret_test',
    });

    // 发送一条 60 秒前的消息
    const oldTime = String(Date.now() - 60_000);
    await (platform as any).handleIncomingEvent({
      event: {
        sender: { sender_id: { open_id: 'ou_user1' } },
        message: {
          message_id: 'msg_expired_001',
          chat_id: 'oc_chat1',
          chat_type: 'p2p',
          message_type: 'text',
          content: JSON.stringify({ text: '旧消息' }),
          create_time: oldTime,
        },
      },
    });

    // 过期消息不应被处理
    expect(backend.chats).toHaveLength(0);

    // 发送一条新鲜消息
    await (platform as any).handleIncomingEvent({
      event: {
        sender: { sender_id: { open_id: 'ou_user1' } },
        message: {
          message_id: 'msg_fresh_001',
          chat_id: 'oc_chat1',
          chat_type: 'p2p',
          message_type: 'text',
          content: JSON.stringify({ text: '新消息' }),
          create_time: String(Date.now()),
        },
      },
    });

    // 新消息应被处理
    expect(backend.chats).toHaveLength(1);
    expect(backend.chats[0].text).toBe('新消息');
  });
});

// ---- Telegram 健壮性测试 ----

describe('Telegram Phase 7: 消息去重', () => {
  it('相同 message_id 的消息只处理一次', async () => {
    const { TelegramPlatform } = await import('../src/platforms/telegram');

    class FakeBackend extends EventEmitter {
      chats: any[] = [];
      async chat(sid: string, text: string, images?: any[], documents?: any[]) {
        this.chats.push({ sid, text });
      }
      isStreamEnabled() { return false; }
    }

    const backend = new FakeBackend();
    const platform = new TelegramPlatform(backend as any, {
      token: 'bot-token',
      groupMentionRequired: false,
    });
    // 手动注册 Backend 事件监听，让 done 事件能释放 busy 锁
    (platform as any).setupBackendListeners();

    (platform as any).client = {
      sendMessageReturningId: vi.fn(async () => 999),
    };

    const now = Math.floor(Date.now() / 1000);
    const makeCtx = (msgId: number, text: string) => ({
      chat: { id: 3001, type: 'private' },
      me: { username: 'test_bot' },
      message: { message_id: msgId, text, date: now },
    });

    await (platform as any).handleMessage(makeCtx(100, '第一次'));
    expect(backend.chats).toHaveLength(1);

    // 释放 busy 锁（第一条消息处理完后 busy=true，需要 done 事件释放）
    const sid = backend.chats[0].sid;
    backend.emit('done', sid);
    await new Promise((r) => setTimeout(r, 20));

    // 同一条消息再次到达
    await (platform as any).handleMessage(makeCtx(100, '第一次'));
    expect(backend.chats).toHaveLength(1);

    // 不同 message_id 应正常处理（busy 已在上面释放）
    await (platform as any).handleMessage(makeCtx(101, '第二次'));
    expect(backend.chats).toHaveLength(2);
  });
});

describe('Telegram Phase 7: 消息过期', () => {
  it('丢弃 date 超过 30s 的旧消息', async () => {
    const { TelegramPlatform } = await import('../src/platforms/telegram');

    class FakeBackend extends EventEmitter {
      chats: any[] = [];
      async chat(sid: string, text: string) { this.chats.push({ sid, text }); }
      isStreamEnabled() { return false; }
    }

    const backend = new FakeBackend();
    const platform = new TelegramPlatform(backend as any, {
      token: 'bot-token',
      groupMentionRequired: false,
    });

    (platform as any).client = {
    };

    // 60 秒前的消息
    const oldDate = Math.floor((Date.now() - 60_000) / 1000);
    await (platform as any).handleMessage({
      chat: { id: 3002, type: 'private' },
      me: { username: 'test_bot' },
      message: { message_id: 200, text: '旧消息', date: oldDate },
    });
    expect(backend.chats).toHaveLength(0);

    // 新消息
    const nowDate = Math.floor(Date.now() / 1000);
    await (platform as any).handleMessage({
      chat: { id: 3002, type: 'private' },
      me: { username: 'test_bot' },
      message: { message_id: 201, text: '新消息', date: nowDate },
    });
    expect(backend.chats).toHaveLength(1);
  });
});

describe('Telegram Phase 7: editText 静默忽略 "message is not modified"', () => {
  it('编辑相同内容时不抛异常', async () => {
    const { TelegramClient } = await import('../src/platforms/telegram/client');

    const client = new TelegramClient({ token: 'fake-token' });
    // mock bot.api.editMessageText 抛出 "message is not modified" 错误
    (client as any).bot = {
      api: {
        editMessageText: vi.fn(async () => {
          throw new Error('Bad Request: message is not modified');
        }),
      },
    };

    // 不应抛出异常
    await expect(
      client.editText({ chatId: 1, chatKey: 'dm:1', sessionId: 's', scope: 'dm' }, 1, 'test'),
    ).resolves.toBeUndefined();
  });

  it('其他错误正常抛出', async () => {
    const { TelegramClient } = await import('../src/platforms/telegram/client');

    const client = new TelegramClient({ token: 'fake-token' });
    (client as any).bot = {
      api: {
        editMessageText: vi.fn(async () => {
          throw new Error('Forbidden: bot was blocked by the user');
        }),
      },
    };

    await expect(
      client.editText({ chatId: 1, chatKey: 'dm:1', sessionId: 's', scope: 'dm' }, 1, 'test'),
    ).rejects.toThrow('bot was blocked');
  });
});
