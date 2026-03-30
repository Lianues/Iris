/**
 * undo-redo 栈逻辑的单元测试。
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  createUndoRedoStack,
  performUndo,
  performRedo,
  clearRedo,
  MAX_STACK_SIZE,
  UndoRedoStack,
} from '../extensions/console/src/undo-redo';
import type { ChatMessage } from '../extensions/console/src/components/MessageItem';

function msg(id: string, role: 'user' | 'assistant', text: string): ChatMessage {
  return { id, role, parts: [{ type: 'text', text }] };
}

describe('undo-redo stack', () => {
  let stack: UndoRedoStack;

  beforeEach(() => {
    stack = createUndoRedoStack();
  });

  // ========== performUndo ==========

  describe('performUndo', () => {
    it('空消息列表返回 null', () => {
      const result = performUndo([], stack);
      expect(result).toBeNull();
    });

    it('删除最后一条消息并返回剩余列表', () => {
      const messages = [msg('1', 'user', 'hello'), msg('2', 'assistant', 'hi')];
      const result = performUndo(messages, stack);
      expect(result).not.toBeNull();
      expect(result!.messages).toHaveLength(1);
      expect(result!.messages[0].id).toBe('1');
      expect(result!.removed.id).toBe('2');
    });

    it('被删除的消息压入 redo 栈', () => {
      const messages = [msg('1', 'user', 'hello')];
      performUndo(messages, stack);
      expect(stack.redoStack).toHaveLength(1);
      expect(stack.redoStack[0].id).toBe('1');
    });

    it('连续 undo 逐条删除', () => {
      const messages = [
        msg('1', 'user', 'a'),
        msg('2', 'assistant', 'b'),
        msg('3', 'user', 'c'),
      ];
      const r1 = performUndo(messages, stack)!;
      expect(r1.messages).toHaveLength(2);
      expect(r1.removed.id).toBe('3');

      const r2 = performUndo(r1.messages, stack)!;
      expect(r2.messages).toHaveLength(1);
      expect(r2.removed.id).toBe('2');

      const r3 = performUndo(r2.messages, stack)!;
      expect(r3.messages).toHaveLength(0);
      expect(r3.removed.id).toBe('1');

      expect(stack.redoStack).toHaveLength(3);
      // redo 栈的顺序：最后 undo 的在栈顶
      expect(stack.redoStack.map(m => m.id)).toEqual(['3', '2', '1']);
    });

    it('redo 栈超过 MAX_STACK_SIZE 时截断最早的条目', () => {
      // 预填充 redo 栈到满
      for (let i = 0; i < MAX_STACK_SIZE; i++) {
        stack.redoStack.push(msg(`pre-${i}`, 'user', `text-${i}`));
      }
      expect(stack.redoStack).toHaveLength(MAX_STACK_SIZE);

      // 再 undo 一条
      const messages = [msg('new', 'user', 'new')];
      performUndo(messages, stack);

      expect(stack.redoStack).toHaveLength(MAX_STACK_SIZE);
      // 最早的 pre-0 被截掉，栈顶是 'new'
      expect(stack.redoStack[0].id).toBe('pre-1');
      expect(stack.redoStack[stack.redoStack.length - 1].id).toBe('new');
    });
  });

  // ========== performRedo ==========

  describe('performRedo', () => {
    it('redo 栈为空时返回 null', () => {
      const result = performRedo([], stack);
      expect(result).toBeNull();
    });

    it('从 redo 栈恢复消息到列表末尾', () => {
      const messages = [msg('1', 'user', 'hello')];
      // 先 undo
      const undone = performUndo(messages, stack)!;
      expect(undone.messages).toHaveLength(0);

      // 再 redo
      const result = performRedo(undone.messages, stack)!;
      expect(result).not.toBeNull();
      expect(result.messages).toHaveLength(1);
      expect(result.restored.id).toBe('1');
      expect(stack.redoStack).toHaveLength(0);
    });

    it('undo 后 redo 恢复顺序正确（LIFO）', () => {
      const messages = [
        msg('1', 'user', 'a'),
        msg('2', 'assistant', 'b'),
        msg('3', 'user', 'c'),
      ];

      // undo 3 次
      let cur = messages;
      for (let i = 0; i < 3; i++) {
        cur = performUndo(cur, stack)!.messages;
      }
      expect(cur).toHaveLength(0);

      // redo 3 次，应按 1, 2, 3 顺序恢复
      const r1 = performRedo(cur, stack)!;
      expect(r1.restored.id).toBe('1');

      const r2 = performRedo(r1.messages, stack)!;
      expect(r2.restored.id).toBe('2');

      const r3 = performRedo(r2.messages, stack)!;
      expect(r3.restored.id).toBe('3');

      expect(r3.messages).toHaveLength(3);
      expect(r3.messages.map(m => m.id)).toEqual(['1', '2', '3']);
    });
  });

  // ========== clearRedo ==========

  describe('clearRedo', () => {
    it('清空 redo 栈', () => {
      stack.redoStack.push(msg('1', 'user', 'a'));
      stack.redoStack.push(msg('2', 'assistant', 'b'));
      expect(stack.redoStack).toHaveLength(2);

      clearRedo(stack);
      expect(stack.redoStack).toHaveLength(0);
    });

    it('已空时调用不报错', () => {
      expect(() => clearRedo(stack)).not.toThrow();
      expect(stack.redoStack).toHaveLength(0);
    });
  });

  // ========== 组合场景 ==========

  describe('组合场景', () => {
    it('undo → 新消息 → redo 失效', () => {
      const messages = [
        msg('1', 'user', 'a'),
        msg('2', 'assistant', 'b'),
      ];

      // undo 一条
      const r1 = performUndo(messages, stack)!;
      expect(r1.messages).toHaveLength(1);
      expect(stack.redoStack).toHaveLength(1);

      // 模拟新消息写入 → clearRedo
      clearRedo(stack);
      expect(stack.redoStack).toHaveLength(0);

      // redo 应该失败
      const r2 = performRedo(r1.messages, stack);
      expect(r2).toBeNull();
    });

    it('交替 undo/redo 保持一致', () => {
      const messages = [
        msg('1', 'user', 'a'),
        msg('2', 'assistant', 'b'),
        msg('3', 'user', 'c'),
      ];

      // undo 2 条
      const u1 = performUndo(messages, stack)!;
      const u2 = performUndo(u1.messages, stack)!;
      expect(u2.messages).toHaveLength(1);
      expect(u2.messages[0].id).toBe('1');

      // redo 1 条
      const r1 = performRedo(u2.messages, stack)!;
      expect(r1.messages).toHaveLength(2);
      expect(r1.messages[1].id).toBe('2');

      // 再 undo 1 条（应该删掉刚 redo 回来的 '2'）
      const u3 = performUndo(r1.messages, stack)!;
      expect(u3.messages).toHaveLength(1);
      expect(u3.removed.id).toBe('2');

      // redo 栈应该有 '3' 和 '2'
      expect(stack.redoStack.map(m => m.id)).toEqual(['3', '2']);
    });

    it('不同角色的消息均可 undo/redo', () => {
      const messages = [
        msg('1', 'user', 'question'),
        msg('2', 'assistant', 'answer'),
      ];

      // undo assistant
      const u1 = performUndo(messages, stack)!;
      expect(u1.removed.role).toBe('assistant');

      // undo user
      const u2 = performUndo(u1.messages, stack)!;
      expect(u2.removed.role).toBe('user');

      // redo user
      const r1 = performRedo(u2.messages, stack)!;
      expect(r1.restored.role).toBe('user');

      // redo assistant
      const r2 = performRedo(r1.messages, stack)!;
      expect(r2.restored.role).toBe('assistant');
    });

    it('单条消息的 undo + redo 往返', () => {
      const messages = [msg('1', 'user', 'only')];

      const u = performUndo(messages, stack)!;
      expect(u.messages).toHaveLength(0);

      const r = performRedo(u.messages, stack)!;
      expect(r.messages).toHaveLength(1);
      expect(r.messages[0].id).toBe('1');
      expect(r.messages[0].parts[0]).toEqual({ type: 'text', text: 'only' });
    });

    it('大量 undo 不超过栈容量', () => {
      // 构造 300 条消息
      const messages: ChatMessage[] = [];
      for (let i = 0; i < 300; i++) {
        messages.push(msg(`m-${i}`, i % 2 === 0 ? 'user' : 'assistant', `text-${i}`));
      }

      // undo 全部 300 条
      let cur = messages;
      for (let i = 0; i < 300; i++) {
        const result = performUndo(cur, stack);
        if (!result) break;
        cur = result.messages;
      }

      expect(cur).toHaveLength(0);
      // redo 栈被限制在 MAX_STACK_SIZE
      expect(stack.redoStack).toHaveLength(MAX_STACK_SIZE);
      // 栈顶是最后 undo 的（即 m-0），栈底是较早 undo 的
      expect(stack.redoStack[stack.redoStack.length - 1].id).toBe('m-0');
    });
  });
});
