/**
 * Web 平台消息格式化工具
 *
 * 将内部 Content / Part 结构转换为前端可直接消费的消息格式。
 */

import { isOCRTextPart } from '../../ocr';
import { Content, isTextPart, isThoughtTextPart, isInlineDataPart, isFunctionCallPart, isFunctionResponsePart } from '../../types';
import { isDocumentMimeType } from '../../llm/vision';

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

  // 匹配 [Document: file.json] 后跟换行/空格/行尾（兼容提取失败/处理异常等后缀）
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
        formatted.parts.push({ type: 'thought', text: part.text, durationMs: part.thoughtDurationMs })
      }
      continue
    }

    if (isTextPart(part)) {
      // 过滤图片尺寸标记（仅供 LLM 坐标映射，不需要展示给用户）
      if (isImageDimensionNote(part.text)) continue

      const fileName = extractDocumentMarkerFileName(part.text)
      if (fileName && pendingDocumentIndices.length > 0) {
        // 有对应的 inlineData document part，回填文件名
        const targetIndex = pendingDocumentIndices.shift()
        if (typeof targetIndex === 'number' && formatted.parts[targetIndex]?.type === 'document') {
          formatted.parts[targetIndex].fileName = fileName
        }
      } else if (fileName) {
        // 后端将文本格式文档（JSON/TXT/CSV 等）存储为纯文本 part，
        // 刷新后需要还原为 document 类型以渲染 DocumentBubble
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
        callId: part.functionCall.callId,
      })
      continue
    }

    if (isFunctionResponsePart(part)) {
      formatted.parts.push({
        type: 'function_response',
        name: part.functionResponse.name,
        response: part.functionResponse.response,
        callId: part.functionResponse.callId,
      })
    }
  }

  return formatted
}

export function formatMessages(contents: Content[]): WebMessage[] {
  return contents.map(formatContent)
}
