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

function createBashTransport(counter: { execs: number }) {
  return {
    getTransportMode() { return 'bash'; },
    execCommand(_alias: string, command: string, _signal?: AbortSignal, input?: Buffer | string) {
      counter.execs++;
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
});
