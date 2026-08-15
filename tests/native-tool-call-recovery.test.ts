import { describe, expect, it, vi } from 'vitest';

import { ToolLoop } from '../src/core/tool-loop.js';
import { OpenAICompatibleFormat } from '../src/llm/formats/openai-compatible.js';
import { PromptAssembler } from '../src/prompt/assembler.js';
import { ToolRegistry } from '../src/tools/registry.js';
import type { Content, FunctionCallPart } from '../src/types/index.js';

function prompt(): PromptAssembler {
  const value = new PromptAssembler();
  value.setSystemPrompt('test');
  return value;
}

describe('native OpenAI-compatible tool call recovery', () => {
  it('keeps native tools and injects same-response tool-use instructions', () => {
    const format = new OpenAICompatibleFormat('test-model');
    const body = format.encodeRequest({
      systemInstruction: { parts: [{ text: 'base system prompt' }] },
      contents: [{ role: 'user', parts: [{ text: 'inspect it' }] }],
      tools: [{
        functionDeclarations: [{
          name: 'read_file',
          description: 'read a file',
          parameters: {
            type: 'object',
            properties: { file_path: { type: 'string' } },
            required: ['file_path'],
          },
        }],
      }],
    }) as any;

    expect(body.tools).toHaveLength(1);
    expect(body.messages[0].content)
      .toContain('provider-native tool/function calling mechanism');
    expect(body.messages[0].content)
      .toContain('Never end with only a promise, plan, or preamble');
    expect(body.messages[0].content)
      .toContain('Do not print serialized tool-call JSON');
  });

  it('blocks truncated argument JSON in non-stream responses too', () => {
    const format = new OpenAICompatibleFormat('test-model');
    const response = format.decodeResponse({
      choices: [{
        message: {
          role: 'assistant',
          content: 'Checking.',
          tool_calls: [{
            id: 'call_non_stream_bad',
            type: 'function',
            function: { name: 'read_file', arguments: '{"file_path":"unfinished' },
          }],
        },
        finish_reason: 'tool_calls',
      }],
    });

    const call = response.content.parts
      .find((part): part is FunctionCallPart => 'functionCall' in part);
    expect(call?.functionCall.callId).toBe('call_non_stream_bad');
    expect(call?.functionCall.protocolError?.code).toBe('invalid_arguments_json');
  });

  it('turns truncated argument JSON into a blocked protocol-error call', () => {
    const format = new OpenAICompatibleFormat('test-model');
    const state = format.createStreamState();

    format.decodeStreamChunk({
      choices: [{
        delta: {
          tool_calls: [{
            index: 0,
            id: 'call_truncated',
            function: {
              name: 'read_file',
              arguments: '{"file_path":"D:\\\\code\\\\Iris\\\\tests\\\\skill-system.test.ts',
            },
          }],
        },
      }],
    }, state);
    const end = format.decodeStreamChunk({
      choices: [{ delta: {}, finish_reason: 'tool_calls' }],
    }, state);

    expect(end.functionCalls).toHaveLength(1);
    const call = end.functionCalls![0].functionCall;
    expect(call.name).toBe('read_file');
    expect(call.callId).toBe('call_truncated');
    expect(call.args).toEqual({});
    expect(call.protocolError?.code).toBe('invalid_arguments_json');
    expect(call.protocolError?.rawArgumentsPreview).toContain('file_path');
  });

  it('flushes a truncated native call when SSE ends without finish_reason', () => {
    const format = new OpenAICompatibleFormat('test-model');
    const state = format.createStreamState();
    format.decodeStreamChunk({
      choices: [{
        delta: {
          tool_calls: [{
            index: 0,
            id: 'call_no_finish',
            function: { name: 'grep', arguments: '{"pattern":"read_skill"' },
          }],
        },
      }],
    }, state);

    const final = format.finalizeStream(state);
    expect(final?.functionCalls).toHaveLength(1);
    expect(final?.functionCalls?.[0].functionCall.protocolError?.code)
      .toBe('invalid_arguments_json');
  });

  it('does not accept finish_reason=tool_calls without a decodable call', () => {
    const format = new OpenAICompatibleFormat('test-model');
    const end = format.decodeStreamChunk({
      choices: [{ delta: {}, finish_reason: 'tool_calls' }],
    }, format.createStreamState());

    expect(end.functionCalls).toHaveLength(1);
    expect(end.functionCalls![0].functionCall.name).toBe('__invalid_tool_call__');
    expect(end.functionCalls![0].functionCall.protocolError?.code).toBe('missing_tool_call');
  });

  it('feeds protocol errors back to the model without invoking the real tool', async () => {
    const registry = new ToolRegistry();
    const handler = vi.fn(async () => ({ ok: true }));
    registry.register({
      declaration: { name: 'read_file', description: 'read a file' },
      handler,
    });
    const loop = new ToolLoop(registry, prompt(), {
      maxRounds: 3,
      toolsConfig: { permissions: { read_file: { autoApprove: true } } },
    });
    let round = 0;
    const malformedCall: FunctionCallPart = {
      functionCall: {
        name: 'read_file',
        args: {},
        callId: 'call_bad',
        protocolError: {
          code: 'invalid_arguments_json',
          message: 'arguments JSON was truncated',
          rawArgumentsPreview: '{"file_path":"unfinished',
          rawArgumentsLength: 24,
        },
      },
    };

    const result = await loop.run(
      [{ role: 'user', parts: [{ text: 'inspect it' }] }],
      async (request): Promise<Content> => {
        round++;
        if (round === 1) return { role: 'model', parts: [malformedCall] };
        const response = request.contents
          .flatMap(content => content.parts)
          .find(part => 'functionResponse' in part);
        expect((response as any).functionResponse.response.protocolError)
          .toBe('invalid_arguments_json');
        return { role: 'model', parts: [{ text: 'Recovered.' }] };
      },
    );

    expect(handler).not.toHaveBeenCalled();
    expect(round).toBe(2);
    expect(result.text).toBe('Recovered.');
  });

  it('returns an LLM error instead of committing an empty final response', async () => {
    const loop = new ToolLoop(new ToolRegistry(), prompt(), {
      maxRounds: 1,
      toolsConfig: { permissions: {} },
      retryOnError: false,
    });
    const history: Content[] = [{ role: 'user', parts: [{ text: 'hello' }] }];
    const result = await loop.run(history, async () => ({
      role: 'model',
      parts: [{ text: '' }],
    }));

    expect(result.error).toContain('LLM 返回了空响应');
    expect(result.text).toBe('');
    expect(result.history).toHaveLength(1);
  });

  it('treats a thought-only provider response as empty and does not commit it', async () => {
    const loop = new ToolLoop(new ToolRegistry(), prompt(), {
      maxRounds: 1,
      toolsConfig: { permissions: {} },
      retryOnError: false,
    });
    const history: Content[] = [{ role: 'user', parts: [{ text: 'hello' }] }];
    const result = await loop.run(history, async () => ({
      role: 'model',
      parts: [{ text: 'I will call the tool now.', thought: true }],
    }));

    expect(result.error).toContain('LLM 返回了空响应');
    expect(result.text).toBe('');
    expect(result.history).toHaveLength(1);
  });
});
