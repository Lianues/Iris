/**
 * Telegram Phase 1.3 测试。
 *
 * 目标：验证平台主类的并发控制、消息缓冲与回合结束后的自动续处理。
 *
 * Phase 2 升级后 sessionId 带时间戳后缀，测试改用 startsWith 匹配。
 */

import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { TelegramPlatform } from '../extensions/telegram/src';

class FakeBackend extends EventEmitter {
  chats: Array<{ sessionId: string; text: string; images?: any[]; documents?: any[] }> = [];
  abortChat = vi.fn();

  async chat(sessionId: string, text: string, images?: any[], documents?: any[]): Promise<void> {
    this.chats.push({ sessionId, text, images, documents });
  }

  isStreamEnabled(): boolean {
    return false;
  }
}

describe('Telegram Phase 1.3: platform concurrency', () => {
  it('/stop 在长回合中可进入，并中止当前 turn 而不是继续处理缓冲消息', async () => {
    class SlowBackend extends FakeBackend {
      private readonly resolvers: Array<() => void> = [];

      override chat(sessionId: string, text: string, images?: any[], documents?: any[]): Promise<void> {
        this.chats.push({ sessionId, text, images, documents });
        return new Promise((resolve) => {
          this.resolvers.push(resolve);
        });
      }

      resolveNext(): void {
        this.resolvers.shift()?.();
      }
    }

    const backend = new SlowBackend();
    const platform = new TelegramPlatform(backend as any, {
      token: 'bot-token',
      groupMentionRequired: false,
      outputFormat: 'plain',
    });
    (platform as any).setupBackendListeners();

    const sentMessages: string[] = [];
    (platform as any).client = {
      sendMessageReturningId: vi.fn(async (_target: unknown, text: string) => {
        sentMessages.push(text);
        return 999;
      }),
      sendTextReturningIds: vi.fn(async (_target: unknown, text: string) => {
        sentMessages.push(text);
        return [999];
      }),
      sendTyping: vi.fn(async () => undefined),
    };

    const makeCtx = (messageId: number, text: string) => ({
      chat: { id: 1003, type: 'private' },
      me: { username: 'iris_bot' },
      message: { message_id: messageId, text },
    });

    // 旧实现会一直 await backend.chat()，导致这一 Promise 在长回合结束前不 resolve。
    // 现在 handler 必须尽快返回，后续 /stop 才能被 grammY 投递进来。
    let firstTurnResolved = false;
    const firstTurn = (platform as any).handleMessage(makeCtx(10, '长回合'))
      .then(() => { firstTurnResolved = true; });
    await new Promise((resolve) => setImmediate(resolve));
    expect(firstTurnResolved).toBe(true);
    await firstTurn;
    expect(backend.chats).toHaveLength(1);

    await (platform as any).handleMessage(makeCtx(11, '第二条'));
    expect(sentMessages.some((m) => m.includes('暂存'))).toBe(true);

    await (platform as any).handleMessage(makeCtx(12, '/stop'));
    expect(backend.abortChat).toHaveBeenCalledWith(backend.chats[0].sessionId);

    // /stop 会丢弃已暂存输入；done 后不应再自动 flush 第二条消息。
    backend.resolveNext();
    backend.emit('done', backend.chats[0].sessionId);
    await new Promise((r) => setTimeout(r, 50));

    expect(backend.chats).toHaveLength(1);
  });

  it('旧 turn 的异步失败不会清理后续 turn 状态', async () => {
    class RejectableBackend extends FakeBackend {
      private readonly rejecters: Array<(err: Error) => void> = [];

      override chat(sessionId: string, text: string, images?: any[], documents?: any[]): Promise<void> {
        this.chats.push({ sessionId, text, images, documents });
        return new Promise((_resolve, reject) => {
          this.rejecters.push(reject);
        });
      }

      rejectAt(index: number): void {
        this.rejecters[index]?.(new Error(`turn ${index} failed`));
      }
    }

    const backend = new RejectableBackend();
    const platform = new TelegramPlatform(backend as any, {
      token: 'bot-token',
      groupMentionRequired: false,
      outputFormat: 'plain',
    });
    (platform as any).setupBackendListeners();

    const sentMessages: string[] = [];
    (platform as any).client = {
      sendMessageReturningId: vi.fn(async (_target: unknown, text: string) => {
        sentMessages.push(text);
        return 999;
      }),
      sendTextReturningIds: vi.fn(async (_target: unknown, text: string) => {
        sentMessages.push(text);
        return [999];
      }),
      sendTyping: vi.fn(async () => undefined),
    };

    const makeCtx = (messageId: number, text: string) => ({
      chat: { id: 1004, type: 'private' },
      me: { username: 'iris_bot' },
      message: { message_id: messageId, text },
    });

    await (platform as any).handleMessage(makeCtx(20, '第一轮'));
    backend.emit('done', backend.chats[0].sessionId);
    await new Promise((resolve) => setImmediate(resolve));

    await (platform as any).handleMessage(makeCtx(21, '第二轮'));
    expect(backend.chats).toHaveLength(2);

    // 第一轮的 Promise 如果迟到 reject，不应把第二轮 busy 状态清掉。
    backend.rejectAt(0);
    await new Promise((resolve) => setImmediate(resolve));

    await (platform as any).handleMessage(makeCtx(22, '第三条'));
    expect(backend.chats).toHaveLength(2);
    expect(sentMessages.some((m) => m.includes('暂存'))).toBe(true);
  });

  it('在 busy 时暂存消息，并在 done 后自动继续处理', async () => {
    const backend = new FakeBackend();
    const platform = new TelegramPlatform(backend as any, {
      token: 'bot-token',
      groupMentionRequired: false,
      outputFormat: 'plain',
    });

    const sentMessages: string[] = [];
    (platform as any).client = {
      sendMessageReturningId: vi.fn(async (_target: unknown, text: string) => {
        sentMessages.push(text);
        return 999;
      }),
      sendTextReturningIds: vi.fn(async (_target: unknown, text: string) => {
        sentMessages.push(text);
        return [999];
      }),
      sendTyping: vi.fn(async () => undefined),
    };

    // 第一条消息
    await (platform as any).handleMessage({
      chat: { id: 1001, type: 'private' },
      me: { username: 'iris_bot' },
      message: { message_id: 1, text: '第一条' },
    });

    // 第二条消息（应被暂存）
    await (platform as any).handleMessage({
      chat: { id: 1001, type: 'private' },
      me: { username: 'iris_bot' },
      message: { message_id: 2, text: '第二条' },
    });

    // 验证第一条已发送
    expect(backend.chats).toHaveLength(1);
    expect(backend.chats[0].text).toBe('第一条');
    // sessionId 带时间戳，用 startsWith 匹配
    expect(backend.chats[0].sessionId).toMatch(/^telegram-dm-1001/);

    // 验证暂存通知
    expect(sentMessages.some((m) => m.includes('暂存'))).toBe(true);

    // 模拟 done 事件
    ;(platform as any).setupBackendListeners();
    backend.emit('response', backend.chats[0].sessionId, '第一轮回复');
    backend.emit('done', backend.chats[0].sessionId);

    // 等异步 flush 完成
    await new Promise((r) => setTimeout(r, 50));

    // 验证第二条被合并发送
    expect(backend.chats).toHaveLength(2);
    expect(backend.chats[1].text).toBe('第二条');
  });

  it('Phase 3：纯图片消息尝试下载后传给 backend', async () => {
    const backend = new FakeBackend();
    const platform = new TelegramPlatform(backend as any, {
      token: 'bot-token',
      groupMentionRequired: false,
    });

    const sentMessages: string[] = [];
    (platform as any).client = {
      sendMessageReturningId: vi.fn(async () => 999),
      // Phase 3：提供 downloadFile mock，模拟图片下载
      downloadFile: vi.fn(async () => ({
        fileId: 'p1',
        filePath: 'photos/p1.jpg',
        // JPEG 文件头：FF D8 FF
        buffer: Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10]),
      })),
    };

    await (platform as any).handleMessage({
      chat: { id: 1002, type: 'private' },
      me: { username: 'iris_bot' },
      message: {
        message_id: 3,
        photo: [{ file_id: 'p1' }],
      },
    });

    // Phase 3：纯图片消息现在会被处理，backend.chat 应被调用
    expect(backend.chats).toHaveLength(1);
    // 纯图片消息的 text 为空字符串
    expect(backend.chats[0].text).toBe('');
    // 验证 images 参数（第三个参数）包含下载的图片
    const chatCall = backend.chats[0] as any;
    expect(chatCall.images).toBeDefined();
    expect(chatCall.images).toHaveLength(1);
    expect(chatCall.images[0].mimeType).toBe('image/jpeg');
  });
});
