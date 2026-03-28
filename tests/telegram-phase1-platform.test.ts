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

  async chat(sessionId: string, text: string, images?: any[], documents?: any[]): Promise<void> {
    this.chats.push({ sessionId, text, images, documents });
  }

  isStreamEnabled(): boolean {
    return false;
  }
}

describe('Telegram Phase 1.3: platform concurrency', () => {
  it('在 busy 时暂存消息，并在 done 后自动继续处理', async () => {
    const backend = new FakeBackend();
    const platform = new TelegramPlatform(backend as any, {
      token: 'bot-token',
      groupMentionRequired: false,
    });

    const sentMessages: string[] = [];
    (platform as any).client = {
      sendMessageReturningId: vi.fn(async (_target: unknown, text: string) => {
        sentMessages.push(text);
        return 999;
      }),
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
