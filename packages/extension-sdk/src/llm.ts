import type { Content, Part, UsageMetadata } from './message.js';
import type { FunctionCallPart } from './message.js';
import type { FunctionDeclaration } from './tool.js';

export interface LLMGenerationConfig {
  temperature?: number;
  topP?: number;
  topK?: number;
  maxOutputTokens?: number;
  stopSequences?: string[];
  [key: string]: unknown;
}

export interface LLMRequest {
  contents: Content[];
  tools?: {
    functionDeclarations: FunctionDeclaration[];
  }[];
  systemInstruction?: {
    parts: Part[];
  };
  generationConfig?: LLMGenerationConfig;
}

export interface LLMResponse {
  content: Content;
  finishReason?: string;
  usageMetadata?: UsageMetadata;
}

export interface LLMStreamChunk {
  partsDelta?: Part[];
  textDelta?: string;
  functionCalls?: FunctionCallPart[];
  finishReason?: string;
  usageMetadata?: UsageMetadata;
  thoughtSignatures?: {
    gemini?: string;
    claude?: string;
    openai?: string;
    [key: string]: string | undefined;
  };
}
