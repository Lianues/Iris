import { describe, expect, it, vi } from 'vitest';
import { handleDefaultIdeCommand, ideMatchesEditorLabel } from '../extensions/ide/src/index';
import type { IdeManager } from '../extensions/ide/src/manager';
import type { DetectedIde, IdeStatusSnapshot } from '../extensions/ide/src/types';

function detectedIde(name: string, port: number): DetectedIde {
  return {
    id: `${name}:${port}`,
    name,
    port,
    url: `http://127.0.0.1:${port}/sse`,
    transport: 'sse',
    workspaceFolders: ['D:\\workspace'],
    isValid: true,
    lockfilePath: `D:\\data\\ide\\${port}.lock`,
  };
}

function managerStub(status: IdeStatusSnapshot, detected: DetectedIde[] = []): {
  manager: IdeManager;
  detect: ReturnType<typeof vi.fn>;
  connect: ReturnType<typeof vi.fn>;
} {
  const detect = vi.fn().mockResolvedValue(detected);
  const connect = vi.fn().mockImplementation(async (target: string) => {
    const match = detected.find((ide) => ide.id === target);
    if (!match) throw new Error(`unknown target: ${target}`);
    return match;
  });
  const manager = {
    status: vi.fn(() => status),
    current: vi.fn(() => status.current),
    detect,
    connect,
  } as unknown as IdeManager;
  return { manager, detect, connect };
}

describe('default /ide command', () => {
  it('only reports status when already connected', async () => {
    const current = detectedIde('VS Code', 43100);
    const { manager, detect, connect } = managerStub({
      state: 'connected',
      current,
      detected: [current],
    });

    const result = await handleDefaultIdeCommand(manager);

    expect(result.message).toContain('IDE 状态：connected');
    expect(detect).not.toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();
  });

  it('connects the single matching IDE without running installer logic', async () => {
    const vscode = detectedIde('VS Code', 43101);
    const { manager, connect } = managerStub({
      state: 'disconnected',
      detected: [],
    }, [vscode]);

    const result = await handleDefaultIdeCommand(manager);

    expect(connect).toHaveBeenCalledWith(vscode.id);
    expect(result.message).toBe(`已连接 IDE：${vscode.name} (${vscode.port})`);
  });

  it('asks the user to choose when multiple IDE sessions match cwd', async () => {
    const vscode = detectedIde('VS Code', 43102);
    const cursor = detectedIde('Cursor', 43103);
    const { manager, connect } = managerStub({
      state: 'disconnected',
      detected: [],
    }, [cursor, vscode]);

    const result = await handleDefaultIdeCommand(manager);

    expect(connect).not.toHaveBeenCalled();
    expect(result.message).toContain('发现多个匹配当前 cwd 的 IDE 会话');
    expect(result.message).toContain('/ide connect <id|port>');
  });
});

describe('IDE install session matching', () => {
  it('does not match an existing Cursor session when VS Code was installed', () => {
    expect(ideMatchesEditorLabel(detectedIde('Cursor', 43104), 'VS Code')).toBe(false);
    expect(ideMatchesEditorLabel(detectedIde('VS Code', 43105), 'VS Code')).toBe(true);
  });

  it('matches the requested Cursor and Windsurf products only', () => {
    expect(ideMatchesEditorLabel(detectedIde('Cursor', 43106), 'Cursor')).toBe(true);
    expect(ideMatchesEditorLabel(detectedIde('Windsurf', 43107), 'Cursor')).toBe(false);
    expect(ideMatchesEditorLabel(detectedIde('Windsurf', 43108), 'Windsurf')).toBe(true);
  });
});
