/**
 * Phase 3 多媒体处理测试。
 *
 * 覆盖飞书和 Telegram 两个平台的多媒体下载与格式转换逻辑。
 */

import { describe, expect, it, vi } from 'vitest';

// ---- 飞书多媒体测试 ----

describe('Lark Phase 3: 多媒体类型定义', () => {
  it('LarkResourceRef 支持 image/file/audio 三种类型', async () => {
    const { LarkResourceRef } = await import('../src/platforms/lark/types') as any;
    // 类型测试：确保 LarkResourceRef 的 type 字段覆盖三种类型
    const imageRef = { type: 'image' as const, fileKey: 'img_key_001' };
    const fileRef = { type: 'file' as const, fileKey: 'file_key_001', fileName: 'doc.pdf' };
    const audioRef = { type: 'audio' as const, fileKey: 'audio_key_001', duration: 5000 };

    expect(imageRef.type).toBe('image');
    expect(fileRef.type).toBe('file');
    expect(fileRef.fileName).toBe('doc.pdf');
    expect(audioRef.type).toBe('audio');
    expect(audioRef.duration).toBe(5000);
  });

  it('LarkDownloadedResource / LarkUploadImageResult / LarkUploadFileResult 结构正确', async () => {
    const types = await import('../src/platforms/lark/types');
    // 验证类型导出存在（编译时检查）
    const downloadResult: import('../src/platforms/lark/types').LarkDownloadedResource = {
      buffer: Buffer.from('test'),
      contentType: 'image/jpeg',
      fileName: 'test.jpg',
    };
    expect(downloadResult.buffer).toBeInstanceOf(Buffer);
    expect(downloadResult.contentType).toBe('image/jpeg');

    const uploadImageResult: import('../src/platforms/lark/types').LarkUploadImageResult = {
      imageKey: 'img_v2_xxx',
    };
    expect(uploadImageResult.imageKey).toBe('img_v2_xxx');

    const uploadFileResult: import('../src/platforms/lark/types').LarkUploadFileResult = {
      fileKey: 'file_v2_xxx',
    };
    expect(uploadFileResult.fileKey).toBe('file_v2_xxx');
  });
});

describe('Lark Phase 3: 消息解析器对多媒体的解析', () => {
  it('解析 image 消息并提取 resources', async () => {
    const { LarkMessageHandler } = await import('../src/platforms/lark/message-handler');
    const handler = new LarkMessageHandler();

    const result = handler.parseIncomingMessage({
      event: {
        sender: { sender_id: { open_id: 'ou_user1' } },
        message: {
          message_id: 'msg_001',
          chat_id: 'oc_chat1',
          chat_type: 'p2p',
          message_type: 'image',
          content: JSON.stringify({ image_key: 'img_v2_abc123' }),
        },
      },
    });

    expect(result).not.toBeNull();
    expect(result!.resources).toHaveLength(1);
    expect(result!.resources[0].type).toBe('image');
    expect(result!.resources[0].fileKey).toBe('img_v2_abc123');
    // 图片消息的文本为占位符
    expect(result!.text).toContain('img_v2_abc123');
  });

  it('解析 file 消息并提取 resources', async () => {
    const { LarkMessageHandler } = await import('../src/platforms/lark/message-handler');
    const handler = new LarkMessageHandler();

    const result = handler.parseIncomingMessage({
      event: {
        sender: { sender_id: { open_id: 'ou_user1' } },
        message: {
          message_id: 'msg_002',
          chat_id: 'oc_chat1',
          chat_type: 'p2p',
          message_type: 'file',
          content: JSON.stringify({ file_key: 'file_v2_xyz', file_name: 'report.pdf' }),
        },
      },
    });

    expect(result).not.toBeNull();
    expect(result!.resources).toHaveLength(1);
    expect(result!.resources[0].type).toBe('file');
    expect(result!.resources[0].fileKey).toBe('file_v2_xyz');
    expect(result!.resources[0].fileName).toBe('report.pdf');
  });

  it('解析 audio 消息并提取 resources', async () => {
    const { LarkMessageHandler } = await import('../src/platforms/lark/message-handler');
    const handler = new LarkMessageHandler();

    const result = handler.parseIncomingMessage({
      event: {
        sender: { sender_id: { open_id: 'ou_user1' } },
        message: {
          message_id: 'msg_003',
          chat_id: 'oc_chat1',
          chat_type: 'p2p',
          message_type: 'audio',
          content: JSON.stringify({ file_key: 'audio_key_001', duration: 3500 }),
        },
      },
    });

    expect(result).not.toBeNull();
    expect(result!.resources).toHaveLength(1);
    expect(result!.resources[0].type).toBe('audio');
    expect(result!.resources[0].fileKey).toBe('audio_key_001');
    expect(result!.resources[0].duration).toBe(3500);
  });

  it('解析 post 消息中的内嵌图片', async () => {
    const { LarkMessageHandler } = await import('../src/platforms/lark/message-handler');
    const handler = new LarkMessageHandler();

    const result = handler.parseIncomingMessage({
      event: {
        sender: { sender_id: { open_id: 'ou_user1' } },
        message: {
          message_id: 'msg_004',
          chat_id: 'oc_chat1',
          chat_type: 'p2p',
          message_type: 'post',
          content: JSON.stringify({
            zh_cn: {
              title: '带图富文本',
              content: [
                [
                  { tag: 'text', text: '请看这张图：' },
                  { tag: 'img', image_key: 'img_v2_embedded' },
                ],
              ],
            },
          }),
        },
      },
    });

    expect(result).not.toBeNull();
    expect(result!.resources).toHaveLength(1);
    expect(result!.resources[0].type).toBe('image');
    expect(result!.resources[0].fileKey).toBe('img_v2_embedded');
    expect(result!.text).toContain('请看这张图');
  });
});

// ---- Telegram 多媒体测试 ----

describe('Telegram Phase 3: TelegramMediaService', () => {
  it('supportsInboundMedia 返回 true', async () => {
    const { TelegramMediaService } = await import('../src/platforms/telegram/media');
    const service = new TelegramMediaService();
    expect(service.supportsInboundMedia()).toBe(true);
  });

  it('downloadPhoto 正确转换为 ImageInput', async () => {
    const { TelegramMediaService } = await import('../src/platforms/telegram/media');
    const service = new TelegramMediaService();

    // JPEG 文件头
    const jpegBuffer = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46]);
    const mockClient = {
      downloadFile: vi.fn(async () => ({
        fileId: 'photo_1',
        filePath: 'photos/photo_1.jpg',
        buffer: jpegBuffer,
      })),
    };

    const result = await service.downloadPhoto(mockClient as any, {
      fileId: 'photo_1',
      width: 800,
      height: 600,
    });

    expect(result).not.toBeNull();
    expect(result!.mimeType).toBe('image/jpeg');
    expect(result!.data).toBe(jpegBuffer.toString('base64'));
    expect(mockClient.downloadFile).toHaveBeenCalledWith('photo_1');
  });

  it('downloadPhoto 对 PNG 图片正确检测 MIME', async () => {
    const { TelegramMediaService } = await import('../src/platforms/telegram/media');
    const service = new TelegramMediaService();

    // PNG 文件头
    const pngBuffer = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    const mockClient = {
      downloadFile: vi.fn(async () => ({
        fileId: 'photo_2',
        filePath: 'photos/photo_2.png',
        buffer: pngBuffer,
      })),
    };

    const result = await service.downloadPhoto(mockClient as any, { fileId: 'photo_2' });
    expect(result).not.toBeNull();
    expect(result!.mimeType).toBe('image/png');
  });

  it('downloadPhoto 下载失败时返回 null', async () => {
    const { TelegramMediaService } = await import('../src/platforms/telegram/media');
    const service = new TelegramMediaService();

    const mockClient = {
      downloadFile: vi.fn(async () => { throw new Error('网络超时'); }),
    };

    const result = await service.downloadPhoto(mockClient as any, { fileId: 'photo_err' });
    expect(result).toBeNull();
  });

  it('downloadDocument 正确转换为 DocumentInput', async () => {
    const { TelegramMediaService } = await import('../src/platforms/telegram/media');
    const service = new TelegramMediaService();

    const pdfBuffer = Buffer.from('%PDF-1.4 test content');
    const mockClient = {
      downloadFile: vi.fn(async () => ({
        fileId: 'doc_1',
        filePath: 'documents/report.pdf',
        buffer: pdfBuffer,
      })),
    };

    const result = await service.downloadDocument(mockClient as any, {
      fileId: 'doc_1',
      fileName: 'report.pdf',
      mimeType: 'application/pdf',
    });

    expect(result).not.toBeNull();
    expect(result!.fileName).toBe('report.pdf');
    expect(result!.mimeType).toBe('application/pdf');
    expect(result!.data).toBe(pdfBuffer.toString('base64'));
  });

  it('downloadDocument 无 fileName 时使用兜底名', async () => {
    const { TelegramMediaService } = await import('../src/platforms/telegram/media');
    const service = new TelegramMediaService();

    const mockClient = {
      downloadFile: vi.fn(async () => ({
        fileId: 'doc_2',
        filePath: 'documents/doc_2',
        buffer: Buffer.from('content'),
      })),
    };

    const result = await service.downloadDocument(mockClient as any, {
      fileId: 'doc_2',
      // 没有 fileName 和 mimeType
    });

    expect(result).not.toBeNull();
    expect(result!.fileName).toContain('doc_2');
    // 无扩展名时回退到 octet-stream
    expect(result!.mimeType).toBe('application/octet-stream');
  });

  it('downloadVoice 正确转换为 DocumentInput', async () => {
    const { TelegramMediaService } = await import('../src/platforms/telegram/media');
    const service = new TelegramMediaService();

    const oggBuffer = Buffer.from('OggS fake audio data');
    const mockClient = {
      downloadFile: vi.fn(async () => ({
        fileId: 'voice_1',
        filePath: 'voice/voice_1.oga',
        buffer: oggBuffer,
      })),
    };

    const result = await service.downloadVoice(mockClient as any, {
      fileId: 'voice_1',
      mimeType: 'audio/ogg',
      duration: 5,
    });

    expect(result).not.toBeNull();
    expect(result!.fileName).toContain('voice_1');
    expect(result!.fileName).toContain('.ogg');
    expect(result!.mimeType).toBe('audio/ogg');
    expect(result!.data).toBe(oggBuffer.toString('base64'));
  });
});

describe('Telegram Phase 3: 平台主类对多媒体消息的处理', () => {
  it('纯图片消息下载后传给 backend.chat', async () => {
    const { EventEmitter } = await import('node:events');
    const { TelegramPlatform } = await import('../src/platforms/telegram');

    class FakeBackend extends EventEmitter {
      chats: any[] = [];
      async chat(sid: string, text: string, images?: any[], documents?: any[]) {
        this.chats.push({ sid, text, images, documents });
      }
      isStreamEnabled() { return false; }
    }

    const backend = new FakeBackend();
    const platform = new TelegramPlatform(backend as any, {
      token: 'bot-token',
      groupMentionRequired: false,
    });

    // JPEG 文件头
    const jpegBuf = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]);
    (platform as any).client = {
      sendMessageReturningId: vi.fn(async () => 999),
      downloadFile: vi.fn(async () => ({
        fileId: 'p1',
        filePath: 'photos/p1.jpg',
        buffer: jpegBuf,
      })),
    };

    await (platform as any).handleMessage({
      chat: { id: 2001, type: 'private' },
      me: { username: 'test_bot' },
      message: {
        message_id: 10,
        photo: [{ file_id: 'p1', width: 100, height: 100 }],
      },
    });

    expect(backend.chats).toHaveLength(1);
    expect(backend.chats[0].images).toHaveLength(1);
    expect(backend.chats[0].images[0].mimeType).toBe('image/jpeg');
    expect(backend.chats[0].images[0].data).toBe(jpegBuf.toString('base64'));
  });

  it('图片+文字消息同时传递 text 和 images', async () => {
    const { EventEmitter } = await import('node:events');
    const { TelegramPlatform } = await import('../src/platforms/telegram');

    class FakeBackend extends EventEmitter {
      chats: any[] = [];
      async chat(sid: string, text: string, images?: any[], documents?: any[]) {
        this.chats.push({ sid, text, images, documents });
      }
      isStreamEnabled() { return false; }
    }

    const backend = new FakeBackend();
    const platform = new TelegramPlatform(backend as any, {
      token: 'bot-token',
      groupMentionRequired: false,
    });

    const pngBuf = Buffer.from([0x89, 0x50, 0x4E, 0x47]);
    (platform as any).client = {
      downloadFile: vi.fn(async () => ({
        fileId: 'p2',
        filePath: 'photos/p2.png',
        buffer: pngBuf,
      })),
    };

    await (platform as any).handleMessage({
      chat: { id: 2002, type: 'private' },
      me: { username: 'test_bot' },
      message: {
        message_id: 11,
        caption: '这是一张截图',
        photo: [{ file_id: 'p2', width: 800, height: 600 }],
      },
    });

    expect(backend.chats).toHaveLength(1);
    expect(backend.chats[0].text).toBe('这是一张截图');
    expect(backend.chats[0].images).toHaveLength(1);
    expect(backend.chats[0].images[0].mimeType).toBe('image/png');
  });

  it('文件消息下载后作为 documents 传给 backend', async () => {
    const { EventEmitter } = await import('node:events');
    const { TelegramPlatform } = await import('../src/platforms/telegram');

    class FakeBackend extends EventEmitter {
      chats: any[] = [];
      async chat(sid: string, text: string, images?: any[], documents?: any[]) {
        this.chats.push({ sid, text, images, documents });
      }
      isStreamEnabled() { return false; }
    }

    const backend = new FakeBackend();
    const platform = new TelegramPlatform(backend as any, {
      token: 'bot-token',
      groupMentionRequired: false,
    });

    const pdfBuf = Buffer.from('%PDF-1.4');
    (platform as any).client = {
      sendMessageReturningId: vi.fn(async () => 999),
      downloadFile: vi.fn(async () => ({
        fileId: 'doc1',
        filePath: 'documents/report.pdf',
        buffer: pdfBuf,
      })),
    };

    await (platform as any).handleMessage({
      chat: { id: 2003, type: 'private' },
      me: { username: 'test_bot' },
      message: {
        message_id: 12,
        document: { file_id: 'doc1', file_name: 'report.pdf', mime_type: 'application/pdf' },
      },
    });

    expect(backend.chats).toHaveLength(1);
    expect(backend.chats[0].documents).toHaveLength(1);
    expect(backend.chats[0].documents[0].fileName).toBe('report.pdf');
    expect(backend.chats[0].documents[0].mimeType).toBe('application/pdf');
  });
});
