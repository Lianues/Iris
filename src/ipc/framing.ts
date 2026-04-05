/**
 * IPC 帧编解码器
 *
 * 使用长度前缀帧（Length-Prefixed Framing）在 TCP 流上传输 JSON 消息：
 *   [4字节 BigEndian 长度][JSON payload]
 *
 * 解决 TCP 粘包/拆包问题，保证每条消息的完整性。
 */

import { Transform, type TransformCallback } from 'node:stream';

/** 帧头长度（4字节） */
const HEADER_SIZE = 4;

/** 最大消息大小（16MB，防止恶意大包） */
const MAX_MESSAGE_SIZE = 16 * 1024 * 1024;

/**
 * 将 JSON 对象编码为帧：[4字节长度][payload]
 */
export function encodeFrame(data: unknown): Buffer {
  const payload = Buffer.from(JSON.stringify(data), 'utf-8');
  const header = Buffer.alloc(HEADER_SIZE);
  header.writeUInt32BE(payload.length, 0);
  return Buffer.concat([header, payload]);
}

/**
 * 帧解码器（Transform Stream）
 *
 * 从 TCP 流中解析完整的 JSON 消息。
 * 处理粘包、拆包、半包等情况。
 *
 * 用法：
 *   const decoder = new FrameDecoder();
 *   socket.pipe(decoder);
 *   decoder.on('data', (msg) => { ... });
 */
export class FrameDecoder extends Transform {
  private buffer: Buffer = Buffer.alloc(0);

  constructor() {
    super({ readableObjectMode: true, writableObjectMode: false });
  }

  _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);

    while (this.buffer.length >= HEADER_SIZE) {
      const payloadLength = this.buffer.readUInt32BE(0);

      // 安全检查
      if (payloadLength > MAX_MESSAGE_SIZE) {
        this.buffer = Buffer.alloc(0);
        callback(new Error(`IPC 帧超过最大大小: ${payloadLength} > ${MAX_MESSAGE_SIZE}`));
        return;
      }

      const totalLength = HEADER_SIZE + payloadLength;
      if (this.buffer.length < totalLength) {
        // 数据不足，等待更多数据
        break;
      }

      // 提取完整帧
      const payload = this.buffer.subarray(HEADER_SIZE, totalLength);
      this.buffer = this.buffer.subarray(totalLength);

      try {
        const message = JSON.parse(payload.toString('utf-8'));
        this.push(message);
      } catch (err) {
        callback(new Error(`IPC 帧 JSON 解析失败: ${(err as Error).message}`));
        return;
      }
    }

    callback();
  }

  _flush(callback: TransformCallback): void {
    if (this.buffer.length > 0) {
      callback(new Error(`IPC 流结束时有未处理的数据 (${this.buffer.length} 字节)`));
    } else {
      callback();
    }
  }
}
