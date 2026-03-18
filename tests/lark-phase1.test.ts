/**
 * Lark Phase 1 测试。
 *
 * 目标：验证客户端纯逻辑、会话归一化与基础消息解析已可用。
 */

import { describe, expect, it } from 'vitest';
import { buildLarkTextContent, normalizeLarkMessageId } from '../src/platforms/lark/client';
import { extractLarkMessageContent, extractLarkText, LarkMessageHandler, stripLarkBotMention } from '../src/platforms/lark/message-handler';
import { buildLarkSessionTarget, parseLarkSessionTarget } from '../src/platforms/lark/types';

describe('Lark Phase 1: session target', () => {
  it('构造并解析私聊 sessionId', () => {
    const target = buildLarkSessionTarget({
      chatId: 'oc_dm_chat',
      chatType: 'p2p',
      userOpenId: 'ou_user_1',
    });

    expect(target.sessionId).toBe('lark-dm-ou_user_1');
    expect(parseLarkSessionTarget(target.sessionId)).toMatchObject({
      scope: 'dm',
      userOpenId: 'ou_user_1',
      receiveIdType: 'open_id',
    });
  });

  it('构造并解析群线程 sessionId', () => {
    const target = buildLarkSessionTarget({
      chatId: 'oc_group_1',
      chatType: 'group',
      threadId: 'omt-thread-1',
    });

    expect(target.sessionId).toBe('lark-group-oc_group_1-thread-omt-thread-1');
    expect(parseLarkSessionTarget(target.sessionId)).toMatchObject({
      scope: 'group',
      chatId: 'oc_group_1',
      threadId: 'omt-thread-1',
      receiveIdType: 'chat_id',
    });
  });
});

describe('Lark Phase 1: client helpers', () => {
  it('构造飞书 text content JSON', () => {
    expect(buildLarkTextContent('你好')).toBe(JSON.stringify({ text: '你好' }));
  });

  it('规范化 message_id', () => {
    expect(normalizeLarkMessageId('om_xxx:card-action')).toBe('om_xxx');
  });
});

describe('Lark Phase 1: message handler', () => {
  it('解析 text 消息并移除 bot mention', () => {
    const handler = new LarkMessageHandler('ou_bot');
    const parsed = handler.parseIncomingMessage({
      event: {
        sender: { sender_id: { open_id: 'ou_user_1' } },
        message: {
          message_id: 'om_1',
          chat_id: 'oc_group_1',
          chat_type: 'group',
          thread_id: 'omt_1',
          message_type: 'text',
          content: JSON.stringify({ text: '<at user_id="ou_bot">Iris</at> 请继续' }),
          mentions: [{ key: '@_user_1', name: 'Iris', id: { open_id: 'ou_bot' } }],
        },
      },
    });

    expect(parsed).toMatchObject({
      text: '请继续',
      mentioned: true,
      threadId: 'omt_1',
      session: { sessionId: 'lark-group-oc_group_1-thread-omt_1' },
    });
  });

  it('解析 post 消息正文', () => {
    const postText = extractLarkText({
      message_type: 'post',
      content: JSON.stringify({
        zh_cn: {
          content: [
            [{ tag: 'text', text: '第一行' }],
            [{ tag: 'text', text: '第二行' }],
          ],
        },
      }),
    });

    expect(postText).toBe('第一行\n第二行');
  });

  it('清理 at 标签', () => {
    expect(stripLarkBotMention('<at user_id="ou_bot">Iris</at> 你好')).toBe('你好');
  });

  it('解析 image/file/audio 占位文本与资源描述', () => {
    expect(extractLarkMessageContent({
      message_type: 'image',
      content: JSON.stringify({ image_key: 'img_1' }),
    })).toMatchObject({
      text: '![image](img_1)',
      resources: [{ type: 'image', fileKey: 'img_1' }],
    });

    expect(extractLarkMessageContent({
      message_type: 'file',
      content: JSON.stringify({ file_key: 'file_1', file_name: 'a.txt' }),
    }).resources[0]).toMatchObject({ type: 'file', fileKey: 'file_1', fileName: 'a.txt' });

    expect(extractLarkMessageContent({
      message_type: 'audio',
      content: JSON.stringify({ file_key: 'audio_1', duration: 3100 }),
    }).text).toBe('<audio key="audio_1" duration="00:03"/>');
  });
});

