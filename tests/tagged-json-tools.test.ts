import { EventEmitter } from 'events';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { parseSingleLLMConfig } from '../src/config/llm.js';
import { callLLMStream } from '../src/core/backend/stream.js';
import { ToolLoop, type LLMCaller } from '../src/core/tool-loop.js';
import { LLMRouter } from '../src/llm/router.js';
import { OpenAICompatibleFormat } from '../src/llm/formats/openai-compatible.js';
import {
  TAGGED_JSON_TOOL_CALL_CLOSE,
  TAGGED_JSON_TOOL_CALL_OPEN,
  TAGGED_JSON_TOOL_RESULT_CLOSE,
  TAGGED_JSON_TOOL_RESULT_OPEN,
  buildTaggedJsonToolRepairPrompt,
  consumeTaggedJsonToolText,
  createTaggedJsonToolStreamState,
  decodeTaggedJsonToolText,
} from '../src/llm/formats/tagged-json-tools.js';
import { isLikelyUnfulfilledToolIntentPreamble } from '../src/llm/tool-intent-guard.js';
import { createOpenAICompatibleProvider } from '../src/llm/providers/openai-compatible.js';
import { PromptAssembler } from '../src/prompt/assembler.js';
import { ToolRegistry } from '../src/tools/registry.js';
import type { Content, FunctionCallPart, LLMRequest, Part } from '../src/types/index.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  vi.restoreAllMocks();
  globalThis.fetch = originalFetch;
});

function tools(): LLMRequest['tools'] {
  return [{
    functionDeclarations: [
      {
        name: 'first_tool',
        description: 'Run the first tool',
        parameters: {
          type: 'object',
          properties: { value: { type: 'number' } },
          required: ['value'],
        },
      },
      {
        name: 'second_tool',
        description: 'Run the second tool',
        parameters: {
          type: 'object',
          properties: { text: { type: 'string' } },
          required: ['text'],
        },
      },
    ],
  }];
}

function request(contents: Content[]): LLMRequest {
  return {
    contents,
    systemInstruction: { parts: [{ text: 'Base system prompt.' }] },
    tools: tools(),
  };
}

function functionCalls(parts: Part[]): FunctionCallPart[] {
  return parts.filter((part): part is FunctionCallPart => 'functionCall' in part);
}

function parseBlocks(content: string, open: string, close: string): Array<Record<string, any>> {
  const values: Array<Record<string, any>> = [];
  let cursor = 0;
  while (true) {
    const start = content.indexOf(open, cursor);
    if (start < 0) break;
    const end = content.indexOf(close, start + open.length);
    if (end < 0) throw new Error(`Unclosed block: ${open}`);
    values.push(JSON.parse(content.slice(start + open.length, end)));
    cursor = end + close.length;
  }
  return values;
}

describe('tagged JSON configuration and request encoding', () => {
  it('validates toolCallProtocol and keeps native as the implicit default', () => {
    expect(parseSingleLLMConfig({
      provider: 'openai-compatible',
      toolCallProtocol: 'tagged-json',
    }).toolCallProtocol).toBe('tagged-json');
    expect(parseSingleLLMConfig({
      provider: 'openai-compatible',
      toolCallProtocol: 'native',
    }).toolCallProtocol).toBe('native');
    expect(parseSingleLLMConfig({
      provider: 'openai-compatible',
      toolCallProtocol: 'invalid',
    }).toolCallProtocol).toBeUndefined();
  });

  it('injects tool schemas into the system prompt and omits native tools', () => {
    const format = new OpenAICompatibleFormat('local-model', false, 'tagged-json');
    const body = format.encodeRequest(request([
      { role: 'user', parts: [{ text: 'run both' }] },
    ])) as any;

    expect(body.tools).toBeUndefined();
    expect(body.messages[0].role).toBe('system');
    expect(body.messages[0].content).toContain('Base system prompt.');
    expect(body.messages[0].content).toContain(TAGGED_JSON_TOOL_CALL_OPEN);
    expect(body.messages[0].content).toContain('first_tool');
    expect(body.messages[0].content).toContain('second_tool');
    expect(body.messages[0].content).toContain('exactly match a property from that tool schema');
    expect(body.messages[0].content).toContain('__unparsedToolInput');
    expect(body.messages[0].content).toContain('Never emit a partial JSON value');
    expect(body.messages[0].content).toContain('never only in hidden reasoning or thinking fields');
    expect(body.messages[0].content).toContain('Never end a response with only a promise, plan, or preamble');
    expect(body.messages[0].content).toContain('if your gateway cannot preserve <tool_call> tags');
    expect(body.messages[0].content).toContain('Do not nest provider-specific wrappers such as DSML');
  });

  it('detects short unfulfilled tool preambles without rejecting complete answers', () => {
    expect(isLikelyUnfulfilledToolIntentPreamble(
      '我来查看当前 git 的同步情况。先检查状态和远程配置。',
    )).toBe(true);
    expect(isLikelyUnfulfilledToolIntentPreamble(
      '让我先读取文件，然后确认实现。',
    )).toBe(true);
    expect(isLikelyUnfulfilledToolIntentPreamble(
      "I'll inspect the repository first and then check the remote.",
    )).toBe(true);

    expect(isLikelyUnfulfilledToolIntentPreamble(
      '我来查看当前 git 的同步情况：工作区干净，分支已与远程同步。',
    )).toBe(false);
    expect(isLikelyUnfulfilledToolIntentPreamble(
      '检查结果如下：本地领先远程 2 个提交。',
    )).toBe(false);
    expect(isLikelyUnfulfilledToolIntentPreamble(
      'JSON 协议本身不会影响 rewind 或 MCP。',
    )).toBe(false);

    const repair = buildTaggedJsonToolRepairPrompt(1);
    expect(repair).toContain('previous candidate response was discarded');
    expect(repair).toContain('<tool_call>');
    expect(repair).toContain('exact schema keys');
  });

  it('returns multi-call history and matching multi-result history as tagged user text', () => {
    const format = new OpenAICompatibleFormat('local-model', false, 'tagged-json');
    const body = format.encodeRequest(request([
      { role: 'user', parts: [{ text: 'run both' }] },
      {
        role: 'model',
        parts: [
          { text: 'Checking now.' },
          { functionCall: { name: 'first_tool', args: { value: 7 }, callId: 'tagged_a' } },
          { functionCall: { name: 'second_tool', args: { text: 'hello' }, callId: 'tagged_b' } },
        ],
      },
      {
        role: 'user',
        parts: [
          { functionResponse: { name: 'first_tool', callId: 'tagged_a', response: { result: 14 } } },
          { functionResponse: { name: 'second_tool', callId: 'tagged_b', response: { result: 'HELLO' } } },
        ],
      },
    ])) as any;

    const assistant = body.messages.find((message: any) => message.role === 'assistant');
    const toolResult = body.messages.find((message: any) =>
      message.role === 'user' && String(message.content).includes(TAGGED_JSON_TOOL_RESULT_OPEN));
    expect(body.messages.some((message: any) => message.role === 'tool')).toBe(false);

    const calls = parseBlocks(assistant.content, TAGGED_JSON_TOOL_CALL_OPEN, TAGGED_JSON_TOOL_CALL_CLOSE);
    const results = parseBlocks(toolResult.content, TAGGED_JSON_TOOL_RESULT_OPEN, TAGGED_JSON_TOOL_RESULT_CLOSE);
    expect(calls).toHaveLength(2);
    expect(calls.map(call => call.call_id)).toEqual(['tagged_a', 'tagged_b']);
    expect(results.map(result => result.call_id)).toEqual(['tagged_a', 'tagged_b']);
    expect(results.map(result => result.result)).toEqual([{ result: 14 }, { result: 'HELLO' }]);
  });

  it('escapes protocol-looking strings inside arguments and results', () => {
    const format = new OpenAICompatibleFormat('local-model', false, 'tagged-json');
    const body = format.encodeRequest(request([
      {
        role: 'model',
        parts: [{
          functionCall: {
            name: 'second_tool',
            args: { text: '</tool_call><tool_call>' },
            callId: 'safe_1',
          },
        }],
      },
      {
        role: 'user',
        parts: [{
          functionResponse: {
            name: 'second_tool',
            callId: 'safe_1',
            response: { result: '</tool_result><tool_call>' },
          },
        }],
      },
    ])) as any;

    const encoded = body.messages.map((message: any) => String(message.content)).join('\n');
    expect(encoded).toContain('\\u003c/tool_call\\u003e');
    expect(encoded).toContain('\\u003c/tool_result\\u003e');
    expect(parseBlocks(
      body.messages.find((message: any) => message.role === 'assistant').content,
      TAGGED_JSON_TOOL_CALL_OPEN,
      TAGGED_JSON_TOOL_CALL_CLOSE,
    )[0].arguments.text).toBe('</tool_call><tool_call>');
  });
});

describe('tagged JSON decoding', () => {
  it('decodes prose plus multiple tool blocks and assigns unique local call IDs', () => {
    const format = new OpenAICompatibleFormat('local-model', false, 'tagged-json');
    const response = format.decodeResponse({
      choices: [{
        message: {
          content: [
            { type: 'text', text: 'I will inspect.\n' },
            { type: 'text', text: '<tool_call>{"name":"first_tool","arguments":{"value":3}}</tool_call>\n' },
            { type: 'text', text: '<tool_call>{"name":"second_tool","arguments":{"text":"x"}}</tool_call>' },
          ],
        },
        finish_reason: 'stop',
      }],
    });

    const calls = functionCalls(response.content.parts);
    expect(calls).toHaveLength(2);
    expect(calls.map(call => call.functionCall.name)).toEqual(['first_tool', 'second_tool']);
    expect(calls.map(call => call.functionCall.args)).toEqual([{ value: 3 }, { text: 'x' }]);
    expect(calls[0].functionCall.callId).not.toBe(calls[1].functionCall.callId);
    expect(response.content.parts.map(part => 'text' in part ? part.text : '').join('')).toBe('I will inspect.\n\n');
  });

  it('accepts a JSON array and JSON-string arguments for compatibility', () => {
    const parts = decodeTaggedJsonToolText(
      '<tool_call>['
      + '{"name":"first_tool","arguments":"{\\"value\\":4}"},'
      + '{"name":"second_tool","args":{"text":"ok"}}'
      + ']</tool_call>',
      'array_call',
    );
    const calls = functionCalls(parts);
    expect(calls.map(call => call.functionCall.args)).toEqual([{ value: 4 }, { text: 'ok' }]);
    expect(calls.map(call => call.functionCall.callId)).toEqual(['array_call_0', 'array_call_1']);
  });

  it('recovers a strict bare JSON call while leaving ordinary JSON answers visible', () => {
    const bare = '{"name":"first_tool","arguments":{"value":4}}';
    const recovered = decodeTaggedJsonToolText(bare, 'bare');
    expect(functionCalls(recovered).map(call => call.functionCall.args)).toEqual([{ value: 4 }]);
    expect(recovered.some(part => 'text' in part)).toBe(false);

    const ordinary = '{"status":"ok","value":4}';
    expect(decodeTaggedJsonToolText(ordinary, 'ordinary')).toEqual([{ text: ordinary }]);

    const descriptive = '{"name":"first_tool","arguments":{"value":4},"summary":"example"}';
    expect(decodeTaggedJsonToolText(descriptive, 'descriptive')).toEqual([{ text: descriptive }]);
  });

  it('buffers a bare JSON stream until completion and emits only the recovered call', () => {
    const state = createTaggedJsonToolStreamState('bare_stream');
    const source = '{"name":"first_tool","arguments":{"value":9}}';
    const emitted: Part[] = [];
    for (const char of source) {
      emitted.push(...consumeTaggedJsonToolText(state, char));
    }
    expect(emitted).toEqual([]);
    emitted.push(...consumeTaggedJsonToolText(state, '', true));
    expect(functionCalls(emitted).map(call => call.functionCall.args)).toEqual([{ value: 9 }]);
    expect(emitted.some(part => 'text' in part)).toBe(false);
  });

  it('recovers standalone ASCII/full-width DSML call envelopes', () => {
    const ascii = '<|DSML|_call>{"name":"first_tool","arguments":{"value":10}}</|DSML|_call>';
    const fullWidth = '<｜DSML｜_call>{"name":"second_tool","arguments":{"text":"ok"}}</｜DSML｜_call>';
    expect(functionCalls(decodeTaggedJsonToolText(ascii, 'dsml_ascii'))[0].functionCall.args)
      .toEqual({ value: 10 });
    expect(functionCalls(decodeTaggedJsonToolText(fullWidth, 'dsml_full'))[0].functionCall.args)
      .toEqual({ text: 'ok' });
  });

  it('recovers a complete DSML inner frame when the outer tool_call close tag is missing', () => {
    const source = '<tool_call>\n<｜DSML｜_call>\n'
      + '{"name":"first_tool","arguments":{"value":11},"call_id":"model_supplied"}\n'
      + '</｜DSML｜_call>';
    const state = createTaggedJsonToolStreamState('dsml_nested');
    const emitted: Part[] = [];
    for (const char of source) emitted.push(...consumeTaggedJsonToolText(state, char));
    expect(emitted).toEqual([]);
    emitted.push(...consumeTaggedJsonToolText(state, '', true));

    const calls = functionCalls(emitted);
    expect(calls).toHaveLength(1);
    expect(calls[0].functionCall.name).toBe('first_tool');
    expect(calls[0].functionCall.args).toEqual({ value: 11 });
    expect(calls[0].functionCall.callId).toBe('dsml_nested_0');
    expect(emitted.some(part => 'text' in part)).toBe(false);
  });

  it('keeps incomplete or contaminated DSML frames visible and never executes them', () => {
    const missingClose = '<tool_call><｜DSML｜_call>{"name":"first_tool","arguments":{"value":1}}';
    expect(decodeTaggedJsonToolText(missingClose, 'missing_dsml')).toEqual([{ text: missingClose }]);

    const trailingText = '<tool_call><｜DSML｜_call>'
      + '{"name":"first_tool","arguments":{"value":1}}'
      + '</｜DSML｜_call> trailing';
    expect(decodeTaggedJsonToolText(trailingText, 'trailing_dsml')).toEqual([{ text: trailingText }]);
  });

  it('never executes malformed or unfinished tagged JSON and restores it as visible text', () => {
    const malformed = '<tool_call>{"name":"first_tool","arguments":</tool_call>';
    const malformedParts = decodeTaggedJsonToolText(malformed, 'bad');
    expect(functionCalls(malformedParts)).toHaveLength(0);
    expect(malformedParts).toEqual([{ text: malformed }]);

    const state = createTaggedJsonToolStreamState('unfinished');
    expect(consumeTaggedJsonToolText(state, '<tool_call>{"name":"first_tool"')).toEqual([]);
    const flushed = consumeTaggedJsonToolText(state, '', true);
    expect(functionCalls(flushed)).toHaveLength(0);
    expect(flushed).toEqual([{ text: '<tool_call>{"name":"first_tool"' }]);
  });

  it('handles every tag and JSON boundary split without leaking protocol text', () => {
    const format = new OpenAICompatibleFormat('local-model', false, 'tagged-json');
    const state = format.createStreamState();
    const source = 'before <tool_call>{"name":"first_tool","arguments":{"value":9}}</tool_call> after';
    const emitted: Part[] = [];
    const visibleDeltas: string[] = [];

    for (const char of source) {
      const chunk = format.decodeStreamChunk({
        choices: [{ delta: { content: char } }],
      }, state);
      emitted.push(...(chunk.partsDelta ?? []));
      if (chunk.textDelta) visibleDeltas.push(chunk.textDelta);
    }
    const end = format.decodeStreamChunk({
      choices: [{ delta: {}, finish_reason: 'stop' }],
    }, state);
    emitted.push(...(end.partsDelta ?? []));
    if (end.textDelta) visibleDeltas.push(end.textDelta);

    const calls = functionCalls(emitted);
    expect(calls).toHaveLength(1);
    expect(calls[0].functionCall.args).toEqual({ value: 9 });
    expect(visibleDeltas.join('')).toBe('before  after');
    expect(visibleDeltas.join('')).not.toContain('<tool_call>');
  });
});

describe('tagged JSON streaming integration', () => {
  it('streams two tagged tool calls through Provider, SSE parser and Backend callback', async () => {
    const taggedOutput = 'Starting. '
      + '<tool_call>{"name":"first_tool","arguments":{"value":5}}</tool_call>'
      + '<tool_call>{"name":"second_tool","arguments":{"text":"hello"}}</tool_call>';
    const modelPieces: string[] = [];
    for (let index = 0; index < taggedOutput.length; index += 7) {
      modelPieces.push(taggedOutput.slice(index, index + 7));
    }
    const sse = [
      ...modelPieces.map(piece => `data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`),
      `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`,
      'data: [DONE]\n\n',
    ].join('');
    const bytes = new TextEncoder().encode(sse);

    let capturedBody: any;
    globalThis.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body));
      let offset = 0;
      return new Response(new ReadableStream<Uint8Array>({
        pull(controller) {
          if (offset >= bytes.length) {
            controller.close();
            return;
          }
          const next = Math.min(offset + 11, bytes.length);
          controller.enqueue(bytes.slice(offset, next));
          offset = next;
        },
      }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    }) as any;

    const config = {
      provider: 'openai-compatible',
      apiKey: 'test-key',
      model: 'local-model',
      baseUrl: 'https://local.invalid/v1',
      toolCallProtocol: 'tagged-json' as const,
    };
    const provider = createOpenAICompatibleProvider(config);
    const router = new LLMRouter({
      defaultModelName: 'local',
      models: [{ modelName: 'local', provider, config }],
    });
    const readyCalls: FunctionCallPart[] = [];
    const emitter = new EventEmitter();
    const streamedText: string[] = [];
    emitter.on('stream:chunk', (_sessionId, text) => streamedText.push(text));

    const content = await callLLMStream(
      router,
      emitter,
      'session-tagged',
      request([{ role: 'user', parts: [{ text: 'run both' }] }]),
      undefined,
      undefined,
      call => readyCalls.push(call),
    );

    expect(capturedBody.tools).toBeUndefined();
    expect(capturedBody.messages[0].content).toContain('Tagged JSON tool protocol');
    expect(readyCalls.map(call => call.functionCall.name)).toEqual(['first_tool', 'second_tool']);
    expect(functionCalls(content.parts).map(call => call.functionCall.name)).toEqual(['first_tool', 'second_tool']);
    expect(streamedText.join('')).toBe('Starting. ');
    expect(streamedText.join('')).not.toContain('<tool_call>');
  });

  it('flushes a possible opening-tag suffix when SSE ends without finish_reason', async () => {
    const sse = `data: ${JSON.stringify({ choices: [{ delta: { content: 'answer<' } }] })}\n\n`
      + 'data: [DONE]\n\n';
    const provider = createOpenAICompatibleProvider({
      provider: 'openai-compatible',
      apiKey: 'test-key',
      model: 'local-model',
      baseUrl: 'https://local.invalid/v1',
      toolCallProtocol: 'tagged-json',
    });
    globalThis.fetch = vi.fn(async () => new Response(sse, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    })) as any;
    const config = {
      provider: 'openai-compatible', apiKey: '', model: 'local-model', baseUrl: '',
      toolCallProtocol: 'tagged-json' as const,
    };
    const router = new LLMRouter({
      defaultModelName: 'local',
      models: [{ modelName: 'local', provider, config }],
    });

    const content = await callLLMStream(
      router,
      new EventEmitter(),
      'session-finalize',
      request([{ role: 'user', parts: [{ text: 'answer' }] }]),
    );
    expect(content.parts).toEqual([{ text: 'answer<' }]);
  });
});

describe('tagged JSON ToolLoop end-to-end', () => {
  it('executes multiple calls and sends matching call/result history into the next model round', async () => {
    const firstHandler = vi.fn(async (args: Record<string, unknown>) => ({ doubled: Number(args.value) * 2 }));
    const secondHandler = vi.fn(async (args: Record<string, unknown>) => ({ upper: String(args.text).toUpperCase() }));
    const registry = new ToolRegistry();
    registry.register({
      declaration: tools()![0].functionDeclarations[0],
      handler: firstHandler,
      parallel: true,
    });
    registry.register({
      declaration: tools()![0].functionDeclarations[1],
      handler: secondHandler,
      parallel: true,
    });

    const prompt = new PromptAssembler();
    prompt.setSystemPrompt('End-to-end tagged test.');
    const loop = new ToolLoop(registry, prompt, {
      maxRounds: 4,
      toolsConfig: {
        permissions: {
          first_tool: { autoApprove: true },
          second_tool: { autoApprove: true },
        },
      },
    });
    const format = new OpenAICompatibleFormat('local-model', false, 'tagged-json');
    const encodedRequests: any[] = [];
    let round = 0;
    const callLLM: LLMCaller = async llmRequest => {
      encodedRequests.push(format.encodeRequest(llmRequest));
      round++;
      if (round === 1) {
        return format.decodeResponse({
          choices: [{
            message: {
              content: '<tool_call>{"name":"first_tool","arguments":{"value":6}}</tool_call>'
                + '<tool_call>{"name":"second_tool","arguments":{"text":"iris"}}</tool_call>',
            },
            finish_reason: 'stop',
          }],
        }).content;
      }
      return format.decodeResponse({
        choices: [{ message: { content: 'Both tools completed.' }, finish_reason: 'stop' }],
      }).content;
    };

    const result = await loop.run([
      { role: 'user', parts: [{ text: 'run both tools' }] },
    ], callLLM);

    expect(result.text).toBe('Both tools completed.');
    expect(firstHandler).toHaveBeenCalledWith({ value: 6 }, expect.any(Object));
    expect(secondHandler).toHaveBeenCalledWith({ text: 'iris' }, expect.any(Object));
    expect(encodedRequests).toHaveLength(2);

    const secondBody = encodedRequests[1];
    const assistantHistory = secondBody.messages.find((message: any) =>
      message.role === 'assistant' && String(message.content).includes(TAGGED_JSON_TOOL_CALL_OPEN));
    const resultHistory = secondBody.messages.find((message: any) =>
      message.role === 'user' && String(message.content).includes(TAGGED_JSON_TOOL_RESULT_OPEN));
    const callPayloads = parseBlocks(
      assistantHistory.content,
      TAGGED_JSON_TOOL_CALL_OPEN,
      TAGGED_JSON_TOOL_CALL_CLOSE,
    );
    const resultPayloads = parseBlocks(
      resultHistory.content,
      TAGGED_JSON_TOOL_RESULT_OPEN,
      TAGGED_JSON_TOOL_RESULT_CLOSE,
    );

    expect(callPayloads.map(payload => payload.name)).toEqual(['first_tool', 'second_tool']);
    expect(resultPayloads.map(payload => payload.name)).toEqual(['first_tool', 'second_tool']);
    expect(resultPayloads.map(payload => payload.call_id))
      .toEqual(callPayloads.map(payload => payload.call_id));
    expect(resultPayloads.map(payload => payload.result.result)).toEqual([
      { doubled: 12 },
      { upper: 'IRIS' },
    ]);
    expect(functionCalls(result.history.flatMap(message => message.parts))).toHaveLength(2);
  });
});
