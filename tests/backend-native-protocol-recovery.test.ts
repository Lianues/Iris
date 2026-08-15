import { describe, expect, it, vi } from 'vitest';

import { Backend } from '../src/core/backend/backend.js';
import { PromptAssembler } from '../src/prompt/assembler.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { ToolStateManager } from '../src/tools/state.js';
import type {
  Content,
  FunctionCallPart,
  LLMRequest,
  LLMStreamChunk,
  Part,
} from '../src/types/index.js';

function createStorage() {
  const histories = new Map<string, Content[]>();
  return {
    getHistory: vi.fn(async (sessionId: string) => histories.get(sessionId) ?? []),
    addMessage: vi.fn(async (sessionId: string, message: Content) => {
      if (!histories.has(sessionId)) histories.set(sessionId, []);
      histories.get(sessionId)!.push(message);
    }),
    getMeta: vi.fn(async () => undefined),
    updateMeta: vi.fn(async () => {}),
    saveMeta: vi.fn(async () => {}),
    clearHistory: vi.fn(async (sessionId: string) => histories.delete(sessionId)),
    listSessionMetas: vi.fn(async () => []),
    listSessions: vi.fn(async () => []),
    clearSession: vi.fn(async (sessionId: string) => histories.delete(sessionId)),
    truncateHistory: vi.fn(async () => {}),
    updateLastMessage: vi.fn(async () => {}),
    _histories: histories,
  };
}

function malformedShellCall(callId = 'bad_shell_call'): FunctionCallPart {
  return {
    functionCall: {
      name: 'shell_probe',
      args: {},
      callId,
      protocolError: {
        code: 'invalid_arguments_json',
        message: 'arguments JSON was truncated',
        rawArgumentsPreview: '{"command":"git status',
        rawArgumentsLength: 22,
      },
    },
  };
}

function createPrompt(): PromptAssembler {
  const prompt = new PromptAssembler();
  prompt.setSystemPrompt('test system prompt');
  return prompt;
}

function createNativeConfig() {
  return {
    provider: 'openai-compatible' as const,
    apiKey: 'test-key',
    model: 'mock-model',
    baseUrl: 'https://example.invalid/v1',
    toolCallProtocol: 'native' as const,
  };
}

describe('Backend native protocol recovery', () => {
  it('discards a malformed streamed call and regenerates it once non-streaming', async () => {
    const storage = createStorage();
    const tools = new ToolRegistry();
    const toolState = new ToolStateManager();
    const handler = vi.fn(async () => ({ clean: true }));
    tools.register({
      declaration: {
        name: 'shell_probe',
        description: 'Run a harmless diagnostic command',
        parameters: {
          type: 'object',
          properties: { command: { type: 'string' } },
          required: ['command'],
        },
      },
      handler,
    });

    let streamRound = 0;
    const chatStream = vi.fn(async function* (): AsyncGenerator<LLMStreamChunk> {
      streamRound++;
      if (streamRound === 1) {
        yield { partsDelta: [malformedShellCall()] };
      } else {
        yield {
          partsDelta: [{ text: '检查完成，仓库状态正常。' }],
          textDelta: '检查完成，仓库状态正常。',
        };
      }
    });
    const chat = vi.fn(async () => ({
      content: {
        role: 'model' as const,
        parts: [{
          functionCall: {
            name: 'shell_probe',
            args: { command: 'git status' },
            callId: 'recovered_shell_call',
          },
        }] as Part[],
      },
      usageMetadata: { totalTokenCount: 120 },
    }));
    const config = createNativeConfig();
    const router = {
      chat,
      chatStream,
      getCurrentModelName: vi.fn(() => 'mock-model'),
      getModelInfo: vi.fn(() => ({})),
      getModelConfig: vi.fn(() => config),
    } as any;
    const backend = new Backend(
      router, storage as any, tools, toolState, createPrompt(),
      {
        stream: true,
        maxToolRounds: 5,
        currentLLMConfig: config,
        toolsConfig: { permissions: { shell_probe: { autoApprove: true } } },
      },
    );
    backend.on('error', () => {});
    const retrySpy = vi.fn();
    backend.on('retry', retrySpy);
    const streamedParts: Part[] = [];
    backend.on('stream:parts', (_sessionId, parts) => streamedParts.push(...parts));

    await backend.chat('native-stream-recovery', '检查仓库状态');

    expect(chatStream).toHaveBeenCalledTimes(2);
    expect(chat).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(
      { command: 'git status' },
      expect.objectContaining({ sessionId: 'native-stream-recovery' }),
    );
    const recoveryRequest = chat.mock.calls[0][0] as LLMRequest;
    const systemText = recoveryRequest.systemInstruction?.parts
      .map(part => ('text' in part ? part.text : ''))
      .join('\n') ?? '';
    expect(systemText).toContain('[Native malformed tool-call recovery, attempt 1]');
    expect(retrySpy).toHaveBeenCalledWith(
      'native-stream-recovery', 1, 2,
      '原生工具调用参数在流式响应中不完整，正在改用非流式重试',
    );
    expect(streamedParts.some(part => 'functionCall' in part
      && part.functionCall.protocolError !== undefined)).toBe(false);

    const saved = storage._histories.get('native-stream-recovery') ?? [];
    expect(JSON.stringify(saved)).not.toContain('invalid_arguments_json');
    expect(JSON.stringify(saved)).toContain('recovered_shell_call');
    expect(JSON.stringify(saved)).toContain('检查完成，仓库状态正常。');
  });

  it('stops explicitly after two failed non-stream recoveries without showing empty tools', async () => {
    const storage = createStorage();
    const tools = new ToolRegistry();
    const toolState = new ToolStateManager();
    const handler = vi.fn(async () => ({ shouldNotRun: true }));
    tools.register({
      declaration: {
        name: 'shell_probe',
        description: 'Run a harmless diagnostic command',
        parameters: {
          type: 'object',
          properties: { command: { type: 'string' } },
          required: ['command'],
        },
      },
      handler,
    });
    const chatStream = vi.fn(async function* (): AsyncGenerator<LLMStreamChunk> {
      yield { partsDelta: [malformedShellCall('stream_bad')] };
    });
    const chat = vi.fn(async () => ({
      content: {
        role: 'model' as const,
        parts: [malformedShellCall('non_stream_bad')],
      },
      usageMetadata: { totalTokenCount: 120 },
    }));
    const config = createNativeConfig();
    const router = {
      chat,
      chatStream,
      getCurrentModelName: vi.fn(() => 'mock-model'),
      getModelInfo: vi.fn(() => ({})),
      getModelConfig: vi.fn(() => config),
    } as any;
    const backend = new Backend(
      router, storage as any, tools, toolState, createPrompt(),
      {
        stream: true,
        maxToolRounds: 5,
        currentLLMConfig: config,
        toolsConfig: { permissions: { shell_probe: { autoApprove: true } } },
      },
    );
    backend.on('error', () => {});
    const retrySpy = vi.fn();
    backend.on('retry', retrySpy);
    const streamedParts: Part[] = [];
    backend.on('stream:parts', (_sessionId, parts) => streamedParts.push(...parts));

    await backend.chat('native-stream-stop', '检查仓库状态');

    expect(chatStream).toHaveBeenCalledTimes(1);
    expect(chat).toHaveBeenCalledTimes(2);
    expect(handler).not.toHaveBeenCalled();
    expect(retrySpy).toHaveBeenCalledTimes(2);
    expect(streamedParts.some(part => 'functionCall' in part)).toBe(false);
    const saved = storage._histories.get('native-stream-stop') ?? [];
    expect(JSON.stringify(saved)).not.toContain('invalid_arguments_json');
    expect(JSON.stringify(saved)).toContain('两次非流式恢复也没有得到完整参数');
  });
});
