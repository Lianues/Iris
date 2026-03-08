/**
 * LLM 请求 / 响应类型定义
 *
 * 内部统一使用 Gemini 格式。各 LLM Provider 负责与自身 API 格式互转。
 */

import { Content, Part, UsageMetadata, FunctionCallPart } from './message';
import { FunctionDeclaration } from './tool';

/** LLM 请求体（Gemini generateContent 格式） */
export interface LLMRequest {
  contents: Content[];
  tools?: {
    functionDeclarations: FunctionDeclaration[];
  }[];
  systemInstruction?: {
    parts: Part[];
  };
  generationConfig?: {
    temperature?: number;
    topP?: number;
    topK?: number;
    maxOutputTokens?: number;
    stopSequences?: string[];
  };
}

/** LLM 响应（统一格式） */
export interface LLMResponse {
  /** 模型返回的消息内容 */
  content: Content;
  /** 结束原因 */
  finishReason?: string;
  /** Token 用量统计 */
  usageMetadata?: UsageMetadata;
}

/** 流式响应的单个数据块 */
export interface LLMStreamChunk {
  /** 本块新增的文本 */
  textDelta?: string;
  /** 完整的函数调用（通常在最后一块或专用块中出现） */
  functionCalls?: FunctionCallPart[];
  /** 结束原因（最后一块） */
  finishReason?: string;
  /** Token 用量（最后一块） */
  usageMetadata?: UsageMetadata;
  /** Gemini 思考签名（需原样保留回传） */
  thoughtSignature?: string;
}
