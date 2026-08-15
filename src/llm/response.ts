/**
 * 响应后处理模块
 *
 * 统一处理流式和非流式响应。
 * 内部使用 FormatAdapter 做格式解码，内置 SSE 解析处理流式数据。
 */

import { LLMResponse, LLMStreamChunk } from '../types';
import { FormatAdapter } from './formats/types';

// ============ 非流式 ============

/** 处理非流式响应 */
export async function processResponse(
  res: Response,
  format: FormatAdapter,
): Promise<LLMResponse> {
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LLM API 错误 (${res.status}): ${text}`);
  }
  const data = await res.json();
  return format.decodeResponse(data);
}

// ============ 流式 ============

/** 处理流式响应（SSE 解析 + 逐块解码） */
export async function* processStreamResponse(
  res: Response,
  format: FormatAdapter,
): AsyncGenerator<LLMStreamChunk> {
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LLM API 流式错误 (${res.status}): ${text}`);
  }
 const state = format.createStreamState();
  for await (const sse of parseSSE(res)) {
    const payload = JSON.parse(sse.data);
    // 注入事件名，以便 FormatAdapter 区分
    if (sse.event) (payload as any).event = sse.event;
    yield format.decodeStreamChunk(payload, state);
  }
  const finalChunk = format.finalizeStream?.(state);
  if (finalChunk) yield finalChunk;
}

// ============ SSE 解析 ============

export interface SSEChunk {
  event?: string;
  data: string;
}

/**
 * 从 fetch Response 中解析 SSE 流，逐条 yield 包含 data 字段的原始字符串的对象。
 * 遇到 `data: [DONE]` 时自动结束。
 */
async function* parseSSE(response: Response): AsyncGenerator<SSEChunk> {
  const body = response.body;
  if (!body) throw new Error('Response body is null');

  const reader = (body as any).getReader() as ReadableStreamDefaultReader<Uint8Array>;
  const decoder = new TextDecoder();
  let buffer = '';
  let currentEvent: string | undefined;
  let chunksRead = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunksRead++;

      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('event: ')) {
          currentEvent = trimmed.slice(7).trim();
        } else if (trimmed.startsWith('data: ')) {
          const data = trimmed.slice(6);
          if (data === '[DONE]') return;
          if (data) {
            yield { event: currentEvent, data };
            currentEvent = undefined; // data 是事件序列的结尾
          }
        } else if (trimmed === '') {
          currentEvent = undefined; // 空行重置事件
        }
      }
    }
    // 处理剩余 buffer
    const trimmed = buffer.trim();
    if (trimmed.startsWith('data: ')) {
      const data = trimmed.slice(6);
      if (data && data !== '[DONE]') {
        yield { event: currentEvent, data };
      }
    }
  } catch (err) {
    // 为连接中断错误补充上下文（已接收块数帮助判断是建连失败还是中途断开）
    const msg = err instanceof Error ? err.message : String(err);
    const wrapped = new Error(`SSE 流读取中断（已接收 ${chunksRead} 个数据块）: ${msg}`);
    (wrapped as any).cause = err;
    throw wrapped;
  } finally {
    reader.releaseLock();
  }
}
