import { describe, expect, it } from 'vitest';
import {
  findLiveAssistantTargetIndex,
  findResponseMetadataTargetIndex,
  type MessageTargetLike,
} from '../extensions/console/src/message-target.js';
import {
  getHistoryMessageMeta,
  resolveLoadedSessionContextTokenCount,
} from '../extensions/console/src/history-usage.js';
import type { Content } from '../src/types/index.js';

const assistant = (extra: Partial<MessageTargetLike> = {}): MessageTargetLike => ({
  role: 'assistant',
  ...extra,
});
const user = (extra: Partial<MessageTargetLike> = {}): MessageTargetLike => ({
  role: 'user',
  ...extra,
});

describe('Console compact message targets', () => {
  it('does not merge a resumed stream across a summary boundary', () => {
    const messages = [
      user(),
      assistant(),
      user({ isSummary: true }),
      assistant({ isCommand: true }),
    ];
    expect(findLiveAssistantTargetIndex(messages)).toBe(-1);
  });

  it('still reuses an assistant hidden only by a command in the same turn', () => {
    const messages = [user(), assistant(), assistant({ isCommand: true })];
    expect(findLiveAssistantTargetIndex(messages)).toBe(1);
  });

  it('attaches done metadata to the real response before post-turn compact UI messages', () => {
    const messages = [
      user(),
      assistant(),
      user({ isSummary: true }),
      assistant({ isCommand: true }),
    ];
    expect(findResponseMetadataTargetIndex(messages)).toBe(1);
  });

  it('does not cross a new ordinary user turn while resolving done metadata', () => {
    const messages = [user(), assistant(), user(), assistant({ isError: true })];
    expect(findResponseMetadataTargetIndex(messages)).toBe(-1);
  });

  it('keeps summary card tokens separate from the restored full context tokens', () => {
    const history: Content[] = [{
      role: 'user',
      parts: [{ text: '[Context Summary]\n\nshort summary' }],
      isSummary: true,
      usageMetadata: {
        promptTokenCount: 37,
        totalTokenCount: 37,
      },
      compactedContextTokenCount: 412,
    }];

    expect(getHistoryMessageMeta(history[0])).toMatchObject({
      isSummary: true,
      tokenIn: 37,
    });
    expect(resolveLoadedSessionContextTokenCount(history)).toBe(412);
  });

  it('prefers the latest model provider usage after a summary', () => {
    const history: Content[] = [
      {
        role: 'user',
        parts: [{ text: '[Context Summary]\n\nsummary' }],
        isSummary: true,
        usageMetadata: { totalTokenCount: 20 },
        compactedContextTokenCount: 300,
      },
      {
        role: 'model',
        parts: [{ text: 'first response' }],
        usageMetadata: { totalTokenCount: 450 },
      },
      { role: 'user', parts: [{ text: 'next question' }] },
      {
        role: 'model',
        parts: [{ text: 'latest response' }],
        usageMetadata: { totalTokenCount: 525 },
      },
    ];

    expect(resolveLoadedSessionContextTokenCount(history)).toBe(525);
  });

  it('uses Backend recovery only for legacy transcripts that contain a summary', () => {
    const legacySummary: Content[] = [{
      role: 'user',
      parts: [{ text: '[Context Summary]\n\nlegacy summary' }],
      isSummary: true,
      usageMetadata: { promptTokenCount: 19, totalTokenCount: 19 },
    }];
    const ordinaryHistory: Content[] = [{
      role: 'model',
      parts: [{ text: 'ordinary response' }],
      usageMetadata: { totalTokenCount: 91 },
    }];

    expect(resolveLoadedSessionContextTokenCount(legacySummary, 275)).toBe(275);
    expect(resolveLoadedSessionContextTokenCount(ordinaryHistory, 275)).toBeUndefined();
  });
});
