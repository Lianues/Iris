/**
 * 对话历史总结模块
 *
 * 将对话历史压缩为一段上下文摘要，用于缩减发送给 LLM 的上下文长度。
 * 总结结果以特殊的 user 消息存入历史，后续 LLM 调用仅从该消息开始加载上下文。
 *
 * 总结时将完整的 Content[] 作为对话历史直接发给总结 AI，
 * 由 AI 自行理解工具调用和返回结果。
 */

import { Content, Part, LLMRequest, extractText } from '../types';
import { LLMRouter } from '../llm/router';
import type { SummaryConfig } from '../config/types';

/**
 * 剥离 Part 中的思考签名和内部计时字段。
 *
 * thoughtSignatures 是各 provider 的加密签名，仅对产生它的同一 provider 有意义，
 * 发给总结模型无用且浪费 token。
 */
function stripThoughtMeta(part: Part): Part {
  if (!('text' in part)) return part;
  const { thoughtSignatures, thoughtDurationMs, ...clean } = part;
  return clean;
}

/**
 * 调用 LLM 对历史进行总结。
 *
 * 将完整的 Content[] 作为对话历史发给总结 AI，
 * 末尾追加一条 user 消息要求生成摘要。
 * 不携带工具声明，直接非流式调用。
 */
export async function summarizeHistory(
  router: LLMRouter,
  history: Content[],
  modelName?: string,
  config?: SummaryConfig,
  signal?: AbortSignal,
): Promise<string> {
  const cleanHistory: Content[] = history.map(({ role, parts }) => ({
    role,
    parts: parts.map(stripThoughtMeta),
  }));

  cleanHistory.push({
    role: 'user',
    parts: [{ text: config?.userPrompt ?? 'Please summarize the conversa above into a concise context summary.' }],
  });

  const request: LLMRequest = {
    contents: cleanHistory,
  };

  if (config?.systemPrompt) {
    request.systemInstruction = { parts: [{ text: config.systemPrompt }] };
  }

  const response = await router.chat(request, modelName, signal);
  return extractText(response.content.parts).trim();
}
