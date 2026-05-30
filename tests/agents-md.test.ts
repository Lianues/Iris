import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { AgentsMdManager } from '../src/core/agents-md.js';
import { Backend } from '../src/core/backend/backend.js';
import { clearSessionCwd, initSessionCwd } from '../src/core/backend/session-context.js';
import { StorageProvider, type SessionMeta } from '../src/storage/base.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { ToolStateManager } from '../src/tools/state.js';
import { PromptAssembler } from '../src/prompt/assembler.js';
import type { Content, LLMRequest, Part } from '../src/types/index.js';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'iris-agents-md-'));
}

function systemText(request: LLMRequest): string {
  return request.systemInstruction?.parts
    .map((part: Part) => 'text' in part && typeof part.text === 'string' ? part.text : '')
    .join('\n') ?? '';
}

class InMemoryStorage extends StorageProvider {
  private histories = new Map<string, Content[]>();
  private metas = new Map<string, SessionMeta>();

  async getHistory(sessionId: string): Promise<Content[]> {
    return clone(this.histories.get(sessionId) ?? []);
  }

  async addMessage(sessionId: string, content: Content): Promise<void> {
    const history = this.histories.get(sessionId) ?? [];
    history.push(clone(content));
    this.histories.set(sessionId, history);
  }

  async clearHistory(sessionId: string): Promise<void> {
    await this.withMetaUpdateLock(sessionId, async () => {
      this.histories.delete(sessionId);
      this.metas.delete(sessionId);
    });
  }

  async updateLastMessage(sessionId: string, updater: (content: Content) => Content): Promise<void> {
    const history = this.histories.get(sessionId) ?? [];
    if (history.length === 0) return;
    history[history.length - 1] = clone(updater(clone(history[history.length - 1])));
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
    const meta = this.metas.get(sessionId);
    return meta ? clone(meta) : null;
  }

  async saveMeta(meta: SessionMeta): Promise<void> {
    this.metas.set(meta.id, clone(meta));
  }

  async listSessionMetas(): Promise<SessionMeta[]> {
    return [...this.metas.values()].map(meta => clone(meta));
  }
}

function createBackend(tmpDir: string, requests: LLMRequest[]): Backend {
  const storage = new InMemoryStorage();
  const router = {
    chat: vi.fn(async (request: LLMRequest, modelName?: string) => {
      requests.push(request);
      return {
        content: {
          role: 'model' as const,
          parts: [{ text: modelName === 'summary-model' ? 'compact summary' : 'ok' }],
          createdAt: Date.now(),
        },
        usageMetadata: { totalTokenCount: 12 },
      };
    }),
    chatStream: vi.fn(),
    getCurrentModelName: vi.fn(() => 'mock-model'),
    getModelConfig: vi.fn(() => ({ model: 'mock-model', provider: 'gemini', supportsVision: true })),
    getModelInfo: vi.fn(() => ({})),
  } as any;
  const prompt = new PromptAssembler();
  prompt.setSystemPrompt('base system');
  const backend = new Backend(
    router,
    storage,
    new ToolRegistry(),
    new ToolStateManager(),
    prompt,
    {
      stream: false,
      maxToolRounds: 5,
      toolsConfig: { permissions: {} },
      summaryModelName: 'summary-model',
      dataDir: path.join(tmpDir, '.iris-test-data'),
    },
  );
  backend.on('error', () => {});
  return backend;
}

describe('AgentsMdManager', () => {
  it('loads AGENTS.md once per session until explicit reload', async () => {
    const dir = makeTempDir();
    try {
      fs.writeFileSync(path.join(dir, 'AGENTS.md'), 'version one');
      const manager = new AgentsMdManager();

      const first = await manager.ensureLoaded('s1', dir);
      expect(first.status).toBe('loaded');
      expect(first.part && 'text' in first.part ? first.part.text : '').toContain('version one');

      fs.writeFileSync(path.join(dir, 'AGENTS.md'), 'version two');
      const cached = await manager.ensureLoaded('s1', dir);
      const cachedText = cached.part && 'text' in cached.part ? cached.part.text : '';
      expect(cachedText).toContain('version one');
      expect(cachedText).not.toContain('version two');

      const reload = await manager.reload('s1', dir);
      expect(reload.ok).toBe(true);
      expect(reload.status).toBe('loaded');
      const reloadedPart = manager.getSystemPart('s1') as ({ text?: string } | undefined);
      const reloadedText = reloadedPart?.text ?? '';
      expect(reloadedText).toContain('version two');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('treats missing or empty AGENTS.md as no injected project instructions', async () => {
    const dir = makeTempDir();
    try {
      const manager = new AgentsMdManager();

      const missing = await manager.reload('s1', dir);
      expect(missing.ok).toBe(true);
      expect(missing.status).toBe('missing');
      expect(manager.getSystemPart('s1')).toBeUndefined();

      fs.writeFileSync(path.join(dir, 'AGENTS.md'), '  \n');
      const empty = await manager.reload('s1', dir);
      expect(empty.ok).toBe(true);
      expect(empty.status).toBe('empty');
      expect(manager.getSystemPart('s1')).toBeUndefined();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('Backend AGENTS.md system prompt injection', () => {
  it('injects cached AGENTS.md and updates it only after explicit reload', async () => {
    const dir = makeTempDir();
    const sessionId = `agents-md-${Date.now()}-reload`;
    try {
      fs.writeFileSync(path.join(dir, 'AGENTS.md'), 'project rule v1');
      initSessionCwd(sessionId, dir);
      const requests: LLMRequest[] = [];
      const backend = createBackend(dir, requests);

      await backend.chat(sessionId, 'hello');
      expect(systemText(requests[0])).toContain('Project Instructions (AGENTS.md)');
      expect(systemText(requests[0])).toContain('project rule v1');

      fs.writeFileSync(path.join(dir, 'AGENTS.md'), 'project rule v2');
      await backend.chat(sessionId, 'still cached');
      expect(systemText(requests[1])).toContain('project rule v1');
      expect(systemText(requests[1])).not.toContain('project rule v2');

      const reload = await backend.reloadAgentsMd(sessionId);
      expect(reload.ok).toBe(true);
      expect(reload.status).toBe('loaded');
      await backend.chat(sessionId, 'after reload');
      expect(systemText(requests[2])).toContain('project rule v2');
    } finally {
      clearSessionCwd(sessionId);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reloads AGENTS.md after compact summaries', async () => {
    const dir = makeTempDir();
    const sessionId = `agents-md-${Date.now()}-compact`;
    try {
      fs.writeFileSync(path.join(dir, 'AGENTS.md'), 'compact rule v1');
      initSessionCwd(sessionId, dir);
      const requests: LLMRequest[] = [];
      const backend = createBackend(dir, requests);

      await backend.chat(sessionId, 'hello');
      expect(systemText(requests[0])).toContain('compact rule v1');

      // backend.chat resolves on done; turnLock is released in the following finally tick.
      await new Promise(resolve => setTimeout(resolve, 0));
      fs.writeFileSync(path.join(dir, 'AGENTS.md'), 'compact rule v2');
      await backend.summarize(sessionId);
      await backend.chat(sessionId, 'after compact');

      expect(systemText(requests[requests.length - 1])).toContain('compact rule v2');
    } finally {
      clearSessionCwd(sessionId);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
