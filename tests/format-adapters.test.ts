/**
 * Format Adapter 全面测试
 *
 * 覆盖所有四个 format adapter 的 encodeRequest / decodeResponse / stream 逻辑，
 * 重点验证各 API 的格式约束和边界情况。
 *
 * Gemini 重点：
 *   - thoughtSignatures.gemini ↔ thoughtSignature 双向映射
 *   - 多轮 thinking 中签名的完整保留
 *   - 没有签名的 thought part 不能丢掉 thought 标记
 *   - 内部字段过滤（durationMs / usageMetadata / modelName / thoughtDurationMs）
 *   - functionCall 场景
 *
 * Claude 重点：
 *   - tool_use 必须有 id
 *   - tool_use 后必须紧跟 tool_result（下一条 user 消息）
 *   - tool_result.tool_use_id 必须匹配 tool_use.id
 *   - tool_use 必须在 assistant 消息内容块末尾
 *   - thinking block 需要 signature
 *
 * OpenAI Compatible / Responses:
 *   - tool_call id 唯一与匹配
 *   - reasoning encrypted_content 回传
 *
 * 通用:
 *   - callId 传播与匹配
 *   - abort 清理后历史的编码安全性
 *   - 多轮工具调用的 ID 唯一性
 */

import { describe, it, expect } from 'vitest';
import { ClaudeFormat } from '../src/llm/formats/claude.js';
import { GeminiFormat } from '../src/llm/formats/gemini.js';
import { OpenAICompatibleFormat } from '../src/llm/formats/openai-compatible.js';
import { OpenAIResponsesFormat } from '../src/llm/formats/openai-responses.js';
import { normalizeCallId, resolveCallId, consumeCallId } from '../src/llm/formats/tool-call-ids.js';
import type { LLMRequest, Content, Part, FunctionCallPart } from '../src/types/index.js';

// ============ 辅助工具 ============

function userMsg(text: string): Content {
  return { role: 'user', parts: [{ text }] };
}

function modelTextMsg(text: string): Content {
  return { role: 'model', parts: [{ text }] };
}

function modelThoughtMsg(thought: string, sig?: { claude?: string; gemini?: string; openai?: string }): Content {
  return {
    role: 'model',
    parts: [{ text: thought, thought: true, thoughtSignatures: sig }],
  };
}

function modelToolCallMsg(calls: Array<{ name: string; args?: Record<string, unknown>; callId?: string }>): Content {
  return {
    role: 'model',
    parts: calls.map(c => ({
      functionCall: { name: c.name, args: c.args ?? {}, callId: c.callId },
    })),
  };
}

function modelMixedMsg(opts: {
  thought?: { text: string; sig?: { claude?: string; gemini?: string } };
  text?: string;
  toolCalls?: Array<{ name: string; args?: Record<string, unknown>; callId?: string }>;
}): Content {
  const parts: Part[] = [];
  if (opts.thought) {
    parts.push({ text: opts.thought.text, thought: true, thoughtSignatures: opts.thought.sig });
  }
  if (opts.text) {
    parts.push({ text: opts.text });
  }
  if (opts.toolCalls) {
    for (const c of opts.toolCalls) {
      parts.push({ functionCall: { name: c.name, args: c.args ?? {}, callId: c.callId } });
    }
  }
  return { role: 'model', parts };
}

function toolResponseMsg(responses: Array<{ name: string; result: unknown; callId?: string }>): Content {
  return {
    role: 'user',
    parts: responses.map(r => ({
      functionResponse: {
        name: r.name,
        response: typeof r.result === 'object' && r.result !== null
          ? r.result as Record<string, unknown>
          : { result: r.result },
        callId: r.callId,
      },
    })),
  };
}

function simpleToolDecls(): LLMRequest['tools'] {
  return [{
    functionDeclarations: [
      {
        name: 'get_weather',
        description: 'Get weather',
        parameters: {
          type: 'object',
          properties: { city: { type: 'string', description: 'city' } },
          required: ['city'],
        },
      },
      {
        name: 'read_file',
        description: 'Read file',
        parameters: {
          type: 'object',
          properties: { path: { type: 'string', description: 'file path' } },
          required: ['path'],
        },
      },
    ],
  }];
}


function buildRequest(contents: Content[], withTools = true): LLMRequest {
  return {
    contents,
    systemInstruction: { parts: [{ text: 'You are a helpful assistant.' }] },
    tools: withTools ? simpleToolDecls() : undefined,
    generationConfig: { maxOutputTokens: 4096, temperature: 0.7 },
  };
}

// ============================================================
//  Gemini Format — 重点测试签名完整性
// ============================================================

describe('GeminiFormat: encodeRequest', () => {
  const fmt = new GeminiFormat();

  it('过滤内部字段 durationMs / usageMetadata / modelName / streamOutputDurationMs', () => {
    const req: LLMRequest = {
      contents: [{
        role: 'user',
        parts: [{ text: 'hi' }],
        usageMetadata: { promptTokenCount: 10 },
        durationMs: 123,
        streamOutputDurationMs: 456,
        modelName: 'gemini-2.5-flash',
      } as any],
    };
    const body = fmt.encodeRequest(req) as any;
    const content = body.contents[0];
    expect(content.usageMetadata).toBeUndefined();
    expect(content.durationMs).toBeUndefined();
    expect(content.streamOutputDurationMs).toBeUndefined();
    expect(content.modelName).toBeUndefined();
  });

  it('过滤 thoughtDurationMs', () => {
    const req: LLMRequest = {
      contents: [{
        role: 'model',
        parts: [{ text: 'thinking', thought: true, thoughtDurationMs: 500 }],
      }],
    };
    const body = fmt.encodeRequest(req) as any;
    expect(body.contents[0].parts[0].thoughtDurationMs).toBeUndefined();
  });

  it('thoughtSignatures.gemini → thoughtSignature 映射', () => {
    const req: LLMRequest = {
      contents: [{
        role: 'model',
        parts: [{ text: 'thinking', thought: true, thoughtSignatures: { gemini: 'sig_gem_001' } }],
      }],
    };
    const body = fmt.encodeRequest(req) as any;
    const part = body.contents[0].parts[0];
    expect(part.thoughtSignature).toBe('sig_gem_001');
    expect(part.thoughtSignatures).toBeUndefined();
  });

  it('多轮 thinking：每个 thought part 的签名都被正确映射', () => {
    const req: LLMRequest = {
      contents: [
        userMsg('q1'),
        // 第一轮：thinking + answer
        {
          role: 'model',
          parts: [
            { text: 'thought round 1', thought: true, thoughtSignatures: { gemini: 'sig_r1' } },
            { text: 'answer 1' },
          ],
        },
        userMsg('q2'),
        // 第二轮：thinking + answer
        {
          role: 'model',
          parts: [
            { text: 'thought round 2', thought: true, thoughtSignatures: { gemini: 'sig_r2' } },
            { text: 'answer 2' },
          ],
        },
      ],
    };
    const body = fmt.encodeRequest(req) as any;

    // 第一轮 model 消息
    const r1ThoughtPart = body.contents[1].parts[0];
    expect(r1ThoughtPart.thought).toBe(true);
    expect(r1ThoughtPart.thoughtSignature).toBe('sig_r1');
    expect(r1ThoughtPart.thoughtSignatures).toBeUndefined();

    // 第二轮 model 消息
    const r2ThoughtPart = body.contents[3].parts[0];
    expect(r2ThoughtPart.thought).toBe(true);
    expect(r2ThoughtPart.thoughtSignature).toBe('sig_r2');
    expect(r2ThoughtPart.thoughtSignatures).toBeUndefined();
  });

  it('多轮 thinking + 工具调用：签名穿插在工具调用之间时仍被保留', () => {
    const req: LLMRequest = {
      contents: [
        userMsg('start'),
        // thinking → tool call
        {
          role: 'model',
          parts: [
            { text: 'think before tool', thought: true, thoughtSignatures: { gemini: 'sig_pre_tool' } },
            { functionCall: { name: 'get_weather', args: { city: 'X' } } },
          ],
        },
        // tool response
        toolResponseMsg([{ name: 'get_weather', result: { temp: 20 } }]),
        // thinking → final answer
        {
          role: 'model',
          parts: [
            { text: 'think after tool', thought: true, thoughtSignatures: { gemini: 'sig_post_tool' } },
            { text: 'final answer' },
          ],
        },
      ],
    };
    const body = fmt.encodeRequest(req) as any;

    // 第一个 model 消息中的 thinking
    const preToolThought = body.contents[1].parts[0];
    expect(preToolThought.thought).toBe(true);
    expect(preToolThought.thoughtSignature).toBe('sig_pre_tool');

    // 第二个 model 消息中的 thinking
    const postToolThought = body.contents[3].parts[0];
    expect(postToolThought.thought).toBe(true);
    expect(postToolThought.thoughtSignature).toBe('sig_post_tool');
  });

  it('无签名的 thought part：保留 thought=true 标记，不添加 thoughtSignature', () => {
    const req: LLMRequest = {
      contents: [{
        role: 'model',
        parts: [{ text: 'just thinking', thought: true }],
      }],
    };
    const body = fmt.encodeRequest(req) as any;
    const part = body.contents[0].parts[0];
    expect(part.thought).toBe(true);
    expect(part.text).toBe('just thinking');
    expect(part.thoughtSignature).toBeUndefined();
  });

  it('非 Gemini 的签名不被映射到 thoughtSignature', () => {
    // 有 Claude 签名但无 Gemini 签名
    const req: LLMRequest = {
      contents: [{
        role: 'model',
        parts: [{ text: 'thinking', thought: true, thoughtSignatures: { claude: 'sig_claude_only' } }],
      }],
    };
    const body = fmt.encodeRequest(req) as any;
    const part = body.contents[0].parts[0];
    expect(part.thoughtSignature).toBeUndefined();
    expect(part.thoughtSignatures).toBeUndefined();
  });

  it('functionCall part 直通', () => {
    const req: LLMRequest = {
      contents: [
        userMsg('test'),
        { role: 'model', parts: [{ functionCall: { name: 'get_weather', args: { city: 'X' } } }] },
      ],
    };
    const body = fmt.encodeRequest(req) as any;
    const part = body.contents[1].parts[0];
    expect(part.functionCall).toBeDefined();
    expect(part.functionCall.name).toBe('get_weather');
  });
});

describe('GeminiFormat: decodeResponse', () => {
  const fmt = new GeminiFormat();

  it('解码标准响应', () => {
    const raw = {
      candidates: [{ content: { role: 'model', parts: [{ text: 'hi' }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
    };
    const resp = fmt.decodeResponse(raw);
    expect((resp.content.parts[0] as any).text).toBe('hi');
    expect(resp.finishReason).toBe('STOP');
  });

  it('解码 thoughtSignature → thoughtSignatures.gemini', () => {
    const raw = {
      candidates: [{
        content: {
          role: 'model',
          parts: [{ text: 'think', thought: true, thoughtSignature: 'sig_gem_dec' }],
        },
        finishReason: 'STOP',
      }],
    };
    const resp = fmt.decodeResponse(raw);
    const part = resp.content.parts[0] as any;
    expect(part.thoughtSignatures?.gemini).toBe('sig_gem_dec');
    expect(part.thoughtSignature).toBeUndefined();
  });

  it('解码多个 content blocks 含签名', () => {
    const raw = {
      candidates: [{
        content: {
          role: 'model',
          parts: [
            { text: 'thought text', thought: true, thoughtSignature: 'sig_multi' },
            { text: 'visible text' },
          ],
        },
        finishReason: 'STOP',
      }],
    };
    const resp = fmt.decodeResponse(raw);
    expect((resp.content.parts[0] as any).thoughtSignatures?.gemini).toBe('sig_multi');
    expect((resp.content.parts[0] as any).thoughtSignature).toBeUndefined();
    expect((resp.content.parts[1] as any).text).toBe('visible text');
  });

  it('无有效 candidates 时抛错', () => {
    expect(() => fmt.decodeResponse({ candidates: [] })).toThrow();
    expect(() => fmt.decodeResponse({})).toThrow();
  });
});

describe('GeminiFormat: stream decode', () => {
  const fmt = new GeminiFormat();

  it('流式 thoughtSignature → thoughtSignatures.gemini 映射', () => {
    const state = fmt.createStreamState();
    const chunk = fmt.decodeStreamChunk({
      candidates: [{
        content: {
          parts: [{ text: 'thinking...', thought: true, thoughtSignature: 'sig_stream_gem' }],
        },
      }],
    }, state);

    expect(chunk.partsDelta).toHaveLength(1);
    const part = chunk.partsDelta![0] as any;
    expect(part.thought).toBe(true);
    expect(part.thoughtSignatures?.gemini).toBe('sig_stream_gem');
    expect(part.thoughtSignature).toBeUndefined();
    expect(chunk.thoughtSignatures?.gemini).toBe('sig_stream_gem');
  });

  it('流式纯文本不产生 thoughtSignatures', () => {
    const state = fmt.createStreamState();
    const chunk = fmt.decodeStreamChunk({
      candidates: [{ content: { parts: [{ text: 'hello' }] } }],
    }, state);

    expect(chunk.textDelta).toBe('hello');
    expect(chunk.thoughtSignatures).toBeUndefined();
  });

  it('流式 functionCall', () => {
    const state = fmt.createStreamState();
    const chunk = fmt.decodeStreamChunk({
      candidates: [{
        content: {
          parts: [{ functionCall: { name: 'get_weather', args: { city: 'X' } } }],
        },
      }],
    }, state);

    expect(chunk.functionCalls).toHaveLength(1);
    expect(chunk.functionCalls![0].functionCall.name).toBe('get_weather');
  });
});

// ============================================================
//  Gemini Format — functionCall/functionResponse id 映射测试
//  Gemini 3 模型要求：
//    - functionCall 返回 id 字段，需提取为内部 callId
//    - functionResponse 发送时需携带匹配的 id 字段
//    - callId 是内部字段，不能原样发送给 Gemini API
// ============================================================

describe('GeminiFormat: functionCall/functionResponse id mapping', () => {
  const fmt = new GeminiFormat();

  it('encodeRequest: functionCall.callId 映射为 functionCall.id', () => {
    const req: LLMRequest = {
      contents: [
        userMsg('test'),
        modelToolCallMsg([{ name: 'list_files', args: { paths: ['.'] }, callId: 'abc123' }]),
        toolResponseMsg([{ name: 'list_files', result: { ok: true }, callId: 'abc123' }]),
      ],
    };
    const body = fmt.encodeRequest(req) as any;

    // functionCall 部分：callId → id
    const fcPart = body.contents[1].parts[0];
    expect(fcPart.functionCall.id).toBe('abc123');
    expect(fcPart.functionCall.callId).toBeUndefined();

    // functionResponse 部分：callId → id
    const frPart = body.contents[2].parts[0];
    expect(frPart.functionResponse.id).toBe('abc123');
    expect(frPart.functionResponse.callId).toBeUndefined();
  });

  it('encodeRequest: 无 callId 时不添加 id 字段', () => {
    const req: LLMRequest = {
      contents: [
        userMsg('test'),
        modelToolCallMsg([{ name: 'list_files', args: { paths: ['.'] } }]),
        toolResponseMsg([{ name: 'list_files', result: { ok: true } }]),
      ],
    };
    const body = fmt.encodeRequest(req) as any;

    const fcPart = body.contents[1].parts[0];
    expect(fcPart.functionCall.id).toBeUndefined();
    expect(fcPart.functionCall.callId).toBeUndefined();

    const frPart = body.contents[2].parts[0];
    expect(frPart.functionResponse.id).toBeUndefined();
    expect(frPart.functionResponse.callId).toBeUndefined();
  });

  it('encodeRequest: 多个并行工具调用的 id 都正确映射', () => {
    const req: LLMRequest = {
      contents: [
        userMsg('test'),
        modelToolCallMsg([
          { name: 'get_weather', args: { city: 'A' }, callId: 'id_1' },
          { name: 'read_file', args: { path: '/x' }, callId: 'id_2' },
        ]),
        toolResponseMsg([
          { name: 'get_weather', result: 'ok', callId: 'id_1' },
          { name: 'read_file', result: 'ok', callId: 'id_2' },
        ]),
      ],
    };
    const body = fmt.encodeRequest(req) as any;

    // functionCall 部分
    expect(body.contents[1].parts[0].functionCall.id).toBe('id_1');
    expect(body.contents[1].parts[1].functionCall.id).toBe('id_2');
    expect(body.contents[1].parts[0].functionCall.callId).toBeUndefined();

    // functionResponse 部分
    expect(body.contents[2].parts[0].functionResponse.id).toBe('id_1');
    expect(body.contents[2].parts[1].functionResponse.id).toBe('id_2');
    expect(body.contents[2].parts[0].functionResponse.callId).toBeUndefined();
  });

  it('encodeRequest: durationMs 被过滤', () => {
    const req: LLMRequest = {
      contents: [
        userMsg('test'),
        modelToolCallMsg([{ name: 'list_files', args: {}, callId: 'x' }]),
        {
          role: 'user',
          parts: [{
            functionResponse: {
              name: 'list_files',
              response: { result: 'ok' },
              callId: 'x',
              durationMs: 500,
            },
          }],
        },
      ],
    };
    const body = fmt.encodeRequest(req) as any;
    const frPart = body.contents[2].parts[0];
    expect(frPart.functionResponse.durationMs).toBeUndefined();
    expect(frPart.functionResponse.id).toBe('x');
  });

  it('decodeResponse: Gemini 返回的 functionCall.id 提取为 callId', () => {
    const raw = {
      candidates: [{
        content: {
          role: 'model',
          parts: [{
            functionCall: { name: 'list_files', args: { paths: ['.'] }, id: '9uyyp2b0' },
            thoughtSignature: 'sig_test',
          }],
        },
        finishReason: 'STOP',
      }],
    };
    const resp = fmt.decodeResponse(raw);
    const fc = resp.content.parts[0] as FunctionCallPart;
    expect(fc.functionCall.callId).toBe('9uyyp2b0');
    // id 被提取后不应该残留（避免 encode 时重复）
    expect((fc.functionCall as any).id).toBeUndefined();
  });

  it('decodeStreamChunk: 流式 functionCall.id 提取为 callId', () => {
    const state = fmt.createStreamState();
    const chunk = fmt.decodeStreamChunk({
      candidates: [{
        content: {
          parts: [{
            functionCall: { name: 'get_weather', args: { city: 'X' }, id: 'stream_id_1' },
          }],
        },
      }],
    }, state);
    expect(chunk.functionCalls).toHaveLength(1);
    expect(chunk.functionCalls![0].functionCall.callId).toBe('stream_id_1');
    expect((chunk.functionCalls![0].functionCall as any).id).toBeUndefined();
  });

  it('decodeStreamChunk: 过滤 functionCall 后的空 text part', () => {
    const state = fmt.createStreamState();
    // Gemini 3 流式响应：functionCall 后跟一个 {"text":""} 空 part
    const chunk = fmt.decodeStreamChunk({
      candidates: [{
        content: {
          parts: [
            { functionCall: { name: 'list_files', args: { paths: ['.'] }, id: 'fc1' }, thoughtSignature: 'sig' },
            { text: '' },  // 空 part，应被过滤
          ],
        },
      }],
    }, state);
    // partsDelta 中不应该出现空 text part
    const textParts = (chunk.partsDelta || []).filter((p: any) => 'text' in p && !('functionCall' in p));
    for (const tp of textParts) {
      // 如果有 text part，它要么有实际文本，要么有签名
      expect((tp as any).text || (tp as any).thoughtSignatures).toBeTruthy();
    }
  });


  it('encodeRequest: 过滤 functionCall 后面的空 text part', () => {
    // Gemini 3 流式响应中，functionCall 后经常跟一个 {text:""} 空 part，
    // 回传时会导致 Gemini API 报 INTERNAL 错误
    const req: LLMRequest = {
      contents: [
        userMsg('test'),
        {
          role: 'model',
          parts: [
            { functionCall: { name: 'list_files', args: { paths: ['.'] }, callId: 'abc' } },
            { text: '' },  // 空 text part，应被过滤
          ],
        },
        toolResponseMsg([{ name: 'list_files', result: { ok: true }, callId: 'abc' }]),
      ],
    };
    const body = fmt.encodeRequest(req) as any;
    // model 消息应该只剩 1 个 part（functionCall），空 text 被过滤
    expect(body.contents[1].parts).toHaveLength(1);
    expect(body.contents[1].parts[0].functionCall).toBeDefined();
  });

  it('encodeRequest: 不过滤带 thoughtSignature 的空 text part', () => {
    const req: LLMRequest = {
      contents: [
        userMsg('test'),
        {
          role: 'model',
          parts: [
            { functionCall: { name: 'list_files', args: {}, callId: 'abc' } },
            { text: '', thoughtSignatures: { gemini: 'sig_123' } } as any,  // 带签名，应保留
          ],
        },
        toolResponseMsg([{ name: 'list_files', result: 'ok', callId: 'abc' }]),
      ],
    };
    const body = fmt.encodeRequest(req) as any;
    // 签名 part 应该保留（mapSignaturesToProvider 会把 thoughtSignatures 转为 thoughtSignature）
    expect(body.contents[1].parts).toHaveLength(2);
  });

  it('encodeRequest: 不过滤唯一的空 text part（parts.length === 1）', () => {
    const req: LLMRequest = {
      contents: [
        { role: 'model', parts: [{ text: '' }] },
      ],
    };
    const body = fmt.encodeRequest(req) as any;
    // 唯一的 part 不能被过滤掉
    expect(body.contents[0].parts).toHaveLength(1);
  });

});

// ============================================================
//  Claude Format
// ============================================================

describe('ClaudeFormat: encodeRequest', () => {
  const fmt = new ClaudeFormat('claude-sonnet-4-20250514');

  it('纯文本对话：基本编码正确', () => {
    const req = buildRequest([userMsg('hello'), modelTextMsg('hi'), userMsg('bye')]);
    const body = fmt.encodeRequest(req) as any;
    expect(body.model).toBe('claude-sonnet-4-20250514');
    expect(body.system).toBe('You are a helpful assistant.');
    expect(body.messages).toHaveLength(3);
    expect(body.messages[0].content).toBe('hello');
    expect(body.max_tokens).toBe(4096);
  });

  it('tool_use 块必须有 id 字段', () => {
    const req = buildRequest([
      userMsg('weather?'),
      modelToolCallMsg([{ name: 'get_weather', args: { city: 'Tokyo' } }]),
      toolResponseMsg([{ name: 'get_weather', result: { temp: 25 } }]),
      modelTextMsg('Tokyo is 25°C'),
    ]);
    const body = fmt.encodeRequest(req) as any;
    const toolUseBlock = body.messages[1].content.find((b: any) => b.type === 'tool_use');
    expect(toolUseBlock).toBeDefined();
    expect(typeof toolUseBlock.id).toBe('string');
    expect(toolUseBlock.id.length).toBeGreaterThan(0);
  });

  it('tool_result 的 tool_use_id 必须匹配 tool_use.id', () => {
    const req = buildRequest([
      userMsg('weather?'),
      modelToolCallMsg([{ name: 'get_weather', args: { city: 'Tokyo' }, callId: 'toolu_abc123' }]),
      toolResponseMsg([{ name: 'get_weather', result: { temp: 25 }, callId: 'toolu_abc123' }]),
    ]);
    const body = fmt.encodeRequest(req) as any;
    const toolUseBlock = body.messages[1].content.find((b: any) => b.type === 'tool_use');
    const toolResultBlock = body.messages[2].content.find((b: any) => b.type === 'tool_result');
    expect(toolUseBlock.id).toBe('toolu_abc123');
    expect(toolResultBlock.tool_use_id).toBe('toolu_abc123');
  });

  it('无 callId 时生成的 fallback id 也必须配对', () => {
    const req = buildRequest([
      userMsg('weather?'),
      modelToolCallMsg([{ name: 'get_weather', args: { city: 'Tokyo' } }]),
      toolResponseMsg([{ name: 'get_weather', result: { temp: 25 } }]),
    ]);
    const body = fmt.encodeRequest(req) as any;
    const toolUseBlock = body.messages[1].content.find((b: any) => b.type === 'tool_use');
    const toolResultBlock = body.messages[2].content.find((b: any) => b.type === 'tool_result');
    expect(toolUseBlock.id).toBe(toolResultBlock.tool_use_id);
  });

  it('多个并行工具调用：每个 tool_use 有唯一 id，每个 tool_result 匹配', () => {
    const req = buildRequest([
      userMsg('weather and file'),
      modelToolCallMsg([
        { name: 'get_weather', args: { city: 'Tokyo' }, callId: 'toolu_001' },
        { name: 'read_file', args: { path: '/a.txt' }, callId: 'toolu_002' },
      ]),
      toolResponseMsg([
        { name: 'get_weather', result: { temp: 25 }, callId: 'toolu_001' },
        { name: 'read_file', result: { content: 'hello' }, callId: 'toolu_002' },
      ]),
    ]);
    const body = fmt.encodeRequest(req) as any;
    const toolUses = body.messages[1].content.filter((b: any) => b.type === 'tool_use');
    const toolResults = body.messages[2].content;
    expect(toolUses[0].id).toBe('toolu_001');
    expect(toolUses[1].id).toBe('toolu_002');
    expect(toolResults[0].tool_use_id).toBe('toolu_001');
    expect(toolResults[1].tool_use_id).toBe('toolu_002');
  });

  it('tool_use 块必须在 assistant 消息内容的末尾（text 不能在 tool_use 之后）', () => {
    const req = buildRequest([
      userMsg('help'),
      modelMixedMsg({
        thought: { text: 'thinking...', sig: { claude: 'sig_abc' } },
        text: 'I will look this up',
        toolCalls: [{ name: 'get_weather', args: { city: 'NY' }, callId: 'toolu_mixed' }],
      }),
      toolResponseMsg([{ name: 'get_weather', result: { temp: 20 }, callId: 'toolu_mixed' }]),
    ]);
    const body = fmt.encodeRequest(req) as any;
    const assistantContent = body.messages[1].content as any[];
    const firstToolUseIdx = assistantContent.findIndex((b: any) => b.type === 'tool_use');
    expect(firstToolUseIdx).toBeGreaterThanOrEqual(0);

    for (let i = firstToolUseIdx + 1; i < assistantContent.length; i++) {
      expect(assistantContent[i].type).not.toBe('text');
      expect(assistantContent[i].type).not.toBe('thinking');
    }
  });

  it('thinking block 的 signature 字段被正确传递', () => {
    const req = buildRequest([
      userMsg('think'),
      modelThoughtMsg('deep thought', { claude: 'sig_xyz_123' }),
      modelTextMsg('my conclusion'),
    ], false);
    const body = fmt.encodeRequest(req) as any;
    const thinkingBlock = body.messages[1].content.find((b: any) => b.type === 'thinking');
    expect(thinkingBlock).toBeDefined();
    expect(thinkingBlock.thinking).toBe('deep thought');
    expect(thinkingBlock.signature).toBe('sig_xyz_123');
  });

  it('thinking block 不带 Claude 签名时不输出 thinking block', () => {
    const req = buildRequest([
      userMsg('think'),
      modelThoughtMsg('deep thought'),  // 无签名
      modelTextMsg('visible answer'),
    ], false);
    const body = fmt.encodeRequest(req) as any;
    // 无签名的 thought → 不产生 thinking block → contentBlocks 为空 → 跳过
    // 第一条 assistant 应该是 visible answer
    const assistantContent = body.messages[1].content as any[];
    const thinkingBlock = assistantContent.find((b: any) => b.type === 'thinking');
    expect(thinkingBlock).toBeUndefined();
  });

  it('多轮工具调用：每对 tool_use/tool_result 的 ID 都匹配', () => {
    const req = buildRequest([
      userMsg('multi'),
      modelToolCallMsg([{ name: 'get_weather', args: { city: 'A' }, callId: 'toolu_r1' }]),
      toolResponseMsg([{ name: 'get_weather', result: { temp: 10 }, callId: 'toolu_r1' }]),
      modelToolCallMsg([{ name: 'read_file', args: { path: '/b' }, callId: 'toolu_r2' }]),
      toolResponseMsg([{ name: 'read_file', result: { content: 'data' }, callId: 'toolu_r2' }]),
      modelTextMsg('done'),
    ]);
    const body = fmt.encodeRequest(req) as any;
    expect(body.messages[1].content[0].id).toBe('toolu_r1');
    expect(body.messages[2].content[0].tool_use_id).toBe('toolu_r1');
    expect(body.messages[3].content[0].id).toBe('toolu_r2');
    expect(body.messages[4].content[0].tool_use_id).toBe('toolu_r2');
  });

  it('无 callId 多轮：fallback ID 跨轮次不冲突', () => {
    const req = buildRequest([
      userMsg('multi'),
      modelToolCallMsg([{ name: 'get_weather', args: { city: 'A' } }]),
      toolResponseMsg([{ name: 'get_weather', result: { temp: 10 } }]),
      modelToolCallMsg([{ name: 'read_file', args: { path: '/b' } }]),
      toolResponseMsg([{ name: 'read_file', result: { content: 'data' } }]),
    ]);
    const body = fmt.encodeRequest(req) as any;
    const round1Id = body.messages[1].content[0].id;
    const round2Id = body.messages[3].content[0].id;
    expect(round1Id).not.toBe(round2Id);
    expect(body.messages[2].content[0].tool_use_id).toBe(round1Id);
    expect(body.messages[4].content[0].tool_use_id).toBe(round2Id);
  });

  it('abort 清理后的历史编码安全：tool_call + tool_response 完整对', () => {
    const history: Content[] = [
      userMsg('hello'),
      modelToolCallMsg([{ name: 'get_weather', args: { city: 'X' }, callId: 'toolu_abort1' }]),
      toolResponseMsg([{ name: 'get_weather', result: { temp: 15 }, callId: 'toolu_abort1' }]),
    ];
    const req = buildRequest(history);
    const body = fmt.encodeRequest(req) as any;
    expect(body.messages).toHaveLength(3);
    const toolUse = body.messages[1].content.find((b: any) => b.type === 'tool_use');
    const toolResult = body.messages[2].content.find((b: any) => b.type === 'tool_result');
    expect(toolUse.id).toBe(toolResult.tool_use_id);
  });

  it('空 contents 编码不崩溃', () => {
    const req = buildRequest([]);
    const body = fmt.encodeRequest(req) as any;
    expect(Array.isArray(body.messages)).toBe(true);
  });

  it('tool_use 的 input 字段是对象而非字符串', () => {
    const req = buildRequest([
      userMsg('test'),
      modelToolCallMsg([{ name: 'get_weather', args: { city: 'Paris', unit: 'celsius' }, callId: 'toolu_inp' }]),
      toolResponseMsg([{ name: 'get_weather', result: 'ok', callId: 'toolu_inp' }]),
    ]);
    const body = fmt.encodeRequest(req) as any;
    const toolUse = body.messages[1].content.find((b: any) => b.type === 'tool_use');
    expect(typeof toolUse.input).toBe('object');
  });

  it('tool_result 的 content 字段是字符串', () => {
    const req = buildRequest([
      userMsg('test'),
      modelToolCallMsg([{ name: 'get_weather', args: {}, callId: 'toolu_str' }]),
      toolResponseMsg([{ name: 'get_weather', result: { temp: 20 }, callId: 'toolu_str' }]),
    ]);
    const body = fmt.encodeRequest(req) as any;
    const toolResult = body.messages[2].content.find((b: any) => b.type === 'tool_result');
    expect(typeof toolResult.content).toBe('string');
    expect(() => JSON.parse(toolResult.content)).not.toThrow();
  });

  it('max_tokens 必须存在（Claude 强制要求）', () => {
    const req: LLMRequest = { contents: [userMsg('hi')] };
    const body = fmt.encodeRequest(req) as any;
    expect(body.max_tokens).toBeGreaterThan(0);
  });

  it('stream=true 时设置 stream 字段', () => {
    const req = buildRequest([userMsg('hi')], false);
    const body = fmt.encodeRequest(req, true) as any;
    expect(body.stream).toBe(true);
  });

  it('tools 声明转换格式正确（name + description + input_schema）', () => {
    const req = buildRequest([userMsg('hi')]);
    const body = fmt.encodeRequest(req) as any;
    expect(Array.isArray(body.tools)).toBe(true);
    for (const tool of body.tools) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.input_schema).toBeDefined();
    }
  });
});

describe('ClaudeFormat: decodeResponse', () => {
  const fmt = new ClaudeFormat('claude-sonnet-4-20250514');

  it('解码纯文本响应', () => {
    const raw = {
      content: [{ type: 'text', text: 'hello world' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 10, output_tokens: 5 },
    };
    const resp = fmt.decodeResponse(raw);
    expect(resp.content.role).toBe('model');
    expect((resp.content.parts[0] as any).text).toBe('hello world');
    expect(resp.finishReason).toBe('STOP');
  });

  it('解码 tool_use 响应：保留 callId', () => {
    const raw = {
      content: [{ type: 'tool_use', id: 'toolu_decode_123', name: 'get_weather', input: { city: 'London' } }],
      stop_reason: 'tool_use',
    };
    const resp = fmt.decodeResponse(raw);
    const fc = resp.content.parts[0] as FunctionCallPart;
    expect(fc.functionCall.callId).toBe('toolu_decode_123');
    expect(resp.finishReason).toBe('TOOL_CALLS');
  });

  it('解码 thinking 响应：保留签名', () => {
    const raw = {
      content: [
        { type: 'thinking', thinking: 'let me think', signature: 'sig_think_001' },
        { type: 'text', text: 'result' },
      ],
      stop_reason: 'end_turn',
    };
    const resp = fmt.decodeResponse(raw);
    const thoughtPart = resp.content.parts[0] as any;
    expect(thoughtPart.thought).toBe(true);
    expect(thoughtPart.thoughtSignatures?.claude).toBe('sig_think_001');
  });

  it('空 content 数组时回退空文本', () => {
    const raw = { content: [], stop_reason: 'end_turn' };
    const resp = fmt.decodeResponse(raw);
    expect(resp.content.parts).toHaveLength(1);
    expect((resp.content.parts[0] as any).text).toBe('');
  });
});

describe('ClaudeFormat: stream decode', () => {
  const fmt = new ClaudeFormat('claude-sonnet-4-20250514');

  it('流式工具调用完整流程：functionCall 在 content_block_stop 时即输出', () => {
    const state = fmt.createStreamState();
    fmt.decodeStreamChunk({
      type: 'content_block_start',
      content_block: { type: 'tool_use', id: 'toolu_stream_1', name: 'get_weather' },
    }, state);
    fmt.decodeStreamChunk({
      type: 'content_block_delta',
      delta: { type: 'input_json_delta', partial_json: '{"city":' },
    }, state);
    fmt.decodeStreamChunk({
      type: 'content_block_delta',
      delta: { type: 'input_json_delta', partial_json: '"Tokyo"}' },
    }, state);

    // 流式边执行优化：functionCall 在 content_block_stop 时立即输出，
    // 不再等到 message_delta 的 stop_reason。
    const stopChunk = fmt.decodeStreamChunk({ type: 'content_block_stop' }, state);
    expect(stopChunk.functionCalls).toHaveLength(1);
    const fc = stopChunk.functionCalls![0] as FunctionCallPart;
    expect(fc.functionCall.name).toBe('get_weather');
    expect(fc.functionCall.callId).toBe('toolu_stream_1');
    expect(fc.functionCall.args).toEqual({ city: 'Tokyo' });

    // message_delta 只携带 finishReason 和 usage，不再携带 functionCalls
    const deltaChunk = fmt.decodeStreamChunk({
      type: 'message_delta',
      delta: { stop_reason: 'tool_use' },
      usage: { output_tokens: 50 },
    }, state);
    expect(deltaChunk.functionCalls).toBeUndefined();
    expect(deltaChunk.finishReason).toBe('TOOL_CALLS');
  });

  it('流式 thinking：thinking_delta + signature_delta', () => {
    const state = fmt.createStreamState();
    fmt.decodeStreamChunk({
      type: 'content_block_start',
      content_block: { type: 'thinking' },
    }, state);
    const chunk1 = fmt.decodeStreamChunk({
      type: 'content_block_delta',
      delta: { type: 'thinking_delta', thinking: 'analyzing...' },
    }, state);
    expect(chunk1.partsDelta![0]).toHaveProperty('thought', true);

    const chunk2 = fmt.decodeStreamChunk({
      type: 'content_block_delta',
      delta: { type: 'signature_delta', signature: 'sig_stream_001' },
    }, state);
    expect(chunk2.thoughtSignatures?.claude).toBe('sig_stream_001');
  });
});

// ============================================================
//  OpenAI Compatible Format
// ============================================================

describe('OpenAICompatibleFormat: encodeRequest', () => {
  const fmt = new OpenAICompatibleFormat('gpt-4o');

  it('tool_calls 中每个 call 有唯一 id 且 tool response 匹配', () => {
    const req = buildRequest([
      userMsg('test'),
      modelToolCallMsg([
        { name: 'get_weather', args: { city: 'A' }, callId: 'call_oai_1' },
        { name: 'read_file', args: { path: '/x' }, callId: 'call_oai_2' },
      ]),
      toolResponseMsg([
        { name: 'get_weather', result: 'ok', callId: 'call_oai_1' },
        { name: 'read_file', result: 'ok', callId: 'call_oai_2' },
      ]),
    ]);
    const body = fmt.encodeRequest(req) as any;
    const assistantMsg = body.messages.find((m: any) => m.role === 'assistant');
    const toolMsgs = body.messages.filter((m: any) => m.role === 'tool');
    expect(assistantMsg.tool_calls[0].id).toBe('call_oai_1');
    expect(assistantMsg.tool_calls[1].id).toBe('call_oai_2');
    expect(toolMsgs[0].tool_call_id).toBe('call_oai_1');
    expect(toolMsgs[1].tool_call_id).toBe('call_oai_2');
  });

  it('无 callId 时 fallback ID 配对正确', () => {
    const req = buildRequest([
      userMsg('test'),
      modelToolCallMsg([{ name: 'get_weather', args: { city: 'A' } }]),
      toolResponseMsg([{ name: 'get_weather', result: 'ok' }]),
    ]);
    const body = fmt.encodeRequest(req) as any;
    const assistantMsg = body.messages.find((m: any) => m.role === 'assistant');
    const toolMsg = body.messages.find((m: any) => m.role === 'tool');
    expect(assistantMsg.tool_calls[0].id).toBe(toolMsg.tool_call_id);
  });

  it('tool_call arguments 是 JSON 字符串', () => {
    const req = buildRequest([
      userMsg('test'),
      modelToolCallMsg([{ name: 'get_weather', args: { city: 'Paris' }, callId: 'call_str_test' }]),
      toolResponseMsg([{ name: 'get_weather', result: 'ok', callId: 'call_str_test' }]),
    ]);
    const body = fmt.encodeRequest(req) as any;
    const tc = body.messages.find((m: any) => m.role === 'assistant').tool_calls[0];
    expect(typeof tc.function.arguments).toBe('string');
    expect(JSON.parse(tc.function.arguments)).toEqual({ city: 'Paris' });
  });

  it('多轮无 callId 的 fallback ID 不冲突', () => {
    const req = buildRequest([
      userMsg('test'),
      modelToolCallMsg([{ name: 'get_weather', args: { city: 'A' } }]),
      toolResponseMsg([{ name: 'get_weather', result: 'r1' }]),
      modelToolCallMsg([{ name: 'read_file', args: { path: '/b' } }]),
      toolResponseMsg([{ name: 'read_file', result: 'r2' }]),
    ]);
    const body = fmt.encodeRequest(req) as any;
    const assistantMsgs = body.messages.filter((m: any) => m.role === 'assistant' && m.tool_calls);
    expect(assistantMsgs[0].tool_calls[0].id).not.toBe(assistantMsgs[1].tool_calls[0].id);
  });

  it('stream=true 设置 stream 和 stream_options', () => {
    const req = buildRequest([userMsg('hi')], false);
    const body = fmt.encodeRequest(req, true) as any;
    expect(body.stream).toBe(true);
    expect(body.stream_options).toEqual({ include_usage: true });
  });
});

describe('OpenAICompatibleFormat: decodeResponse (basic)', () => {
  const fmt = new OpenAICompatibleFormat('gpt-4o');

  it('解码 tool_calls 响应：callId 保留', () => {
    const raw = {
      choices: [{
        message: {
          content: null,
          tool_calls: [{
            id: 'call_dec_001', type: 'function',
            function: { name: 'get_weather', arguments: '{"city":"NYC"}' },
          }],
        },
        finish_reason: 'tool_calls',
      }],
    };
    const resp = fmt.decodeResponse(raw);
    const fc = resp.content.parts.find(p => 'functionCall' in p) as FunctionCallPart;
    expect(fc.functionCall.callId).toBe('call_dec_001');
  });
});

// ============================================================
//  OpenAI Compatible: reasoning_content 全链路测试
// ============================================================

describe('OpenAICompatibleFormat: encodeRequest — reasoning_content', () => {
  const fmt = new OpenAICompatibleFormat('kimi-2.5');

  it('assistant 纯文本消息含 thinking → reasoning_content 被写入', () => {
    const req = buildRequest([
      userMsg('hello'),
      {
        role: 'model',
        parts: [
          { text: 'let me think about this', thought: true },
          { text: 'here is my answer' },
        ],
      },
      userMsg('thanks'),
    ], false);
    const body = fmt.encodeRequest(req) as any;
    const assistantMsg = body.messages.find((m: any) => m.role === 'assistant');
    expect(assistantMsg.reasoning_content).toBe('let me think about this');
    expect(assistantMsg.content).toBe('here is my answer');
  });

  it('assistant tool_call 消息含 thinking → reasoning_content 被写入', () => {
    const req = buildRequest([
      userMsg('weather?'),
      modelMixedMsg({
        thought: { text: 'I should call the weather tool' },
        toolCalls: [{ name: 'get_weather', args: { city: 'Tokyo' }, callId: 'call_rc_1' }],
      }),
      toolResponseMsg([{ name: 'get_weather', result: { temp: 25 }, callId: 'call_rc_1' }]),
    ]);
    const body = fmt.encodeRequest(req) as any;
    const assistantMsg = body.messages.find((m: any) => m.role === 'assistant');
    expect(assistantMsg.reasoning_content).toBe('I should call the weather tool');
    expect(assistantMsg.tool_calls).toHaveLength(1);
    expect(assistantMsg.tool_calls[0].id).toBe('call_rc_1');
  });

  it('assistant tool_call 消息含 thinking + text → 三个字段都存在', () => {
    const req = buildRequest([
      userMsg('help'),
      modelMixedMsg({
        thought: { text: 'reasoning about the request' },
        text: 'Let me look this up',
        toolCalls: [{ name: 'get_weather', args: { city: 'NY' }, callId: 'call_rc_2' }],
      }),
      toolResponseMsg([{ name: 'get_weather', result: { temp: 20 }, callId: 'call_rc_2' }]),
    ]);
    const body = fmt.encodeRequest(req) as any;
    const assistantMsg = body.messages.find((m: any) => m.role === 'assistant');
    expect(assistantMsg.reasoning_content).toBe('reasoning about the request');
    expect(assistantMsg.content).toBe('Let me look this up');
    expect(assistantMsg.tool_calls).toHaveLength(1);
  });

  it('assistant 消息无 thinking → 不包含 reasoning_content 字段', () => {
    const req = buildRequest([
      userMsg('hello'),
      modelTextMsg('just a reply'),
      userMsg('ok'),
    ], false);
    const body = fmt.encodeRequest(req) as any;
    const assistantMsg = body.messages.find((m: any) => m.role === 'assistant');
    expect(assistantMsg.content).toBe('just a reply');
    expect(assistantMsg).not.toHaveProperty('reasoning_content');
  });

  it('assistant tool_call 消息无 thinking → 不包含 reasoning_content 字段', () => {
    const req = buildRequest([
      userMsg('test'),
      modelToolCallMsg([{ name: 'get_weather', args: { city: 'X' }, callId: 'call_no_rc' }]),
      toolResponseMsg([{ name: 'get_weather', result: 'ok', callId: 'call_no_rc' }]),
    ]);
    const body = fmt.encodeRequest(req) as any;
    const assistantMsg = body.messages.find((m: any) => m.role === 'assistant');
    expect(assistantMsg).not.toHaveProperty('reasoning_content');
  });

  it('多个 thought part 被拼接为单个 reasoning_content', () => {
    const req = buildRequest([
      userMsg('hello'),
      {
        role: 'model',
        parts: [
          { text: 'first thought', thought: true },
          { text: 'second thought', thought: true },
          { text: 'visible answer' },
        ],
      },
      userMsg('ok'),
    ], false);
    const body = fmt.encodeRequest(req) as any;
    const assistantMsg = body.messages.find((m: any) => m.role === 'assistant');
    expect(assistantMsg.reasoning_content).toBe('first thoughtsecond thought');
    expect(assistantMsg.content).toBe('visible answer');
  });

  it('空 thought text → reasoning_content 不被写入（null）', () => {
    const req = buildRequest([
      userMsg('hello'),
      {
        role: 'model',
        parts: [
          { text: '', thought: true },
          { text: 'answer' },
        ],
      },
    ], false);
    const body = fmt.encodeRequest(req) as any;
    const assistantMsg = body.messages.find((m: any) => m.role === 'assistant');
    // 空字符串拼接结果为空 → null → 不写入
    expect(assistantMsg.reasoning_content).toBeFalsy();
  });

  it('多轮 thinking + 工具调用：每轮 assistant 的 reasoning_content 独立正确', () => {
    const req = buildRequest([
      userMsg('start'),
      // 第一轮：thinking → tool call
      modelMixedMsg({
        thought: { text: 'think round 1' },
        toolCalls: [{ name: 'get_weather', args: { city: 'A' }, callId: 'call_mr1' }],
      }),
      toolResponseMsg([{ name: 'get_weather', result: { temp: 10 }, callId: 'call_mr1' }]),
      // 第二轮：thinking → tool call
      modelMixedMsg({
        thought: { text: 'think round 2' },
        toolCalls: [{ name: 'read_file', args: { path: '/x' }, callId: 'call_mr2' }],
      }),
      toolResponseMsg([{ name: 'read_file', result: { content: 'data' }, callId: 'call_mr2' }]),
      // 第三轮：thinking → 最终回复
      {
        role: 'model',
        parts: [
          { text: 'think round 3', thought: true },
          { text: 'final answer' },
        ],
      },
    ]);
    const body = fmt.encodeRequest(req) as any;
    const assistantMsgs = body.messages.filter((m: any) => m.role === 'assistant');
    expect(assistantMsgs).toHaveLength(3);
    expect(assistantMsgs[0].reasoning_content).toBe('think round 1');
    expect(assistantMsgs[0].tool_calls).toHaveLength(1);
    expect(assistantMsgs[1].reasoning_content).toBe('think round 2');
    expect(assistantMsgs[1].tool_calls).toHaveLength(1);
    expect(assistantMsgs[2].reasoning_content).toBe('think round 3');
    expect(assistantMsgs[2].content).toBe('final answer');
  });
});

describe('OpenAICompatibleFormat: decodeResponse — reasoning_content', () => {
  const fmt = new OpenAICompatibleFormat('kimi-2.5');

  it('响应含 reasoning_content → 解码为 thought part', () => {
    const raw = {
      choices: [{
        message: {
          reasoning_content: 'let me think step by step',
          content: 'the answer is 42',
        },
        finish_reason: 'stop',
      }],
    };
    const resp = fmt.decodeResponse(raw);
    expect(resp.content.parts).toHaveLength(2);
    const thoughtPart = resp.content.parts[0] as any;
    expect(thoughtPart.thought).toBe(true);
    expect(thoughtPart.text).toBe('let me think step by step');
    const textPart = resp.content.parts[1] as any;
    expect(textPart.text).toBe('the answer is 42');
    expect(textPart.thought).toBeUndefined();
  });

  it('响应含 reasoning_content + tool_calls → thought part 在 functionCall 之前', () => {
    const raw = {
      choices: [{
        message: {
          reasoning_content: 'I need to check the weather',
          content: null,
          tool_calls: [{
            id: 'call_rc_dec_1', type: 'function',
            function: { name: 'get_weather', arguments: '{"city":"Tokyo"}' },
          }],
        },
        finish_reason: 'tool_calls',
      }],
    };
    const resp = fmt.decodeResponse(raw);
    expect(resp.content.parts.length).toBeGreaterThanOrEqual(2);
    const thoughtPart = resp.content.parts[0] as any;
    expect(thoughtPart.thought).toBe(true);
    expect(thoughtPart.text).toBe('I need to check the weather');
    const fcPart = resp.content.parts.find((p: any) => 'functionCall' in p) as any;
    expect(fcPart.functionCall.name).toBe('get_weather');
    expect(fcPart.functionCall.callId).toBe('call_rc_dec_1');
  });

  it('响应无 reasoning_content → 不产生 thought part', () => {
    const raw = {
      choices: [{
        message: { content: 'just a reply' },
        finish_reason: 'stop',
      }],
    };
    const resp = fmt.decodeResponse(raw);
    expect(resp.content.parts).toHaveLength(1);
    expect((resp.content.parts[0] as any).thought).toBeUndefined();
  });

  it('reasoning_content 为空字符串 → 不产生 thought part', () => {
    const raw = {
      choices: [{
        message: { reasoning_content: '', content: 'answer' },
        finish_reason: 'stop',
      }],
    };
    const resp = fmt.decodeResponse(raw);
    expect(resp.content.parts).toHaveLength(1);
    expect((resp.content.parts[0] as any).text).toBe('answer');
    expect((resp.content.parts[0] as any).thought).toBeUndefined();
  });
});

describe('OpenAICompatibleFormat: stream decode — reasoning_content', () => {
  const fmt = new OpenAICompatibleFormat('kimi-2.5');

  it('delta.reasoning_content → thought partsDelta', () => {
    const state = fmt.createStreamState();
    const chunk = fmt.decodeStreamChunk({
      choices: [{ delta: { reasoning_content: 'thinking...' } }],
    }, state);
    expect(chunk.partsDelta).toHaveLength(1);
    const thoughtDelta = chunk.partsDelta![0] as any;
    expect(thoughtDelta.thought).toBe(true);
    expect(thoughtDelta.text).toBe('thinking...');
    // 不应该有 textDelta（textDelta 只包含可见文本）
    expect(chunk.textDelta).toBeUndefined();
  });

  it('reasoning_content 后接 content → 分别输出', () => {
    const state = fmt.createStreamState();
    // 先收到 reasoning
    const c1 = fmt.decodeStreamChunk({
      choices: [{ delta: { reasoning_content: 'step 1' } }],
    }, state);
    expect(c1.partsDelta).toHaveLength(1);
    expect((c1.partsDelta![0] as any).thought).toBe(true);

    // 再收到正文
    const c2 = fmt.decodeStreamChunk({
      choices: [{ delta: { content: 'answer text' } }],
    }, state);
    expect(c2.textDelta).toBe('answer text');
  });

  it('delta 同时含 reasoning_content 和 content → 两者都输出', () => {
    const state = fmt.createStreamState();
    const chunk = fmt.decodeStreamChunk({
      choices: [{ delta: { reasoning_content: 'think', content: 'speak' } }],
    }, state);
    expect(chunk.partsDelta).toHaveLength(2);
    expect((chunk.partsDelta![0] as any).thought).toBe(true);
    expect((chunk.partsDelta![0] as any).text).toBe('think');
    expect((chunk.partsDelta![1] as any).text).toBe('speak');
    expect(chunk.textDelta).toBe('speak');
  });

  it('delta 无 reasoning_content → 产生可见文本 partsDelta', () => {
    const state = fmt.createStreamState();
    const chunk = fmt.decodeStreamChunk({
      choices: [{ delta: { content: 'normal text' } }],
    }, state);
    expect(chunk.textDelta).toBe('normal text');
    expect(chunk.partsDelta).toEqual([{ text: 'normal text' }]);
  });

  it('reasoning_content 后接 tool_calls → 两者都正确输出', () => {
    const state = fmt.createStreamState();
    // reasoning 阶段
    const c1 = fmt.decodeStreamChunk({
      choices: [{ delta: { reasoning_content: 'analyzing...' } }],
    }, state);
    expect(c1.partsDelta).toHaveLength(1);
    expect((c1.partsDelta![0] as any).thought).toBe(true);

    // tool call 分片
    fmt.decodeStreamChunk({
      choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_stream_rc', function: { name: 'get_weather', arguments: '{"city":' } }] } }],
    }, state);
    const toolReady = fmt.decodeStreamChunk({
      choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"Tokyo"}' } }] } }],
    }, state);
    expect(toolReady.functionCalls).toHaveLength(1);
    expect(toolReady.functionCalls![0].functionCall.name).toBe('get_weather');
    expect(toolReady.functionCalls![0].functionCall.callId).toBe('call_stream_rc');

    // 结束时不重复输出已提前发出的工具调用
    const cEnd = fmt.decodeStreamChunk({
      choices: [{ finish_reason: 'tool_calls', delta: {} }],
    }, state);
    expect(cEnd.functionCalls).toBeUndefined();
  });

  it('tool_calls 首帧 arguments 为空字符串时，不应提前解析为空参数', () => {
    const state = fmt.createStreamState();

    const first = fmt.decodeStreamChunk({
      choices: [{
        delta: {
          tool_calls: [{
            index: 0,
            id: 'call_empty_first',
            type: 'function',
            function: { name: 'switch_environment', arguments: '' },
          }],
        },
      }],
    }, state);
    expect(first.functionCalls).toBeUndefined();

    for (const piece of ['{', '"', 'name', '"', ': ', '"', 'server', '1', '"']) {
      const chunk = fmt.decodeStreamChunk({
        choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: piece } }] } }],
      }, state);
      expect(chunk.functionCalls).toBeUndefined();
    }

    const ready = fmt.decodeStreamChunk({
      choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '}' } }] } }],
    }, state);
    expect(ready.functionCalls).toHaveLength(1);
    expect(ready.functionCalls![0].functionCall.name).toBe('switch_environment');
    expect(ready.functionCalls![0].functionCall.callId).toBe('call_empty_first');
    expect(ready.functionCalls![0].functionCall.args).toEqual({ name: 'server1' });

    const end = fmt.decodeStreamChunk({
      choices: [{ finish_reason: 'tool_calls', delta: {} }],
    }, state);
    expect(end.functionCalls).toBeUndefined();
  });
});

// ============================================================
//  OpenAI Responses Format
// ============================================================

describe('OpenAIResponsesFormat: encodeRequest', () => {
  const fmt = new OpenAIResponsesFormat('o3');

  it('function_call 有 call_id 且与 function_call_output 匹配', () => {
    const req = buildRequest([
      userMsg('test'),
      modelToolCallMsg([{ name: 'get_weather', args: { city: 'A' }, callId: 'call_resp_1' }]),
      toolResponseMsg([{ name: 'get_weather', result: 'ok', callId: 'call_resp_1' }]),
    ]);
    const body = fmt.encodeRequest(req) as any;
    const funcCall = body.input.find((i: any) => i.type === 'function_call');
    const funcOutput = body.input.find((i: any) => i.type === 'function_call_output');
    expect(funcCall.call_id).toBe('call_resp_1');
    expect(funcOutput.call_id).toBe('call_resp_1');
  });

  it('reasoning item 回传 encrypted_content', () => {
    const req = buildRequest([
      userMsg('think'),
      modelThoughtMsg('deep thought', { openai: 'enc_abc_123' }),
      modelTextMsg('result'),
    ], false);
    const body = fmt.encodeRequest(req) as any;
    const reasoning = body.input.find((i: any) => i.type === 'reasoning');
    expect(reasoning).toBeDefined();
    expect(reasoning.encrypted_content).toBe('enc_abc_123');
  });

  it('只有 encrypted_content 的 reasoning item 也会回传空 summary', () => {
    const req = buildRequest([
      userMsg('think'),
      modelThoughtMsg('', { openai: 'enc_sig_only' }),
      modelTextMsg('result'),
    ], false);
    const body = fmt.encodeRequest(req) as any;
    const reasoning = body.input.find((i: any) => i.type === 'reasoning');

    expect(reasoning).toBeDefined();
    expect(reasoning.summary).toEqual([]);
    expect(reasoning.encrypted_content).toBe('enc_sig_only');
  });

  it('function_call arguments 是 JSON 字符串', () => {
    const req = buildRequest([
      userMsg('test'),
      modelToolCallMsg([{ name: 'get_weather', args: { city: 'Tokyo' }, callId: 'call_arg_test' }]),
      toolResponseMsg([{ name: 'get_weather', result: 'ok', callId: 'call_arg_test' }]),
    ]);
    const body = fmt.encodeRequest(req) as any;
    const funcCall = body.input.find((i: any) => i.type === 'function_call');
    expect(typeof funcCall.arguments).toBe('string');
  });

  it('include 中包含 reasoning.encrypted_content', () => {
    const req = buildRequest([userMsg('hi')], false);
    const body = fmt.encodeRequest(req) as any;
    expect(body.include).toContain('reasoning.encrypted_content');
  });
});

describe('OpenAIResponsesFormat: stream decode', () => {
  const fmt = new OpenAIResponsesFormat('o3');

  it('只在 reasoning done 事件中回填 encrypted_content', () => {
    const state = fmt.createStreamState();

    const added = fmt.decodeStreamChunk({
      event: 'response.output_item.added',
      item: {
        id: 'rs_stream_1',
        type: 'reasoning',
        summary: [{ type: 'summary_text', text: 'thinking...' }],
        encrypted_content: 'enc_partial_should_not_emit',
      },
    }, state);

    expect(added.partsDelta).toEqual([{ text: 'thinking...', thought: true }]);
    expect(added.thoughtSignatures).toBeUndefined();

    const done = fmt.decodeStreamChunk({
      event: 'response.output_item.done',
      item: {
        id: 'rs_stream_1',
        type: 'reasoning',
        summary: [{ type: 'summary_text', text: 'thinking...' }],
        encrypted_content: 'enc_final_sig',
      },
    }, state);

    expect(done.partsDelta).toEqual([{ thought: true, thoughtSignatures: { openai: 'enc_final_sig' } }]);
    expect(done.thoughtSignatures).toEqual({ openai: 'enc_final_sig' });
  });

  it('reasoning_summary_text.delta 会作为 thought 增量输出并进入后端存储链路', () => {
    const state = fmt.createStreamState();

    const added = fmt.decodeStreamChunk({
      event: 'response.output_item.added',
      item: {
        id: 'rs_delta_1',
        type: 'reasoning',
        summary: [],
      },
    }, state);
    expect(added.partsDelta).toBeUndefined();

    const delta1 = fmt.decodeStreamChunk({
      event: 'response.reasoning_summary_text.delta',
      item_id: 'rs_delta_1',
      output_index: 0,
      summary_index: 0,
      delta: 'step 1: inspect ',
    }, state);
    expect(delta1.partsDelta).toEqual([{ text: 'step 1: inspect ', thought: true }]);
    expect(delta1.textDelta).toBeUndefined();

    const delta2 = fmt.decodeStreamChunk({
      event: 'response.reasoning_summary_text.delta',
      item_id: 'rs_delta_1',
      output_index: 0,
      summary_index: 0,
      delta: 'then answer',
    }, state);
    expect(delta2.partsDelta).toEqual([{ text: 'then answer', thought: true }]);
    expect(delta2.textDelta).toBeUndefined();

    const done = fmt.decodeStreamChunk({
      event: 'response.output_item.done',
      item: {
        id: 'rs_delta_1',
        type: 'reasoning',
        summary: [{ type: 'summary_text', text: 'step 1: inspect then answer' }],
        encrypted_content: 'enc_delta_sig',
      },
    }, state);

    // summary 文本已通过 delta 发出，done 阶段只补签名，避免后端重复存储思维链。
    expect(done.partsDelta).toEqual([{ thought: true, thoughtSignatures: { openai: 'enc_delta_sig' } }]);
    expect(done.thoughtSignatures).toEqual({ openai: 'enc_delta_sig' });
  });

  it('reasoning_summary_text.done 在缺少 delta 时会兜底输出完整 thought 文本', () => {
    const state = fmt.createStreamState();

    const done = fmt.decodeStreamChunk({
      event: 'response.reasoning_summary_text.done',
      item_id: 'rs_done_text_only',
      output_index: 0,
      summary_index: 0,
      text: 'complete reasoning summary',
    }, state);

    expect(done.partsDelta).toEqual([{ text: 'complete reasoning summary', thought: true }]);
    expect(done.textDelta).toBeUndefined();
  });

  it('response.completed 中的 reasoning output 只兜底补齐 summary，不保存最终 encrypted_content', () => {
    const state = fmt.createStreamState();

    const completed = fmt.decodeStreamChunk({
      event: 'response.completed',
      response: {
        output: [{
          id: 'rs_completed_only',
          type: 'reasoning',
          summary: [{ type: 'summary_text', text: 'final reasoning from completed' }],
          encrypted_content: 'enc_completed_sig',
        }],
        usage: { input_tokens: 11, output_tokens: 7, total_tokens: 18 },
      },
    }, state);

    expect(completed.partsDelta).toEqual([
      { text: 'final reasoning from completed', thought: true },
    ]);
    expect(completed.usageMetadata).toEqual({ promptTokenCount: 11, candidatesTokenCount: 7, totalTokenCount: 18 });
  });

  it('function_call 在 arguments.done 时提前输出，output_item.done 不重复输出', () => {
    const state = fmt.createStreamState();

    const added = fmt.decodeStreamChunk({
      event: 'response.output_item.added',
      item: {
        id: 'fc_stream_1',
        type: 'function_call',
        status: 'in_progress',
        arguments: '',
        call_id: 'call_stream_1',
        name: 'list_files',
      },
    }, state);
    expect(added.functionCalls).toBeUndefined();

    fmt.decodeStreamChunk({
      event: 'response.function_call_arguments.delta',
      item_id: 'fc_stream_1',
      delta: '{"paths":[".' ,
    }, state);

    const argsDone = fmt.decodeStreamChunk({
      event: 'response.function_call_arguments.done',
      item_id: 'fc_stream_1',
      arguments: '{"paths":["."],"recursive":false}',
    }, state);
    expect(argsDone.functionCalls).toHaveLength(1);
    expect(argsDone.functionCalls![0].functionCall).toEqual({
      name: 'list_files',
      args: { paths: ['.'], recursive: false },
      callId: 'call_stream_1',
    });
    expect(argsDone.partsDelta).toEqual(argsDone.functionCalls);

    const itemDone = fmt.decodeStreamChunk({
      event: 'response.output_item.done',
      item: {
        id: 'fc_stream_1',
        type: 'function_call',
        status: 'completed',
        arguments: '{"paths":["."],"recursive":false}',
        call_id: 'call_stream_1',
        name: 'list_files',
      },
    }, state);

    expect(itemDone.functionCalls).toBeUndefined();

    const completed = fmt.decodeStreamChunk({ event: 'response.completed', response: {} }, state);
    expect(completed.functionCalls).toBeUndefined();
  });

  it('response.completed 会读取 response.usage，并兜底输出未完成的 function_call', () => {
    const state = fmt.createStreamState();

    fmt.decodeStreamChunk({
      event: 'response.output_item.added',
      item: {
        id: 'fc_stream_2',
        type: 'function_call',
        status: 'in_progress',
        arguments: '',
        call_id: 'call_stream_2',
        name: 'read_file',
      },
    }, state);

    const argsDone = fmt.decodeStreamChunk({
      event: 'response.function_call_arguments.done',
      item_id: 'fc_stream_2',
      arguments: '{"files":[{"path":"README.md"}]}'
    }, state);
    expect(argsDone.functionCalls?.[0].functionCall.callId).toBe('call_stream_2');
    expect(argsDone.functionCalls?.[0].functionCall.name).toBe('read_file');

    const completed = fmt.decodeStreamChunk({
      event: 'response.completed',
      response: { usage: { input_tokens: 11, output_tokens: 7, total_tokens: 18 } },
    }, state);

    expect(completed.usageMetadata).toEqual({ promptTokenCount: 11, candidatesTokenCount: 7, totalTokenCount: 18 });
    expect(completed.functionCalls).toBeUndefined();
  });
});

// ============================================================
//  tool-call-ids 辅助函数
// ============================================================

describe('tool-call-ids', () => {
  it('normalizeCallId: 各种输入', () => {
    expect(normalizeCallId('abc')).toBe('abc');
    expect(normalizeCallId('  trimmed  ')).toBe('trimmed');
    expect(normalizeCallId('')).toBeUndefined();
    expect(normalizeCallId('  ')).toBeUndefined();
    expect(normalizeCallId(null)).toBeUndefined();
    expect(normalizeCallId(undefined)).toBeUndefined();
    expect(normalizeCallId(123)).toBeUndefined();
  });

  it('resolveCallId: explicit 优先，fallback 兜底', () => {
    expect(resolveCallId('explicit_id', 'fallback')).toBe('explicit_id');
    expect(resolveCallId(undefined, 'fallback')).toBe('fallback');
    expect(resolveCallId('', 'fallback')).toBe('fallback');
  });

  it('consumeCallId: 从 pendingCallIds 消费', () => {
    const pending = ['id_1', 'id_2'];
    expect(consumeCallId({ explicit: 'id_1', pendingCallIds: pending, providerLabel: 'test', toolName: 'a' })).toBe('id_1');
    expect(pending).toEqual(['id_2']);
    expect(consumeCallId({ explicit: undefined, pendingCallIds: pending, providerLabel: 'test', toolName: 'b' })).toBe('id_2');
    expect(pending).toEqual([]);
  });

  it('consumeCallId: 无显式 ID 且 pending 为空时抛错', () => {
    expect(() => {
      consumeCallId({ explicit: undefined, pendingCallIds: [], providerLabel: 'Claude', toolName: 'missing_tool' });
    }).toThrow(/Claude.*missing_tool/);
  });
});

// ============================================================
//  跨格式一致性验证
// ============================================================

describe('cross-format: abort 后历史的编码安全性', () => {
  const claudeFmt = new ClaudeFormat('claude-sonnet-4-20250514');
  const oaiFmt = new OpenAICompatibleFormat('gpt-4o');
  const respFmt = new OpenAIResponsesFormat('o3');
  const geminiFmt = new GeminiFormat();

  it('场景1：只有 user 消息 — 所有格式正常编码', () => {
    const req = buildRequest([userMsg('hello')], false);
    expect(() => claudeFmt.encodeRequest(req)).not.toThrow();
    expect(() => oaiFmt.encodeRequest(req)).not.toThrow();
    expect(() => respFmt.encodeRequest(req)).not.toThrow();
    expect(() => geminiFmt.encodeRequest(req)).not.toThrow();
  });

  it('场景2：user + model(text) — 所有格式正常编码', () => {
    const req = buildRequest([userMsg('hello'), modelTextMsg('partial')], false);
    expect(() => claudeFmt.encodeRequest(req)).not.toThrow();
    expect(() => oaiFmt.encodeRequest(req)).not.toThrow();
    expect(() => respFmt.encodeRequest(req)).not.toThrow();
    expect(() => geminiFmt.encodeRequest(req)).not.toThrow();
  });

  it('场景3：完整的 tool call/response 对 — 所有格式 ID 配对', () => {
    const history = [
      userMsg('hello'),
      modelToolCallMsg([{ name: 'get_weather', args: { city: 'X' }, callId: 'call_cross_1' }]),
      toolResponseMsg([{ name: 'get_weather', result: { temp: 15 }, callId: 'call_cross_1' }]),
    ];
    const req = buildRequest(history);

    const claudeBody = claudeFmt.encodeRequest(req) as any;
    expect(claudeBody.messages[1].content.find((b: any) => b.type === 'tool_use').id)
      .toBe(claudeBody.messages[2].content.find((b: any) => b.type === 'tool_result').tool_use_id);

    const oaiBody = oaiFmt.encodeRequest(req) as any;
    expect(oaiBody.messages.find((m: any) => m.role === 'assistant' && m.tool_calls).tool_calls[0].id)
      .toBe(oaiBody.messages.find((m: any) => m.role === 'tool').tool_call_id);

    const respBody = respFmt.encodeRequest(req) as any;
    expect(respBody.input.find((i: any) => i.type === 'function_call').call_id)
      .toBe(respBody.input.find((i: any) => i.type === 'function_call_output').call_id);
  });

  it('场景4：多轮完整对话后 abort — Claude 每对 tool_use/tool_result 匹配', () => {
    const history = [
      userMsg('start'),
      modelToolCallMsg([{ name: 'get_weather', args: {}, callId: 'call_m1' }]),
      toolResponseMsg([{ name: 'get_weather', result: 'r1', callId: 'call_m1' }]),
      modelToolCallMsg([{ name: 'read_file', args: {}, callId: 'call_m2' }]),
      toolResponseMsg([{ name: 'read_file', result: 'r2', callId: 'call_m2' }]),
      modelTextMsg('final answer'),
      userMsg('followup'),
    ];
    const req = buildRequest(history);
    const claudeBody = claudeFmt.encodeRequest(req) as any;

    const allToolUseIds: string[] = [];
    const allToolResultIds: string[] = [];
    for (const msg of claudeBody.messages) {
      if (msg.role === 'assistant' && Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === 'tool_use') allToolUseIds.push(block.id);
        }
      }
      if (msg.role === 'user' && Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === 'tool_result') allToolResultIds.push(block.tool_use_id);
        }
      }
    }
    expect(allToolUseIds).toEqual(allToolResultIds);
  });

  it('场景5：abort 清理后历史含 thinking 的 tool_call — OAI 编码包含 reasoning_content 且 ID 配对', () => {
    const history: Content[] = [
      userMsg('hello'),
      // abort 清理后保留的完整对：thinking + tool_call → tool_response
      modelMixedMsg({
        thought: { text: 'I need to check the weather first' },
        toolCalls: [{ name: 'get_weather', args: { city: 'X' }, callId: 'call_abort_rc' }],
      }),
      toolResponseMsg([{ name: 'get_weather', result: { temp: 15 }, callId: 'call_abort_rc' }]),
    ];
    const req = buildRequest(history);
    const body = oaiFmt.encodeRequest(req) as any;
    const assistantMsg = body.messages.find((m: any) => m.role === 'assistant');
    const toolMsg = body.messages.find((m: any) => m.role === 'tool');

    // reasoning_content 被正确填充
    expect(assistantMsg.reasoning_content).toBe('I need to check the weather first');
    // tool_call ID 配对
    expect(assistantMsg.tool_calls[0].id).toBe(toolMsg.tool_call_id);
    expect(assistantMsg.tool_calls[0].id).toBe('call_abort_rc');
  });

  it('场景6：abort 清理后多轮 thinking + tool_call — 每轮 reasoning_content 和 ID 都正确', () => {
    const history: Content[] = [
      userMsg('start'),
      modelMixedMsg({
        thought: { text: 'round 1 thinking' },
        toolCalls: [{ name: 'get_weather', args: { city: 'A' }, callId: 'call_ab_r1' }],
      }),
      toolResponseMsg([{ name: 'get_weather', result: { temp: 10 }, callId: 'call_ab_r1' }]),
      modelMixedMsg({
        thought: { text: 'round 2 thinking' },
        toolCalls: [{ name: 'read_file', args: { path: '/b' }, callId: 'call_ab_r2' }],
      }),
      toolResponseMsg([{ name: 'read_file', result: { content: 'data' }, callId: 'call_ab_r2' }]),
      // 第三轮被 abort 清理掉了，只剩最终文本回复
      {
        role: 'model',
        parts: [
          { text: 'round 3 thinking', thought: true },
          { text: 'final answer' },
        ],
      },
    ];
    const req = buildRequest(history);
    const body = oaiFmt.encodeRequest(req) as any;
    const assistantMsgs = body.messages.filter((m: any) => m.role === 'assistant');
    const toolMsgs = body.messages.filter((m: any) => m.role === 'tool');

    expect(assistantMsgs).toHaveLength(3);
    // 第一轮
    expect(assistantMsgs[0].reasoning_content).toBe('round 1 thinking');
    expect(assistantMsgs[0].tool_calls[0].id).toBe(toolMsgs[0].tool_call_id);
    // 第二轮
    expect(assistantMsgs[1].reasoning_content).toBe('round 2 thinking');
    expect(assistantMsgs[1].tool_calls[0].id).toBe(toolMsgs[1].tool_call_id);
    // 第三轮（纯文本）
    expect(assistantMsgs[2].reasoning_content).toBe('round 3 thinking');
    expect(assistantMsgs[2].content).toBe('final answer');
  });
});

describe('cross-format: abort 后历史的编码安全性 (original)', () => {
  const claudeFmt = new ClaudeFormat('claude-sonnet-4-20250514');
  const oaiFmt = new OpenAICompatibleFormat('gpt-4o');
  const respFmt = new OpenAIResponsesFormat('o3');
  const geminiFmt = new GeminiFormat();

  it('场景1：只有 user 消息 — 所有格式正常编码', () => {
    const req = buildRequest([userMsg('hello')], false);
    expect(() => claudeFmt.encodeRequest(req)).not.toThrow();
    expect(() => oaiFmt.encodeRequest(req)).not.toThrow();
    expect(() => respFmt.encodeRequest(req)).not.toThrow();
    expect(() => geminiFmt.encodeRequest(req)).not.toThrow();
  });

  it('场景2：user + model(text) — 所有格式正常编码', () => {
    const req = buildRequest([userMsg('hello'), modelTextMsg('partial')], false);
    expect(() => claudeFmt.encodeRequest(req)).not.toThrow();
    expect(() => oaiFmt.encodeRequest(req)).not.toThrow();
    expect(() => respFmt.encodeRequest(req)).not.toThrow();
    expect(() => geminiFmt.encodeRequest(req)).not.toThrow();
  });

  it('场景3：完整的 tool call/response 对 — 所有格式 ID 配对', () => {
    const history = [
      userMsg('hello'),
      modelToolCallMsg([{ name: 'get_weather', args: { city: 'X' }, callId: 'call_cross_1' }]),
      toolResponseMsg([{ name: 'get_weather', result: { temp: 15 }, callId: 'call_cross_1' }]),
    ];
    const req = buildRequest(history);

    const claudeBody = claudeFmt.encodeRequest(req) as any;
    expect(claudeBody.messages[1].content.find((b: any) => b.type === 'tool_use').id)
      .toBe(claudeBody.messages[2].content.find((b: any) => b.type === 'tool_result').tool_use_id);

    const oaiBody = oaiFmt.encodeRequest(req) as any;
    expect(oaiBody.messages.find((m: any) => m.role === 'assistant' && m.tool_calls).tool_calls[0].id)
      .toBe(oaiBody.messages.find((m: any) => m.role === 'tool').tool_call_id);

    const respBody = respFmt.encodeRequest(req) as any;
    expect(respBody.input.find((i: any) => i.type === 'function_call').call_id)
      .toBe(respBody.input.find((i: any) => i.type === 'function_call_output').call_id);
  });

  it('场景4：多轮完整对话后 abort — Claude 每对 tool_use/tool_result 匹配', () => {
    const history = [
      userMsg('start'),
      modelToolCallMsg([{ name: 'get_weather', args: {}, callId: 'call_m1' }]),
      toolResponseMsg([{ name: 'get_weather', result: 'r1', callId: 'call_m1' }]),
      modelToolCallMsg([{ name: 'read_file', args: {}, callId: 'call_m2' }]),
      toolResponseMsg([{ name: 'read_file', result: 'r2', callId: 'call_m2' }]),
      modelTextMsg('final answer'),
      userMsg('followup'),
    ];
    const req = buildRequest(history);
    const claudeBody = claudeFmt.encodeRequest(req) as any;

    const allToolUseIds: string[] = [];
    const allToolResultIds: string[] = [];
    for (const msg of claudeBody.messages) {
      if (msg.role === 'assistant' && Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === 'tool_use') allToolUseIds.push(block.id);
        }
      }
      if (msg.role === 'user' && Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === 'tool_result') allToolResultIds.push(block.tool_use_id);
        }
      }
    }
    expect(allToolUseIds).toEqual(allToolResultIds);
  });
});

// ============================================================
//  Claude payload 结构性验证
// ============================================================

describe('Claude payload structural validation', () => {
  const fmt = new ClaudeFormat('claude-sonnet-4-20250514');

  it('每条 assistant 消息中 tool_use 之后没有 text/thinking 块', () => {
    const history = [
      userMsg('start'),
      modelMixedMsg({
        thought: { text: 'thinking step 1', sig: { claude: 'sig1' } },
        text: 'I will use a tool',
        toolCalls: [{ name: 'get_weather', args: { city: 'A' }, callId: 'c1' }],
      }),
      toolResponseMsg([{ name: 'get_weather', result: 'ok', callId: 'c1' }]),
      modelMixedMsg({
        thought: { text: 'thinking step 2', sig: { claude: 'sig2' } },
        toolCalls: [
          { name: 'get_weather', args: { city: 'B' }, callId: 'c2' },
          { name: 'read_file', args: { path: '/c' }, callId: 'c3' },
        ],
      }),
      toolResponseMsg([
        { name: 'get_weather', result: 'r2', callId: 'c2' },
        { name: 'read_file', result: 'r3', callId: 'c3' },
      ]),
      modelTextMsg('done'),
    ];
    const req = buildRequest(history);
    const body = fmt.encodeRequest(req) as any;

    for (const msg of body.messages) {
      if (msg.role !== 'assistant' || !Array.isArray(msg.content)) continue;
      let seenToolUse = false;
      for (const block of msg.content) {
        if (block.type === 'tool_use') {
          seenToolUse = true;
        } else if (seenToolUse) {
          expect.unreachable(
            `Found ${block.type} block after tool_use: ${JSON.stringify(msg.content.map((b: any) => b.type))}`,
          );
        }
      }
    }
  });

  it('tool_result 消息紧跟在对应的 tool_use assistant 消息后面', () => {
    const history = [
      userMsg('go'),
      modelToolCallMsg([{ name: 'get_weather', args: {}, callId: 'tr1' }]),
      toolResponseMsg([{ name: 'get_weather', result: 'ok', callId: 'tr1' }]),
    ];
    const req = buildRequest(history);
    const body = fmt.encodeRequest(req) as any;

    for (let i = 0; i < body.messages.length; i++) {
      const msg = body.messages[i];
      if (msg.role === 'assistant' && Array.isArray(msg.content) && msg.content.some((b: any) => b.type === 'tool_use')) {
        const nextMsg = body.messages[i + 1];
        expect(nextMsg).toBeDefined();
        expect(nextMsg.role).toBe('user');
        if (Array.isArray(nextMsg.content)) {
          expect(nextMsg.content.some((b: any) => b.type === 'tool_result')).toBe(true);
        }
      }
    }
  });

  it('所有 tool_use id 在整个请求内唯一', () => {
    const history = [
      userMsg('multi'),
      modelToolCallMsg([
        { name: 'get_weather', args: {}, callId: 'u1' },
        { name: 'read_file', args: {}, callId: 'u2' },
      ]),
      toolResponseMsg([
        { name: 'get_weather', result: 'a', callId: 'u1' },
        { name: 'read_file', result: 'b', callId: 'u2' },
      ]),
      modelToolCallMsg([{ name: 'get_weather', args: {}, callId: 'u3' }]),
      toolResponseMsg([{ name: 'get_weather', result: 'c', callId: 'u3' }]),
    ];
    const req = buildRequest(history);
    const body = fmt.encodeRequest(req) as any;

    const allIds: string[] = [];
    for (const msg of body.messages) {
      if (msg.role === 'assistant' && Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === 'tool_use') allIds.push(block.id);
        }
      }
    }
    expect(new Set(allIds).size).toBe(allIds.length);
  });
});
