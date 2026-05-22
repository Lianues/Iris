import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  filterFileMentionCandidates,
  findFileMentionToken,
  normalizeFileMentionPath,
} from '../extensions/console/src/file-mention-completion';
import { listFileMentionFiles } from '../extensions/console/src/file-mention-files';

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iris-console-file-mention-'));
  tempDirs.push(dir);
  return dir;
}

function writeFile(root: string, relativePath: string): void {
  const fullPath = path.join(root, ...relativePath.split('/'));
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, relativePath, 'utf8');
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('console file mention token detection', () => {
  it('triggers for @query at line start', () => {
    expect(findFileMentionToken('@foo', 4)).toEqual({ start: 0, end: 4, query: 'foo' });
  });

  it('triggers for @query after whitespace', () => {
    expect(findFileMentionToken('see @foo', 8)).toEqual({ start: 4, end: 8, query: 'foo' });
  });

  it('does not trigger inside email-like text', () => {
    expect(findFileMentionToken('a@b.com', 7)).toBeNull();
  });

  it('uses the text before the current cursor when cursor is inside a token', () => {
    expect(findFileMentionToken('see @foobar', 8)).toEqual({ start: 4, end: 8, query: 'foo' });
  });
});

describe('console file mention matching', () => {
  it('sorts filename matches before path-only matches', () => {
    const candidates = filterFileMentionCandidates([
      'docs/input/guide.md',
      'src/components/InputBar.tsx',
      'src/input.ts',
    ], 'input');

    expect(candidates.map((item) => item.path)).toEqual([
      'src/input.ts',
      'src/components/InputBar.tsx',
      'docs/input/guide.md',
    ]);
  });

  it('returns POSIX relative paths', () => {
    expect(normalizeFileMentionPath('src\\components\\InputBar.tsx')).toBe('src/components/InputBar.tsx');
  });
});

describe('console file mention file listing', () => {
  it('skips heavy ignored directories but keeps .limcode plans', () => {
    const root = makeTempDir();
    writeFile(root, 'src/index.ts');
    writeFile(root, 'node_modules/pkg/index.js');
    writeFile(root, '.git/HEAD');
    writeFile(root, 'dist/bundle.js');
    writeFile(root, '.limcode/plan/console-at-file-completion.md');

    expect(listFileMentionFiles(root)).toEqual([
      '.limcode/plan/console-at-file-completion.md',
      'src/index.ts',
    ]);
  });
});

describe('console file mention wiring regressions', () => {
  it('InputBar receives candidates through props and does not scan the filesystem', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../extensions/console/src/components/InputBar.tsx'),
      'utf8',
    );

    expect(source).toContain('onListFileMentionFiles');
    expect(source).toContain('useFileMentionCompletion');
    expect(source).not.toMatch(/from ['"]node:fs['"]/);
    expect(source).not.toMatch(/from ['"]node:path['"]/);
  });

  it('ConsolePlatform disables the file mention callback while remote is active', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../extensions/console/src/index.ts'),
      'utf8',
    );

    expect(source).toContain('onListFileMentionFiles: this._isRemote ? undefined : () => this.listFileMentionFiles()');
    expect(source).toContain('backendWithCwd.getCwd?.()');
    expect(source).toContain('listLocalFileMentionFiles(cwd)');
  });

  it('file mention Tab completion uses undoable range replacement', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../extensions/console/src/components/InputBar.tsx'),
      'utf8',
    );

    expect(source).toContain('inputActions.replaceRange(fileMention.token.start, fileMention.token.end, current.path)');
  });
});
