/**
 * OCR 服务
 */

import type { OCRConfig } from '../config/ocr';
import type { LLMProviderLike } from '../llm/providers/base';
import { createOpenAICompatibleProvider } from '../llm/providers/openai-compatible';
import type { LLMRequest, Part, TextPart } from '../types';
import { extractText, isTextPart } from '../types';

const OCR_TEXT_MARKER_RE = /^\[\[IRIS_OCR_IMAGE_(\d+)\]\]\n/;
const OCR_PROMPT = '请详细描述图片内容，优先完整、准确地提取其中所有可见文字；若存在段落、表格、列表或表单，请尽量保持原有结构。若图片中没有文字，再简要描述主要视觉内容。';
const OCR_EMPTY_TEXT = '（OCR 未提取到可识别内容）';

export interface OCRProvider {
  extractText(mimeType: string, base64Data: string): Promise<string>;
}

export class OCRService implements OCRProvider {
  private provider: LLMProviderLike;

  constructor(private config: OCRConfig) {
    this.provider = createOpenAICompatibleProvider({
      provider: this.config.provider,
      apiKey: this.config.apiKey,
      model: this.config.model,
      baseUrl: this.config.baseUrl,
    });
  }

  async extractText(mimeType: string, base64Data: string): Promise<string> {
    const request: LLMRequest = {
      contents: [{
        role: 'user',
        parts: [
          { text: OCR_PROMPT },
          { inlineData: { mimeType, data: base64Data } },
        ],
      }],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 4096,
      },
    };

    const response = await this.provider.chat(request);
    return extractText(response.content.parts).trim();
  }
}

export function createOCRTextPart(index: number, text: string): TextPart {
  const normalized = text.trim() || OCR_EMPTY_TEXT;
  return {
    text: `[[IRIS_OCR_IMAGE_${index}]]\n[图片${index}内容]\n${normalized}`,
  };
}

export function isOCRTextValue(text: string | undefined): boolean {
  return typeof text === 'string' && OCR_TEXT_MARKER_RE.test(text);
}

export function isOCRTextPart(part: Part): part is TextPart & { text: string } {
  return isTextPart(part) && isOCRTextValue(part.text);
}

export function stripOCRTextMarker(text: string): string {
  return text.replace(OCR_TEXT_MARKER_RE, '');
}
