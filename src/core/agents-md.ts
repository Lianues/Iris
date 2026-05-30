import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Part } from '../types';

export const AGENTS_MD_FILE_NAME = 'AGENTS.md';

export type AgentsMdStatus = 'loaded' | 'missing' | 'empty' | 'error';

export interface AgentsMdState {
  sessionId: string;
  cwd: string;
  path: string;
  status: AgentsMdStatus;
  loadedAt: number;
  bytes?: number;
  content?: string;
  error?: string;
  part?: Part;
}

export interface AgentsMdReloadResult {
  ok: boolean;
  status: AgentsMdStatus;
  cwd: string;
  path: string;
  loadedAt: number;
  bytes?: number;
  error?: string;
  message: string;
}

function getErrorCode(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null && 'code' in err
    ? String((err as { code?: unknown }).code)
    : undefined;
}

function formatError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function buildAgentsMdSystemPrompt(filePath: string, content: string): string {
  const normalizedContent = content.replace(/\s+$/u, '');
  return [
    '## Project Instructions (AGENTS.md)',
    '',
    `The following project-level instructions were loaded from: ${filePath}`,
    'Follow these instructions when working in this project.',
    '',
    normalizedContent,
  ].join('\n');
}

function buildResult(state: AgentsMdState): AgentsMdReloadResult {
  switch (state.status) {
    case 'loaded':
      return {
        ok: true,
        status: state.status,
        cwd: state.cwd,
        path: state.path,
        loadedAt: state.loadedAt,
        bytes: state.bytes,
        message: `已重载 AGENTS.md：${state.path}${typeof state.bytes === 'number' ? `（${state.bytes} bytes）` : ''}。后续消息将使用新的项目指令。`,
      };
    case 'missing':
      return {
        ok: true,
        status: state.status,
        cwd: state.cwd,
        path: state.path,
        loadedAt: state.loadedAt,
        message: `当前目录未找到 AGENTS.md：${state.path}。已清空该会话的 AGENTS.md 项目指令。`,
      };
    case 'empty':
      return {
        ok: true,
        status: state.status,
        cwd: state.cwd,
        path: state.path,
        loadedAt: state.loadedAt,
        bytes: state.bytes,
        message: `AGENTS.md 为空：${state.path}。已清空该会话的 AGENTS.md 项目指令。`,
      };
    case 'error':
    default:
      return {
        ok: false,
        status: 'error',
        cwd: state.cwd,
        path: state.path,
        loadedAt: state.loadedAt,
        error: state.error,
        message: `读取 AGENTS.md 失败：${state.path}${state.error ? `\n${state.error}` : ''}`,
      };
  }
}

export class AgentsMdManager {
  private readonly states = new Map<string, AgentsMdState>();

  async ensureLoaded(sessionId: string, cwd: string): Promise<AgentsMdState> {
    const existing = this.states.get(sessionId);
    if (existing) return existing;
    return this.reloadState(sessionId, cwd);
  }

  async reload(sessionId: string, cwd: string): Promise<AgentsMdReloadResult> {
    const state = await this.reloadState(sessionId, cwd);
    return buildResult(state);
  }

  getState(sessionId: string): AgentsMdState | undefined {
    return this.states.get(sessionId);
  }

  getSystemPart(sessionId: string): Part | undefined {
    return this.states.get(sessionId)?.part;
  }

  clear(sessionId: string): void {
    this.states.delete(sessionId);
  }

  clearAll(): void {
    this.states.clear();
  }

  private async reloadState(sessionId: string, cwd: string): Promise<AgentsMdState> {
    const resolvedCwd = path.resolve(cwd || process.cwd());
    const filePath = path.join(resolvedCwd, AGENTS_MD_FILE_NAME);
    const loadedAt = Date.now();

    try {
      const data = await fs.readFile(filePath);
      const content = data.toString('utf8');
      const bytes = data.byteLength;
      if (!content.trim()) {
        const state: AgentsMdState = {
          sessionId,
          cwd: resolvedCwd,
          path: filePath,
          status: 'empty',
          loadedAt,
          bytes,
        };
        this.states.set(sessionId, state);
        return state;
      }

      const part = {
        text: buildAgentsMdSystemPrompt(filePath, content),
        cacheBehavior: 'stable',
      } as Part;
      const state: AgentsMdState = {
        sessionId,
        cwd: resolvedCwd,
        path: filePath,
        status: 'loaded',
        loadedAt,
        bytes,
        content,
        part,
      };
      this.states.set(sessionId, state);
      return state;
    } catch (err) {
      const code = getErrorCode(err);
      const state: AgentsMdState = {
        sessionId,
        cwd: resolvedCwd,
        path: filePath,
        status: code === 'ENOENT' ? 'missing' : 'error',
        loadedAt,
        error: code === 'ENOENT' ? undefined : formatError(err),
      };
      this.states.set(sessionId, state);
      return state;
    }
  }
}
