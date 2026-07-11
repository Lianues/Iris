import { describe, expect, it } from 'vitest';
import {
  findLiveAssistantTargetIndex,
  findResponseMetadataTargetIndex,
  type MessageTargetLike,
} from '../extensions/console/src/message-target.js';

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
});
