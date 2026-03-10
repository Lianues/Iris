/**
 * OpenAI Compatible 格式适配器
 *
 * Gemini ↔ OpenAI 格式的完整双向转换。
 * 适用于所有 OpenAI 兼容接口（OpenAI、DeepSeek、本地模型等）。
 */

import {
  LLMRequest, LLMResponse, LLMStreamChunk, Part,
  isTextPart, isVisibleTextPart, isFunctionCallPart, isFunctionResponsePart,
} from '../../types';
import { FormatAdapter, StreamDecodeState } from './types';

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
    let pendingCallId = 0;
    for (const content of request.contents) {
      const textParts = content.parts.filter(isVisibleTextPart);
      const funcCallParts = content.parts.filter(isFunctionCallPart);
      const funcRespParts = content.parts.filter(isFunctionResponsePart);

      if (content.role === 'model') {
        if (funcCallParts.length > 0) {
          const toolCalls = funcCallParts.map((part, i) => {
            if (!isFunctionCallPart(part)) throw new Error('unreachable');
            return {
              id: `call_${pendingCallId + i}`,
              type: 'function' as const,
              function: {
                name: part.functionCall.name,
                arguments: JSON.stringify(part.functionCall.args),
              },
            };
          });
          const text = textParts.map(p => {
            if (!isTextPart(p)) throw new Error('unreachable');
            return p.text;
          }).join('') || null;
          messages.push({ role: 'assistant', content: text, tool_calls: toolCalls });
       } else {
          const text = textParts.map(p => {
            if (!isTextPart(p)) throw new Error('unreachable');
            return p.text;
          }).join('');
          messages.push({ role: 'assistant', content: text });
        }
      } else {
        if (funcRespParts.length > 0) {
          for (let i = 0; i < funcRespParts.length; i++) {
            const part = funcRespParts[i];
            if (!isFunctionResponsePart(part)) throw new Error('unreachable');
            messages.push({
              role: 'tool',
              tool_call_id: `call_${pendingCallId + i}`,
              content: JSON.stringify(part.functionResponse.response),
            });
          }
          pendingCallId += funcRespParts.length;
        } else {
          const text = textParts.map(p => {
            if (!isTextPart(p)) throw new Error('unreachable');
            return p.text;
          }).join('');
          messages.push({ role: 'user', content: text });
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
        function: { name: decl.name, description: decl.description, parameters: decl.parameters },
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

    if (msg.content) parts.push({ text: msg.content });
    if (msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        parts.push({
          functionCall: { name: tc.function.name, args: JSON.parse(tc.function.arguments) },
        });
      }
    }
    if (parts.length === 0) parts.push({ text: '' });

    return {
      content: { role: 'model', parts },
      finishReason: choice.finish_reason,
      usageMetadata: data.usage
        ? {
            promptTokenCount: data.usage.prompt_tokens,
            candidatesTokenCount: data.usage.completion_tokens,
            totalTokenCount: data.usage.total_tokens,
          }
        : undefined,
    };
  }

  // ============ 流式解码 ============

  decodeStreamChunk(raw: unknown, state: StreamDecodeState): LLMStreamChunk {
    const data = raw as any;
    const choice = data.choices?.[0];
    const chunk: LLMStreamChunk = {};

    if (choice?.delta?.content) {
      chunk.textDelta = choice.delta.content;
    }

    // 累积工具调用分片
    const pending = state.pendingToolCalls as Map<number, { name: string; arguments: string }>;
    if (choice?.delta?.tool_calls) {
      for (const tc of choice.delta.tool_calls) {
        if (!pending.has(tc.index)) {
          pending.set(tc.index, { name: '', arguments: '' });
        }
        const entry = pending.get(tc.index)!;
        if (tc.function?.name) entry.name = tc.function.name;
        if (tc.function?.arguments) entry.arguments += tc.function.arguments;
      }
    }

    // 结束时输出累积的工具调用
    if (choice?.finish_reason) {
      chunk.finishReason = choice.finish_reason;
      if (pending.size > 0) {
        chunk.functionCalls = Array.from(pending.values()).map(tc => ({
          functionCall: { name: tc.name, args: JSON.parse(tc.arguments) },
        }));
        pending.clear();
      }
    }

    // usage
    if (data.usage) {
      chunk.usageMetadata = {
        promptTokenCount: data.usage.prompt_tokens,
        candidatesTokenCount: data.usage.completion_tokens,
        totalTokenCount: data.usage.total_tokens,
      };
    }

    return chunk;
  }

  createStreamState(): StreamDecodeState {
    return {
      pendingToolCalls: new Map<number, { name: string; arguments: string }>(),
    };
  }
}
