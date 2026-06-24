import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { TelegramClient } from '../extensions/telegram/src/client';
import { renderTelegramDraftTurn, renderTelegramRichTurn } from '../extensions/telegram/src/rich-message';
import { TelegramPlatform } from '../extensions/telegram/src';

class FakeBackend extends EventEmitter {
  chats: Array<{ sessionId: string; text: string }> = [];
  constructor(private readonly streamEnabled: boolean) {
    super();
  }

  async chat(sessionId: string, text: string): Promise<void> {
    this.chats.push({ sessionId, text });
  }

  isStreamEnabled(): boolean {
    return this.streamEnabled;
  }
}

const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('Telegram rich renderer', () => {
  it('将 trace 折叠在正文前，并保留正文 Markdown 表格', () => {
    const rich = renderTelegramRichTurn({
      traceSections: [{ title: '思考过程', content: '先分析\n再回答', format: 'text' }],
      answerMarkdown: '| Metric | Value |\n| --- | --- |\n| Speed | 42 |',
    });

    expect(rich.markdown).toContain('<details><summary>思考过程</summary>');
    expect(rich.markdown).toContain('```text\n先分析\n再回答\n```');
    expect(rich.markdown).toMatch(/<\/details>\n\n\| Metric \| Value \|/);
  });

  it('空 draft 使用 Telegram draft-only thinking block', () => {
    const rich = renderTelegramDraftTurn({ answerMarkdown: '', thinkingText: '思考中...' });
    expect(rich.markdown).toBe('<tg-thinking>思考中...</tg-thinking>');
  });
});

describe('Telegram rich client primitives', () => {
  it('发送 rich message 并返回 message_id', async () => {
    const client = new TelegramClient({ token: 'fake-token' });
    const sendRichMessage = vi.fn(async () => ({ message_id: 123 }));
    (client as any).bot = { api: { sendRichMessage } };

    const messageId = await client.sendRichMessageReturningId(
      { chatId: 1, chatKey: 'dm:1', sessionId: 'telegram-dm-1', scope: 'dm' },
      { markdown: 'hello' },
    );

    expect(messageId).toBe(123);
    expect(sendRichMessage).toHaveBeenCalledWith(1, { markdown: 'hello' }, {});
  });

  it('draft stream 只允许私聊并要求非零 draft_id', async () => {
    const client = new TelegramClient({ token: 'fake-token' });
    const sendRichMessageDraft = vi.fn(async () => true);
    (client as any).bot = { api: { sendRichMessageDraft } };

    await client.sendRichMessageDraft(
      { chatId: 1, chatKey: 'dm:1', sessionId: 'telegram-dm-1', scope: 'dm' },
      10,
      { markdown: 'hello' },
    );

    expect(sendRichMessageDraft).toHaveBeenCalledWith(1, 10, { markdown: 'hello' }, {});
    await client.sendRichMessageDraft(
      { chatId: 1, chatKey: 'dm:1', sessionId: 'telegram-dm-1', scope: 'dm', threadId: 99 },
      11,
      { markdown: 'thread' },
    );
    expect(sendRichMessageDraft).toHaveBeenLastCalledWith(
      1,
      11,
      { markdown: 'thread' },
      { message_thread_id: 99 },
    );
    await expect(client.sendRichMessageDraft(
      { chatId: -1, chatKey: 'group:-1', sessionId: 'telegram-group--1', scope: 'group' },
      10,
      { markdown: 'hello' },
    )).rejects.toThrow('仅支持私聊');
    await expect(client.sendRichMessageDraft(
      { chatId: 1, chatKey: 'dm:1', sessionId: 'telegram-dm-1', scope: 'dm' },
      0,
      { markdown: 'hello' },
    )).rejects.toThrow('draft_id');
  });

  it('替换长纯文本时编辑首条并发送后续分片', async () => {
    const client = new TelegramClient({ token: 'fake-token' });
    const editMessageText = vi.fn(async () => true);
    const sendMessage = vi.fn(async () => ({ message_id: 124 }));
    (client as any).bot = { api: { editMessageText, sendMessage } };

    const messageIds = await client.replaceMessageTextReturningIds(
      { chatId: 1, chatKey: 'dm:1', sessionId: 'telegram-dm-1', scope: 'dm' },
      123,
      `${'a'.repeat(4096)}\n${'b'.repeat(10)}`,
    );

    expect(messageIds).toEqual([123, 124]);
    expect(editMessageText).toHaveBeenCalledWith(1, 123, 'a'.repeat(4096), {});
    expect(sendMessage).toHaveBeenCalledWith(1, 'b'.repeat(10), {});
  });

  it('批量发送纯文本时逐条暴露已成功发送的 message_id', async () => {
    const client = new TelegramClient({ token: 'fake-token' });
    const sendMessage = vi.fn()
      .mockResolvedValueOnce({ message_id: 201 })
      .mockRejectedValueOnce(new Error('send failed'));
    (client as any).bot = { api: { sendMessage } };
    const observed: number[] = [];

    await expect(client.sendTextReturningIds(
      { chatId: 1, chatKey: 'dm:1', sessionId: 'telegram-dm-1', scope: 'dm' },
      `${'a'.repeat(4096)}\n${'b'.repeat(10)}`,
      {},
      { onMessageId: (messageId) => observed.push(messageId) },
    )).rejects.toThrow('send failed');

    expect(observed).toEqual([201]);
  });
});

describe('Telegram platform rich output', () => {
  it('非流式回复发送 rich message，trace 在正文前', async () => {
    const backend = new FakeBackend(false);
    const platform = new TelegramPlatform(backend as any, {
      token: 'bot-token',
      groupMentionRequired: false,
    });
    (platform as any).setupBackendListeners();

    const sendRichMessageReturningId = vi.fn(async () => 42);
    (platform as any).client = {
      sendRichMessageReturningId,
      sendMessageReturningId: vi.fn(async () => 999),
    };

    await (platform as any).handleMessage({
      chat: { id: 1001, type: 'private' },
      me: { username: 'iris_bot' },
      message: { message_id: 1, text: '请列表格' },
    });

    const sid = backend.chats[0].sessionId;
    backend.emit('assistant:content', sid, {
      role: 'model',
      parts: [{ text: '分析表格结构', thought: true }],
    });
    backend.emit('response', sid, '| A | B |\n| --- | --- |\n| 1 | 2 |');
    await flushMicrotasks();

    expect(sendRichMessageReturningId).toHaveBeenCalledOnce();
    const rich = sendRichMessageReturningId.mock.calls[0][1];
    expect(rich.markdown).toContain('<details><summary>思考过程</summary>');
    expect(rich.markdown).toMatch(/<\/details>\n\n\| A \| B \|/);
  });

  it('非流式 rich 发送失败时回落为用户可见的纯文本回复', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const backend = new FakeBackend(false);
      const platform = new TelegramPlatform(backend as any, {
        token: 'bot-token',
        groupMentionRequired: false,
      });
      (platform as any).setupBackendListeners();

      const sendTextReturningIds = vi.fn(async () => [43]);
      (platform as any).client = {
        sendRichMessageReturningId: vi.fn(async () => {
          throw { error_code: 400, description: 'Bad Request: RICH_MESSAGE_PHOTO_NO_MEDIA_FOUND' };
        }),
        sendTextReturningIds,
      };

      await (platform as any).handleMessage({
        chat: { id: 1002, type: 'private' },
        me: { username: 'iris_bot' },
        message: { message_id: 2, text: '展示 markdown 图片语法' },
      });

      const sid = backend.chats[0].sessionId;
      backend.emit('assistant:content', sid, {
        role: 'model',
        parts: [{ text: '检查 rich 输出', thought: true }],
      });
      backend.emit('response', sid, '图片示例：![图片描述](https://example.com/a.png)');
      await flushMicrotasks();

      expect(sendTextReturningIds).toHaveBeenCalledOnce();
      const fallbackText = sendTextReturningIds.mock.calls[0][1];
      expect(fallbackText).toContain('RICH_MESSAGE_PHOTO_NO_MEDIA_FOUND');
      expect(fallbackText).toContain('检查 rich 输出');
      expect(fallbackText).toContain('![图片描述](https://example.com/a.png)');
      expect(warnSpy).toHaveBeenCalledWith(
        '[TelegramExtension:Telegram]',
        expect.stringContaining('RICH_MESSAGE_PHOTO_NO_MEDIA_FOUND'),
      );
      expect(warnSpy.mock.calls.flat().some((arg) => typeof arg === 'object')).toBe(false);
      const cs = Array.from((platform as any).chatStates.values())[0];
      expect((cs as any).botMessageGroups).toEqual([{ messageIds: [43] }]);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('私聊流式使用官方 draft，并在 done 时发送最终 rich message', async () => {
    const backend = new FakeBackend(true);
    const platform = new TelegramPlatform(backend as any, {
      token: 'bot-token',
      groupMentionRequired: false,
    });
    (platform as any).setupBackendListeners();

    const sendRichMessageDraft = vi.fn(async () => undefined);
    const sendRichMessageReturningId = vi.fn(async () => 77);
    (platform as any).client = {
      sendRichMessageDraft,
      sendRichMessageReturningId,
    };

    await (platform as any).handleMessage({
      chat: { id: 2001, type: 'private' },
      me: { username: 'iris_bot' },
      message: { message_id: 5, text: '开始' },
    });

    const sid = backend.chats[0].sessionId;
    const cs = Array.from((platform as any).chatStates.values())[0];
    expect(sendRichMessageDraft).toHaveBeenCalledWith(
      expect.objectContaining({ chatId: 2001, scope: 'dm' }),
      5,
      { markdown: '<tg-thinking>💭 思考中...</tg-thinking>' },
    );

    backend.emit('stream:parts', sid, [{ text: '分析中', thought: true }]);
    backend.emit('stream:chunk', sid, '最终正文');
    await (platform as any).flushStreamUpdate(cs);

    const updatedDraft = sendRichMessageDraft.mock.calls.at(-1)?.[2];
    expect(updatedDraft.markdown).toContain('<details><summary>思考过程</summary>');
    expect(updatedDraft.markdown).toContain('最终正文');

    backend.emit('done', sid);
    await flushMicrotasks();

    expect(sendRichMessageReturningId).toHaveBeenCalledWith(
      expect.objectContaining({ chatId: 2001, scope: 'dm' }),
      expect.objectContaining({ markdown: expect.stringContaining('最终正文') }),
    );
    expect((cs as any).botMessageGroups).toEqual([{ messageIds: [77] }]);
  });

  it('私聊 draft 最终 rich 发送失败时发送纯文本 fallback', async () => {
    const backend = new FakeBackend(true);
    const platform = new TelegramPlatform(backend as any, {
      token: 'bot-token',
      groupMentionRequired: false,
    });
    (platform as any).setupBackendListeners();

    const sendTextReturningIds = vi.fn(async () => [78]);
    (platform as any).client = {
      sendRichMessageDraft: vi.fn(async () => undefined),
      sendRichMessageReturningId: vi.fn(async () => {
        throw { error_code: 400, description: 'Bad Request: RICH_MESSAGE_PHOTO_NO_MEDIA_FOUND' };
      }),
      sendTextReturningIds,
    };

    await (platform as any).handleMessage({
      chat: { id: 2002, type: 'private' },
      me: { username: 'iris_bot' },
      message: { message_id: 6, text: '开始' },
    });

    const sid = backend.chats[0].sessionId;
    const cs = Array.from((platform as any).chatStates.values())[0];
    backend.emit('stream:parts', sid, [{ text: '保留 trace', thought: true }]);
    backend.emit('stream:chunk', sid, '图片示例：![图片描述](https://example.com/a.png)');
    await (platform as any).flushStreamUpdate(cs);

    backend.emit('done', sid);
    await flushMicrotasks();

    expect(sendTextReturningIds).toHaveBeenCalledOnce();
    const fallbackText = sendTextReturningIds.mock.calls[0][1];
    expect(fallbackText).toContain('RICH_MESSAGE_PHOTO_NO_MEDIA_FOUND');
    expect(fallbackText).toContain('保留 trace');
    expect(fallbackText).toContain('![图片描述](https://example.com/a.png)');
    expect((cs as any).botMessageGroups).toEqual([{ messageIds: [78] }]);
  });

  it('群聊 auto 流式使用 legacy edit 预览，最终编辑为 rich message', async () => {
    const backend = new FakeBackend(true);
    const platform = new TelegramPlatform(backend as any, {
      token: 'bot-token',
      groupMentionRequired: false,
    });
    (platform as any).setupBackendListeners();

    const sendMessageReturningId = vi.fn(async () => 88);
    const editText = vi.fn(async () => undefined);
    const editRichMessage = vi.fn(async () => undefined);
    (platform as any).client = {
      sendMessageReturningId,
      editText,
      editRichMessage,
    };

    await (platform as any).handleMessage({
      chat: { id: -3001, type: 'supergroup' },
      me: { username: 'iris_bot' },
      message: { message_id: 9, text: '群聊问题' },
    });

    const sid = backend.chats[0].sessionId;
    const cs = Array.from((platform as any).chatStates.values())[0];
    backend.emit('stream:chunk', sid, '| A | B |\n| --- | --- |\n| 1 | 2 |');
    await (platform as any).flushStreamUpdate(cs);
    expect(editText).toHaveBeenCalledWith(
      expect.objectContaining({ chatId: -3001, scope: 'group' }),
      88,
      expect.stringContaining('| A | B |'),
    );

    backend.emit('done', sid);
    await flushMicrotasks();

    expect(editRichMessage).toHaveBeenCalledWith(
      expect.objectContaining({ chatId: -3001, scope: 'group' }),
      88,
      expect.objectContaining({ markdown: expect.stringContaining('| A | B |') }),
    );
    expect((cs as any).botMessageGroups).toEqual([{ messageIds: [88] }]);
  });

  it('群聊最终 rich 编辑失败时替换 placeholder 为纯文本 fallback', async () => {
    const backend = new FakeBackend(true);
    const platform = new TelegramPlatform(backend as any, {
      token: 'bot-token',
      groupMentionRequired: false,
    });
    (platform as any).setupBackendListeners();

    const replaceMessageTextReturningIds = vi.fn(async () => [88, 89]);
    (platform as any).client = {
      sendMessageReturningId: vi.fn(async () => 88),
      editText: vi.fn(async () => undefined),
      editRichMessage: vi.fn(async () => {
        throw { error_code: 400, description: 'Bad Request: RICH_MESSAGE_PHOTO_NO_MEDIA_FOUND' };
      }),
      replaceMessageTextReturningIds,
    };

    await (platform as any).handleMessage({
      chat: { id: -3002, type: 'supergroup' },
      me: { username: 'iris_bot' },
      message: { message_id: 10, text: '群聊问题' },
    });

    const sid = backend.chats[0].sessionId;
    const cs = Array.from((platform as any).chatStates.values())[0];
    backend.emit('stream:chunk', sid, '图片示例：![图片描述](https://example.com/a.png)');
    backend.emit('done', sid);
    await flushMicrotasks();

    expect(replaceMessageTextReturningIds).toHaveBeenCalledWith(
      expect.objectContaining({ chatId: -3002, scope: 'group' }),
      88,
      expect.stringContaining('RICH_MESSAGE_PHOTO_NO_MEDIA_FOUND'),
      {},
      { onMessageId: expect.any(Function) },
    );
    expect(replaceMessageTextReturningIds.mock.calls[0][2]).toContain('![图片描述](https://example.com/a.png)');
    expect((cs as any).botMessageGroups).toEqual([{ messageIds: [88, 89] }]);
  });

  it('纯文本兜底分片中途失败时保留已发送消息的 undo 记录', async () => {
    const backend = new FakeBackend(false);
    const platform = new TelegramPlatform(backend as any, {
      token: 'bot-token',
      groupMentionRequired: false,
      outputFormat: 'plain',
    });
    const cs = (platform as any).getChatState({
      chatId: 1,
      chatKey: 'dm:1',
      sessionId: 'telegram-dm-1',
      scope: 'dm',
    });
    (platform as any).client = {
      sendTextReturningIds: vi.fn(async (_target, _text, _options, observer) => {
        observer.onMessageId(301);
        throw new Error('send failed');
      }),
    };

    await expect((platform as any).sendPlainAssistantFinal(cs, 'fallback')).rejects.toThrow('send failed');

    expect((cs as any).botMessageGroups).toEqual([{ messageIds: [301] }]);
  });

  it('undo UI 按消息组标记最终 assistant 回复', async () => {
    const backend = new FakeBackend(false);
    const platform = new TelegramPlatform(backend as any, {
      token: 'bot-token',
      groupMentionRequired: false,
    });
    const editText = vi.fn(async () => undefined);
    (platform as any).client = { editText, deleteMessage: vi.fn() };

    const cs = (platform as any).getChatState({
      chatId: 1,
      chatKey: 'dm:1',
      sessionId: 'telegram-dm-1',
      scope: 'dm',
    });
    (platform as any).trackBotMessageGroup(cs, [10, 11]);

    await (platform as any).markBotMessageAsUndone(cs);

    expect(editText).toHaveBeenCalledWith(
      expect.objectContaining({ chatId: 1 }),
      10,
      '已撤销',
    );
    expect((platform as any).client.deleteMessage).toHaveBeenCalledWith(
      expect.objectContaining({ chatId: 1 }),
      11,
    );
  });
});
