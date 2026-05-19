/**
 * Gemini 格式适配器
 *
 * 内部格式就是 Gemini 格式，请求方向直通。
 * 响应方向从 candidates[0] 提取内容。
 */

import { LLMRequest, LLMResponse, LLMStreamChunk } from '../../types';
import { FormatAdapter, StreamDecodeState } from './types';
import { sanitizeSchemaForGemini } from './schema-sanitizer';

export class GeminiFormat implements FormatAdapter {

  /** 请求直通，但过滤内部字段 */
  encodeRequest(request: LLMRequest, _stream?: boolean): unknown {
    // 深拷贝并过滤内部字段
    const filtered = filterInternalFields(request);

    // 降级工具 schema（Gemini 对 JSON Schema 支持最严格）
    sanitizeToolSchemas(filtered, sanitizeSchemaForGemini);

    // 针对 Gemini 渠道，将 thoughtSignatures.gemini 映射回 thoughtSignature 字段发送
    mapSignaturesToProvider(filtered);

    // 将内部统一的 callId 映射为 Gemini API 的 id 字段
    // Gemini 3 模型要求 functionCall 和 functionResponse 使用 id 字段进行配对
    mapCallIdsToGemini(filtered);

    // 过滤 Gemini 3 流式响应中产生的空 text part（text === "" 且无签名/thought）。
    // 这类空 part 由模型在 functionCall 后附带返回，回传时会导致 Gemini API 报 INTERNAL 错误。
    stripEmptyTextParts(filtered);

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

        // Gemini 3 模型返回 functionCall.id，提取为内部统一的 callId
        if (rawPart.functionCall?.id) {
          rawPart.functionCall.callId = rawPart.functionCall.id;
          delete rawPart.functionCall.id;
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
        const hasFunctionCall = 'functionCall' in rawPart;
        const hasText = 'text' in rawPart;
        const hasSignature = 'thoughtSignature' in rawPart;

        // 签名可能附着在 functionCall part 上，需先提取再决定归类
        if (hasSignature) {
          if (!rawPart.thoughtSignatures) rawPart.thoughtSignatures = {};
          rawPart.thoughtSignatures.gemini = rawPart.thoughtSignature;

          if (!chunk.thoughtSignatures) chunk.thoughtSignatures = {};
          chunk.thoughtSignatures.gemini = rawPart.thoughtSignature;

          delete rawPart.thoughtSignature;
        }

        // Gemini 3 流式响应中 functionCall.id → callId
        if (hasFunctionCall && rawPart.functionCall?.id) {
          if (!rawPart.functionCall.callId) {
            rawPart.functionCall.callId = rawPart.functionCall.id;
          }
          delete rawPart.functionCall.id;
        }

        if (hasText || (hasSignature && !hasFunctionCall)) {
          // Gemini 3 流式响应中 functionCall 后面经常跟一个 {"text":""} 空 part，
          // 没有 thought 标记也没有签名，纯粹是占位符。
          // 跳过这种无意义的空 part，避免它进入 partsDelta 并最终污染历史。
          // 回传时 Gemini API 会因为含有空 text part 报 INTERNAL 错误。
          if (hasText && !rawPart.text && !rawPart.thought && !hasSignature) {
            continue;
          }

          if (!chunk.partsDelta) chunk.partsDelta = [];

          if (hasText) {
            if (rawPart.text && !rawPart.thought) {
              chunk.textDelta = (chunk.textDelta ?? '') + rawPart.text;
            }
          }

          // 如果同时有 functionCall，只 push 文本部分，functionCall 在下面单独处理
          if (!hasFunctionCall) {
            chunk.partsDelta.push(rawPart);
          } else {
            // 拆出文本 part 单独 push
            const textOnly: Record<string, unknown> = { text: rawPart.text };
            if (rawPart.thought) textOnly.thought = rawPart.thought;
            if (rawPart.thoughtSignatures) textOnly.thoughtSignatures = rawPart.thoughtSignatures;
            chunk.partsDelta.push(textOnly);
          }
        }

        if (hasFunctionCall) {
          if (!chunk.partsDelta) chunk.partsDelta = [];
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
    if (key === 'modelName') {
      continue; // 过滤我们新加的模型名称字段
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

/**
 * 将内部统一的 callId 映射为 Gemini API 原生的 id 字段。
 *
 * Gemini 3 模型要求：
 *   - functionCall 中的 id 用于标识工具调用
 *   - functionResponse 中的 id 用于与 functionCall 配对
 *   - callId 是内部统一字段，Gemini API 不认识，必须删除
 *
 * 同时清理 functionResponse.durationMs 等内部字段。
 */
function mapCallIdsToGemini(obj: unknown): void {
  if (obj === null || obj === undefined || typeof obj !== 'object') {
    return;
  }

  if (Array.isArray(obj)) {
    obj.forEach(mapCallIdsToGemini);
    return;
  }

  const record = obj as Record<string, any>;

  // functionCall.callId → functionCall.id
  if (record.functionCall && typeof record.functionCall === 'object') {
    if (record.functionCall.callId) {
      record.functionCall.id = record.functionCall.callId;
    }
    delete record.functionCall.callId;
  }

  // functionResponse.callId → functionResponse.id
  // 同时清理 durationMs / diffPreview（仅本地存储与前端展示使用，不发送给 LLM）
  if (record.functionResponse && typeof record.functionResponse === 'object') {
    if (record.functionResponse.callId) {
      record.functionResponse.id = record.functionResponse.callId;
    }
    delete record.functionResponse.callId;
    delete record.functionResponse.durationMs;
    delete record.functionResponse.diffPreview;
  }

  for (const value of Object.values(record)) {
    mapCallIdsToGemini(value);
  }
}

/**
 * 遍历 Gemini 请求体中的 tools[].functionDeclarations[].parameters，
 * 用指定的 sanitizer 函数对每个 parameters 做降级处理。
 */
function sanitizeToolSchemas(
  request: unknown,
  sanitizer: (schema: unknown) => unknown,
): void {
  const req = request as Record<string, any>;
  if (!Array.isArray(req?.tools)) return;
  for (const toolGroup of req.tools) {
    if (!Array.isArray(toolGroup?.functionDeclarations)) continue;
    for (const decl of toolGroup.functionDeclarations) {
      if (decl.parameters) {
        decl.parameters = sanitizer(decl.parameters);
      }
    }
  }
}


/**
 * 过滤 Gemini 3 流式响应中产生的无意义空 text part。
 *
 * Gemini 3 模型在流式响应中，functionCall part 后面可能跟一个 {"text":""} 的空 part。
 * 这个空 part 如果在下一轮请求中原样回传给 Gemini API，会导致 INTERNAL 错误。
 *
 * 过滤条件：text === "" 且没有 thought 标记、没有 thoughtSignature。
 * 带 thoughtSignature 的空 text part 需要保留（签名载体）。
 */
function stripEmptyTextParts(obj: unknown): void {
  const req = obj as Record<string, any>;
  if (!Array.isArray(req?.contents)) return;

  for (const content of req.contents) {
    if (!Array.isArray(content?.parts) || content.parts.length <= 1) continue;

    content.parts = content.parts.filter((part: any) => {
      // 保留非 text part（functionCall、functionResponse、inlineData 等）
      if (!('text' in part)) return true;
      // 保留有实际文本内容的 part
      if (part.text !== '' && part.text !== undefined) return true;
      // 保留带 thought 标记的空 part（thinking 占位）
      if (part.thought) return true;
      // 保留带签名的空 part（签名载体）
      if (part.thoughtSignature) return true;
      // 其余空 text part 过滤掉
      return false;
    });
  }
}
