import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppHandle } from '../extensions/console/src/hooks/use-app-handle.js';

const { reactHarness, reactMock } = vi.hoisted(() => {
  const harness = {
    cursor: 0,
    states: [] as unknown[],
  };
  return {
    reactHarness: harness,
    reactMock: {
      useState(initial: unknown) {
        const index = harness.cursor++;
        const value = typeof initial === 'function'
          ? (initial as () => unknown)()
          : initial;
        harness.states[index] = value;
        const setValue = (next: unknown) => {
          const previous = harness.states[index];
          harness.states[index] = typeof next === 'function'
            ? (next as (value: unknown) => unknown)(previous)
            : next;
        };
        return [value, setValue];
      },
      useRef(initial: unknown) {
        return { current: initial };
      },
      useCallback<T>(callback: T) {
        return callback;
      },
      useEffect(effect: () => void | (() => void)) {
        effect();
      },
    },
  };
});

vi.mock('react', () => reactMock);
vi.mock('../extensions/console/node_modules/react/index.js', () => reactMock);

import { useAppHandle } from '../extensions/console/src/hooks/use-app-handle.js';
import { createUndoRedoStack } from '../extensions/console/src/undo-redo.js';

function mutableRef<T>(current: T): { current: T } {
  return { current };
}

describe('Console AppHandle compact usage', () => {
  beforeEach(() => {
    reactHarness.cursor = 0;
    reactHarness.states.length = 0;
  });

  it('updates contextTokens without replacing the current response usage', () => {
    let handle: AppHandle | undefined;
    const state = useAppHandle({
      onReady: (value) => { handle = value; },
      undoRedoRef: mutableRef(createUndoRedoStack()),
      drainCallbackRef: mutableRef<(() => string | undefined) | null>(null),
      setPendingFilesRef: mutableRef(null),
      openFileBrowserRef: mutableRef(null),
      fileBrowserCallbackRef: mutableRef(null),
      setExtensionListRef: mutableRef(null),
    });

    state.setMessages([{
      id: 'response-1',
      role: 'assistant',
      parts: [{ type: 'text', text: 'answer' }],
    }]);

    handle!.setUsage({
      promptTokenCount: 111,
      candidatesTokenCount: 222,
      totalTokenCount: 333,
    });
    handle!.setCompactUsage({
      promptTokenCount: 444,
      totalTokenCount: 444,
    });

    // useAppHandle 的第六个 useState 槽位是 contextTokens。
    expect(reactHarness.states[5]).toBe(444);

    handle!.finalizeResponse(1_234);
    expect(reactHarness.states[0]).toEqual([expect.objectContaining({
      id: 'response-1',
      tokenIn: 111,
      tokenOut: 222,
      durationMs: 1_234,
    })]);
  });
});
