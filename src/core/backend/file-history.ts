/**
 * Per-session 文件历史快照，用于 /rewind 的 code/both 恢复。
 *
 * - 每条普通用户消息创建一个 checkpoint snapshot；
 * - 编辑类工具真正写文件前，向当前 snapshot 记录该文件的“编辑前”备份；
 * - code rewind 时将已跟踪文件恢复到目标 checkpoint 对应状态。
 *
 * 这是 best-effort 能力：仅覆盖 Iris 内置结构化编辑工具，不覆盖 shell/bash
 * 或用户在外部手动修改文件。
 */

import * as crypto from 'node:crypto';
import * as path from 'node:path';
import { promises as fs } from 'node:fs';
import type { Stats } from 'node:fs';
import { createLogger } from '../../logger';
import { resolveProjectPath as resolveProjectPathRaw } from 'irises-extension-sdk/tool-utils';

const logger = createLogger('FileHistory');
const MAX_SNAPSHOTS = 100;
const STATE_FILE = 'state.json';

export interface FileHistoryBackup {
  /** null 表示该 checkpoint 时文件不存在。 */
  backupFileName: string | null;
  version: number;
  backupTime: number;
  mode?: number;
  /** 目录等暂不支持恢复的路径类型。 */
  unsupported?: boolean;
}

export interface FileHistorySnapshot {
  checkpointId: string;
  trackedFileBackups: Record<string, FileHistoryBackup>;
  timestamp: number;
}

export interface FileHistoryState {
  snapshots: FileHistorySnapshot[];
  trackedFiles: string[];
  snapshotSequence: number;
}

export interface FileHistoryDiffStats {
  filesChanged: string[];
  insertions: number;
  deletions: number;
}

function emptyState(): FileHistoryState {
  return { snapshots: [], trackedFiles: [], snapshotSequence: 0 };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeStoredPath(filePath: string): string {
  return path.resolve(filePath);
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function statOrNull(filePath: string): Promise<Stats | null> {
  try {
    return await fs.stat(filePath);
  } catch {
    return null;
  }
}

function splitLines(text: string): string[] {
  if (!text) return [];
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

function countLineChanges(before: string, after: string): { insertions: number; deletions: number } {
  const oldLines = splitLines(before);
  const newLines = splitLines(after);
  let prefix = 0;
  while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) prefix++;

  let oldSuffix = oldLines.length - 1;
  let newSuffix = newLines.length - 1;
  while (oldSuffix >= prefix && newSuffix >= prefix && oldLines[oldSuffix] === newLines[newSuffix]) {
    oldSuffix--;
    newSuffix--;
  }

  return {
    deletions: Math.max(0, oldSuffix - prefix + 1),
    insertions: Math.max(0, newSuffix - prefix + 1),
  };
}

function firstString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function collectPathArgs(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  for (const item of value) {
    if (isRecord(item)) {
      const p = firstString(item.path);
      if (p) result.push(p);
    } else if (typeof item === 'string' && item.trim()) {
      result.push(item);
    }
  }
  return result;
}

function extractEditPaths(toolName: string, args: Record<string, unknown>): string[] {
  switch (toolName) {
    case 'write_file':
      return [firstString(args.path), ...collectPathArgs(args.files)].filter((v): v is string => !!v);
    case 'apply_diff':
      return [firstString(args.path)].filter((v): v is string => !!v);
    case 'insert_code':
      return [firstString(args.path), ...collectPathArgs(args.files)].filter((v): v is string => !!v);
    case 'delete_code':
      return [firstString(args.path), ...collectPathArgs(args.files)].filter((v): v is string => !!v);
    case 'delete_file':
      return [firstString(args.path), ...collectPathArgs(args.paths)].filter((v): v is string => !!v);
    default:
      return [];
  }
}

export class FileHistoryManager {
  private readonly rootDir: string;
  private readonly stateCache = new Map<string, FileHistoryState>();
  private readonly locks = new Map<string, Promise<void>>();

  constructor(dataDir: string) {
    this.rootDir = path.join(dataDir, 'file-history');
  }

  async clearSession(sessionId: string): Promise<void> {
    this.stateCache.delete(sessionId);
    try {
      await fs.rm(this.sessionDir(sessionId), { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }

  async makeSnapshot(sessionId: string, checkpointId: string): Promise<void> {
    await this.withLock(sessionId, async () => {
      const state = await this.loadState(sessionId);
      const lastSnapshot = state.snapshots[state.snapshots.length - 1];
      const trackedFileBackups: Record<string, FileHistoryBackup> = {};

      for (const filePath of state.trackedFiles) {
        const latest = lastSnapshot?.trackedFileBackups[filePath];
        if (latest?.backupFileName && !(await this.fileChangedSinceBackup(sessionId, filePath, latest))) {
          trackedFileBackups[filePath] = latest;
          continue;
        }
        trackedFileBackups[filePath] = await this.createBackup(sessionId, filePath, latest ? latest.version + 1 : 1);
      }

      const snapshots = [
        ...state.snapshots,
        { checkpointId, trackedFileBackups, timestamp: Date.now() },
      ];
      state.snapshots = snapshots.length > MAX_SNAPSHOTS ? snapshots.slice(-MAX_SNAPSHOTS) : snapshots;
      state.snapshotSequence = (state.snapshotSequence ?? 0) + 1;
      await this.saveState(sessionId, state);
    });
  }

  async trackToolEdit(sessionId: string | undefined, cwd: string | undefined, toolName: string, args: Record<string, unknown>): Promise<void> {
    if (!sessionId || !cwd) return;
    const requestedPaths = extractEditPaths(toolName, args);
    if (requestedPaths.length === 0) return;

    await this.withLock(sessionId, async () => {
      const state = await this.loadState(sessionId);
      const latestSnapshot = state.snapshots[state.snapshots.length - 1];
      if (!latestSnapshot) return;

      let changed = false;
      const tracked = new Set(state.trackedFiles);
      for (const requestedPath of requestedPaths) {
        let resolved: string;
        try {
          resolved = normalizeStoredPath(resolveProjectPathRaw(requestedPath, cwd));
        } catch (err) {
          logger.warn(`跳过文件历史跟踪，路径解析失败: ${requestedPath}: ${err instanceof Error ? err.message : String(err)}`);
          continue;
        }

        if (latestSnapshot.trackedFileBackups[resolved]) continue;
        latestSnapshot.trackedFileBackups[resolved] = await this.createBackup(sessionId, resolved, 1);
        tracked.add(resolved);
        changed = true;
      }

      if (changed) {
        state.trackedFiles = Array.from(tracked);
        await this.saveState(sessionId, state);
      }
    });
  }

  async getDiffStats(sessionId: string, checkpointId: string): Promise<FileHistoryDiffStats | undefined> {
    const state = await this.loadState(sessionId);
    const targetSnapshot = this.findSnapshot(state, checkpointId);
    if (!targetSnapshot) return undefined;

    const filesChanged: string[] = [];
    let insertions = 0;
    let deletions = 0;

    for (const filePath of state.trackedFiles) {
      const backup = this.resolveBackupForSnapshot(state, targetSnapshot, filePath);
      if (backup === undefined) continue;
      if (backup.unsupported) continue;
      const current = await this.readTextOrNull(filePath);
      let target: string | null;
      if (backup.backupFileName === null) {
        target = null;
      } else {
        target = await this.readBackupTextOrThrow(sessionId, backup.backupFileName);
      }
      if (current === target) continue;

      filesChanged.push(filePath);
      const stats = countLineChanges(target ?? '', current ?? '');
      insertions += stats.insertions;
      deletions += stats.deletions;
    }

    return { filesChanged, insertions, deletions };
  }

  async canRestore(sessionId: string, checkpointId: string): Promise<boolean> {
    const state = await this.loadState(sessionId);
    return !!this.findSnapshot(state, checkpointId);
  }

  async rewind(sessionId: string, checkpointId: string): Promise<string[]> {
    return await this.withLock(sessionId, async () => {
      const state = await this.loadState(sessionId);
      const targetSnapshot = this.findSnapshot(state, checkpointId);
      if (!targetSnapshot) {
        throw new Error('未找到对应的代码快照。该回溯点可能创建于文件快照功能启用之前。');
      }

      const restored: string[] = [];
      for (const filePath of state.trackedFiles) {
        const backup = this.resolveBackupForSnapshot(state, targetSnapshot, filePath);
        if (backup === undefined) continue;
        const changed = await this.restoreBackup(sessionId, filePath, backup);
        if (changed) restored.push(filePath);
      }
      return restored;
    });
  }

  private sessionDir(sessionId: string): string {
    const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(this.rootDir, safe);
  }

  private backupPath(sessionId: string, backupFileName: string): string {
    return path.join(this.sessionDir(sessionId), 'backups', backupFileName);
  }

  private statePath(sessionId: string): string {
    return path.join(this.sessionDir(sessionId), STATE_FILE);
  }

  private async loadState(sessionId: string): Promise<FileHistoryState> {
    const cached = this.stateCache.get(sessionId);
    if (cached) return cached;

    try {
      const raw = await fs.readFile(this.statePath(sessionId), 'utf-8');
      const parsed = JSON.parse(raw) as FileHistoryState;
      const state: FileHistoryState = {
        snapshots: Array.isArray(parsed.snapshots) ? parsed.snapshots : [],
        trackedFiles: Array.isArray(parsed.trackedFiles) ? parsed.trackedFiles : [],
        snapshotSequence: Number.isFinite(parsed.snapshotSequence) ? parsed.snapshotSequence : 0,
      };
      this.stateCache.set(sessionId, state);
      return state;
    } catch {
      const state = emptyState();
      this.stateCache.set(sessionId, state);
      return state;
    }
  }

  private async saveState(sessionId: string, state: FileHistoryState): Promise<void> {
    this.stateCache.set(sessionId, state);
    await fs.mkdir(this.sessionDir(sessionId), { recursive: true });
    await fs.writeFile(this.statePath(sessionId), JSON.stringify(state, null, 2), 'utf-8');
  }

  private async createBackup(sessionId: string, filePath: string, version: number): Promise<FileHistoryBackup> {
    const stat = await statOrNull(filePath);
    if (!stat) {
      return { backupFileName: null, version, backupTime: Date.now() };
    }
    if (!stat.isFile()) {
      return { backupFileName: null, version, backupTime: Date.now(), unsupported: true };
    }

    const backupFileName = `${crypto.createHash('sha256').update(filePath).digest('hex').slice(0, 16)}@v${version}`;
    const backupPath = this.backupPath(sessionId, backupFileName);
    await fs.mkdir(path.dirname(backupPath), { recursive: true });
    await fs.copyFile(filePath, backupPath);
    await fs.chmod(backupPath, stat.mode);
    return { backupFileName, version, backupTime: Date.now(), mode: stat.mode };
  }

  private async fileChangedSinceBackup(sessionId: string, filePath: string, backup: FileHistoryBackup): Promise<boolean> {
    if (backup.unsupported) return false;
    if (backup.backupFileName === null) return await pathExists(filePath);
    const backupPath = this.backupPath(sessionId, backup.backupFileName);
    const [current, saved] = await Promise.all([
      this.readBufferOrNull(filePath),
      this.readBufferOrNull(backupPath),
    ]);
    if (!current || !saved) return current !== saved;
    return !current.equals(saved);
  }

  private resolveBackupForSnapshot(
    state: FileHistoryState,
    snapshot: FileHistorySnapshot,
    filePath: string,
  ): FileHistoryBackup | undefined {
    const exact = snapshot.trackedFileBackups[filePath];
    if (exact !== undefined) return exact;
    for (const candidate of state.snapshots) {
      const backup = candidate.trackedFileBackups[filePath];
      if (backup !== undefined && backup.version === 1) return backup;
    }
    return undefined;
  }

  private findSnapshot(state: FileHistoryState, checkpointId: string): FileHistorySnapshot | undefined {
    for (let i = state.snapshots.length - 1; i >= 0; i--) {
      if (state.snapshots[i].checkpointId === checkpointId) return state.snapshots[i];
    }
    return undefined;
  }

  private async restoreBackup(sessionId: string, filePath: string, backup: FileHistoryBackup): Promise<boolean> {
    if (backup.unsupported) return false;
    if (backup.backupFileName === null) {
      if (!(await pathExists(filePath))) return false;
      await fs.rm(filePath, { recursive: true, force: true });
      return true;
    }

    const backupPath = this.backupPath(sessionId, backup.backupFileName);
    const [current, saved] = await Promise.all([
      this.readBufferOrNull(filePath),
      this.readBufferOrNull(backupPath),
    ]);
    if (!saved) throw new Error(`代码快照备份文件缺失: ${backup.backupFileName}`);
    if (current && current.equals(saved)) return false;

    const currentStat = await statOrNull(filePath);
    if (currentStat?.isDirectory()) {
      await fs.rm(filePath, { recursive: true, force: true });
    }
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.copyFile(backupPath, filePath);
    if (backup.mode != null) {
      await fs.chmod(filePath, backup.mode).catch(() => undefined);
    }
    return true;
  }

  private async readBufferOrNull(filePath: string): Promise<Buffer | null> {
    try {
      return await fs.readFile(filePath);
    } catch {
      return null;
    }
  }

  private async readTextOrNull(filePath: string): Promise<string | null> {
    try {
      return await fs.readFile(filePath, 'utf-8');
    } catch {
      return null;
    }
  }

  private async readBackupTextOrThrow(sessionId: string, backupFileName: string): Promise<string> {
    return await fs.readFile(this.backupPath(sessionId, backupFileName), 'utf-8');
  }

  private async withLock<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(sessionId) ?? Promise.resolve();
    let result!: T;
    const current = previous.catch(() => undefined).then(async () => {
      result = await fn();
    });
    const settled = current.then(() => undefined, () => undefined);
    this.locks.set(sessionId, settled);
    try {
      await current;
      return result;
    } finally {
      if (this.locks.get(sessionId) === settled) this.locks.delete(sessionId);
    }
  }
}
