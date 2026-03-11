/**
 * Gemini 格式适配器
 *
 * 内部格式就是 Gemini 格式，请求方向直通。
 * 响应方向从 candidates[0] 提取内容。
 */

import { LLMRequest, LLMResponse, LLMStreamChunk } from '../../types';
import { FormatAdapter, StreamDecodeState } from './types';

export class GeminiFormat implements FormatAdapter {

  /** 请求直通，但过滤内部字段 */
  encodeRequest(request: LLMRequest, _stream?: boolean): unknown {
    // 深拷贝并过滤内部字段
    const filtered = filterInternalFields(request);

    // 针对 Gemini 渠道，将 thoughtSignatures.gemini 映射回 thoughtSignature 字段发送
    mapSignaturesToProvider(filtered);

    return filtered;
  }

  /** 从 Gemini API 响应中提取 content、finishReason、usageMetadata */
  decodeResponse(raw: unknown): LLMResponse {
    const data = raw as any;
    const candidate = data.candidates?.[0];
    if (!candidate?.content) {
      throw new Error(`Gemini API 未返回有效内容: ${JSON.stringify(data)}`);
    }

    if (candidate.content.parts) {
      for (const part of candidate.content.parts) {
        const rawPart = part as any;
        // 1. 转换并清理签名字段
        if (rawPart.thoughtSignature) {
          if (!part.thoughtSignatures) part.thoughtSignatures = {};
          part.thoughtSignatures.gemini = rawPart.thoughtSignature;
          delete rawPart.thoughtSignature;
        }
      }
    }

    return {
      content: candidate.content,
      finishReason: candidate.finishReason,
      usageMetadata: data.usageMetadata,
    };
  }

  /** 流式块：从每个 SSE chunk 的 candidates 提取有序 parts / 可见文本 / functionCalls */
  decodeStreamChunk(raw: unknown, _state: StreamDecodeState): LLMStreamChunk {
    const data = raw as any;
    const candidate = data.candidates?.[0];
    const chunk: LLMStreamChunk = {};

    if (candidate?.content?.parts) {
      for (const part of candidate.content.parts) {
        const rawPart = part as any;
        const hasText = 'text' in rawPart;
        const hasSignature = 'thoughtSignature' in rawPart;

        if (hasText || hasSignature) {
          if (!chunk.partsDelta) chunk.partsDelta = [];
          
          // 处理签名
          if (hasSignature) {
            if (!rawPart.thoughtSignatures) rawPart.thoughtSignatures = {};
            rawPart.thoughtSignatures.gemini = rawPart.thoughtSignature;
            
            if (!chunk.thoughtSignatures) chunk.thoughtSignatures = {};
            chunk.thoughtSignatures.gemini = rawPart.thoughtSignature;
            
            delete rawPart.thoughtSignature;
          }

          // 处理文本及清理
          if (hasText) {
            if (rawPart.text && !rawPart.thought) {
              chunk.textDelta = (chunk.textDelta ?? '') + rawPart.text;
            }
          }

          chunk.partsDelta.push(rawPart);
        }
        if ('functionCall' in part) {
          if (!chunk.functionCalls) chunk.functionCalls = [];
          chunk.functionCalls.push(part);
          chunk.partsDelta.push(part);
        }

      }
    }

    if (candidate?.finishReason) chunk.finishReason = candidate.finishReason;
    if (data.usageMetadata) chunk.usageMetadata = data.usageMetadata;

    return chunk;
  }

  /** Gemini 无跨 chunk 状态 */
  createStreamState(): StreamDecodeState {
    return {};
  }
}

/** 过滤内部字段，防止发送到外部 API */
function filterInternalFields(obj: unknown): unknown {
  if (obj === null || obj === undefined || typeof obj !== 'object') {
    return obj;
  }

  // 处理数组
  if (Array.isArray(obj)) {
    return obj.map(filterInternalFields);
  }

  // 处理对象
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    // 跳过内部字段
    // 注意：不要在这里过滤 thoughtSignatures，因为它需要由 mapSignaturesToProvider 处理
    if (key === 'durationMs' || key === 'streamOutputDurationMs' || key === 'thoughtDurationMs' || key === 'usageMetadata') {
      continue;
    }
    // 递归处理嵌套对象
    result[key] = filterInternalFields(value);
  }
  return result;
}

/** 将内部统一的 thoughtSignatures 映射回 Provider 预期的字段（如 Gemini 的 thoughtSignature） */
function mapSignaturesToProvider(obj: unknown): void {
  if (obj === null || obj === undefined || typeof obj !== 'object') {
    return;
  }

  if (Array.isArray(obj)) {
    obj.forEach(mapSignaturesToProvider);
    return;
  }

  const record = obj as Record<string, any>;
  if (record.thoughtSignatures?.gemini) {
    record.thoughtSignature = record.thoughtSignatures.gemini;
  }
  if (record.thoughtSignatures) {
    delete record.thoughtSignatures;
  }

  for (const value of Object.values(record)) {
    mapSignaturesToProvider(value);
  }
}
