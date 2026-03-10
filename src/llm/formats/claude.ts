/**
 * Claude/Anthropic 格式适配器
 *
 * Gemini ↔ Claude API 格式的完整双向转换。
 */

import {
  LLMRequest, LLMResponse, LLMStreamChunk, Part, FunctionCallPart,
  isTextPart, isVisibleTextPart, isFunctionCallPart, isFunctionResponsePart,
} from '../../types';
import { FormatAdapter, StreamDecodeState } from './types';

export class ClaudeFormat implements FormatAdapter {
  constructor(private model: string) {}

  // ============ 编码请求：Gemini → Claude ============

  encodeRequest(request: LLMRequest, stream?: boolean): unknown {
    const body: Record<string, unknown> = { model: this.model };

    // systemInstruction → system 字符串
    if (request.systemInstruction?.parts) {
      const text = request.systemInstruction.parts
        .filter(isVisibleTextPart).map(p => p.text).join('\n');
      if (text) body.system = text;
    }

    // contents → messages
    const messages: Record<string, unknown>[] = [];
    let toolUseIdCounter = 0;

    for (const content of request.contents) {
      const textParts = content.parts.filter(isVisibleTextPart);
      const funcCallParts = content.parts.filter(isFunctionCallPart);
      const funcRespParts = content.parts.filter(isFunctionResponsePart);

      if (content.role === 'model') {
        const contentBlocks: Record<string, unknown>[] = [];

        // 文本部分
        for (const part of textParts) {
          if (!isTextPart(part)) continue;
          if (part.text) contentBlocks.push({ type: 'text', text: part.text });
        }

        // 工具调用部分
        for (const part of funcCallParts) {
          if (!isFunctionCallPart(part)) continue;
          contentBlocks.push({
            type: 'tool_use',
            id: `toolu_${toolUseIdCounter++}`,
            name: part.functionCall.name,
            input: part.functionCall.args,
          });
        }

        if (contentBlocks.length > 0) {
          messages.push({ role: 'assistant', content: contentBlocks });
        }
      } else {
        // user role
        if (funcRespParts.length > 0) {
          const contentBlocks: Record<string, unknown>[] = [];
          for (const part of funcRespParts) {
            if (!isFunctionResponsePart(part)) continue;
            // tool_use_id 需要匹配之前 assistant 消息中的 tool_use id
            // 使用计数器回推：funcResp 总是紧跟在 funcCall 之后
            const toolUseId = `toolu_${toolUseIdCounter - funcRespParts.length + contentBlocks.length}`;
            contentBlocks.push({
              type: 'tool_result',
              tool_use_id: toolUseId,
              content: JSON.stringify(part.functionResponse.response),
            });
          }
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

    body.messages = messages;

    // tools 声明转换
    if (request.tools && request.tools.length > 0) {
      const allDecls = request.tools.flatMap(t => t.functionDeclarations);
      body.tools = allDecls.map(decl => ({
        name: decl.name,
        description: decl.description,
        input_schema: decl.parameters,
      }));
    }

    // generationConfig 转换（Claude 要求必填 max_tokens）
    const gc = request.generationConfig;
    body.max_tokens = gc?.maxOutputTokens ?? 4096;
    if (gc?.temperature !== undefined) body.temperature = gc.temperature;
    if (gc?.topP !== undefined) body.top_p = gc.topP;
    if (gc?.topK !== undefined) body.top_k = gc.topK;

    // 流式参数
    if (stream) body.stream = true;

    return body;
  }

  // ============ 解码响应：Claude → Gemini ============

  decodeResponse(raw: unknown): LLMResponse {
    const data = raw as any;
    const parts: Part[] = [];

    if (data.content) {
      for (const block of data.content) {
        if (block.type === 'text') {
          parts.push({ text: block.text });
        } else if (block.type === 'tool_use') {
          parts.push({
            functionCall: { name: block.name, args: block.input },
          });
        }
      }
    }
    if (parts.length === 0) parts.push({ text: '' });

    // stop_reason 映射
    const finishReason = mapStopReason(data.stop_reason);

    return {
      content: { role: 'model', parts },
      finishReason,
      usageMetadata: data.usage
        ? {
            promptTokenCount: data.usage.input_tokens,
            candidatesTokenCount: data.usage.output_tokens,
            totalTokenCount: (data.usage.input_tokens ?? 0) + (data.usage.output_tokens ?? 0),
          }
        : undefined,
    };
  }

  // ============ 流式解码 ============

  decodeStreamChunk(raw: unknown, state: StreamDecodeState): LLMStreamChunk {
    const data = raw as any;
    const chunk: LLMStreamChunk = {};
    const st = state as ClaudeStreamState;

    switch (data.type) {
      case 'content_block_start':
        if (data.content_block?.type === 'tool_use') {
          st.currentToolUse = {
            id: data.content_block.id,
            name: data.content_block.name,
            arguments: '',
          };
        }
        break;

      case 'content_block_delta':
        if (data.delta?.type === 'text_delta') {
          chunk.textDelta = data.delta.text;
        } else if (data.delta?.type === 'input_json_delta') {
          if (st.currentToolUse) {
            st.currentToolUse.arguments += data.delta.partial_json;
          }
        }
        break;

      case 'content_block_stop':
        if (st.currentToolUse) {
          st.pendingFunctionCalls.push({
            functionCall: {
              name: st.currentToolUse.name,
              args: st.currentToolUse.arguments
                ? JSON.parse(st.currentToolUse.arguments)
                : {},
            },
          });
          st.currentToolUse = null;
        }
        break;

      case 'message_delta':
        if (data.delta?.stop_reason) {
          chunk.finishReason = mapStopReason(data.delta.stop_reason);
          // 输出累积的工具调用
          if (st.pendingFunctionCalls.length > 0) {
            chunk.functionCalls = [...st.pendingFunctionCalls];
            st.pendingFunctionCalls = [];
          }
        }
        if (data.usage) {
          chunk.usageMetadata = {
            candidatesTokenCount: data.usage.output_tokens,
          };
        }
        break;

      // message_start, ping 等事件忽略
    }

    return chunk;
  }

  createStreamState(): StreamDecodeState {
    return {
      currentToolUse: null,
      pendingFunctionCalls: [],
    } as ClaudeStreamState;
  }
}

interface ClaudeStreamState extends StreamDecodeState {
  currentToolUse: { id: string; name: string; arguments: string } | null;
  pendingFunctionCalls: FunctionCallPart[];
}

function mapStopReason(reason: string | undefined): string {
  switch (reason) {
    case 'end_turn': return 'STOP';
    case 'tool_use': return 'TOOL_CALLS';
    case 'max_tokens': return 'MAX_TOKENS';
    case 'stop_sequence': return 'STOP';
    default: return reason ?? 'STOP';
  }
}
