/**
 * OpenAI Compatible 格式适配器
 *
 * Gemini ↔ OpenAI 格式的完整双向转换。
 * 适用于所有 OpenAI 兼容接口（OpenAI、DeepSeek、本地模型等）。
 *
 * 支持 reasoning_content（DeepSeek / KIMI 等模型的 thinking 字段）。
 */

import {
  LLMRequest, LLMResponse, LLMStreamChunk, Part,
  isTextPart, isVisibleTextPart, isInlineDataPart, isFunctionCallPart, isFunctionResponsePart,
} from '../../types';
import { FormatAdapter, StreamDecodeState } from './types';
import { consumeCallId, normalizeCallId, resolveCallId } from './tool-call-ids';
import { sanitizeSchemaForOpenAI } from './schema-sanitizer';

export class OpenAICompatibleFormat implements FormatAdapter {
  constructor(private model: string) {}

  // ============ 编码请求：Gemini → OpenAI ============

  encodeRequest(request: LLMRequest, stream?: boolean): unknown {
    const messages: Record<string, unknown>[] = [];

    // systemInstruction → system message
    if (request.systemInstruction?.parts) {
      const text = request.systemInstruction.parts
        .filter(isVisibleTextPart).map(p => p.text).join('\n');
      if (text) messages.push({ role: 'system', content: text });
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

        if (funcCallParts.length > 0) {
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
    if (request.tools && request.tools.length > 0) {
      const allDecls = request.tools.flatMap(t => t.functionDeclarations);
      body.tools = allDecls.map(decl => ({
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

    // reasoning_content → thought part（DeepSeek / KIMI 等模型的 thinking 输出）
    if (typeof msg.reasoning_content === 'string' && msg.reasoning_content) {
      parts.push({ text: msg.reasoning_content, thought: true });
    }

    if (typeof msg.content === 'string') {
      parts.push({ text: msg.content });
    } else if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (typeof block === 'string') parts.push({ text: block });
        else if (block?.type === 'text' && typeof block.text === 'string') parts.push({ text: block.text });
      }
    }
    if (msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        parts.push({
          functionCall: {
            name: tc.function.name,
            args: JSON.parse(tc.function.arguments),
            callId: normalizeCallId(tc.id),
          },
        });
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

    // reasoning_content 流式增量（DeepSeek / KIMI 等模型的 thinking 输出）
    if (choice?.delta?.reasoning_content) {
      chunk.partsDelta = [
        ...(chunk.partsDelta || []),
        { text: choice.delta.reasoning_content, thought: true } as any,
      ];
    }

    if (choice?.delta?.content) {
      chunk.textDelta = choice.delta.content;
      chunk.partsDelta = [
        ...(chunk.partsDelta || []),
        { text: choice.delta.content },
      ];
    }

    // 流式边执行优化：累积工具调用分片，并在检测到工具参数完整时立即输出。
    //
    // OpenAI 的 tool_call 分片按 index 顺序发送，没有"单个工具参数完成"的显式信号。
    // 但有一个规律：当 delta 中出现新的 tool_call index 时，说明前一个 index 的
    // 参数已经流完了。利用这个规律，在新 index 出现时立即输出前一个已完成的工具调用，
    // 让 StreamingToolExecutor 可以在 LLM 还在输出后续工具参数时提前启动执行。
    // finish_reason 到达时，最后一个工具也输出。
    const pending = state.pendingToolCalls as Map<number, { callId?: string; name: string; arguments: string; emitted?: boolean }>;
    const emitPendingToolCall = (
      entry: { callId?: string; name: string; arguments: string; emitted?: boolean },
      options?: { allowEmptyArgs?: boolean },
    ) => {
      if (entry.emitted || !entry.name) return;
      const rawArgs = entry.arguments ?? '';
      if (!rawArgs.trim() && !options?.allowEmptyArgs) {
        // OpenAI-compatible providers often send an initial tool_call delta with
        // function.name and arguments="", followed by later arguments fragments.
        // Treating empty arguments as {} here would prematurely emit the tool
        // call and drop subsequent argument deltas.
        return;
      }
      try {
        const args = rawArgs.trim() ? JSON.parse(rawArgs) : {};
        if (!args || typeof args !== 'object' || Array.isArray(args)) return;
        if (!chunk.functionCalls) chunk.functionCalls = [];
        chunk.functionCalls.push({
          functionCall: {
            name: entry.name,
            args,
            callId: entry.callId,
          },
        });
        chunk.partsDelta = [
          ...(chunk.partsDelta || []),
          chunk.functionCalls[chunk.functionCalls.length - 1],
        ];
        entry.emitted = true;
      } catch {
        // 参数 JSON 尚未完整，等待后续 delta 或 finish_reason。
      }
    };
    if (choice?.delta?.tool_calls) {
      for (const tc of choice.delta.tool_calls) {
        // 新 index 出现时，前面未输出的工具调用的参数一定已经完整，立即输出
        if (!pending.has(tc.index) && pending.size > 0) {
          for (const [, entry] of pending) {
            emitPendingToolCall(entry, { allowEmptyArgs: true });
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
        emitPendingToolCall(entry);
      }
    }
    // finish_reason 到达时，输出最后一个（及所有尚未输出的）工具调用
    if (choice?.finish_reason) {
      chunk.finishReason = choice.finish_reason;
      if (pending.size > 0) {
        for (const [, entry] of pending) {
          emitPendingToolCall(entry, { allowEmptyArgs: true });
        }
        pending.clear();
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
    };
  }
}
