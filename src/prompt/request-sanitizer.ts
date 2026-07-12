/**
 * LLM 请求边界净化。
 *
 * 内部 Content / Part 会携带持久化与 UI 专用元数据。这里创建不可变的请求副本，
 * 只剥离明确不应发送给模型的字段；原始历史仍可用于持久化和前端回显。
 */

import type { Content, LLMRequest, Part } from '../types';
import { isFunctionResponsePart } from '../types';

function sanitizePartForLLM(part: Part): Part {
  if (!isFunctionResponsePart(part)) return part;

  const { name, response, callId, parts } = part.functionResponse;
  return {
    functionResponse: {
      name,
      response,
      ...(callId !== undefined ? { callId } : {}),
      ...(parts !== undefined ? { parts } : {}),
    },
  };
}

/**
 * 将内部 Content 转成请求 Content：剥离 Content 顶层持久化字段，并清理 Part 元数据。
 * 不修改传入的 Content、parts 或 functionResponse。
 */
export function sanitizeContentForLLMRequest(content: Content): Content {
  return {
    role: content.role,
    parts: content.parts.map(sanitizePartForLLM),
  };
}

/**
 * 净化完整 LLMRequest。保留插件添加的其他请求级字段，只规范 contents 与 system parts。
 */
export function sanitizeLLMRequest(request: LLMRequest): LLMRequest {
  return {
    ...request,
    contents: request.contents.map(sanitizeContentForLLMRequest),
    ...(request.systemInstruction
      ? {
          systemInstruction: {
            ...request.systemInstruction,
            parts: request.systemInstruction.parts.map(sanitizePartForLLM),
          },
        }
      : {}),
  };
}
