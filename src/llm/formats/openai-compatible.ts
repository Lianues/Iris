/**
 * OpenAI Compatible 格式适配器
 *
 * Gemini ↔ OpenAI 格式的完整双向转换。
 * 适用于所有 OpenAI 兼容接口（OpenAI、DeepSeek、本地模型等）。
 *
 * 支持 reasoning_content / reasoning（DeepSeek / KIMI 等模型的 thinking 字段）。
 */

import {
  LLMRequest, LLMResponse, LLMStreamChunk, Part,
  isTextPart, isVisibleTextPart, isInlineDataPart, isFunctionCallPart, isFunctionResponsePart,
} from '../../types';
import type { FunctionCallPart, ToolCallProtocol, ToolCallProtocolError } from '../../types';
import { FormatAdapter, StreamDecodeState } from './types';
import { consumeCallId, normalizeCallId, resolveCallId } from './tool-call-ids';
import { sanitizeSchemaForOpenAI } from './schema-sanitizer';
import { applyOpenAIPromptCachePolicy } from './openai-prompt-cache';
import { buildNativeToolUsePrompt } from '../tool-intent-guard';
import {
  buildTaggedJsonToolPrompt,
  consumeTaggedJsonToolText,
  createTaggedJsonToolStreamState,
  decodeTaggedJsonToolText,
  encodeTaggedJsonAssistantContent,
  encodeTaggedJsonToolResults,
} from './tagged-json-tools';
import type { TaggedJsonToolStreamState } from './tagged-json-tools';

interface PendingNativeToolCall {
  callId?: string;
  name: string;
  arguments: string;
  emitted?: boolean;
}

const MAX_PROTOCOL_ERROR_ARGUMENT_PREVIEW = 512;
let nativeProtocolCallPrefixCounter = 0;

export class OpenAICompatibleFormat implements FormatAdapter {
  constructor(
    private model: string,
    private promptCaching?: boolean,
    private toolCallProtocol: ToolCallProtocol = 'native',
  ) {}

  // ============ 编码请求：Gemini → OpenAI ============

  encodeRequest(request: LLMRequest, stream?: boolean): unknown {
    const messages: Record<string, unknown>[] = [];
    const declarations = request.tools?.flatMap(t => t.functionDeclarations) ?? [];
    const usesTaggedJson = this.toolCallProtocol === 'tagged-json';

    // systemInstruction → system message
    const systemText = request.systemInstruction?.parts
        .filter(isVisibleTextPart).map(p => p.text).join('\n');
    const taggedJsonPrompt = usesTaggedJson && declarations.length > 0
      ? buildTaggedJsonToolPrompt(declarations)
      : '';
    const nativeToolPrompt = !usesTaggedJson && declarations.length > 0
      ? buildNativeToolUsePrompt()
      : '';
    const combinedSystemText = [systemText, taggedJsonPrompt, nativeToolPrompt]
      .filter(Boolean).join('\n\n');
    if (combinedSystemText) {
      messages.push({ role: 'system', content: combinedSystemText });
    }

    // contents → messages
    const pendingToolCallIds: string[] = [];
    let generatedToolCallIdCounter = 0;
    for (const content of request.contents) {
      const textParts = content.parts.filter(isVisibleTextPart);
      const funcCallParts = content.parts.filter(isFunctionCallPart);
      const funcRespParts = content.parts.filter(isFunctionResponsePart);

      if (content.role === 'model') {
        // 提取 thinking/reasoning 内容（thought: true 的 text parts）
        const thoughtParts = content.parts.filter(p => isTextPart(p) && p.thought === true);
        const reasoningContent = thoughtParts.map(p => (p as any).text || '').join('') || null;

        if (usesTaggedJson) {
          const text = encodeTaggedJsonAssistantContent(content.parts);
          const msg: Record<string, unknown> = { role: 'assistant', content: text };
          if (reasoningContent) msg.reasoning_content = reasoningContent;
          messages.push(msg);
        } else if (funcCallParts.length > 0) {
          const toolCalls = funcCallParts.map((part, i) => {
            if (!isFunctionCallPart(part)) {
              throw new Error('unreachable');
            }
            const callId = resolveCallId(part.functionCall.callId, `call_${generatedToolCallIdCounter + i}`);
            pendingToolCallIds.push(callId);
            return {
              id: callId,
              type: 'function' as const,
              function: {
                name: part.functionCall.name,
                arguments: JSON.stringify(part.functionCall.args),
              },
            };
          });
          generatedToolCallIdCounter += funcCallParts.length;
          const text = textParts.map(p => {
            if (!isTextPart(p)) throw new Error('unreachable');
            return p.text;
          }).join('') || null;
          const msg: Record<string, unknown> = { role: 'assistant', content: text, tool_calls: toolCalls };
          if (reasoningContent) msg.reasoning_content = reasoningContent;
          messages.push(msg);
       } else {
          const text = textParts.map(p => {
            if (!isTextPart(p)) throw new Error('unreachable');
            return p.text;
          }).join('');
          const msg: Record<string, unknown> = { role: 'assistant', content: text };
          if (reasoningContent) msg.reasoning_content = reasoningContent;
          messages.push(msg);
        }
      } else {
        if (funcRespParts.length > 0) {
          if (usesTaggedJson) {
            messages.push({
              role: 'user',
              content: encodeTaggedJsonToolResults(funcRespParts),
            });
          } else {
            for (let i = 0; i < funcRespParts.length; i++) {
              const part = funcRespParts[i];
              if (!isFunctionResponsePart(part)) {
                throw new Error('unreachable');
              }
              const callId = consumeCallId({
                explicit: part.functionResponse.callId,
                pendingCallIds: pendingToolCallIds,
                providerLabel: 'OpenAI Compatible',
                toolName: part.functionResponse.name,
              });
              messages.push({
                role: 'tool',
                tool_call_id: callId,
                content: JSON.stringify(part.functionResponse.response),
              });
            }
          }
        } else {
          const contentBlocks: Record<string, unknown>[] = [];
          let hasInlineImage = false;

          for (const part of content.parts) {
            if (isTextPart(part) && part.thought !== true && part.text) {
              contentBlocks.push({ type: 'text', text: part.text });
            } else if (isInlineDataPart(part)) {
              hasInlineImage = true;
              contentBlocks.push({
                type: 'image_url',
                image_url: {
                  url: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`,
                },
              });
            }
          }

          if (hasInlineImage) {
            messages.push({ role: 'user', content: contentBlocks });
          } else {
            const text = textParts.map(p => {
              if (!isTextPart(p)) throw new Error('unreachable');
              return p.text;
            }).join('');
            messages.push({ role: 'user', content: text });
          }
        }
      }
    }

    // 组装请求体
    const body: Record<string, unknown> = { model: this.model, messages };

    // tools 声明转换
    if (!usesTaggedJson && declarations.length > 0) {
      body.tools = declarations.map(decl => ({
        type: 'function',
        function: { name: decl.name, description: decl.description, parameters: sanitizeSchemaForOpenAI(decl.parameters) },
      }));
    }

    // generationConfig 转换
    if (request.generationConfig) {
      const gc = request.generationConfig;
      if (gc.temperature !== undefined) body.temperature = gc.temperature;
      if (gc.topP !== undefined) body.top_p = gc.topP;
      if (gc.maxOutputTokens !== undefined) body.max_tokens = gc.maxOutputTokens;
      if (gc.stopSequences !== undefined) body.stop = gc.stopSequences;
    }

    // 流式参数
    if (stream) {
      body.stream = true;
      body.stream_options = { include_usage: true };
    }

    applyOpenAIPromptCachePolicy(body, {
      model: this.model,
      enabled: this.promptCaching,
      stablePrefix: {
        system: messages.find(message => message.role === 'system')?.content,
        tools: body.tools,
      },
    });

    return body;
  }

  // ============ 解码响应：OpenAI → Gemini ============

  decodeResponse(raw: unknown): LLMResponse {
    const data = raw as any;
    const choice = data.choices?.[0];
    if (!choice?.message) {
      throw new Error(`OpenAI Compatible API 未返回有效内容: ${JSON.stringify(data)}`);
    }

    const msg = choice.message;
    const parts: Part[] = [];

    // reasoning_content / reasoning → thought part。
    // 部分 OpenAI 兼容代理使用非标准 reasoning 别名；两者同时存在时
    // 优先采用 reasoning_content，避免重复保存同一段思考。
    const reasoningContent = typeof msg.reasoning_content === 'string'
      ? msg.reasoning_content
      : typeof msg.reasoning === 'string'
        ? msg.reasoning
        : undefined;
    if (reasoningContent) {
      parts.push({ text: reasoningContent, thought: true });
    }

    if (this.toolCallProtocol === 'tagged-json') {
      const taggedText = extractOpenAIMessageText(msg.content);
      if (taggedText !== undefined) {
        parts.push(...decodeTaggedJsonToolText(taggedText));
      }
    } else {
      if (typeof msg.content === 'string') {
        parts.push({ text: msg.content });
      } else if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (typeof block === 'string') parts.push({ text: block });
          else if (block?.type === 'text' && typeof block.text === 'string') parts.push({ text: block.text });
        }
      }
      const nativeState = this.createStreamState();
      if (Array.isArray(msg.tool_calls)) {
        for (const tc of msg.tool_calls) {
          const rawArguments = typeof tc?.function?.arguments === 'string'
            ? tc.function.arguments
            : JSON.stringify(tc?.function?.arguments ?? {});
          const decoded: LLMStreamChunk = {};
          emitPendingNativeToolCall(decoded, nativeState, {
            name: typeof tc?.function?.name === 'string' ? tc.function.name : '',
            arguments: rawArguments,
            callId: normalizeCallId(tc?.id),
          }, { allowEmptyArgs: true, final: true });
          if (decoded.partsDelta) parts.push(...decoded.partsDelta);
        }
      }
      if (choice.finish_reason === 'tool_calls' && getNativeToolCallCount(nativeState) === 0) {
        const decoded: LLMStreamChunk = {};
        flushPendingNativeToolCalls(decoded, nativeState, choice.finish_reason);
        if (decoded.partsDelta) parts.push(...decoded.partsDelta);
      }
    }
    if (parts.length === 0) parts.push({ text: '' });

    return {
      content: { role: 'model', parts },
      finishReason: choice.finish_reason,
      usageMetadata: data.usage
        ? (() => {
            const cached = data.usage.prompt_tokens_details?.cached_tokens ?? 0;
            return {
            promptTokenCount: data.usage.prompt_tokens,
            ...(cached > 0 ? { cachedContentTokenCount: cached } : {}),
            candidatesTokenCount: data.usage.completion_tokens,
            totalTokenCount: data.usage.total_tokens,
            };
          })()
        : undefined,
    };
  }

  // ============ 流式解码 ============

  decodeStreamChunk(raw: unknown, state: StreamDecodeState): LLMStreamChunk {
    const data = raw as any;
    const choice = data.choices?.[0];
    const chunk: LLMStreamChunk = {};

    // reasoning_content / reasoning 流式增量。reasoning 是若干兼容代理
    // 实际返回的别名；优先 reasoning_content 以免重复输出。
    const reasoningDelta = typeof choice?.delta?.reasoning_content === 'string'
      ? choice.delta.reasoning_content
      : typeof choice?.delta?.reasoning === 'string'
        ? choice.delta.reasoning
        : undefined;
    if (reasoningDelta) {
      chunk.partsDelta = [
        ...(chunk.partsDelta || []),
        { text: reasoningDelta, thought: true } as any,
      ];
    }

    if (choice?.delta?.content) {
      if (this.toolCallProtocol === 'tagged-json') {
        const taggedState = state.taggedJsonTools as TaggedJsonToolStreamState;
        appendTaggedJsonParts(
          chunk,
          consumeTaggedJsonToolText(taggedState, choice.delta.content),
        );
      } else {
        chunk.textDelta = choice.delta.content;
        chunk.partsDelta = [
          ...(chunk.partsDelta || []),
          { text: choice.delta.content },
        ];
      }
    }

    // 流式边执行优化：累积工具调用分片，并在检测到工具参数完整时立即输出。
    //
    // OpenAI 的 tool_call 分片按 index 顺序发送，没有"单个工具参数完成"的显式信号。
    // 但有一个规律：当 delta 中出现新的 tool_call index 时，说明前一个 index 的
    // 参数已经流完了。利用这个规律，在新 index 出现时立即输出前一个已完成的工具调用，
    // 让 StreamingToolExecutor 可以在 LLM 还在输出后续工具参数时提前启动执行。
    // finish_reason 到达时，最后一个工具也输出。
    const pending = state.pendingToolCalls as Map<number, PendingNativeToolCall>;
    if (this.toolCallProtocol !== 'tagged-json' && choice?.delta?.tool_calls) {
      for (const tc of choice.delta.tool_calls) {
        // 新 index 出现时，前面未输出的工具调用的参数一定已经完整，立即输出
        if (!pending.has(tc.index) && pending.size > 0) {
          for (const [, entry] of pending) {
            emitPendingNativeToolCall(chunk, state, entry, { allowEmptyArgs: true, final: true });
          }
        }
        if (!pending.has(tc.index)) {
          pending.set(tc.index, { callId: undefined, name: '', arguments: '', emitted: false });
        }
        const entry = pending.get(tc.index)!;
        if (tc.id) entry.callId = normalizeCallId(tc.id) ?? entry.callId;
        if (tc.function?.name) entry.name = tc.function.name;
        if (tc.function?.arguments) entry.arguments += tc.function.arguments;
        // 单个 tool_call 没有“下一个 index”可作为完成信号；当参数 JSON 已经完整时立即输出，
        // 让 AskQuestionFirst 这类交互工具可以在 message 结束前显示面板。
        emitPendingNativeToolCall(chunk, state, entry);
      }
    }
    // finish_reason 到达时，输出最后一个（及所有尚未输出的）工具调用
    if (choice?.finish_reason) {
      chunk.finishReason = choice.finish_reason;
      if (this.toolCallProtocol === 'tagged-json') {
        appendTaggedJsonParts(
          chunk,
          consumeTaggedJsonToolText(state.taggedJsonTools as TaggedJsonToolStreamState, '', true),
        );
      } else {
        flushPendingNativeToolCalls(chunk, state, choice.finish_reason);
      }
    }

    // usage
    if (data.usage) {
      chunk.usageMetadata = {
        promptTokenCount: data.usage.prompt_tokens,
        ...((data.usage.prompt_tokens_details?.cached_tokens ?? 0) > 0
          ? { cachedContentTokenCount: data.usage.prompt_tokens_details.cached_tokens }
          : {}),
        candidatesTokenCount: data.usage.completion_tokens,
        totalTokenCount: data.usage.total_tokens,
      };
    }

    return chunk;
  }

  createStreamState(): StreamDecodeState {
    return {
      pendingToolCalls: new Map<number, { callId?: string; name: string; arguments: string; emitted?: boolean }>(),
      nativeToolCallCount: 0,
      nativeProtocolCallPrefix: `call_iris_protocol_${Date.now().toString(36)}_${(++nativeProtocolCallPrefixCounter).toString(36)}`,
      nativeProtocolCallIndex: 0,
      taggedJsonTools: createTaggedJsonToolStreamState(),
    };
  }

  /** SSE 以 [DONE] 结束但未携带 finish_reason 时，仍需冲刷标签前缀/未闭合块。 */
  finalizeStream(state: StreamDecodeState): LLMStreamChunk | undefined {
    if (this.toolCallProtocol !== 'tagged-json') {
      const chunk: LLMStreamChunk = {};
      flushPendingNativeToolCalls(chunk, state);
      return chunk.partsDelta?.length ? chunk : undefined;
    }
    const chunk: LLMStreamChunk = {};
    appendTaggedJsonParts(
      chunk,
      consumeTaggedJsonToolText(state.taggedJsonTools as TaggedJsonToolStreamState, '', true),
    );
    return chunk.partsDelta?.length ? chunk : undefined;
  }
}

function emitPendingNativeToolCall(
  chunk: LLMStreamChunk,
  state: StreamDecodeState,
  entry: PendingNativeToolCall,
  options?: { allowEmptyArgs?: boolean; final?: boolean },
): boolean {
  if (entry.emitted) return false;

  const rawArgs = entry.arguments ?? '';
  if (!entry.name) {
    if (!options?.final) return false;
    appendNativeToolCall(chunk, state, createProtocolErrorToolCall(state, '', entry.callId, {
      code: 'missing_name',
      message: '工具调用缺少 function.name，Iris 已阻止执行。请重新发送带有真实工具名的完整调用。',
      ...buildRawArgumentsDiagnostic(rawArgs),
    }));
    entry.emitted = true;
    return true;
  }

  if (!rawArgs.trim() && !options?.allowEmptyArgs) {
    // OpenAI-compatible providers often send name + arguments="" first and
    // append the actual JSON in later deltas. Do not turn it into {} early.
    return false;
  }

  let args: unknown;
  try {
    args = rawArgs.trim() ? JSON.parse(rawArgs) : {};
  } catch {
    if (!options?.final) return false;
    appendNativeToolCall(chunk, state, createProtocolErrorToolCall(state, entry.name, entry.callId, {
      code: 'invalid_arguments_json',
      message: '工具调用 arguments 不是有效且完整的 JSON，Iris 已阻止执行。请按工具 schema 使用真实顶层字段重新发送完整调用。',
      ...buildRawArgumentsDiagnostic(rawArgs),
    }));
    entry.emitted = true;
    return true;
  }

  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    if (!options?.final) return false;
    appendNativeToolCall(chunk, state, createProtocolErrorToolCall(state, entry.name, entry.callId, {
      code: 'arguments_not_object',
      message: '工具调用 arguments 必须是 JSON object，Iris 已阻止执行。请按工具 schema 重新发送调用。',
      ...buildRawArgumentsDiagnostic(rawArgs),
    }));
    entry.emitted = true;
    return true;
  }

  appendNativeToolCall(chunk, state, {
    functionCall: {
      name: entry.name,
      args: args as Record<string, unknown>,
      callId: entry.callId,
    },
  });
  entry.emitted = true;
  return true;
}

function flushPendingNativeToolCalls(
  chunk: LLMStreamChunk,
  state: StreamDecodeState,
  finishReason?: string,
): void {
  const pending = state.pendingToolCalls as Map<number, PendingNativeToolCall>;
  for (const [, entry] of pending) {
    emitPendingNativeToolCall(chunk, state, entry, { allowEmptyArgs: true, final: true });
  }
  pending.clear();

  if (finishReason === 'tool_calls' && getNativeToolCallCount(state) === 0) {
    appendNativeToolCall(chunk, state, createProtocolErrorToolCall(state, '', undefined, {
      code: 'missing_tool_call',
      message: 'Provider 以 finish_reason=tool_calls 结束，但没有提供可解码的工具调用。Iris 已阻止把该轮当作正常最终回复；请重新发送完整调用。',
    }));
  }
}

function appendNativeToolCall(
  chunk: LLMStreamChunk,
  state: StreamDecodeState,
  call: FunctionCallPart,
): void {
  if (!chunk.functionCalls) chunk.functionCalls = [];
  chunk.functionCalls.push(call);
  chunk.partsDelta = [...(chunk.partsDelta || []), call];
  state.nativeToolCallCount = getNativeToolCallCount(state) + 1;
}

function getNativeToolCallCount(state: StreamDecodeState): number {
  return typeof state.nativeToolCallCount === 'number' ? state.nativeToolCallCount : 0;
}

function createProtocolErrorToolCall(
  state: StreamDecodeState,
  name: string,
  callId: string | undefined,
  protocolError: ToolCallProtocolError,
): FunctionCallPart {
  const nextIndex = typeof state.nativeProtocolCallIndex === 'number'
    ? state.nativeProtocolCallIndex
    : 0;
  state.nativeProtocolCallIndex = nextIndex + 1;
  const prefix = typeof state.nativeProtocolCallPrefix === 'string'
    ? state.nativeProtocolCallPrefix
    : 'call_iris_protocol';
  return {
    functionCall: {
      name: name || '__invalid_tool_call__',
      args: {},
      callId: callId ?? `${prefix}_${nextIndex}`,
      protocolError,
    },
  };
}

function buildRawArgumentsDiagnostic(rawArguments: string): Pick<
  ToolCallProtocolError,
  'rawArgumentsPreview' | 'rawArgumentsLength'
> {
  if (!rawArguments) return {};
  return {
    rawArgumentsPreview: rawArguments.slice(0, MAX_PROTOCOL_ERROR_ARGUMENT_PREVIEW),
    rawArgumentsLength: rawArguments.length,
  };
}

function appendTaggedJsonParts(chunk: LLMStreamChunk, parts: Part[]): void {
  if (parts.length === 0) return;
  if (!chunk.partsDelta) chunk.partsDelta = [];
  for (const part of parts) {
    chunk.partsDelta.push(part);
    if (isFunctionCallPart(part)) {
      if (!chunk.functionCalls) chunk.functionCalls = [];
      chunk.functionCalls.push(part);
    } else if (isVisibleTextPart(part) && part.text) {
      chunk.textDelta = (chunk.textDelta ?? '') + part.text;
    }
  }
}

function extractOpenAIMessageText(content: unknown): string | undefined {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return undefined;
  let text = '';
  let found = false;
  for (const block of content) {
    if (typeof block === 'string') {
      text += block;
      found = true;
    } else if (block && typeof block === 'object'
      && (block as any).type === 'text' && typeof (block as any).text === 'string') {
      text += (block as any).text;
      found = true;
    }
  }
  return found ? text : undefined;
}
