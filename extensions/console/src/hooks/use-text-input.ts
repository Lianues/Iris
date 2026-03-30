/**
 * useTextInput — 带光标位置的文本输入状态管理
 */
import { useState, useCallback } from 'react';

export interface TextInputState {
  value: string;
  cursor: number;
}

export interface TextInputActions {
  handleKey: (key: { name: string; sequence?: string; ctrl?: boolean; meta?: boolean }) => boolean;
  insert: (text: string) => void;
  setValue: (value: string) => void;
  set: (value: string, cursor: number) => void;
}

function wordBoundaryLeft(text: string, pos: number): number {
  if (pos <= 0) return 0;
  let i = pos - 1;
  while (i > 0 && !/[a-zA-Z0-9_\-.]/.test(text[i])) i--;
  while (i > 0 && /[a-zA-Z0-9_\-.]/.test(text[i - 1])) i--;
  return i;
}

function wordBoundaryRight(text: string, pos: number): number {
  const len = text.length;
  if (pos >= len) return len;
  let i = pos;
  while (i < len && /[a-zA-Z0-9_\-.]/.test(text[i])) i++;
  while (i < len && !/[a-zA-Z0-9_\-.]/.test(text[i])) i++;
  return i;
}

export function useTextInput(initialValue = ''): [TextInputState, TextInputActions] {
  const [state, setState] = useState<TextInputState>({
    value: initialValue,
    cursor: initialValue.length,
  });

  const handleKey = useCallback(
    (key: { name: string; sequence?: string; ctrl?: boolean; meta?: boolean }): boolean => {
      setState((s) => {
        const { value, cursor } = s;

        if (key.name === 'left' && !key.ctrl && !key.meta) {
          return { value, cursor: Math.max(0, cursor - 1) };
        }
        if (key.name === 'right' && !key.ctrl && !key.meta) {
          return { value, cursor: Math.min(value.length, cursor + 1) };
        }
        if (key.name === 'left' && (key.ctrl || key.meta)) {
          return { value, cursor: wordBoundaryLeft(value, cursor) };
        }
        if (key.name === 'right' && (key.ctrl || key.meta)) {
          return { value, cursor: wordBoundaryRight(value, cursor) };
        }
        if (key.name === 'home' || (key.name === 'a' && key.ctrl)) {
          return { value, cursor: 0 };
        }
        if (key.name === 'end' || (key.name === 'e' && key.ctrl)) {
          return { value, cursor: value.length };
        }
        if (key.name === 'backspace') {
          if (cursor === 0) return s;
          if (key.ctrl || key.meta) {
            const to = wordBoundaryLeft(value, cursor);
            return { value: value.slice(0, to) + value.slice(cursor), cursor: to };
          }
          return { value: value.slice(0, cursor - 1) + value.slice(cursor), cursor: cursor - 1 };
        }
        if (key.name === 'delete' || (key.name === 'd' && key.ctrl)) {
          if (cursor >= value.length) return s;
          return { value: value.slice(0, cursor) + value.slice(cursor + 1), cursor };
        }
        if (key.name === 'u' && key.ctrl) {
          return { value: value.slice(cursor), cursor: 0 };
        }
        if (key.name === 'k' && key.ctrl) {
          return { value: value.slice(0, cursor), cursor };
        }
        if (key.sequence && key.sequence.length === 1 && !key.ctrl && !key.meta) {
          return { value: value.slice(0, cursor) + key.sequence + value.slice(cursor), cursor: cursor + 1 };
        }
        return s;
      });

      if (key.name === 'left' || key.name === 'right' || key.name === 'home' || key.name === 'end') return true;
      if (key.name === 'backspace' || key.name === 'delete') return true;
      if ((['a', 'e', 'u', 'k', 'd'] as string[]).includes(key.name) && key.ctrl) return true;
      if (key.sequence && key.sequence.length === 1 && !key.ctrl && !key.meta) return true;
      return false;
    },
    [],
  );

  const insert = useCallback((text: string) => {
    setState((s) => ({
      value: s.value.slice(0, s.cursor) + text + s.value.slice(s.cursor),
      cursor: s.cursor + text.length,
    }));
  }, []);

  const setValue = useCallback((value: string) => {
    setState({ value, cursor: value.length });
  }, []);

  const set = useCallback((value: string, cursor: number) => {
    setState({ value, cursor: Math.min(cursor, value.length) });
  }, []);

  return [state, { handleKey, insert, setValue, set }];
}
