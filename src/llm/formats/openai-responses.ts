/**
 * OpenAI Responses 格式适配器
 * 
 * 专门处理带思考过程（reasoning_content）的 OpenAI 格式模型。
 * 将思考正文映射到 Part { text: ..., thought: true }。
 */

import {
  LLMRequest, LLMResponse, LLMStreamChunk, Part,
  isVisibleTextPart, isFunctionCallPart, isFunctionResponsePart,
} from '../../types';
import { FormatAdapter, StreamDecodeState } from './types';
import { OpenAICompatibleFormat } from './openai-compatible';

export class OpenAIResponsesFormat extends OpenAICompatibleFormat {
  constructor(model: string) {
    super(model);
  }

  // ============ 编码请求：Gemini → OpenAI ============

  encodeRequest(request: LLMRequest, stream?: boolean): unknown {
    const messages: Record<string, unknown>[] = [];

    // systemInstruction
    if (request.systemInstruction?.parts) {
      const text = request.systemInstruction.parts
        .filter(isVisibleTextPart).map(p => p.text).join('\n');
      if (text) messages.push({ role: 'system', content: text });
    }

    // contents
    let pendingCallId = 0;
    for (const content of request.contents) {
      if (content.role === 'model') {
        const msg: Record<string, any> = { role: 'assistant' };
        
        // 分离思考内容和正文内容
        const thoughtParts = content.parts.filter(p => (p as any).thought === true);
        const textParts = content.parts.filter(isVisibleTextPart);
        const funcCallParts = content.parts.filter(isFunctionCallPart);
        
        const reasoning = thoughtParts.map(p => (p as any).text).join('');
        if (reasoning) msg.reasoning_content = reasoning;
        
        const text = textParts.map(p => (p as any).text).join('');
        if (text) msg.content = text;
        
        // 映射签名 (如果存在)
        const signaturePart = content.parts.find(p => (p as any).thoughtSignatures?.openai);
        if (signaturePart) {
          // 这里可以根据需要映射到特定的 OpenAI 扩展字段，目前标准 API 暂无
        }

        if (funcCallParts.length > 0) {
          msg.tool_calls = funcCallParts.map((part, i) => {
            if (!isFunctionCallPart(part)) throw new Error('unreachable');
            return {
              id: `call_${pendingCallId + i}`,
              type: 'function',
              function: {
                name: part.functionCall.name,
                arguments: JSON.stringify(part.functionCall.args),
              },
            };
          });
        }
        
        messages.push(msg);
      } else {
        // User role
        const funcRespParts = content.parts.filter(isFunctionResponsePart);
        if (funcRespParts.length > 0) {
          for (let i = 0; i < funcRespParts.length; i++) {
            const part = funcRespParts[i];
            if (!isFunctionResponsePart(part)) continue;
            messages.push({
              role: 'tool',
              tool_call_id: `call_${pendingCallId + i}`,
              content: JSON.stringify(part.functionResponse.response),
            });
          }
          pendingCallId += funcRespParts.length;
        } else {
          const text = content.parts.filter(p => 'text' in p).map(p => (p as any).text).join('');
          messages.push({ role: 'user', content: text });
        }
      }
    }

    const body: Record<string, any> = {
      model: (this as any).model,
      messages,
    };

    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools.flatMap(t => t.functionDeclarations).map(decl => ({
        type: 'function',
        function: { name: decl.name, description: decl.description, parameters: decl.parameters },
      }));
    }
    
    if (request.generationConfig) {
      const gc = request.generationConfig;
      if (gc.temperature !== undefined) body.temperature = gc.temperature;
      if (gc.topP !== undefined) body.top_p = gc.topP;
      if (gc.maxOutputTokens !== undefined) body.max_tokens = gc.maxOutputTokens;
    }

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
    if (!choice?.message) return super.decodeResponse(raw);

    const msg = choice.message;
    const parts: Part[] = [];

    // 1. 思考过程 -> 存入 Part.text (thought: true)
    const reasoning = msg.reasoning_content || msg.reasoning || msg.thinking;
    if (reasoning) {
      parts.push({
        text: reasoning,
        thought: true
      } as any);
    }

    // 2. 正文内容
    if (msg.content) {
      parts.push({ text: msg.content });
    }

    // 3. 工具调用
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
      usageMetadata: data.usage ? {
        promptTokenCount: data.usage.prompt_tokens,
        candidatesTokenCount: data.usage.completion_tokens,
        totalTokenCount: data.usage.total_tokens,
      } : undefined,
    };
  }

  // ============ 流式解码 ============

  decodeStreamChunk(raw: unknown, state: StreamDecodeState): LLMStreamChunk {
    const data = raw as any;
    const choice = data.choices?.[0];
    const chunk: LLMStreamChunk = {};

    if (!choice?.delta) return super.decodeStreamChunk(raw, state);

    const delta = choice.delta;
    const reasoning = delta.reasoning_content || delta.reasoning || delta.thinking;

    // 1. 处理思考正文 (DeepSeek / OpenAI o1 / o3)
    if (reasoning) {
      chunk.partsDelta = [{
        text: reasoning,
        thought: true
      } as any];
    }

    // 2. 处理普通正文
    if (delta.content) {
      chunk.textDelta = delta.content;
      if (!chunk.partsDelta) chunk.partsDelta = [];
      chunk.partsDelta.push({ text: delta.content });
    }

    const baseChunk = super.decodeStreamChunk(raw, state);
    if (baseChunk.finishReason) chunk.finishReason = baseChunk.finishReason;
    if (baseChunk.usageMetadata) chunk.usageMetadata = baseChunk.usageMetadata;
    if (baseChunk.functionCalls) chunk.functionCalls = baseChunk.functionCalls;

    return chunk;
  }
}
