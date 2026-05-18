import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { sessionContext } from '../src/core/backend/session-context.js';
import { applyDiff } from '../src/tools/internal/apply_diff/index.js';

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'iris-apply-diff-'));
}

describe('apply_diff fallback response metadata', () => {
  const cleanupDirs: string[] = [];

  afterEach(() => {
    for (const dir of cleanupDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('为上下文搜索兜底成功的 hunk 返回 correctedHeader 和 fallback 提示', async () => {
    const cwd = makeTempDir();
    cleanupDirs.push(cwd);

    fs.mkdirSync(path.join(cwd, 'src'), { recursive: true });
    fs.writeFileSync(path.join(cwd, 'src', 'demo.ts'), ['line1', 'target1', 'target2', 'line4', ''].join('\n'));

    const result = await sessionContext.run({ sessionId: 's1', cwd }, () => applyDiff.handler({
      path: 'src/demo.ts',
      patch: '@@ -99,2 +99,2 @@\n target1\n-target2\n+target2_mod',
    })) as any;

    expect(result.applied).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toMatchObject({
      index: 0,
      success: true,
      appliedHeader: '@@ -2,2 +2,2 @@',
      appliedBy: 'context_search',
      fallback: {
        strategy: 'context_search',
        correctedHeader: '@@ -2,2 +2,2 @@',
      },
    });
    expect(result.results[0].fallback.message).toContain('兜底应用');
    expect(result.results[0]).not.toHaveProperty('startLine');
    expect(result.results[0]).not.toHaveProperty('endLine');
  });

  it('正常按行号应用的 hunk 不返回 fallback 提示', async () => {
    const cwd = makeTempDir();
    cleanupDirs.push(cwd);

    fs.mkdirSync(path.join(cwd, 'src'), { recursive: true });
    fs.writeFileSync(path.join(cwd, 'src', 'demo.ts'), ['line1', 'target1', 'target2', 'line4', ''].join('\n'));

    const result = await sessionContext.run({ sessionId: 's1', cwd }, () => applyDiff.handler({
      path: 'src/demo.ts',
      patch: '@@ -2,2 +2,2 @@\n target1\n-target2\n+target2_mod',
    })) as any;

    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toMatchObject({
      index: 0,
      success: true,
      appliedHeader: '@@ -2,2 +2,2 @@',
      appliedBy: 'line_number',
    });
    expect(result.results[0].fallback).toBeUndefined();
    expect(result.results[0]).not.toHaveProperty('startLine');
    expect(result.results[0]).not.toHaveProperty('endLine');
  });
});
