import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { sessionContext } from '../src/core/backend/session-context.js';
import { searchInFiles } from '../src/tools/internal/search_in_files.js';

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iris-search-in-files-'));
  tempDirs.push(dir);
  return dir;
}

async function runInCwd<T>(cwd: string, fn: () => Promise<T>): Promise<T> {
  return await sessionContext.run({ sessionId: `test-${Date.now()}`, cwd }, fn);
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('search_in_files glob interface', () => {
  it('支持 include brace/ext glob 并返回相对项目根目录的文件路径', async () => {
    const cwd = makeTempDir();
    fs.mkdirSync(path.join(cwd, 'src'), { recursive: true });
    fs.mkdirSync(path.join(cwd, 'tests'), { recursive: true });
    fs.writeFileSync(path.join(cwd, 'src', 'a.ts'), 'const token = "src";\n', 'utf-8');
    fs.writeFileSync(path.join(cwd, 'tests', 'b.ts'), 'const token = "tests";\n', 'utf-8');
    fs.writeFileSync(path.join(cwd, 'tests', 'ignored.md'), 'token\n', 'utf-8');

    const result = await runInCwd(cwd, async () => searchInFiles.handler({
      mode: 'search',
      query: 'token',
      include: ['{src,tests}/**/*.{ts,tsx}'],
      maxResults: 10,
      contextLines: 0,
    })) as any;

    expect(result.count).toBe(2);
    expect(result.filesMatched).toBe(2);
    expect(result.results.map((r: any) => r.file).sort()).toEqual(['src/a.ts', 'tests/b.ts']);
  });

  it('不接受旧的 path/pattern/isRegex 参数', async () => {
    const cwd = makeTempDir();
    await expect(runInCwd(cwd, async () => searchInFiles.handler({
      mode: 'search',
      query: 'x',
      path: '.',
      pattern: '**/*',
    }))).rejects.toThrow('不再支持旧参数');
  });
});
