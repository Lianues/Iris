import type { ToolDiffPreviewResponseLike } from './plugin/tool-preview.js';

export interface TextPart {
  text?: string;
  thought?: boolean;
  thoughtSignatures?: {
    gemini?: string;
    claude?: string;
    openai?: string;
    [key: string]: string | undefined;
  };
  thoughtDurationMs?: number;
  /** 内部字段：提示词缓存策略；发送给 provider 前应过滤或转换。 */
  cacheBehavior?: 'stable' | 'dynamic';
}

export interface InlineDataPart {
  inlineData: {
    mimeType: string;
    data: string;
    /** 原始文件名（存储用，发送给 LLM 时剥离） */
    name?: string;
  };
}

export interface FunctionCallPart {
  functionCall: {
    name: string;
    args: Record<string, unknown>;
    callId?: string;
  };
}

export interface FunctionResponsePart {
  functionResponse: {
    name: string;
    response: Record<string, unknown>;
    callId?: string;
    parts?: InlineDataPart[];
    durationMs?: number;
    /** 工具 diff 预览（存储用，不发送给 LLM，仅供前端展示） */
    diffPreview?: ToolDiffPreviewResponseLike;
  };
}

export type Part = TextPart | InlineDataPart | FunctionCallPart | FunctionResponsePart;
export type Role = 'user' | 'model';

export interface TokensDetail {
  modality: string;
  tokenCount: number;
}

export interface UsageMetadata {
  promptTokenCount?: number;
  cachedContentTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
  promptTokensDetails?: TokensDetail[];
  candidatesTokensDetails?: TokensDetail[];
}

export interface Content {
  role: Role;
  parts: Part[];
  usageMetadata?: UsageMetadata;
  durationMs?: number;
  streamOutputDurationMs?: number;
  modelName?: string;
  createdAt?: number;
  isSummary?: boolean;
}


// ── Type Guards ─────────────────────────────────────────────────

export function isTextPart(part: Part): part is TextPart {
  return 'text' in part || 'thought' in part || 'thoughtSignatures' in part;
}

export function isThoughtTextPart(part: Part): part is TextPart {
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

export function extractText(parts: Part[]): string {
  return parts
    .filter((p): p is TextPart => isVisibleTextPart(p))
    .map((p) => p.text ?? '')
    .join('');
}
