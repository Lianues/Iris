import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FileHistoryManager } from '../src/core/backend/file-history';

const cleanupDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iris-file-history-'));
  cleanupDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (cleanupDirs.length > 0) {
    fs.rmSync(cleanupDirs.pop()!, { recursive: true, force: true });
  }
});

describe('FileHistoryManager', () => {
  it('在编辑类工具写入前备份文件，并可按 checkpoint 恢复旧内容', async () => {
    const dataDir = makeTempDir();
    const cwd = makeTempDir();
    const filePath = path.join(cwd, 'demo.txt');
    fs.writeFileSync(filePath, 'old\n', 'utf-8');

    const manager = new FileHistoryManager(dataDir);
    await manager.makeSnapshot('s1', 'rw:0:1000');
    await manager.trackToolEdit('s1', cwd, 'write_file', { path: 'demo.txt', content: 'new\n' });

    fs.writeFileSync(filePath, 'new\n', 'utf-8');

    const stats = await manager.getDiffStats('s1', 'rw:0:1000');
    expect(stats?.filesChanged).toEqual([filePath]);

    const restored = await manager.rewind('s1', 'rw:0:1000');
    expect(restored).toEqual([filePath]);
    expect(fs.readFileSync(filePath, 'utf-8')).toBe('old\n');
  });

  it('checkpoint 时不存在的文件在 code rewind 后会被删除', async () => {
    const dataDir = makeTempDir();
    const cwd = makeTempDir();
    const filePath = path.join(cwd, 'created.txt');

    const manager = new FileHistoryManager(dataDir);
    await manager.makeSnapshot('s1', 'rw:0:1000');
    await manager.trackToolEdit('s1', cwd, 'write_file', { path: 'created.txt', content: 'created\n' });

    fs.writeFileSync(filePath, 'created\n', 'utf-8');
    expect(fs.existsSync(filePath)).toBe(true);

    const restored = await manager.rewind('s1', 'rw:0:1000');
    expect(restored).toEqual([filePath]);
    expect(fs.existsSync(filePath)).toBe(false);
  });
});
