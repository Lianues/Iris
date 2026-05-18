import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { getTranslator } from '../extensions/remote-exec/src/translators.js';

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iris-remote-exec-search-'));
  tempDirs.push(dir);
  return dir;
}

function createBashTransport(counter: { execs: number; commands?: string[] }) {
  return {
    getTransportMode() { return 'bash'; },
    execCommand(_alias: string, command: string, _signal?: AbortSignal, input?: Buffer | string) {
      counter.execs++;
      counter.commands?.push(command);
      const result = spawnSync('/bin/bash', ['-lc', command], { input, encoding: 'buffer' });
      return Promise.resolve({
        stdout: result.stdout.toString('utf8'),
        stderr: result.stderr.toString('utf8'),
        exitCode: result.status,
        signal: result.signal ?? undefined,
      });
    },
  };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('remote-exec search_in_files', () => {
  it('search 模式在远端用 grep 生成结果，避免逐文件下载', async () => {
    const cwd = makeTempDir();
    fs.mkdirSync(path.join(cwd, 'projects/new-api/common'), { recursive: true });
    fs.mkdirSync(path.join(cwd, 'projects/new-api/node_modules/pkg'), { recursive: true });
    fs.writeFileSync(path.join(cwd, 'projects/new-api/common/a.go'), 'OpenAI one\nno\nOpenAI two\n', 'utf8');
    fs.writeFileSync(path.join(cwd, 'projects/new-api/common/b.md'), 'OpenAI markdown\n', 'utf8');
    fs.writeFileSync(path.join(cwd, 'projects/new-api/node_modules/pkg/x.go'), 'OpenAI ignored\n', 'utf8');

    const counter = { execs: 0 };
    const translator = getTranslator('search_in_files');
    expect(translator).toBeTruthy();

    const result = await translator!({
      mode: 'search',
      query: 'OpenAI',
      include: ['projects/new-api/**/*.go'],
      exclude: ['**/node_modules/**'],
      maxResults: 20,
      contextLines: 1,
    }, {
      transport: createBashTransport(counter) as any,
      serverAlias: 'fake',
      remoteCwd: cwd,
    }) as any;

    expect(result.remoteSearch).toBe('grep');
    expect(counter.execs).toBe(1);
    expect(result.count).toBe(2);
    expect(result.results.map((item: any) => item.file)).toEqual([
      'projects/new-api/common/a.go',
      'projects/new-api/common/a.go',
    ]);
    expect(result.results[0].context).toContain('1: OpenAI one');
  });

  it('find_files 只扫描 glob 静态根目录', async () => {
    const cwd = makeTempDir();
    fs.mkdirSync(path.join(cwd, 'projects/new-api/common'), { recursive: true });
    fs.mkdirSync(path.join(cwd, 'other'), { recursive: true });
    fs.writeFileSync(path.join(cwd, 'projects/new-api/common/a.go'), 'package common\n', 'utf8');
    fs.writeFileSync(path.join(cwd, 'projects/new-api/common/b.md'), 'doc\n', 'utf8');
    fs.writeFileSync(path.join(cwd, 'other/c.go'), 'package other\n', 'utf8');

    const counter = { execs: 0, commands: [] as string[] };
    const translator = getTranslator('find_files');
    expect(translator).toBeTruthy();

    const result = await translator!({
      patterns: ['projects/new-api/**/*.go'],
      maxResults: 20,
    }, {
      transport: createBashTransport(counter) as any,
      serverAlias: 'fake',
      remoteCwd: cwd,
    }) as any;

    expect(counter.execs).toBe(1);
    expect(counter.commands[0]).toContain('/projects/new-api');
    expect(result.results).toEqual(['projects/new-api/common/a.go']);
  });

  it('replace 模式先用远端 grep 预筛候选文件', async () => {
    const cwd = makeTempDir();
    fs.mkdirSync(path.join(cwd, 'src'), { recursive: true });
    fs.writeFileSync(path.join(cwd, 'src/a.ts'), 'foo\n', 'utf8');
    fs.writeFileSync(path.join(cwd, 'src/b.ts'), 'bar\n', 'utf8');
    fs.writeFileSync(path.join(cwd, 'src/c.md'), 'foo\n', 'utf8');

    const counter = { execs: 0 };
    const translator = getTranslator('search_in_files');
    expect(translator).toBeTruthy();

    const result = await translator!({
      mode: 'replace',
      query: 'foo',
      replace: 'baz',
      include: ['src/**/*.ts'],
      maxFiles: 20,
    }, {
      transport: createBashTransport(counter) as any,
      serverAlias: 'fake',
      remoteCwd: cwd,
    }) as any;

    expect(result.remotePrefilter).toBe('grep');
    expect(result.processedFiles).toBe(1);
    expect(result.totalReplacements).toBe(1);
    expect(fs.readFileSync(path.join(cwd, 'src/a.ts'), 'utf8')).toBe('baz\n');
    expect(fs.readFileSync(path.join(cwd, 'src/b.ts'), 'utf8')).toBe('bar\n');
    expect(fs.readFileSync(path.join(cwd, 'src/c.md'), 'utf8')).toBe('foo\n');
  });

  it('read_file 指定行范围时在远端切片读取', async () => {
    const cwd = makeTempDir();
    fs.writeFileSync(path.join(cwd, 'demo.txt'), 'one\ntwo\nthree\nfour\n', 'utf8');

    const counter = { execs: 0 };
    const translator = getTranslator('read_file');
    expect(translator).toBeTruthy();

    const result = await translator!({
      files: [{ path: 'demo.txt', startLine: 2, endLine: 3 }],
    }, {
      transport: createBashTransport(counter) as any,
      serverAlias: 'fake',
      remoteCwd: cwd,
    }) as any;

    expect(counter.execs).toBe(2); // stat + remote slice; no full-file download command
    expect(result.results[0].success).toBe(true);
    expect(result.results[0].totalLines).toBe(5);
    expect(result.results[0].content).toContain('2 | two');
    expect(result.results[0].content).toContain('3 | three');
    expect(result.results[0].content).not.toContain('one');
    expect(result.results[0].content).not.toContain('four');
  });
});
