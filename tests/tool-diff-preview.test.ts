import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ToolInvocation } from '../src/types/tool.js';
import { buildToolDiffPreview, buildUnifiedLineDiff, countDiffStats } from '../src/tools/diff-preview.js';
import { DEFAULT_TOOL_LIMITS, setToolLimits } from '../src/tools/tool-limits.js';

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iris-diff-preview-'));
  tempDirs.push(dir);
  return dir;
}

function inv(toolName: string, args: Record<string, unknown>): ToolInvocation {
  const now = Date.now();
  return {
    id: `tool_${toolName}_${now}`,
    toolName,
    args,
    status: 'awaiting_apply',
    createdAt: now,
    updatedAt: now,
    sessionId: 'session-test',
  };
}

afterEach(() => {
  setToolLimits(undefined);
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('tool diff preview', () => {
  it('为单行插入生成局部 unified diff，而不是整文件全删全加', () => {
    const diff = buildUnifiedLineDiff('demo.txt', 'one\ntwo\nthree\n', 'one\ntwo\ninserted\nthree\n', true);

    expect(diff).toContain('+inserted');
    expect(diff).toContain(' one');
    expect(diff).not.toContain('-one');
    expect(diff).not.toContain('+one');
    expect(countDiffStats(diff)).toEqual({ added: 1, removed: 0 });
  });

  it('write_file files 数组预览使用真实行级 diff 与指定 cwd', () => {
    const cwd = makeTempDir();
    fs.writeFileSync(path.join(cwd, 'demo.txt'), 'one\ntwo\nthree\n', 'utf-8');

    const preview = buildToolDiffPreview(inv('write_file', {
      files: [{ path: 'demo.txt', content: 'one\nTWO\nthree\n' }],
    }), { cwd });

    expect(preview.items).toHaveLength(1);
    expect(preview.items[0].diff).toContain('-two');
    expect(preview.items[0].diff).toContain('+TWO');
    expect(preview.items[0].diff).not.toContain('-one');
    expect(preview.items[0].diff).not.toContain('+one');
    expect(preview.items[0].added).toBe(1);
    expect(preview.items[0].removed).toBe(1);
  });

  it('insert_code 预览复用实际行号校验，非法行号返回错误 message', () => {
    const cwd = makeTempDir();
    fs.writeFileSync(path.join(cwd, 'demo.txt'), 'one\ntwo\n', 'utf-8');

    const preview = buildToolDiffPreview(inv('insert_code', {
      path: 'demo.txt',
      line: 99,
      content: 'bad',
    }), { cwd });

    expect(preview.items).toHaveLength(1);
    expect(preview.items[0].diff).toBeUndefined();
    expect(preview.items[0].message).toContain('超出范围');
  });

  it('delete_code 预览复用实际范围校验，非法范围返回错误 message', () => {
    const cwd = makeTempDir();
    fs.writeFileSync(path.join(cwd, 'demo.txt'), 'one\ntwo\n', 'utf-8');

    const preview = buildToolDiffPreview(inv('delete_code', {
      path: 'demo.txt',
      start_line: 2,
      end_line: 99,
    }), { cwd });

    expect(preview.items).toHaveLength(1);
    expect(preview.items[0].diff).toBeUndefined();
    expect(preview.items[0].message).toContain('超出范围');
  });

  it('search_in_files replace 预览遵守实际工具 limits', () => {
    setToolLimits({
      search_in_files: { ...DEFAULT_TOOL_LIMITS.search_in_files, maxFiles: 1 },
    });
    const cwd = makeTempDir();
    fs.writeFileSync(path.join(cwd, 'a.txt'), 'foo\n', 'utf-8');
    fs.writeFileSync(path.join(cwd, 'b.txt'), 'foo\n', 'utf-8');

    const preview = buildToolDiffPreview(inv('search_in_files', {
      mode: 'replace',
      include: ['*.txt'],
      query: 'foo',
      replace: 'bar',
      maxFiles: 10,
    }), { cwd });

    expect(preview.items).toHaveLength(1);
    expect(preview.summary.join('\n')).toContain('maxFiles=1');
    expect(preview.items[0].diff).toContain('-foo');
    expect(preview.items[0].diff).toContain('+bar');
  });

  it('apply_diff 预览不 trim patch 边界有效空白', () => {
    const preview = buildToolDiffPreview(inv('apply_diff', {
      path: 'demo.txt',
      patch: '@@ -1,1 +1,1 @@\n-old  \n+new  ',
    }), { cwd: makeTempDir() });

    expect(preview.items[0].diff).toContain('-old  ');
    expect(preview.items[0].diff).toContain('+new  ');
  });
});
