/**
 * 历史消息的 LLM 预处理
 *
 * 将存储中的原始历史消息转换为 LLM 可消费的格式，包括：
 * - 从最后一条总结消息开始截取
 * - 图片/文档根据模型能力剥离或保留
 * - functionCall/functionResponse 深拷贝
 *
 * OCR 文本标记等扩展特有的清理逻辑由扩展自身通过 onBeforeLLMCall hook 处理。
 */

import type { LLMConfig } from '../../config/types';
import { supportsVision as llmSupportsVision, isDocumentMimeType, supportsNativePDF, supportsNativeOffice } from '../../llm/vision';
import type { Content, Part } from '../../types';
import { isFunctionCallPart, isFunctionResponsePart, isInlineDataPart, isTextPart } from '../../types';
import { IMAGE_UNAVAILABLE_NOTICE, DOCUMENT_UNAVAILABLE_NOTICE } from './types';

/**
 * 将存储的完整历史转换为 LLM 请求所用的历史。
 * - 从最后一条 isSummary 消息开始加载
 * - 对每条消息的 parts 调用 preparePartsForLLM 进行清理
 */
export function prepareHistoryForLLM(
  history: Content[],
  currentLLMConfig?: LLMConfig,
): Content[] {
  // 从最后一条总结消息开始加载上下文，跳过更早的历史
  let startIndex = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].isSummary) {
      startIndex = i;
      break;
    }
  }
  const relevantHistory = startIndex > 0 ? history.slice(startIndex) : history;

  const prepared = relevantHistory.map((content) => ({
    role: content.role,
    parts: preparePartsForLLM(content.parts, currentLLMConfig),
    usageMetadata: content.usageMetadata,
    durationMs: content.durationMs,
    streamOutputDurationMs: content.streamOutputDurationMs,
  }));

  return prepared;
}

/**
 * 对单条消息的 Parts 进行 LLM 投喂前的通用清理：
 * - 非 vision 模型剥离图片 inlineData，补充不可用提示
 * - 文档按端点能力保留或剥离
 * - functionCall/functionResponse 深拷贝
 * - text 浅拷贝
 *
 * 扩展特有的 Part 处理（如 OCR 标记清洗）由扩展通过 onBeforeLLMCall hook 自行处理。
 */
export function preparePartsForLLM(parts: Part[], currentLLMConfig?: LLMConfig): Part[] {
  const visionEnabled = llmSupportsVision(currentLLMConfig);
  const prepared: Part[] = [];
  let strippedImageCount = 0;
  let strippedDocumentCount = 0;

  for (const part of parts) {
    if (isInlineDataPart(part)) {
      const mime = part.inlineData.mimeType;
      if (isDocumentMimeType(mime)) {
        // 文档 InlineDataPart：按端点能力决定保留或剥离
        if (mime === 'application/pdf' && supportsNativePDF(currentLLMConfig)) {
          prepared.push({ inlineData: { mimeType: part.inlineData.mimeType, data: part.inlineData.data } });
        } else if (mime !== 'application/pdf' && supportsNativeOffice(currentLLMConfig)) {
          prepared.push({ inlineData: { mimeType: part.inlineData.mimeType, data: part.inlineData.data } });
        } else {
          strippedDocumentCount++;
        }
      } else {
        // 图片 InlineDataPart
        if (visionEnabled) {
          prepared.push({ inlineData: { mimeType: part.inlineData.mimeType, data: part.inlineData.data } });
        } else {
          strippedImageCount++;
        }
      }
      continue;
    }

    if (isFunctionCallPart(part)) {
      prepared.push({
        functionCall: {
          name: part.functionCall.name,
          args: JSON.parse(JSON.stringify(part.functionCall.args ?? {})),
          callId: part.functionCall.callId,
        },
      });
      continue;
    }

    if (isFunctionResponsePart(part)) {
      prepared.push({
        functionResponse: {
          // 仅保留发给 LLM 必需的 response/callId/parts；durationMs/diffPreview 等本地元数据在此剥离。
          name: part.functionResponse.name,
          response: JSON.parse(JSON.stringify(part.functionResponse.response ?? {})),
          callId: part.functionResponse.callId,
          // 保留工具结果中的多模态内联数据（截图、音频等）
          ...(part.functionResponse.parts
            ? { parts: part.functionResponse.parts.map(p => ({ inlineData: { ...p.inlineData } })) }
            : {}),
        },
      });
      continue;
    }

    if (isTextPart(part)) {
      prepared.push({
        ...part,
        thoughtSignatures: part.thoughtSignatures ? { ...part.thoughtSignatures } : undefined,
      });
      continue;
    }

    const _exhaustive: never = part;
    void _exhaustive;
  }

  if (!visionEnabled && strippedImageCount > 0) {
    prepared.unshift({ text: IMAGE_UNAVAILABLE_NOTICE(strippedImageCount) });
  }
  if (strippedDocumentCount > 0) {
    prepared.unshift({ text: DOCUMENT_UNAVAILABLE_NOTICE(strippedDocumentCount) });
  }

  if (prepared.length === 0) {
    prepared.push({ text: '' });
  }

  return prepared;
}
