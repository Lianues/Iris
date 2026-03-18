/**
 * Backend 统一 undo/redo 的单元测试。
 *
 * 这些测试直接验证 Backend 对 Content 历史的分组逻辑，
 * 避免平台层回归时再次出现 functionCall / functionResponse 被截断的问题。
 */

import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it } from 'vitest';
import { Backend } from '../src/core/backend';
import { StorageProvider, SessionMeta } from '../src/storage/base';
import type { Content } from '../src/types';

class InMemoryStorage extends StorageProvider {
  private histories = new Map<string, Content[]>();
  private metas = new Map<string, SessionMeta>();

  setHistory(sessionId: string, history: Content[]): void {
    this.histories.set(sessionId, JSON.parse(JSON.stringify(history)));
  }

  async getHistory(sessionId: string): Promise<Content[]> {
    return JSON.parse(JSON.stringify(this.histories.get(sessionId) ?? []));
  }

  async addMessage(sessionId: string, content: Content): Promise<void> {
    const history = this.histories.get(sessionId) ?? [];
    history.push(JSON.parse(JSON.stringify(content)));
    this.histories.set(sessionId, history);
  }

  async clearHistory(sessionId: string): Promise<void> {
    this.histories.set(sessionId, []);
  }

  async updateLastMessage(sessionId: string, updater: (content: Content) => Content): Promise<void> {
    const history = this.histories.get(sessionId) ?? [];
    if (history.length === 0) return;
    history[history.length - 1] = updater(history[history.length - 1]);
    this.histories.set(sessionId, history);
  }

  async truncateHistory(sessionId: string, keepCount: number): Promise<void> {
    const history = this.histories.get(sessionId) ?? [];
    this.histories.set(sessionId, history.slice(0, keepCount));
  }

  async listSessions(): Promise<string[]> {
    return [...this.histories.keys()];
  }

  async getMeta(sessionId: string): Promise<SessionMeta | null> {
    return this.metas.get(sessionId) ?? null;
  }

  async saveMeta(meta: SessionMeta): Promise<void> {
    this.metas.set(meta.id, meta);
  }

  async listSessionMetas(): Promise<SessionMeta[]> {
    return [...this.metas.values()];
  }
}

function createBackend(storage: InMemoryStorage): Backend {
  const toolState = Object.assign(new EventEmitter(), {
    getAll: () => [],
  });

  return new Backend(
    {} as any,
    storage,
    {} as any,
    toolState as any,
    {} as any,
    { stream: false },
  );
}

function textContent(role: 'user' | 'model', text: string): Content {
  return { role, parts: [{ text }] };
}

function functionCallContent(name: string): Content {
  return {
    role: 'model',
    parts: [{ functionCall: { name, args: { value: 1 } } }],
  };
}

function functionResponseContent(name: string): Content {
  return {
    role: 'user',
    parts: [{ functionResponse: { name, response: { ok: true } } }],
  };
}

describe('Backend undo/redo', () => {
  let storage: InMemoryStorage;
  let backend: Backend;
  const sessionId = 'session-1';

  beforeEach(() => {
    storage = new InMemoryStorage();
    backend = createBackend(storage);
  });

  it('last-turn 会把 user + tool loop + assistant 文本作为完整一轮一起撤销，并可精确 redo', async () => {
    const history = [
      textContent('user', '帮我查天气'),
      functionCallContent('weather_lookup'),
      functionResponseContent('weather_lookup'),
      textContent('model', '今天晴。'),
    ];
    storage.setHistory(sessionId, history);

    const undoResult = await backend.undo(sessionId, 'last-turn');
    expect(undoResult).not.toBeNull();
    expect(undoResult?.removedCount).toBe(4);
    expect(undoResult?.userText).toBe('帮我查天气');
    expect(undoResult?.assistantText).toBe('今天晴。');
    expect(await storage.getHistory(sessionId)).toEqual([]);

    const redoResult = await backend.redo(sessionId);
    expect(redoResult).not.toBeNull();
    expect(redoResult?.restoredCount).toBe(4);
    expect(await storage.getHistory(sessionId)).toEqual(history);
  });

  it('last-visible-message 只撤销末尾 assistant 回复段，不会误删前面的 user 消息', async () => {
    storage.setHistory(sessionId, [
      textContent('user', '执行工具'),
      functionCallContent('demo_tool'),
      functionResponseContent('demo_tool'),
      textContent('model', '工具执行完成'),
    ]);

    const undoResult = await backend.undo(sessionId, 'last-visible-message');
    expect(undoResult).not.toBeNull();
    expect(undoResult?.removedCount).toBe(3);
    expect(await storage.getHistory(sessionId)).toEqual([
      textContent('user', '执行工具'),
    ]);
  });

  it('undo 之后只要出现新的写入，redo 就必须失效', async () => {
    storage.setHistory(sessionId, [
      textContent('user', '原始问题'),
      textContent('model', '原始回答'),
    ]);

    await backend.undo(sessionId, 'last-turn');
    await backend.addMessage(sessionId, textContent('user', '新的分叉'));

    const redoResult = await backend.redo(sessionId);
    expect(redoResult).toBeNull();
    expect(await storage.getHistory(sessionId)).toEqual([
      textContent('user', '新的分叉'),
    ]);
  });
});
