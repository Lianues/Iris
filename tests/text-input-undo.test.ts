import { describe, expect, it, vi } from 'vitest';

vi.mock('react', () => ({
  useCallback: (fn: unknown) => fn,
  useState: (initial: unknown) => [typeof initial === 'function' ? (initial as () => unknown)() : initial, () => undefined],
}));

import {
  applyTextInputKey as applyConsoleTextInputKey,
  insertTextInputValue as insertConsoleTextInputValue,
  isTextInputKeyHandled as isConsoleTextInputKeyHandled,
  type TextInputState as ConsoleTextInputState,
} from '../extensions/console/src/hooks/use-text-input';
import {
  applyTextInputKey as applyTerminalTextInputKey,
  insertTextInputValue as insertTerminalTextInputValue,
  isTextInputKeyHandled as isTerminalTextInputKeyHandled,
  type TextInputState as TerminalTextInputState,
} from '../terminal/src/shared/hooks/use-text-input';

type TextInputState = ConsoleTextInputState | TerminalTextInputState;

function visible(state: TextInputState): { value: string; cursor: number } {
  return { value: state.value, cursor: state.cursor };
}

const implementations = [
  {
    name: 'console useTextInput',
    apply: applyConsoleTextInputKey,
    insert: insertConsoleTextInputValue,
    handled: isConsoleTextInputKeyHandled,
  },
  {
    name: 'terminal shared useTextInput',
    apply: applyTerminalTextInputKey,
    insert: insertTerminalTextInputValue,
    handled: isTerminalTextInputKeyHandled,
  },
];

describe('text input undo/redo shortcuts', () => {
  for (const impl of implementations) {
    it(`${impl.name}: Ctrl+Z 撤销输入，Ctrl+Y / Ctrl+Shift+Z 重做`, () => {
      let state: TextInputState = { value: '', cursor: 0 };

      state = impl.apply(state, { name: 'a', sequence: 'a' });
      state = impl.apply(state, { name: 'b', sequence: 'b' });
      expect(visible(state)).toEqual({ value: 'ab', cursor: 2 });
      expect(impl.handled({ name: 'z', ctrl: true })).toBe(true);

      state = impl.apply(state, { name: 'z', ctrl: true });
      expect(visible(state)).toEqual({ value: 'a', cursor: 1 });

      state = impl.apply(state, { name: 'y', ctrl: true });
      expect(visible(state)).toEqual({ value: 'ab', cursor: 2 });

      state = impl.apply(state, { name: 'z', ctrl: true });
      expect(visible(state)).toEqual({ value: 'a', cursor: 1 });

      state = impl.apply(state, { name: 'z', ctrl: true, shift: true });
      expect(visible(state)).toEqual({ value: 'ab', cursor: 2 });
    });

    it(`${impl.name}: 粘贴作为一个 undo 单元`, () => {
      let state: TextInputState = { value: '', cursor: 0 };

      state = impl.insert(state, 'hello world');
      expect(visible(state)).toEqual({ value: 'hello world', cursor: 11 });

      state = impl.apply(state, { name: 'z', ctrl: true });
      expect(visible(state)).toEqual({ value: '', cursor: 0 });

      state = impl.apply(state, { name: 'y', ctrl: true });
      expect(visible(state)).toEqual({ value: 'hello world', cursor: 11 });
    });

    it(`${impl.name}: 光标移动不污染撤销栈`, () => {
      let state: TextInputState = { value: '', cursor: 0 };

      state = impl.apply(state, { name: 'a', sequence: 'a' });
      state = impl.apply(state, { name: 'b', sequence: 'b' });
      state = impl.apply(state, { name: 'left' });
      expect(visible(state)).toEqual({ value: 'ab', cursor: 1 });

      state = impl.apply(state, { name: 'z', ctrl: true });
      expect(visible(state)).toEqual({ value: 'a', cursor: 1 });
    });
  }
});
