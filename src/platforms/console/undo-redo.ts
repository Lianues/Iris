/**
 * Console TUI 的 Undo/Redo 栈管理。
 *
 * 纯内存缓存，退出后清空。最多保存 MAX_STACK_SIZE 个操作。
 * undo 弹出消息列表的最后一条，push 到 redo 栈。
 * redo 弹出 redo 栈顶，push 回消息列表末尾。
 * 任何新消息写入都应调用 clearRedo() 使 redo 栈失效。
 */

import type { ChatMessage } from './components/MessageItem';

export const MAX_STACK_SIZE = 200;

export interface UndoRedoStack {
  /** redo 栈（LIFO），栈顶是最近一次 undo 的消息 */
  redoStack: ChatMessage[];
}

export function createUndoRedoStack(): UndoRedoStack {
  return { redoStack: [] };
}

export interface UndoResult {
  /** undo 后的消息列表 */
  messages: ChatMessage[];
  /** 被移除的消息（用于同步 storage） */
  removed: ChatMessage;
}

export interface RedoResult {
  /** redo 后的消息列表 */
  messages: ChatMessage[];
  /** 被恢复的消息（用于同步 storage） */
  restored: ChatMessage;
}

/**
 * 执行 undo：弹出 messages 最后一条，压入 redo 栈。
 * 如果 messages 为空，返回 null。
 */
export function performUndo(
  messages: ChatMessage[],
  stack: UndoRedoStack,
): UndoResult | null {
  if (messages.length === 0) return null;
  const removed = messages[messages.length - 1];
  const next = messages.slice(0, -1);
  stack.redoStack.push(removed);
  // 限制 redo 栈大小
  if (stack.redoStack.length > MAX_STACK_SIZE) {
    stack.redoStack.splice(0, stack.redoStack.length - MAX_STACK_SIZE);
  }
  return { messages: next, removed };
}

/**
 * 执行 redo：弹出 redo 栈顶，追加到 messages 末尾。
 * 如果 redo 栈为空，返回 null。
 */
export function performRedo(
  messages: ChatMessage[],
  stack: UndoRedoStack,
): RedoResult | null {
  if (stack.redoStack.length === 0) return null;
  const restored = stack.redoStack.pop()!;
  const next = [...messages, restored];
  return { messages: next, restored };
}

/**
 * 清空 redo 栈（有新消息写入时调用）。
 */
export function clearRedo(stack: UndoRedoStack): void {
  stack.redoStack.length = 0;
}
