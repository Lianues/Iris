/**
 * useTextInput — 带光标位置和本地撤销/重做历史的文本输入状态管理
 */
import { useState, useCallback } from 'react';

interface TextInputSnapshot {
  value: string;
  cursor: number;
}

export interface TextInputState {
  value: string;
  cursor: number;
  undoStack?: TextInputSnapshot[];
  redoStack?: TextInputSnapshot[];
}

export interface TextInputKey {
  name: string;
  sequence?: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  preventDefault?: () => void;
}

export interface TextInputActions {
  handleKey: (key: TextInputKey) => boolean;
  insert: (text: string) => void;
  replaceRange: (start: number, end: number, text: string) => void;
  setValue: (value: string) => void;
  set: (value: string, cursor: number) => void;
}

const MAX_UNDO_HISTORY = 100;

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

function snapshotOf(state: TextInputState): TextInputSnapshot {
  return { value: state.value, cursor: state.cursor };
}

function withCursor(state: TextInputState, cursor: number): TextInputState {
  const nextCursor = Math.max(0, Math.min(cursor, state.value.length));
  return nextCursor === state.cursor ? state : { ...state, cursor: nextCursor };
}

function resetHistory(value: string, cursor: number): TextInputState {
  return { value, cursor: Math.max(0, Math.min(cursor, value.length)), undoStack: [], redoStack: [] };
}

function withUndoHistory(previous: TextInputState, next: TextInputSnapshot): TextInputState {
  if (previous.value === next.value && previous.cursor === next.cursor) return previous;
  return {
    value: next.value,
    cursor: Math.max(0, Math.min(next.cursor, next.value.length)),
    undoStack: [...(previous.undoStack ?? []), snapshotOf(previous)].slice(-MAX_UNDO_HISTORY),
    redoStack: [],
  };
}

function undoTextInput(state: TextInputState): TextInputState {
  const undoStack = state.undoStack ?? [];
  if (undoStack.length === 0) return state;
  const previous = undoStack[undoStack.length - 1];
  return {
    ...previous,
    undoStack: undoStack.slice(0, -1),
    redoStack: [...(state.redoStack ?? []), snapshotOf(state)].slice(-MAX_UNDO_HISTORY),
  };
}

function redoTextInput(state: TextInputState): TextInputState {
  const redoStack = state.redoStack ?? [];
  if (redoStack.length === 0) return state;
  const next = redoStack[redoStack.length - 1];
  return {
    ...next,
    undoStack: [...(state.undoStack ?? []), snapshotOf(state)].slice(-MAX_UNDO_HISTORY),
    redoStack: redoStack.slice(0, -1),
  };
}

function isUndoShortcut(key: TextInputKey): boolean {
  return (key.ctrl === true && key.name === 'z' && key.shift !== true) || key.sequence === '\x1a';
}

function isRedoShortcut(key: TextInputKey): boolean {
  return (key.ctrl === true && key.name === 'y')
    || (key.ctrl === true && key.shift === true && key.name === 'z')
    || key.sequence === '\x19';
}

export function isTextInputKeyHandled(key: TextInputKey): boolean {
  if (isUndoShortcut(key) || isRedoShortcut(key)) return true;
  if (key.name === 'left' || key.name === 'right' || key.name === 'home' || key.name === 'end') return true;
  if (key.name === 'backspace' || key.name === 'delete') return true;
  if ((['a', 'e', 'u', 'k', 'd'] as string[]).includes(key.name) && key.ctrl) return true;
  if (key.sequence && key.sequence.length === 1 && !key.ctrl && !key.meta) return true;
  return false;
}

export function applyTextInputKey(state: TextInputState, key: TextInputKey): TextInputState {
  const { value, cursor } = state;

  // 先判断 redo，避免 Ctrl+Shift+Z 在某些终端同时带有 Ctrl+Z 序列时被当作 undo。
  if (isRedoShortcut(key)) return redoTextInput(state);
  if (isUndoShortcut(key)) return undoTextInput(state);

  if (key.name === 'left' && !key.ctrl && !key.meta) {
    return withCursor(state, cursor - 1);
  }
  if (key.name === 'right' && !key.ctrl && !key.meta) {
    return withCursor(state, cursor + 1);
  }
  if (key.name === 'left' && (key.ctrl || key.meta)) {
    return withCursor(state, wordBoundaryLeft(value, cursor));
  }
  if (key.name === 'right' && (key.ctrl || key.meta)) {
    return withCursor(state, wordBoundaryRight(value, cursor));
  }
  if (key.name === 'home' || (key.name === 'a' && key.ctrl)) {
    return withCursor(state, 0);
  }
  if (key.name === 'end' || (key.name === 'e' && key.ctrl)) {
    return withCursor(state, value.length);
  }
  if (key.name === 'backspace') {
    if (cursor === 0) return state;
    if (key.ctrl || key.meta) {
      const to = wordBoundaryLeft(value, cursor);
      return withUndoHistory(state, { value: value.slice(0, to) + value.slice(cursor), cursor: to });
    }
    return withUndoHistory(state, { value: value.slice(0, cursor - 1) + value.slice(cursor), cursor: cursor - 1 });
  }
  if (key.name === 'delete' || (key.name === 'd' && key.ctrl)) {
    if (cursor >= value.length) return state;
    return withUndoHistory(state, { value: value.slice(0, cursor) + value.slice(cursor + 1), cursor });
  }
  if (key.name === 'u' && key.ctrl) {
    return withUndoHistory(state, { value: value.slice(cursor), cursor: 0 });
  }
  if (key.name === 'k' && key.ctrl) {
    return withUndoHistory(state, { value: value.slice(0, cursor), cursor });
  }
  if (key.sequence && key.sequence.length === 1 && !key.ctrl && !key.meta) {
    return withUndoHistory(state, { value: value.slice(0, cursor) + key.sequence + value.slice(cursor), cursor: cursor + 1 });
  }
  return state;
}

export function insertTextInputValue(state: TextInputState, text: string): TextInputState {
  if (!text) return state;
  return withUndoHistory(state, {
    value: state.value.slice(0, state.cursor) + text + state.value.slice(state.cursor),
    cursor: state.cursor + text.length,
  });
}

export function replaceTextInputRange(state: TextInputState, start: number, end: number, text: string): TextInputState {
  const from = Math.max(0, Math.min(start, state.value.length));
  const to = Math.max(from, Math.min(end, state.value.length));
  return withUndoHistory(state, {
    value: state.value.slice(0, from) + text + state.value.slice(to),
    cursor: from + text.length,
  });
}

export function useTextInput(initialValue = ''): [TextInputState, TextInputActions] {
  const [state, setState] = useState<TextInputState>(() => resetHistory(initialValue, initialValue.length));

  const handleKey = useCallback(
    (key: TextInputKey): boolean => {
      if (!isTextInputKeyHandled(key)) return false;

      // OpenTUI 先触发全局 useKeyboard，再触发当前聚焦 renderable 的键盘处理。
      // 文本输入消费的按键必须阻止默认行为，否则 focused <scrollbox> 会继续
      // 收到裸字母（例如 k/j/h/l）并触发 Vim 风格滚动，导致“输入 k 聊天记录上滚”。
      // Ctrl+Z 也必须在输入框内被消费，避免落到终端默认的进程挂起语义。
      key.preventDefault?.();

      setState((current) => applyTextInputKey(current, key));
      return true;
    },
    [],
  );

  const insert = useCallback((text: string) => {
    setState((current) => insertTextInputValue(current, text));
  }, []);

  const replaceRange = useCallback((start: number, end: number, text: string) => {
    setState((current) => replaceTextInputRange(current, start, end, text));
  }, []);

  const setValue = useCallback((value: string) => {
    setState(resetHistory(value, value.length));
  }, []);

  const set = useCallback((value: string, cursor: number) => {
    setState(resetHistory(value, cursor));
  }, []);

  return [state, { handleKey, insert, replaceRange, setValue, set }];
}
