import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { atomicWriteTextFileSync, withFileLockSync } from '../src/config/file-lock';

const dirs: string[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iris-file-lock-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0, dirs.length)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('file lock and atomic write helpers', () => {
  it('serializes read-modify-write sections', () => {
    const file = path.join(tempDir(), 'config.yaml');

    withFileLockSync(file, () => {
      atomicWriteTextFileSync(file, 'a: 1\n');
    });

    expect(fs.readFileSync(file, 'utf-8')).toBe('a: 1\n');
    expect(fs.existsSync(`${file}.lock`)).toBe(false);
  });

  it('times out when another process holds the lock', () => {
    const file = path.join(tempDir(), 'config.yaml');
    expect(() => {
      withFileLockSync(file, () => {
        withFileLockSync(file, () => undefined, { timeoutMs: 30, retryMs: 5, staleMs: 10_000 });
      });
    }).toThrow(/等待文件锁超时/);
  });

  it('cleans stale dead lock files', () => {
    const file = path.join(tempDir(), 'config.yaml');
    const lockPath = `${file}.lock`;
    fs.writeFileSync(lockPath, JSON.stringify({ pid: -1, createdAt: Date.now() - 60_000, targetPath: file }), 'utf-8');

    withFileLockSync(file, () => {
      atomicWriteTextFileSync(file, 'ok: true\n');
    }, { staleMs: 1 });

    expect(fs.readFileSync(file, 'utf-8')).toBe('ok: true\n');
    expect(fs.existsSync(lockPath)).toBe(false);
  });
});
