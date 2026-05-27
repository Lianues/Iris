/**
 * Undo/Redo 状态管理
 *
 * 只负责 redo 栈管理和 undo 范围解析，
 * 不直接操作 Storage —— 持久化由 Backend 负责编排。
 */

import type { Content } from '../../types';
import { extractText, isFunctionResponsePart } from '../../types';
import type { RewindCheckpoint, UndoScope } from './types';
import { MAX_REDO_HISTORY_GROUPS } from './types';

const MAX_REWIND_PREVIEW_CHARS = 120;
const NOTIFICATION_MARKER = '<task-notification>';

export class UndoRedoManager {
  private redoHistory = new Map<string, Content[][]>();

  /** 清空指定会话的 redo 栈 */
  clearRedo(sessionId: string): void {
    this.redoHistory.delete(sessionId);
  }

  /** 将一组被撤销的历史压入 redo 栈，并限制最大长度 */
  pushRedoGroup(sessionId: string, removed: Content[]): void {
    const stack = this.redoHistory.get(sessionId) ?? [];
    stack.push(removed.map(content => JSON.parse(JSON.stringify(content)) as Content));
    if (stack.length > MAX_REDO_HISTORY_GROUPS) {
      stack.splice(0, stack.length - MAX_REDO_HISTORY_GROUPS);
    }
    this.redoHistory.set(sessionId, stack);
  }

  /** 从 redo 栈弹出最近一组（供恢复） */
  popRedoGroup(sessionId: string): Content[] | null {
    const stack = this.redoHistory.get(sessionId);
    if (!stack || stack.length === 0) return null;
    return stack.pop()!;
  }

  /**
   * 根据历史和 scope 计算本次 undo 应从哪条消息开始截断。
   * 返回 null 表示无法 undo。
   */
  resolveUndoRange(history: Content[], scope: UndoScope): { removeStart: number } | null {
    if (history.length === 0) return null;

    const removeStart = this.resolveUndoStartIndex(history, scope);
    if (removeStart < 0 || removeStart >= history.length) return null;

    const removed = history.slice(removeStart);
    if (removed.length === 0) return null;

    return { removeStart };
  }

  /** 从一组历史中提取用户文本和 assistant 可见文本摘要 */
  summarizeGroup(group: Content[]): { userText: string; assistantText: string } {
    const userContent = group.find(content => content.role === 'user' && !this.isToolResponseContent(content));
    const userText = userContent ? extractText(userContent.parts) : '';

    for (let i = group.length - 1; i >= 0; i--) {
      if (group[i].role === 'model') {
        return { userText, assistantText: extractText(group[i].parts) };
      }
    }

    return { userText, assistantText: '' };
  }

  /** 列出可作为 rewind 目标的普通用户消息 checkpoint。 */
  listRewindCheckpoints(sessionId: string, history: Content[]): RewindCheckpoint[] {
    const checkpoints: RewindCheckpoint[] = [];
    for (let i = 0; i < history.length; i++) {
      const content = history[i];
      if (!this.isRewindUserContent(content)) continue;

      const userText = extractText(content.parts).trim();
      const hasAttachments = content.parts.some(part => 'inlineData' in part);
      const fallbackPreview = hasAttachments ? '(包含附件的消息)' : '(空消息)';
      checkpoints.push({
        id: this.makeRewindCheckpointId(i, content),
        sessionId,
        historyIndex: i,
        createdAt: content.createdAt,
        userText,
        preview: this.truncatePreview(userText || fallbackPreview),
        hasAttachments,
        messageCountAfter: history.length - i,
        assistantText: this.findAssistantTextAfter(history, i),
      });
    }
    return checkpoints;
  }

  /** 根据 checkpointId 解析 rewind 截断范围。 */
  resolveRewindRange(
    sessionId: string,
    history: Content[],
    checkpointId: string,
  ): { removeStart: number; checkpoint: RewindCheckpoint } | null {
    const checkpoint = this.listRewindCheckpoints(sessionId, history)
      .find(item => item.id === checkpointId);
    if (!checkpoint) return null;
    if (checkpoint.historyIndex < 0 || checkpoint.historyIndex >= history.length) return null;
    return { removeStart: checkpoint.historyIndex, checkpoint };
  }

  /** 公开生成规则，便于测试或未来迁移。 */
  makeRewindCheckpointId(historyIndex: number, content: Content): string {
    const createdAt = typeof content.createdAt === 'number' && Number.isFinite(content.createdAt)
      ? content.createdAt
      : 0;
    return `rw:${historyIndex}:${createdAt}`;
  }

  // ============ 内部辅助 ============

  private truncatePreview(text: string): string {
    const singleLine = text.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (singleLine.length <= MAX_REWIND_PREVIEW_CHARS) return singleLine;
    return `${singleLine.slice(0, MAX_REWIND_PREVIEW_CHARS - 1)}…`;
  }

  /** 判断一条 user 消息是否纯粹是工具响应 */
  private isToolResponseContent(content: Content): boolean {
    return content.role === 'user'
      && content.parts.length > 0
      && content.parts.every(part => isFunctionResponsePart(part));
  }

  /** 判断一条 user 消息是否应出现在 rewind 选择器中。 */
  private isRewindUserContent(content: Content): boolean {
    if (content.role !== 'user') return false;
    if (content.isSummary) return false;
    if (this.isToolResponseContent(content)) return false;
    const text = extractText(content.parts);
    // 后台子代理完成通知是系统注入的 user-role 消息，不应作为用户可回溯节点。
    if (text.includes(NOTIFICATION_MARKER)) return false;
    return true;
  }

  private findAssistantTextAfter(history: Content[], userIndex: number): string | undefined {
    for (let i = userIndex + 1; i < history.length; i++) {
      const content = history[i];
      if (content.role === 'model') {
        const text = extractText(content.parts).trim();
        if (text) return this.truncatePreview(text);
        continue;
      }
      // 下一个普通用户消息代表已进入下一轮，停止查找。
      if (content.role === 'user' && !this.isToolResponseContent(content)) {
        return undefined;
      }
    }
    return undefined;
  }

  /** 获取历史末尾 assistant 回复段的起始位置；若末尾不是 assistant 回复则返回 null */
  private getAssistantResponseStartIndex(history: Content[]): number | null {
    let startIndex: number | null = null;
    for (let i = history.length - 1; i >= 0; i--) {
      const entry = history[i];
      if (entry.role === 'model' || this.isToolResponseContent(entry)) {
        startIndex = i;
        continue;
      }
      break;
    }
    return startIndex;
  }

  /** 解析本次 undo 应该从哪一条消息开始截断 */
  private resolveUndoStartIndex(history: Content[], scope: UndoScope): number {
    const assistantStart = this.getAssistantResponseStartIndex(history);

    if (scope === 'last-visible-message') {
      return assistantStart ?? (history.length - 1);
    }

    // last-turn
    if (assistantStart != null) {
      const prevIndex = assistantStart - 1;
      if (prevIndex >= 0) {
        const previous = history[prevIndex];
        if (previous.role === 'user' && !this.isToolResponseContent(previous)) {
          return prevIndex;
        }
      }
      return assistantStart;
    }

    return history.length - 1;
  }
}
