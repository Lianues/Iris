/**
 * Claude/Anthropic 格式适配器
 *
 * Gemini ↔ Claude API 格式的完整双向转换。
 */

import {
  LLMRequest, LLMResponse, LLMStreamChunk, Part, FunctionCallPart,
  isTextPart, isVisibleTextPart, isInlineDataPart, isFunctionCallPart, isFunctionResponsePart,
} from '../../types';
import { FormatAdapter, StreamDecodeState } from './types';
import { consumeCallId, normalizeCallId, resolveCallId } from './tool-call-ids';
import { sanitizeSchemaForClaude } from './schema-sanitizer';

export class ClaudeFormat implements FormatAdapter {
  constructor(private model: string, private promptCaching?: boolean, private autoCaching?: boolean) {}

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
    const pendingToolUseIds: string[] = [];
    let generatedToolUseIdCounter = 0;

    for (const content of request.contents) {
      const textParts = content.parts.filter(isVisibleTextPart);
      const funcCallParts = content.parts.filter(isFunctionCallPart);
      const funcRespParts = content.parts.filter(isFunctionResponsePart);

      if (content.role === 'model') {
        const contentBlocks: Record<string, unknown>[] = [];

        // 思考部分 (Claude Thinking) — 必须在 text 之前
        const thoughtPart = content.parts.find(p => (p as any).thought && (p as any).thoughtSignatures?.claude);
        if (thoughtPart) {
          const sig = (thoughtPart as any).thoughtSignatures.claude;
          const thinkingText = (thoughtPart as any).text || '';
          contentBlocks.push({ type: 'thinking', thinking: thinkingText, signature: sig });
        }

        // 文本部分
        for (const part of textParts) {
          if (!isTextPart(part)) continue;
          if (part.text) contentBlocks.push({ type: 'text', text: part.text });
        }

        // 工具调用部分
        for (const part of funcCallParts) {
          if (!isFunctionCallPart(part)) continue;
          const toolUseId = resolveCallId(part.functionCall.callId, `toolu_${generatedToolUseIdCounter++}`);
          contentBlocks.push({
            type: 'tool_use',
            id: toolUseId,
            name: part.functionCall.name,
            input: part.functionCall.args,
          });
          pendingToolUseIds.push(toolUseId);
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
            const toolUseId = consumeCallId({
              explicit: part.functionResponse.callId,
              pendingCallIds: pendingToolUseIds,
              providerLabel: 'Claude',
              toolName: part.functionResponse.name,
            });
            contentBlocks.push({
              type: 'tool_result',
              tool_use_id: toolUseId,
              content: JSON.stringify(part.functionResponse.response),
            });
          }
          messages.push({ role: 'user', content: contentBlocks });
        } else {
          const contentBlocks: Record<string, unknown>[] = [];
          let hasInlineImage = false;

          for (const part of content.parts) {
            if (isTextPart(part) && part.thought !== true && part.text) {
              contentBlocks.push({ type: 'text', text: part.text });
            } else if (isInlineDataPart(part)) {
              hasInlineImage = true;
              const mime = part.inlineData.mimeType;
              if (mime === 'application/pdf') {
                contentBlocks.push({
                  type: 'document',
                  source: {
                    type: 'base64',
                    media_type: mime,
                    data: part.inlineData.data,
                  },
                });
              } else {
                contentBlocks.push({
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: mime,
                    data: part.inlineData.data,
                  },
                });
              }
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

    body.messages = messages;

    // tools 声明转换
    if (request.tools && request.tools.length > 0) {
      const allDecls = request.tools.flatMap(t => t.functionDeclarations);
      body.tools = allDecls.map(decl => ({
        name: decl.name,
        description: decl.description,
        input_schema: sanitizeSchemaForClaude(decl.parameters),
      }));
    }

    // generationConfig 转换（Claude 要求必填 max_tokens）
    const gc = request.generationConfig;
    body.max_tokens = gc?.maxOutputTokens ?? 16000;
    if (gc?.temperature !== undefined) body.temperature = gc.temperature;
    if (gc?.topP !== undefined) body.top_p = gc.topP;
    if (gc?.topK !== undefined) body.top_k = gc.topK;

    // 流式参数
    if (stream) body.stream = true;

    // 启用手动缓存断点时，注入 Prompt Caching 标记。
    // 遵循 Anthropic 的缓存前缀层级：tools → system → messages。
    // 最多 3 个断点（Anthropic 允许最多 4 个）。
    if (this.promptCaching) {
      this.injectCacheBreakpoints(body);
    }

    // 注入顶层自动缓存标记。
    // 服务端会自动将断点放置在最后一个可缓存的内容块上。
    if (this.autoCaching) {
      (body as any).cache_control = { type: 'ephemeral' };
    }

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
            functionCall: {
              name: block.name,
              args: block.input,
              callId: normalizeCallId(block.id),
            },
          });
        } else if (block.type === 'thinking') {
          // Claude thinking block: { type: "thinking", thinking: "思考文本", signature: "签名" }
          parts.push({
            text: block.thinking || '',
            thought: true,
            thoughtSignatures: { claude: block.signature },
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
        ? (() => {
            const inputBase = data.usage.input_tokens ?? 0;
            const cacheCreation = data.usage.cache_creation_input_tokens ?? 0;
            const cacheRead = data.usage.cache_read_input_tokens ?? 0;
            const promptTotal = inputBase + cacheCreation + cacheRead;
            const cachedTotal = cacheCreation + cacheRead;
            return {
              promptTokenCount: promptTotal,
              ...(cachedTotal > 0 ? { cachedContentTokenCount: cachedTotal } : {}),
              candidatesTokenCount: data.usage.output_tokens,
              totalTokenCount: promptTotal + (data.usage.output_tokens ?? 0),
            };
          })()
        : undefined,
    };
  }

  // ============ 流式解码 ============

  decodeStreamChunk(raw: unknown, state: StreamDecodeState): LLMStreamChunk {
    const data = raw as any;
    const chunk: LLMStreamChunk = {};
    const st = state as ClaudeStreamState;

    switch (data.type) {
      case 'message_start':
        // message_start 事件中包含 input_tokens
        if (data.message?.usage) {
          const u = data.message.usage;
          st.inputTokens = (u.input_tokens ?? 0)
            + (u.cache_creation_input_tokens ?? 0)
            + (u.cache_read_input_tokens ?? 0);
          st.cachedContentTokens = (u.cache_creation_input_tokens ?? 0)
            + (u.cache_read_input_tokens ?? 0);
        }
        break;

      case 'content_block_start':
        if (data.content_block?.type === 'tool_use') {
          st.currentToolUse = {
            id: data.content_block.id,
            name: data.content_block.name,
            arguments: '',
          };
        } else if (data.content_block?.type === 'thinking') {
          // 标记进入 thinking block
          st.inThinkingBlock = true;
        }
        break;

      case 'content_block_delta':
        if (data.delta?.type === 'text_delta') {
          chunk.textDelta = data.delta.text;
        } else if (data.delta?.type === 'thinking_delta') {
          // Claude thinking 流式文本：delta.thinking 包含可读的思考文本
          chunk.partsDelta = [{
            text: data.delta.thinking || '',
            thought: true,
          } as any];
        } else if (data.delta?.type === 'signature_delta') {
          // Claude thinking 签名：在 thinking block 结束前发送
          // 仅存签名，不含文本，用于多轮回传
          chunk.partsDelta = [{
            thought: true,
            thoughtSignatures: { claude: data.delta.signature },
          } as any];
          if (!chunk.thoughtSignatures) chunk.thoughtSignatures = {};
          chunk.thoughtSignatures.claude = data.delta.signature;
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
              callId: st.currentToolUse.id,
            },
          });
          st.currentToolUse = null;
        }
        if (st.inThinkingBlock) {
          st.inThinkingBlock = false;
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
            promptTokenCount: st.inputTokens ?? 0,
            ...(st.cachedContentTokens ? { cachedContentTokenCount: st.cachedContentTokens } : {}),
            candidatesTokenCount: data.usage.output_tokens,
            totalTokenCount: (st.inputTokens ?? 0) + (data.usage.output_tokens ?? 0),
          };
        }
        break;

      // ping 等事件忽略
    }

    return chunk;
  }

  createStreamState(): StreamDecodeState {
    return {
      currentToolUse: null,
      pendingFunctionCalls: [],
      inputTokens: 0,
      inThinkingBlock: false,
    } as ClaudeStreamState;
  }

  /**
   * 为 Anthropic Prompt Caching 注入手动缓存断点。
   *
   * 缓存前缀层级（顺序重要）：
   *   1. tools    — 标记最后一个工具定义
   *   2. system   — 将字符串转换为 content-block 数组，标记最后一个块
   *   3. messages — 标记最后一条用户消息的最后一个内容块
   */
  private injectCacheBreakpoints(body: Record<string, unknown>): void {
    const cacheControl = { type: 'ephemeral' as const };

    // 1. 标记最后一个工具定义
    const tools = body.tools as any[] | undefined;
    if (tools && tools.length > 0) {
      tools[tools.length - 1].cache_control = cacheControl;
    }

    // 2. 将 system 从字符串转换为 content-block 数组并标记。
    //    Anthropic 接受 system 为字符串或内容块数组；
    //    需要数组形式才能附加 cache_control。
    if (typeof body.system === 'string' && body.system) {
      body.system = [
        { type: 'text', text: body.system, cache_control: cacheControl },
      ];
    } else if (Array.isArray(body.system) && body.system.length > 0) {
      (body.system as any[])[body.system.length - 1].cache_control = cacheControl;
    }

    // 3. 标记最后一条用户消息的最后一个内容块。
    //    这会缓存整个对话历史前缀。
    const messages = body.messages as any[] | undefined;
    if (messages && messages.length > 0) {
      for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        if (msg.role === 'user' && Array.isArray(msg.content) && msg.content.length > 0) {
          const lastBlock = msg.content[msg.content.length - 1];
          if (typeof lastBlock === 'object' && lastBlock !== null) {
            lastBlock.cache_control = cacheControl;
          }
          break;
        }
      }
    }
  }
}

interface ClaudeStreamState extends StreamDecodeState {
  currentToolUse: { id: string; name: string; arguments: string } | null;
  pendingFunctionCalls: FunctionCallPart[];
  inputTokens: number;
  cachedContentTokens?: number;
  inThinkingBlock: boolean;
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
