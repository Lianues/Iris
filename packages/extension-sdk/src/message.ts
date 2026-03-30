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
}

export interface InlineDataPart {
  inlineData: {
    mimeType: string;
    data: string;
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
  return 'text' in part;
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

export function extractText(content: Content): string {
  return content.parts
    .filter((p): p is TextPart => 'text' in p && (p as TextPart).thought !== true)
    .map((p) => p.text ?? '')
    .join('');
}
