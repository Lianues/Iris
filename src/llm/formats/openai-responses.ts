/**
 * OpenAI Responses 格式适配器
 *
 * 专门处理 /v1/responses 接口。
 * 支持 reasoning summary 存储为 thought parts，
 * 支持 encrypted_content 存储为 thoughtSignatures.openai 并回传。
 */

import {
  LLMRequest, LLMResponse, LLMStreamChunk, Part, FunctionCallPart,
  isVisibleTextPart, isInlineDataPart, isFunctionCallPart, isFunctionResponsePart, isTextPart,
} from '../../types';
import { isDocumentMimeType } from '../vision';
import { FormatAdapter, StreamDecodeState } from './types';
import { consumeCallId, normalizeCallId, resolveCallId } from './tool-call-ids';
import { sanitizeSchemaForOpenAI } from './schema-sanitizer';

export class OpenAIResponsesFormat implements FormatAdapter {
  constructor(private model: string) {}

  // ============ 编码请求：Gemini (Internal) → OpenAI Responses ============

  encodeRequest(request: LLMRequest, stream?: boolean): unknown {
    const body: Record<string, any> = {
      model: this.model,
      store: false,
      include: ['reasoning.encrypted_content'],
    };

    // 1. systemInstruction -> instructions
    if (request.systemInstruction?.parts) {
      body.instructions = request.systemInstruction.parts
        .filter(isVisibleTextPart)
        .map(p => p.text)
        .join('\n');
    }

    // 2. contents -> input
    const inputItems: any[] = [];
    const pendingToolCallIds: string[] = [];
    let generatedToolCallIdCounter = 0;

    for (const content of request.contents) {
      if (content.role === 'model') {
        let currentMessageItem: any = null;

        for (const part of content.parts) {
          if (isTextPart(part) && part.thought === true) {
            const reasoningItem: any = {
              type: 'reasoning',
              summary: part.text ? [{ type: 'summary_text', text: part.text }] : [],
            };
            if (part.thoughtSignatures?.openai) {
              reasoningItem.encrypted_content = part.thoughtSignatures.openai;
            }
            inputItems.push(reasoningItem);
            currentMessageItem = null;
          } else if (isVisibleTextPart(part) && part.text) {
            if (!currentMessageItem) {
              currentMessageItem = { type: 'message', role: 'assistant', content: [] };
              inputItems.push(currentMessageItem);
            }
            currentMessageItem.content.push({ type: 'output_text', text: part.text });
          } else if (isFunctionCallPart(part)) {
            const callId = resolveCallId(part.functionCall.callId, `call_${generatedToolCallIdCounter++}`);
            inputItems.push({
              type: 'function_call',
              call_id: callId,
              name: part.functionCall.name,
              arguments: JSON.stringify(part.functionCall.args),
            });
            pendingToolCallIds.push(callId);
            currentMessageItem = null;
          }
        }
      } else {
        const funcRespParts = content.parts.filter(isFunctionResponsePart);
        if (funcRespParts.length > 0) {
          for (let i = 0; i < funcRespParts.length; i++) {
            const part = funcRespParts[i];
            if (!isFunctionResponsePart(part)) continue;
            const callId = consumeCallId({
              explicit: part.functionResponse.callId,
              pendingCallIds: pendingToolCallIds,
              providerLabel: 'OpenAI Responses',
              toolName: part.functionResponse.name,
            });
            inputItems.push({
              type: 'function_call_output',
              call_id: callId,
              output: JSON.stringify(part.functionResponse.response),
            });
          }
        } else {
          const contentBlocks: any[] = [];
          for (const part of content.parts) {
            if (isTextPart(part) && part.thought !== true && part.text) {
              contentBlocks.push({ type: 'input_text', text: part.text });
            } else if (isInlineDataPart(part)) {
              const mime = part.inlineData.mimeType;
              if (isDocumentMimeType(mime)) {
                contentBlocks.push({
                  type: 'input_file',
                  file_data: `data:${mime};base64,${part.inlineData.data}`,
                });
              } else {
                contentBlocks.push({
                  type: 'input_image',
                  image_url: `data:${mime};base64,${part.inlineData.data}`,
                });
              }
            }
          }
          if (contentBlocks.length === 0) {
            contentBlocks.push({ type: 'input_text', text: ' ' });
          }
          inputItems.push({
            role: 'user',
            content: contentBlocks,
          });
        }
      }
    }

    body.input = inputItems;

    // 3. tools
    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools.flatMap(t => t.functionDeclarations).map(decl => ({
        type: 'function',
        name: decl.name,
        description: decl.description,
        parameters: sanitizeSchemaForOpenAI(decl.parameters),
      }));
    }

    // 4. generationConfig
    if (request.generationConfig) {
      const gc = request.generationConfig;
      if (gc.maxOutputTokens !== undefined) body.max_output_tokens = gc.maxOutputTokens;
      if (gc.temperature !== undefined) body.temperature = gc.temperature;
      if (gc.topP !== undefined) body.top_p = gc.topP;
    }

    if (stream) body.stream = true;

    return body;
  }

  // ============ 解码响应：OpenAI Responses → Gemini (Internal) ============

  decodeResponse(raw: unknown): LLMResponse {
    const data = raw as any;
    if (!data.output) {
      throw new Error(`OpenAI Responses API 未返回有效内容: ${JSON.stringify(data)}`);
    }

    const parts: Part[] = [];
    for (const item of data.output) {
      if (item.type === 'reasoning') {
        const part = createReasoningPart(item, { includeText: true, includeSignature: true });
        if (part) parts.push(part);
      } else if (item.type === 'message') {
        for (const block of item.content ?? []) {
          if (block.type === 'output_text') {
            parts.push({ text: block.text });
          }
        }
      } else if (item.type === 'function_call') {
        parts.push(createFunctionCallPart(item));
      }
    }

    if (parts.length === 0) parts.push({ text: '' });

    return {
      content: { role: 'model', parts },
      usageMetadata: data.usage
        ? (() => {
            const cached = data.usage.input_tokens_details?.cached_tokens ?? 0;
            return {
              promptTokenCount: data.usage.input_tokens,
              ...(cached > 0 ? { cachedContentTokenCount: cached } : {}),
              candidatesTokenCount: data.usage.output_tokens,
              totalTokenCount: data.usage.total_tokens,
            };
          })()
        : undefined,
    };
  }

  // ============ 流式解码 ============

  decodeStreamChunk(raw: unknown, state: StreamDecodeState): LLMStreamChunk {
    const data = raw as any;
    const chunk: LLMStreamChunk = {};
    const streamState = state as OpenAIResponsesStreamState;
    const event = data.event || data.type;

    if (event === 'response.output_text.delta') {
      if (data.delta) {
        chunk.textDelta = data.delta;
        chunk.partsDelta = [{ text: data.delta }];
      }
    } else if (event === 'response.output_item.added') {
      const item = data.item;
      if (item?.type === 'reasoning') {
        // Responses API 的 reasoning item 在 added 阶段通常只有空 summary；
        // 但部分兼容端会直接把 summary 放在这里，仍需立即转成 thought part。
        // encrypted_content 只在 output_item.done 阶段采信，避免保存未完成或最终全量重复签名。
        emitReasoningItemSummary(chunk, streamState, item, data);
      } else if (item?.type === 'function_call') {
        rememberPendingFunctionCall(streamState, item);
      }
    } else if (isReasoningTextDeltaEvent(event)) {
      emitReasoningDeltaText(chunk, streamState, data, data.delta);
    } else if (isReasoningTextDoneEvent(event)) {
      emitReasoningFullText(chunk, streamState, data, data.text ?? data.content ?? data.summary_text);
    } else if (isReasoningSummaryPartEvent(event)) {
      emitReasoningFullText(chunk, streamState, data, extractReasoningSummaryPartText(data.part ?? data.summary_part ?? data.content_part ?? data));
    } else if (event === 'response.function_call_arguments.delta') {
      appendPendingFunctionCallArguments(
        streamState,
        data.item_id ?? data.id ?? data.call_id,
        data.delta,
      );
    } else if (event === 'response.function_call_arguments.done') {
      const itemKey = rememberPendingFunctionCall(streamState, {
        id: data.item_id ?? data.id,
        call_id: data.call_id,
        name: data.name,
        arguments: data.arguments,
      });
      if (itemKey) emitFunctionCallChunk(chunk, itemKey, streamState);
    } else if (event === 'response.output_item.done') {
      const item = data.item;
      if (item?.type === 'reasoning') {
        // 如果前面没有 reasoning_summary_text.delta，done 里的完整 summary 是最后兜底，
        // 否则只补 encrypted_content 签名，避免重复存储思维链文本。
        emitReasoningItemSummary(chunk, streamState, item, data);
        emitReasoningSignature(chunk, streamState, item, data);
      } else if (item?.type === 'function_call') {
        rememberPendingFunctionCall(streamState, item);
        emitFunctionCallChunk(chunk, item, streamState);
      }
    } else if (event === 'response.completed') {
      const usage = data.usage ?? data.response?.usage;
      if (usage) {
        chunk.usageMetadata = {
          promptTokenCount: usage.input_tokens,
          ...((usage.input_tokens_details?.cached_tokens ?? 0) > 0
            ? { cachedContentTokenCount: usage.input_tokens_details.cached_tokens }
            : {}),
          candidatesTokenCount: usage.output_tokens,
          totalTokenCount: usage.total_tokens,
        };
      }
      for (const item of data.response?.output ?? data.output ?? []) {
        if (item?.type === 'reasoning') {
          // 部分网关不会发送 reasoning_* delta，只在 completed.response.output
          // 中带最终 summary；这里作为最终兜底，确保后端历史与前端回显都能拿到 thought part。
          emitReasoningItemSummary(chunk, streamState, item, data);
          // 不保存 response.completed 中的最终 encrypted_content。
          // OpenAI Responses 在 completed 阶段可能给出一份“全量最终签名”，
          // 与 output_item.done 阶段的 reasoning 签名重复且常出现在可见正文之后，
          // 会在历史里形成额外的 signature-only thought part。保持原逻辑：
          // 只在 output_item.done 阶段接收 reasoning.encrypted_content。
        }
      }
      flushPendingFunctionCalls(chunk, streamState);
    }

    return chunk;
  }

  createStreamState(): StreamDecodeState {
    return {
      emittedFunctionCallIds: new Set<string>(),
      pendingFunctionCalls: new Map<string, PendingOpenAIResponsesFunctionCall>(),
      reasoningTextByKey: new Map<string, string>(),
      emittedReasoningSignatures: new Set<string>(),
    } as OpenAIResponsesStreamState;
  }
}

interface OpenAIResponsesStreamState extends StreamDecodeState {
  emittedFunctionCallIds: Set<string>;
  pendingFunctionCalls: Map<string, PendingOpenAIResponsesFunctionCall>;
  reasoningTextByKey: Map<string, string>;
  emittedReasoningSignatures: Set<string>;
}

interface PendingOpenAIResponsesFunctionCall {
  callId?: string;
  name?: string;
  argumentsText: string;
}

function createReasoningPart(
  item: any,
  options: { includeText: boolean; includeSignature: boolean },
): Part | undefined {
  const part: any = { thought: true };

  if (options.includeText) {
    const text = extractReasoningSummaryText(item.summary);
    if (text) part.text = text;
  }

  if (options.includeSignature && item.encrypted_content) {
    part.thoughtSignatures = { openai: item.encrypted_content };
  }

  return part.text || part.thoughtSignatures ? part : undefined;
}

function extractReasoningSummaryText(summary: unknown): string {
  if (typeof summary === 'string') return summary;
  if (!Array.isArray(summary)) return '';
  return summary
    .map(extractReasoningSummaryPartText)
    .filter(Boolean)
    .join('\n');
}

function extractReasoningSummaryPartText(part: unknown): string {
  if (typeof part === 'string') return part;
  if (!part || typeof part !== 'object') return '';
  const record = part as any;
  if (typeof record.text === 'string') return record.text;
  if (typeof record.summary_text === 'string') return record.summary_text;
  if (typeof record.content === 'string') return record.content;
  return '';
}

function isReasoningTextDeltaEvent(event: unknown): boolean {
  return event === 'response.reasoning_summary_text.delta'
    || event === 'response.reasoning_text.delta'
    || event === 'response.reasoning.delta';
}

function isReasoningTextDoneEvent(event: unknown): boolean {
  return event === 'response.reasoning_summary_text.done'
    || event === 'response.reasoning_text.done'
    || event === 'response.reasoning.done';
}

function isReasoningSummaryPartEvent(event: unknown): boolean {
  return event === 'response.reasoning_summary_part.added'
    || event === 'response.reasoning_summary_part.done';
}

function emitReasoningDeltaText(
  chunk: LLMStreamChunk,
  state: OpenAIResponsesStreamState,
  data: any,
  delta: unknown,
): void {
  const text = typeof delta === 'string' ? delta : extractReasoningSummaryPartText(delta);
  if (!text) return;
  const key = getReasoningStateKey(data);
  state.reasoningTextByKey.set(key, (state.reasoningTextByKey.get(key) ?? '') + text);
  appendPartDelta(chunk, { text, thought: true } as any);
}

function emitReasoningFullText(
  chunk: LLMStreamChunk,
  state: OpenAIResponsesStreamState,
  data: any,
  text: unknown,
): void {
  if (typeof text !== 'string' || !text) return;
  const key = getReasoningStateKey(data);
  const emitted = state.reasoningTextByKey.get(key) ?? '';
  if (text === emitted) return;

  // done / completed 事件给的是完整文本：只补齐尚未通过 delta 发出的后缀。
  // 如果 provider 在 done 中返回了与 delta 不同的修订文本，则不追加，避免历史中重复或错序。
  if (emitted && !text.startsWith(emitted)) {
    state.reasoningTextByKey.set(key, text);
    return;
  }

  const delta = emitted ? text.slice(emitted.length) : text;
  state.reasoningTextByKey.set(key, text);
  if (delta) appendPartDelta(chunk, { text: delta, thought: true } as any);
}

function emitReasoningItemSummary(
  chunk: LLMStreamChunk,
  state: OpenAIResponsesStreamState,
  item: any,
  context?: any,
): void {
  const text = extractReasoningSummaryText(item?.summary);
  emitReasoningFullText(chunk, state, { ...context, item }, text);
}

function emitReasoningSignature(
  chunk: LLMStreamChunk,
  state: OpenAIResponsesStreamState,
  item: any,
  context?: any,
): void {
  const signature = typeof item?.encrypted_content === 'string' ? item.encrypted_content : '';
  if (!signature) return;
  const key = `${getReasoningStateKey({ ...context, item })}:${signature}`;
  if (state.emittedReasoningSignatures.has(key)) return;
  state.emittedReasoningSignatures.add(key);

  const part = { thought: true, thoughtSignatures: { openai: signature } } as any;
  appendPartDelta(chunk, part);
  chunk.thoughtSignatures = { ...(chunk.thoughtSignatures ?? {}), openai: signature };
}

function appendPartDelta(chunk: LLMStreamChunk, part: Part): void {
  chunk.partsDelta = [...(chunk.partsDelta ?? []), part];
}

function getReasoningStateKey(data: any): string {
  return normalizeCallId(data?.item_id)
    ?? normalizeCallId(data?.item?.id)
    ?? normalizeCallId(data?.id)
    ?? `output:${data?.output_index ?? data?.index ?? 'default'}`;
}

function createFunctionCallPart(item: any): FunctionCallPart {
  return {
    functionCall: {
      name: item.name,
      args: parseFunctionCallArguments(item.arguments),
      callId: normalizeCallId(item.call_id) ?? normalizeCallId(item.id),
    },
  };
}

function parseFunctionCallArguments(argumentsValue: unknown): Record<string, unknown> {
  if (!argumentsValue) return {};
  if (typeof argumentsValue === 'string') {
    return JSON.parse(argumentsValue);
  }
  if (typeof argumentsValue === 'object' && !Array.isArray(argumentsValue)) {
    return argumentsValue as Record<string, unknown>;
  }
  return {};
}

function rememberPendingFunctionCall(
  state: OpenAIResponsesStreamState,
  item: any,
): string | undefined {
  const itemKey = getPendingFunctionCallKey(item);
  if (!itemKey) return undefined;

  const pending = state.pendingFunctionCalls.get(itemKey) ?? { argumentsText: '' };
  const callId = normalizeCallId(item.call_id) ?? pending.callId ?? normalizeCallId(item.id);
  if (callId) pending.callId = callId;
  if (typeof item.name === 'string' && item.name.trim()) pending.name = item.name;
  if (typeof item.arguments === 'string') {
    if (item.arguments || !pending.argumentsText) {
      pending.argumentsText = item.arguments;
    }
  } else if (item.arguments && typeof item.arguments === 'object' && !Array.isArray(item.arguments)) {
    pending.argumentsText = JSON.stringify(item.arguments);
  }

  state.pendingFunctionCalls.set(itemKey, pending);
  return itemKey;
}

function appendPendingFunctionCallArguments(
  state: OpenAIResponsesStreamState,
  itemId: unknown,
  delta: unknown,
): void {
  const itemKey = normalizeCallId(itemId);
  if (!itemKey || typeof delta !== 'string') return;

  const pending = state.pendingFunctionCalls.get(itemKey) ?? { argumentsText: '' };
  pending.argumentsText += delta;
  state.pendingFunctionCalls.set(itemKey, pending);
}

function getPendingFunctionCallKey(item: any): string | undefined {
  return normalizeCallId(item?.id) ?? normalizeCallId(item?.call_id);
}

function emitFunctionCallChunk(
  chunk: LLMStreamChunk,
  itemOrKey: any,
  state: OpenAIResponsesStreamState,
): void {
  const itemKey = typeof itemOrKey === 'string'
    ? itemOrKey
    : rememberPendingFunctionCall(state, itemOrKey);
  if (!itemKey) return;

  const pending = state.pendingFunctionCalls.get(itemKey);
  if (!pending?.name) return;

  const functionCall = tryCreateFunctionCallPart({
    id: itemKey,
    call_id: pending.callId ?? itemKey,
    name: pending.name,
    arguments: pending.argumentsText,
  });
  if (!functionCall) return;

  const emittedId = functionCall.functionCall.callId ?? itemKey;
  if (state.emittedFunctionCallIds.has(emittedId)) return;
  state.emittedFunctionCallIds.add(emittedId);
  state.pendingFunctionCalls.delete(itemKey);

  chunk.functionCalls = [...(chunk.functionCalls ?? []), functionCall];
  chunk.partsDelta = [...(chunk.partsDelta ?? []), functionCall];
}

function flushPendingFunctionCalls(chunk: LLMStreamChunk, state: OpenAIResponsesStreamState): void {
  for (const itemKey of [...state.pendingFunctionCalls.keys()]) {
    emitFunctionCallChunk(chunk, itemKey, state);
  }
}

function tryCreateFunctionCallPart(item: any): FunctionCallPart | undefined {
  try {
    return createFunctionCallPart(item);
  } catch {
    return undefined;
  }
}
