import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { callLLMStream } from '../src/core/backend/stream.js';
import { hasPartialLLMOutput } from '../src/core/context-overflow.js';
import type { LLMRequest, LLMStreamChunk } from '../src/types/index.js';

const request: LLMRequest = {
  contents: [{ role: 'user', parts: [{ text: 'hello' }] }],
};

function failingStream(chunks: LLMStreamChunk[], error: Error): AsyncGenerator<LLMStreamChunk> {
  return (async function* () {
    for (const chunk of chunks) yield chunk;
    throw error;
  })();
}

describe('callLLMStream lifecycle', () => {
  it('always closes stream state when the provider fails before output', async () => {
    const emitter = new EventEmitter();
    const events: string[] = [];
    emitter.on('stream:start', () => events.push('start'));
    emitter.on('stream:end', () => events.push('end'));
    const router = {
      chatStream: vi.fn(() => failingStream([], new Error('context_length_exceeded'))),
      getCurrentModelName: vi.fn(() => 'mock'),
    } as any;

    let caught: unknown;
    try {
      await callLLMStream(router, emitter, 's1', request);
    } catch (error) {
      caught = error;
    }

    expect(events).toEqual(['start', 'end']);
    expect(caught).toBeInstanceOf(Error);
    expect(hasPartialLLMOutput(caught)).toBe(false);
  });

  it('marks failures after visible output so ToolLoop will not replay the request', async () => {
    const emitter = new EventEmitter();
    const events: string[] = [];
    emitter.on('stream:start', () => events.push('start'));
    emitter.on('stream:parts', () => events.push('parts'));
    emitter.on('stream:end', () => events.push('end'));
    const router = {
      chatStream: vi.fn(() => failingStream(
        [{ partsDelta: [{ text: 'partial' }] }],
        new Error('context window limit exceeded'),
      )),
      getCurrentModelName: vi.fn(() => 'mock'),
    } as any;

    let caught: unknown;
    try {
      await callLLMStream(router, emitter, 's1', request);
    } catch (error) {
      caught = error;
    }

    expect(events).toEqual(['start', 'parts', 'end']);
    expect(hasPartialLLMOutput(caught)).toBe(true);
  });
});
