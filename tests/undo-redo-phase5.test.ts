/**
 * Phase 5 消息编辑与 Undo/Redo 测试。
 *
 * 覆盖飞书和 Telegram 两个平台的撤销和恢复对话功能。
 * 注意：Phase 7 加了消息去重，每次 payload 必须用不同的 message_id。
 */

import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

// ---- 飞书 Undo/Redo 测试 ----

describe('Lark Phase 5: Undo/Redo', () => {
  it('执行 /undo 时截断历史并撤回上一条消息', async () => {
    const { LarkPlatform } = await import('../extensions/lark/src');

    class FakeBackend extends EventEmitter {
      chats: any[] = [];
      async chat(sid: string, text: string) { this.chats.push({ sid, text }); }
      undoCalls: Array<{ sessionId: string; scope: string }> = [];
      async undo(sessionId: string, scope: string) {
        this.undoCalls.push({ sessionId, scope });
        return {
          scope,
          removed: [
            { role: 'user', parts: [{ text: '撤销这句' }] },
            { role: 'model', parts: [{ text: '好的' }] },
          ],
          userText: '撤销这句',
          assistantText: '好的',
          removedCount: 2,
        };
      }
      isStreamEnabled() { return false; }
    }

    const backend = new FakeBackend();
    const platform = new LarkPlatform(backend as any, {
      appId: 'cli_test',
      appSecret: 'secret_test',
    });

    const deletedIds: string[] = [];
    (platform as any).client = {
      sendText: vi.fn(async () => ({ messageId: 'mock', chatId: 'mock' })),
      replyText: vi.fn(async () => ({ messageId: 'mock', chatId: 'mock' })),
      deleteMessage: vi.fn(async (id: string) => { deletedIds.push(id); }),
      patchCard: vi.fn(),
    };
    (platform as any).messageHandler.setBotOpenId('ou_bot');

    // 每次用不同的 message_id，避免 Phase 7 去重拦截
    let seq = 0;
    const makePayload = (text: string) => ({
      event: {
        sender: { sender_id: { open_id: 'ou_user1' } },
        message: {
          message_id: `msg_undo_${++seq}`,
          chat_id: 'oc_chat1',
          chat_type: 'p2p' as const,
          message_type: 'text',
          content: JSON.stringify({ text }),
          create_time: String(Date.now()),
        },
      },
    });

    // 发一条消息建立 ChatState
    await (platform as any).handleIncomingEvent(makePayload('测试消息'));
    const cs = (platform as any).getChatState({ chatKey: 'dm:ou_user1' } as any);
    cs.lastBotMessageId = 'bot_msg_999';
    cs.busy = false;

    // 执行 /undo
    await (platform as any).handleIncomingEvent(makePayload('/undo'));

    // 验证 undo 被调用（历史回滚由 Backend 统一处理）
    expect(backend.undoCalls).toHaveLength(1);
    expect(backend.undoCalls[0].scope).toBe('last-turn');
    expect(deletedIds).toContain('bot_msg_999');
    expect(cs.lastBotMessageId).toBeUndefined();
  });

  it('执行 /redo 时恢复上一轮的用户输入', async () => {
    const { LarkPlatform } = await import('../extensions/lark/src');

    class FakeBackend extends EventEmitter {
      chats: any[] = [];
      redoCalls: string[] = [];
      async chat(sid: string, text: string) { this.chats.push({ sid, text }); }
      async redo(sessionId: string) {
        this.redoCalls.push(sessionId);
        return { restored: [{ role: 'model', parts: [{ text: '恢复后的回答' }] }], restoredCount: 1, userText: '被撤销的话', assistantText: '恢复后的回答' };
      }
      isStreamEnabled() { return false; }
    }

    const backend = new FakeBackend();
    const replies: string[] = [];
    const platform = new LarkPlatform(backend as any, {
      appId: 'cli_test',
      appSecret: 'secret_test',
    });

    (platform as any).client = {
      sendText: vi.fn(async () => ({ messageId: 'mock', chatId: 'mock' })),
      replyText: vi.fn(async ({ text }: { text: string }) => { replies.push(text); return ({ messageId: 'mock', chatId: 'mock' }); }),
      deleteMessage: vi.fn(),
    };
    (platform as any).messageHandler.setBotOpenId('ou_bot');

    let seq = 0;
    const makePayload = (text: string) => ({
      event: {
        sender: { sender_id: { open_id: 'ou_user1' } },
        message: {
          message_id: `msg_redo_${++seq}`,
          chat_id: 'oc_chat1',
          chat_type: 'p2p' as const,
          message_type: 'text',
          content: JSON.stringify({ text }),
          create_time: String(Date.now()),
        },
      },
    });

    await (platform as any).handleIncomingEvent(makePayload('测试消息'));
    const cs = (platform as any).getChatState({ chatKey: 'dm:ou_user1' } as any);
    cs.busy = false;

    await (platform as any).handleIncomingEvent(makePayload('/redo'));

    expect(backend.redoCalls).toHaveLength(1);
    expect(replies).toContain('恢复后的回答');
  });
});

// ---- Telegram Undo/Redo 测试 ----

describe('Telegram Phase 5: Undo/Redo', () => {
  it('执行 /undo 时截断历史并尝试 editText', async () => {
    const { TelegramPlatform } = await import('../extensions/telegram/src');

    class FakeBackend extends EventEmitter {
      chats: any[] = [];
      undoCalls: Array<{ sessionId: string; scope: string }> = [];
      async chat(sid: string, text: string) { this.chats.push({ sid, text }); }
      async undo(sessionId: string, scope: string) {
        this.undoCalls.push({ sessionId, scope });
        return {
          scope,
          removed: [
            { role: 'user', parts: [{ text: 'Undo me' }] },
            { role: 'model', parts: [{ text: 'Sure' }] },
          ],
          userText: 'Undo me',
          assistantText: 'Sure',
          removedCount: 2,
        };
      }
      isStreamEnabled() { return false; }
    }

    const backend = new FakeBackend();
    const platform = new TelegramPlatform(backend as any, {
      token: 'bot-token',
      groupMentionRequired: false,
    });

    const edited: Array<{ id: number; text: string }> = [];
    (platform as any).client = {
      sendMessageReturningId: vi.fn(async () => 999),
      editText: vi.fn(async (_t: any, id: number, text: string) => { edited.push({ id, text }); }),
      deleteMessage: vi.fn(),
    };

    // 每次用不同的 message_id，避免 Phase 7 去重拦截
    let seq = 100;
    const makeCtx = (text: string) => ({
      chat: { id: 3001, type: 'private' },
      me: { username: 'test_bot' },
      message: { message_id: ++seq, text, date: Math.floor(Date.now() / 1000) },
    });

    await (platform as any).handleMessage(makeCtx('Test'));
    const cs = (platform as any).getChatState({ chatKey: 'dm:3001' } as any);
    cs.botMessageIdStack = [888];
    cs.busy = false;

    await (platform as any).handleMessage(makeCtx('/undo'));

    // 验证 undo 被调用（历史回滚由 Backend 统一处理）
    expect(backend.undoCalls).toHaveLength(1);
    expect(backend.undoCalls[0].scope).toBe('last-turn');
    expect(edited).toHaveLength(1);
    expect(edited[0].id).toBe(888);
    expect(edited[0].text).toContain('已撤销');
    expect(cs.botMessageIdStack).toHaveLength(0);
  });

  it('执行 /redo 时恢复上一轮的用户输入', async () => {
    const { TelegramPlatform } = await import('../extensions/telegram/src');

    class FakeBackend extends EventEmitter {
      redoCalls: string[] = [];
      async chat() {}
      async redo(sessionId: string) {
        this.redoCalls.push(sessionId);
        return { restored: [{ role: 'model', parts: [{ text: 'Redo answer' }] }], restoredCount: 1, userText: 'Undo me', assistantText: 'Redo answer' };
      }
      isStreamEnabled() { return false; }
    }

    const backend = new FakeBackend();
    const platform = new TelegramPlatform(backend as any, {
      token: 'bot-token',
      groupMentionRequired: false,
    });

    (platform as any).client = {
      sendMessageReturningId: vi.fn(async () => 999),
    };

    let seq = 200;
    const makeCtx = (text: string) => ({
      chat: { id: 3002, type: 'private' },
      me: { username: 'test_bot' },
      message: { message_id: ++seq, text, date: Math.floor(Date.now() / 1000) },
    });

    await (platform as any).handleMessage(makeCtx('Test'));
    const cs = (platform as any).getChatState({ chatKey: 'dm:3002' } as any);
    cs.busy = false;

    await (platform as any).handleMessage(makeCtx('/redo'));

    expect(backend.redoCalls).toHaveLength(1);
    expect((platform as any).client.sendMessageReturningId).toHaveBeenCalledTimes(1);
    expect((platform as any).client.sendMessageReturningId).toHaveBeenLastCalledWith(expect.anything(), 'Redo answer');
  });
});
