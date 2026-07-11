import { describe, expect, it, vi } from 'vitest';
import {
  ToolLoop,
  type ContextCheckpointRequest,
  type LLMCaller,
} from '../src/core/tool-loop.js';
import { markLLMErrorPartialOutput } from '../src/core/context-overflow.js';
import { PromptAssembler } from '../src/prompt/assembler.js';
import { ToolRegistry } from '../src/tools/registry.js';
import type { Content, FunctionCallPart, ToolExecutionContext } from '../src/types/index.js';

function createLoop(toolHandler: (context?: ToolExecutionContext) => Promise<unknown>) {
  const registry = new ToolRegistry();
  registry.register({
    declaration: { name: 'step', description: 'perform one step' },
    handler: async (_args, context) => toolHandler(context),
  });
  const prompt = new PromptAssembler();
  prompt.setSystemPrompt('test');
  return new ToolLoop(registry, prompt, {
    maxRounds: 8,
    retryOnError: true,
    maxRetries: 3,
    toolsConfig: { permissions: { step: { autoApprove: true } } },
  });
}

function toolCall(callId = 'call-step'): Content {
  const part: FunctionCallPart = {
    functionCall: { name: 'step', args: {}, callId },
  };
  return { role: 'model', parts: [part] };
}

function final(text: string): Content {
  return { role: 'model', parts: [{ text }] };
}

const checkpointHistory = (): Content[] => [{
  role: 'user',
  parts: [{ text: '[Context Summary]\n\nstep completed; continue with final response' }],
  isSummary: true,
}];

describe('ToolLoop context checkpoints', () => {
  it('replaces history between closed tool rounds and continues without replaying the tool', async () => {
    const toolHandler = vi.fn(async () => ({ ok: true }));
    const loop = createLoop(toolHandler);
    const requests: string[] = [];
    let llmCalls = 0;
    const callLLM: LLMCaller = async (request) => {
      requests.push(JSON.stringify(request.contents));
      llmCalls++;
      return llmCalls === 1 ? toolCall() : final('done');
    };
    const checkpoints: ContextCheckpointRequest[] = [];

    const result = await loop.run(
      [{ role: 'user', parts: [{ text: 'do a long task' }] }],
      callLLM,
      {
        onContextCheckpoint: async (context) => {
          checkpoints.push(context);
          if (context.round === 2 && !context.compactedThisRound) return checkpointHistory();
          return undefined;
        },
      },
    );

    expect(result.text).toBe('done');
    expect(toolHandler).toHaveBeenCalledTimes(1);
    expect(llmCalls).toBe(2);
    expect(checkpoints.some(item => item.round === 2 && item.compactedThisRound)).toBe(true);
    expect(requests[1]).toContain('step completed; continue with final response');
    expect(requests[1]).not.toContain('do a long task');
  });

  it('supports multiple checkpoints in different rounds of one long task', async () => {
    const toolHandler = vi.fn(async () => ({ ok: true }));
    const loop = createLoop(toolHandler);
    let llmCalls = 0;
    const callLLM: LLMCaller = async () => {
      llmCalls++;
      if (llmCalls === 1) return toolCall('step-1');
      if (llmCalls === 2) return toolCall('step-2');
      return final('all done');
    };
    const compactedRounds: number[] = [];

    const result = await loop.run(
      [{ role: 'user', parts: [{ text: 'multi-stage task' }] }],
      callLLM,
      {
        onContextCheckpoint: async (context) => {
          if (
            (context.round === 2 || context.round === 3)
            && !context.compactedThisRound
          ) {
            compactedRounds.push(context.round);
            return [{
              role: 'user',
              parts: [{ text: `[Context Summary] completed through round ${context.round - 1}` }],
              isSummary: true,
            }];
          }
          return undefined;
        },
      },
    );

    expect(result.text).toBe('all done');
    expect(compactedRounds).toEqual([2, 3]);
    expect(llmCalls).toBe(3);
    expect(toolHandler).toHaveBeenCalledTimes(2);
  });

  it('recovers a later-round zero-output context overflow in the same round only once', async () => {
    const toolHandler = vi.fn(async () => ({ ok: true }));
    const loop = createLoop(toolHandler);
    let llmCalls = 0;
    const callLLM: LLMCaller = async () => {
      llmCalls++;
      if (llmCalls === 1) return toolCall();
      if (llmCalls === 2) throw new Error('context_length_exceeded: maximum context length reached');
      return final('recovered');
    };
    const overflowRounds: number[] = [];
    const onRetry = vi.fn();

    const result = await loop.run(
      [{ role: 'user', parts: [{ text: 'continue until done' }] }],
      callLLM,
      {
        onRetry,
        onContextCheckpoint: async (context) => {
          if (context.cause === 'context-overflow') {
            overflowRounds.push(context.round);
            return checkpointHistory();
          }
          return undefined;
        },
      },
    );

    expect(result.text).toBe('recovered');
    expect(toolHandler).toHaveBeenCalledTimes(1);
    expect(llmCalls).toBe(3);
    expect(overflowRounds).toEqual([2]);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('does not compact/retry an overflow after partial model output', async () => {
    const toolHandler = vi.fn(async () => ({ ok: true }));
    const loop = createLoop(toolHandler);
    let llmCalls = 0;
    const callLLM: LLMCaller = async () => {
      llmCalls++;
      if (llmCalls === 1) return toolCall();
      throw markLLMErrorPartialOutput(
        new Error('context window limit exceeded after partial stream'),
        true,
      );
    };
    const overflowCheckpoint = vi.fn(async () => checkpointHistory());

    const result = await loop.run(
      [{ role: 'user', parts: [{ text: 'long task' }] }],
      callLLM,
      {
        onContextCheckpoint: async (context) => {
          if (context.cause === 'context-overflow') return overflowCheckpoint();
          return undefined;
        },
      },
    );

    expect(result.errorKind).toBe('context_overflow');
    expect(llmCalls).toBe(2);
    expect(toolHandler).toHaveBeenCalledTimes(1);
    expect(overflowCheckpoint).not.toHaveBeenCalled();
  });

  it('rejects a second history replacement in the same round before calling the provider', async () => {
    const loop = createLoop(async () => ({ ok: true }));
    const callLLM = vi.fn(async () => final('should not run'));

    const result = await loop.run(
      [{ role: 'user', parts: [{ text: 'task' }] }],
      callLLM,
      { onContextCheckpoint: async () => checkpointHistory() },
    );

    expect(result.errorKind).toBe('context_compaction');
    expect(result.error).toContain('同一工具轮次内拒绝重复压缩');
    expect(callLLM).not.toHaveBeenCalled();
  });
});
