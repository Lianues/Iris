/**
 * Web 平台消息格式化工具
 *
 * 将内部 Content / Part 结构转换为前端可直接消费的消息格式。
 * 已从 src/platforms/web/ 迁移，所有类型从 @irises/extension-sdk 导入。
 */

import type { Content, Part, TextPart } from '@irises/extension-sdk';
import { isTextPart, isThoughtTextPart, isInlineDataPart, isFunctionCallPart, isFunctionResponsePart } from '@irises/extension-sdk';

// ── 内联自 src/ocr（避免耦合内部模块）──
const OCR_TEXT_MARKER_RE = /^\[\[IRIS_OCR_IMAGE_(\d+)\]\]\n/;
function isOCRTextPart(part: Part): part is TextPart & { text: string } {
  return isTextPart(part) && typeof part.text === 'string' && OCR_TEXT_MARKER_RE.test(part.text);
}

// ── 内联自 src/llm/vision（避免耦合内部模块）──
const DOCUMENT_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
]);
function isDocumentMimeType(mimeType: string): boolean {
  return DOCUMENT_MIME_TYPES.has(mimeType);
}

export interface WebMessagePart {
  type: 'text' | 'thought' | 'image' | 'document' | 'function_call' | 'function_response'
  text?: string
  durationMs?: number
  mimeType?: string
  data?: string
  fileName?: string
  name?: string
  args?: unknown
  response?: unknown
  callId?: string
}

export interface WebMessageMeta {
  tokenIn?: number
  tokenOut?: number
  durationMs?: number
  streamOutputDurationMs?: number
  modelName?: string
}

export interface WebMessage {
  role: 'user' | 'model'
  parts: WebMessagePart[]
  meta?: WebMessageMeta
}

function extractDocumentMarkerFileName(text?: string): string | null {
  const normalized = text?.trim() ?? ''
  if (!normalized.startsWith('[Document: ')) return null

  const match = normalized.match(/^\[Document: ([^\]\r\n]+)\]/)
  return match?.[1]?.trim() || null
}

function isImageDimensionNote(text?: string): boolean {
  return /^\[Image: original \d+x\d+/.test(text?.trim() ?? '')
}

export function formatContent(content: Content): WebMessage {
  const formatted: WebMessage = { role: content.role, parts: [] }
  const pendingDocumentIndices: number[] = []

  // 提取性能元数据
  const meta: WebMessageMeta = {}
  if (content.usageMetadata?.promptTokenCount != null) meta.tokenIn = content.usageMetadata.promptTokenCount
  if (content.usageMetadata?.candidatesTokenCount != null) meta.tokenOut = content.usageMetadata.candidatesTokenCount
  if (content.durationMs != null) meta.durationMs = content.durationMs
  if (content.streamOutputDurationMs != null) meta.streamOutputDurationMs = content.streamOutputDurationMs
  if (content.modelName) meta.modelName = content.modelName
  if (Object.keys(meta).length > 0) formatted.meta = meta

  for (const part of content.parts) {
    if (isOCRTextPart(part)) {
      continue
    }

    if (isThoughtTextPart(part)) {
      if (part.text?.trim()) {
        formatted.parts.push({ type: 'thought', text: part.text, durationMs: (part as any).thoughtDurationMs })
      }
      continue
    }

    if (isTextPart(part)) {
      if (isImageDimensionNote(part.text)) continue

      const fileName = extractDocumentMarkerFileName(part.text)
      if (fileName && pendingDocumentIndices.length > 0) {
        const targetIndex = pendingDocumentIndices.shift()
        if (typeof targetIndex === 'number' && formatted.parts[targetIndex]?.type === 'document') {
          formatted.parts[targetIndex].fileName = fileName
        }
      } else if (fileName) {
        const ext = fileName.split('.').pop()?.toLowerCase() ?? ''
        const mimeMap: Record<string, string> = {
          json: 'application/json', txt: 'text/plain', csv: 'text/csv',
          xml: 'application/xml', md: 'text/markdown', yaml: 'application/x-yaml',
          yml: 'application/x-yaml', py: 'text/x-python', js: 'application/javascript',
          ts: 'application/typescript', html: 'text/html', css: 'text/css',
        }
        formatted.parts.push({
          type: 'document',
          fileName,
          mimeType: mimeMap[ext] || 'text/plain',
          text: part.text?.replace(/^\[Document: [^\]\r\n]+\]\s*/, '') ?? '',
        })
        continue
      }
      formatted.parts.push({ type: 'text', text: part.text })
      continue
    }

    if (isInlineDataPart(part)) {
      if (isDocumentMimeType(part.inlineData.mimeType)) {
        formatted.parts.push({
          type: 'document',
          mimeType: part.inlineData.mimeType,
          data: part.inlineData.data,
        })
        pendingDocumentIndices.push(formatted.parts.length - 1)
      } else {
        formatted.parts.push({
          type: 'image',
          mimeType: part.inlineData.mimeType,
          data: part.inlineData.data,
        })
      }
      continue
    }

    if (isFunctionCallPart(part)) {
      formatted.parts.push({
        type: 'function_call',
        name: part.functionCall.name,
        args: part.functionCall.args,
        callId: (part.functionCall as any).callId,
      })
      continue
    }

    if (isFunctionResponsePart(part)) {
      formatted.parts.push({
        type: 'function_response',
        name: part.functionResponse.name,
        response: part.functionResponse.response,
        callId: (part.functionResponse as any).callId,
      })
    }
  }

  return formatted
}

export function formatMessages(contents: Content[]): WebMessage[] {
  return contents.map(formatContent)
}
