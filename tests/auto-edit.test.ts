import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkAutoEditPathSafety, evaluateAutoEditApproval } from '../src/auto-edit/index.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { ToolStateManager } from '../src/tools/state.js';
import { executeSingleTool } from '../src/tools/scheduler.js';
import type { FunctionCallPart } from '../src/types/index.js';
import type { ToolsConfig } from '../src/config/types.js';

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'iris-auto-edit-'));
}

function fc(name: string, args: Record<string, unknown> = {}, callId?: string): FunctionCallPart {
  return { functionCall: { name, args, callId: callId ?? `call_${name}_${Date.now()}` } };
}

describe('auto edit safety', () => {
  const cleanupDirs: string[] = [];

  afterEach(() => {
    for (const dir of cleanupDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('允许普通项目内结构化编辑路径', () => {
    const cwd = makeTempDir();
    cleanupDirs.push(cwd);
    fs.mkdirSync(path.join(cwd, 'src'), { recursive: true });

    const result = checkAutoEditPathSafety('src/example.ts', cwd);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.resolvedPath).toBe(path.join(cwd, 'src', 'example.ts'));
    }
  });

  it('拒绝项目外路径自动应用', () => {
    const cwd = makeTempDir();
    cleanupDirs.push(cwd);

    const result = checkAutoEditPathSafety('../outside.ts', cwd);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.category).toBe('outside_workspace');
  });

  it('拒绝敏感文件自动应用但保留普通审批回退空间', () => {
    const cwd = makeTempDir();
    cleanupDirs.push(cwd);

    const result = checkAutoEditPathSafety('.env', cwd);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.category).toBe('sensitive_path');
  });

  it('Auto Edit 只覆盖 V1 支持的结构化编辑工具', () => {
    const cwd = makeTempDir();
    cleanupDirs.push(cwd);

    expect(evaluateAutoEditApproval('write_file', { path: 'src/a.ts', content: 'x' }, { autoEditActive: true, cwd }).allowed).toBe(true);
    expect(evaluateAutoEditApproval('delete_file', { paths: ['src/a.ts'] }, { autoEditActive: true, cwd }).allowed).toBe(false);
    expect(evaluateAutoEditApproval('bash', { command: 'touch src/a.ts' }, { autoEditActive: true, cwd }).allowed).toBe(false);
  });

  it('运行时动态查询优先于 turn 开始时的 Auto Edit 快照', () => {
    const cwd = makeTempDir();
    cleanupDirs.push(cwd);
    let active = false;
    const context = {
      sessionId: 's1', cwd, autoEditActive: true,
      isAutoEditActive: () => active,
    };

    expect(evaluateAutoEditApproval('write_file', { path: 'src/a.ts', content: 'x' }, context).allowed).toBe(false);
    active = true;
    expect(evaluateAutoEditApproval('write_file', { path: 'src/a.ts', content: 'x' }, context).allowed).toBe(true);
  });
});

describe('auto edit scheduler integration', () => {
  const cleanupDirs: string[] = [];

  afterEach(() => {
    for (const dir of cleanupDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('开启 Auto Edit 后，安全 write_file 跳过 diff 审批并直接执行', async () => {
    const cwd = makeTempDir();
    cleanupDirs.push(cwd);
    fs.mkdirSync(path.join(cwd, 'src'), { recursive: true });

    let handlerCalled = false;
    const registry = new ToolRegistry();
    registry.register({
      declaration: { name: 'write_file', description: 'write test file' },
      handler: async (args) => {
        handlerCalled = true;
        return { ok: true, path: args.path };
      },
    });

    const toolState = new ToolStateManager();
    const call = fc('write_file', { path: 'src/a.ts', content: 'hello' });
    const invocation = toolState.create('write_file', call.functionCall.args, 'queued', 's1');
    const toolsConfig: ToolsConfig = {
      permissions: {
        write_file: { autoApprove: false, showApprovalView: true },
      },
    };

    const response = await executeSingleTool(
      call,
      registry,
      toolState,
      invocation.id,
      toolsConfig,
      undefined,
      undefined,
      undefined,
      undefined,
      { sessionId: 's1', cwd, autoEditActive: true, planModeActive: false },
    );

    expect(handlerCalled).toBe(true);
    const completed = toolState.get(invocation.id);
    expect(completed?.status).toBe('success');
    expect(response.functionResponse.response).toEqual({ result: { ok: true, path: 'src/a.ts' } });
    const stateResult = completed?.result as any;
    expect(stateResult.__ui.diffPreview.items[0].diff).toContain('+hello');
    expect(Object.keys(stateResult)).not.toContain('__ui');
    expect(Object.keys(stateResult)).not.toContain('__response');
  });
});
