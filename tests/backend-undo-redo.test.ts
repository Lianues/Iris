/**
 * Backend 统一 undo/redo 的单元测试。
 *
 * 这些测试直接验证 Backend 对 Content 历史的分组逻辑，
 * 避免平台层回归时再次出现 functionCall / functionResponse 被截断的问题。
 */

import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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

const cleanupDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iris-backend-rewind-'));
  cleanupDirs.push(dir);
  return dir;
}

function createBackend(storage: InMemoryStorage, dataDir?: string): Backend {
  const toolState = Object.assign(new EventEmitter(), {
    getAll: () => [],
  });

  return new Backend(
    {} as any,
    storage,
    {} as any,
    toolState as any,
    {} as any,
    { stream: false, ...(dataDir ? { dataDir } : {}) },
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

  afterEach(() => {
    while (cleanupDirs.length > 0) {
      fs.rmSync(cleanupDirs.pop()!, { recursive: true, force: true });
    }
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

  it('undo/redo 会同步恢复 compact 后的完整上下文 token，不沿用被截断回复的缓存', async () => {
    storage.setHistory(sessionId, [
      {
        role: 'user',
        parts: [{ text: '[Context Summary]\n\nsummary' }],
        isSummary: true,
        usageMetadata: { promptTokenCount: 25, totalTokenCount: 25 },
        compactedContextTokenCount: 300,
      },
      {
        role: 'model',
        parts: [{ text: 'response after compact' }],
        usageMetadata: { totalTokenCount: 500 },
      },
    ]);

    await backend.getHistory(sessionId);
    expect(backend.getLastSessionTokens(sessionId)).toBe(500);

    const undoResult = await backend.undo(sessionId, 'last-visible-message');
    expect(undoResult?.removedCount).toBe(1);
    expect(backend.getLastSessionTokens(sessionId)).toBe(300);

    const redoResult = await backend.redo(sessionId);
    expect(redoResult?.restoredCount).toBe(1);
    expect(backend.getLastSessionTokens(sessionId)).toBe(500);
  });

  it('listRewindCheckpoints 只列出普通用户消息，过滤工具响应、summary 和通知', async () => {
    storage.setHistory(sessionId, [
      { ...textContent('user', '第一问'), createdAt: 1000 },
      functionCallContent('demo_tool'),
      functionResponseContent('demo_tool'),
      textContent('model', '第一答'),
      { ...textContent('user', '[Context Summary]\n总结'), isSummary: true, createdAt: 2000 },
      { ...textContent('user', '后台子代理完成了一个任务：\n<task-notification></task-notification>'), createdAt: 3000 },
      { ...textContent('user', '第二问'), createdAt: 4000 },
      textContent('model', '第二答'),
    ]);

    const checkpoints = await backend.listRewindCheckpoints(sessionId);
    expect(checkpoints.map(item => item.userText)).toEqual(['第一问', '第二问']);
    expect(checkpoints[0].assistantText).toBe('第一答');
    expect(checkpoints[1].messageCountAfter).toBe(2);
  });

  it('rewind 会截断到所选用户消息之前，并返回可恢复到输入框的用户文本', async () => {
    const history = [
      { ...textContent('user', '保留的问题'), createdAt: 1000 },
      textContent('model', '保留的回答'),
      { ...textContent('user', '需要修改的问题'), createdAt: 2000 },
      textContent('model', '将被移除的回答'),
    ];
    storage.setHistory(sessionId, history);

    const checkpoints = await backend.listRewindCheckpoints(sessionId);
    const target = checkpoints.find(item => item.userText === '需要修改的问题')!;
    const result = await backend.rewind(sessionId, target.id, 'conversation');

    expect(result?.removedCount).toBe(2);
    expect(result?.restoredInputText).toBe('需要修改的问题');
    expect(await storage.getHistory(sessionId)).toEqual(history.slice(0, 2));
  });

  it('rewind both 会同时恢复代码快照并截断对话', async () => {
    const dataDir = makeTempDir();
    const cwd = makeTempDir();
    const filePath = path.join(cwd, 'demo.txt');
    fs.writeFileSync(filePath, 'old\n', 'utf-8');
    backend = createBackend(storage, dataDir);

    const history = [
      { ...textContent('user', '改文件'), createdAt: 1000 },
      textContent('model', '已修改'),
    ];
    storage.setHistory(sessionId, history);
    const checkpoint = (await backend.listRewindCheckpoints(sessionId))[0];
    const fileHistory = (backend as any).fileHistory;
    await fileHistory.makeSnapshot(sessionId, checkpoint.id);
    await fileHistory.trackToolEdit(sessionId, cwd, 'write_file', { path: 'demo.txt', content: 'new\n' });
    fs.writeFileSync(filePath, 'new\n', 'utf-8');

    const result = await backend.rewind(sessionId, checkpoint.id, 'both');

    expect(result?.removedCount).toBe(2);
    expect(result?.filesRestored).toEqual([filePath]);
    expect(fs.readFileSync(filePath, 'utf-8')).toBe('old\n');
    expect(await storage.getHistory(sessionId)).toEqual([]);
  });
});
