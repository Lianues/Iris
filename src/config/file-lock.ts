/**
 * 小型跨进程文件锁与原子写入工具。
 *
 * 设计目标：
 * - CLI 与 Settings/Web 写配置时，避免多个进程同时 read-modify-write 覆盖彼此修改。
 * - 写文件采用 temp + rename，避免运行中的 ConfigWatcher 读到半截 YAML/JSON。
 *
 * 这是 advisory lock：只有使用本工具的写入方会遵守锁；读方依赖原子 rename 保证不会读到半写入文件。
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface FileLockOptions {
  /** 等待锁的最长时间，默认 10 秒 */
  timeoutMs?: number;
  /** stale lock 判定时间，默认 30 秒 */
  staleMs?: number;
  /** 重试间隔，默认 50ms */
  retryMs?: number;
  /** 自定义 lock 文件路径；默认 `${targetPath}.lock` */
  lockPath?: string;
}

interface LockFilePayload {
  pid: number;
  createdAt: number;
  targetPath: string;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_STALE_MS = 30_000;
const DEFAULT_RETRY_MS = 50;

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: any) {
    return err?.code === 'EPERM';
  }
}

function readLockPayload(lockPath: string): LockFilePayload | undefined {
  try {
    const raw = JSON.parse(fs.readFileSync(lockPath, 'utf-8')) as Partial<LockFilePayload>;
    if (typeof raw.pid !== 'number' || typeof raw.createdAt !== 'number') return undefined;
    return {
      pid: raw.pid,
      createdAt: raw.createdAt,
      targetPath: typeof raw.targetPath === 'string' ? raw.targetPath : '',
    };
  } catch {
    return undefined;
  }
}

function tryRemoveStaleLock(lockPath: string, staleMs: number): boolean {
  if (!fs.existsSync(lockPath)) return false;

  const now = Date.now();
  const payload = readLockPayload(lockPath);
  let stale = false;

  if (payload) {
    // 持锁进程已不存在时立即清理；进程仍存在时不能按时间强删，避免破坏长耗时写入。
    stale = !isProcessAlive(payload.pid);
  } else {
    try {
      const stat = fs.statSync(lockPath);
      stale = now - stat.mtimeMs > staleMs;
    } catch {
      stale = true;
    }
  }

  if (!stale) return false;

  try {
    fs.unlinkSync(lockPath);
    return true;
  } catch {
    return false;
  }
}

function acquireFileLock(targetPath: string, options: FileLockOptions = {}): { fd: number; lockPath: string } {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const staleMs = options.staleMs ?? DEFAULT_STALE_MS;
  const retryMs = options.retryMs ?? DEFAULT_RETRY_MS;
  const lockPath = options.lockPath ?? `${targetPath}.lock`;
  const deadline = Date.now() + timeoutMs;

  fs.mkdirSync(path.dirname(lockPath), { recursive: true });

  while (true) {
    try {
      const fd = fs.openSync(lockPath, 'wx');
      const payload: LockFilePayload = { pid: process.pid, createdAt: Date.now(), targetPath };
      fs.writeFileSync(fd, JSON.stringify(payload), 'utf-8');
      return { fd, lockPath };
    } catch (err: any) {
      if (err?.code !== 'EEXIST') throw err;
      tryRemoveStaleLock(lockPath, staleMs);
      if (Date.now() >= deadline) {
        const holder = readLockPayload(lockPath);
        const holderText = holder ? `pid=${holder.pid}, age=${Date.now() - holder.createdAt}ms` : 'unknown holder';
        throw new Error(`等待文件锁超时: ${lockPath} (${holderText})`);
      }
      sleepSync(retryMs);
    }
  }
}

export function withFileLockSync<T>(targetPath: string, fn: () => T, options: FileLockOptions = {}): T {
  const lock = acquireFileLock(targetPath, options);
  try {
    return fn();
  } finally {
    try { fs.closeSync(lock.fd); } catch { /* ignore */ }
    try { fs.unlinkSync(lock.lockPath); } catch { /* ignore */ }
  }
}

export function atomicWriteTextFileSync(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const suffix = `${process.pid}.${Date.now()}.${crypto.randomBytes(6).toString('hex')}`;
  const tmpPath = `${filePath}.${suffix}.tmp`;
  let fd: number | undefined;

  try {
    fd = fs.openSync(tmpPath, 'w');
    fs.writeFileSync(fd, content, 'utf-8');
    try { fs.fsyncSync(fd); } catch { /* best-effort */ }
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch { /* ignore */ }
    }
    try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    throw err;
  }
}

export function atomicWriteJsonFileSync(filePath: string, value: unknown): void {
  atomicWriteTextFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
