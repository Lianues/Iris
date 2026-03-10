/**
 * 消息类型定义 —— 采用 Gemini 格式作为内部统一数据格式
 *
 * 所有模块之间传递的消息数据均使用此格式。
 * 对于非 Gemini 的 LLM 提供商（如 OpenAI），在 LLM 调用层进行格式转换。
 */

/** 文本部分 */
export interface TextPart {
  text: string;
  /** Gemini thinking 文本块 */
  thought?: boolean;
  /** Gemini thinking 签名 */
  thoughtSignature?: string;
}

/** 内联数据部分（图片等二进制数据，base64 编码） */
export interface InlineDataPart {
  inlineData: {
    mimeType: string;
    data: string;
  };
}

/** 函数调用部分（由模型发出） */
export interface FunctionCallPart {
  functionCall: {
    name: string;
    args: Record<string, unknown>;
  };
}

/** 函数响应部分（工具执行结果，回传给模型） */
export interface FunctionResponsePart {
  functionResponse: {
    name: string;
    response: Record<string, unknown>;
  };
}

/** 消息部分的联合类型 */
export type Part = TextPart | InlineDataPart | FunctionCallPart | FunctionResponsePart;

/** 消息角色 */
export type Role = 'user' | 'model';

/** Token 用量详情（按模态拆分） */
export interface TokensDetail {
  modality: string;
  tokenCount: number;
}

/** API 调用的 Token 用量统计 */
export interface UsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
  promptTokensDetails?: TokensDetail[];
  candidatesTokensDetails?: TokensDetail[];
}

/** 一条消息内容（Gemini Content 格式） */
export interface Content {
  role: Role;
  parts: Part[];
  /** 该轮 API 调用的 Token 用量（存储用，组装请求时剥离） */
  usageMetadata?: UsageMetadata;
  /** 本轮响应耗时（毫秒），存储用 */
  durationMs?: number;
}

// ============ 类型守卫工具函数 ============

export function isTextPart(part: Part): part is TextPart {
  return 'text'in part;
}

export function isThoughtTextPart(part: Part): part is TextPart & { thought: true } {
  return 'text' in part && (part as TextPart).thought === true;
}

export function isVisibleTextPart(part: Part): part is TextPart {
  return 'text' in part && (part as TextPart).thought !== true;
}

export function isInlineDataPart(part: Part): part is InlineDataPart {
  return 'inlineData' in part;
}

export function isFunctionCallPart(part: Part): part is FunctionCallPart {
  return 'functionCall' in part;
}

export function isFunctionResponsePart(part: Part): part is FunctionResponsePart {
  return 'functionResponse' in part;
}

/** 从 Parts 数组中提取所有文本并拼接 */
export function extractText(parts: Part[]): string {
  return parts.filter(isVisibleTextPart).map(p => p.text).join('');
}
