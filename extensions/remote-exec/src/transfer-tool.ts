import * as fs from 'node:fs';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { Transform, type Readable, type Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { SFTPWrapper } from 'ssh2';
import type { ToolDefinition, ToolExecutionContext } from 'irises-extension-sdk';
import { LOCAL_ENV } from './config.js';
import type { EnvironmentManager } from './environment.js';
import type { ExecResult, SshTransport } from './transport.js';
import { shQuote } from './remote-shell.js';

export const TRANSFER_FILES_TOOL_NAME = 'transfer_files';

// ── 性能调优常量 ──

/** SFTP 每次 READ/WRITE 请求的数据块大小（默认 32KB 太小，严重限制吞吐） */
const SFTP_CHUNK_SIZE = 256 * 1024;       // 256KB
/** Node.js 流缓冲区大小（读、写、Transform 统一） */
const STREAM_HIGH_WATER_MARK = 1024 * 1024; // 1MB
/** SFTP 并发写请求数（默认 5 太少，100ms RTT 下仅 1.6MB/s） */
const SFTP_WRITE_CONCURRENCY = 32;
/** SFTP 并发读请求数（默认 64，已足够） */
const SFTP_READ_CONCURRENCY = 64;
/** 目录传输时文件级并发度 */
const FILE_CONCURRENCY = 8;
interface SftpFastOptions {
  chunkSize: number;
  concurrency: number;
}
/**
 * fastPut/fastGet 通用默认：兼顾首屏进度和吞吐。
 */
const SFTP_FAST_OPTIONS: SftpFastOptions = { chunkSize: 64 * 1024, concurrency: 16 }; // 1MB in-flight
/** 进度上报最小间隔（ms），避免高频 IPC 开销 */
const PROGRESS_THROTTLE_MS = 1000;

type TransferKind = 'auto' | 'file' | 'directory';
type ResolvedKind = 'file' | 'directory';
type VerifyMode = 'none' | 'size';

interface TransferItem {
  fromEnvironment: string;
  fromPath: string;
  toEnvironment: string;
  toPath: string;
  type: TransferKind;
  overwrite: boolean;
  createDirs: boolean;
}

interface StatInfo {
  type: ResolvedKind;
  size: number;
}

interface DirEntry {
  name: string;
  type: ResolvedKind;
  /** 文件大小（仅文件类型时有值，由支持的 readdir 实现填充，省掉后续 stat） */
  size?: number;
}

interface TransferProgressTracker {
  context?: ToolExecutionContext;
  startedAt: number;
  /** 上次上报时的时间戳和字节数（用于计算即时速度） */
  prevReportTs: number;
  prevReportBytes: number;
  /** 上次计算出的有效速度（无新数据时保持显示） */
  lastSpeed: number;
  totalBytes: number;
  totalFiles: number;
  /** 总量是否已知（单文件=true，目录=false，边传边统计） */
  totalKnown: boolean;
  transferredBytes: number;
  completedFiles: number;
  currentSourcePath?: string;
  currentTargetPath?: string;
  /** 上次进度上报时间戳（节流用） */
  lastReportTs: number;
}

interface StreamHandle {
  stream: Readable | Writable;
  done?: () => Promise<void>;
}

interface Endpoint {
  environment: string;
  isLocal: boolean;
  assertAbsolute(p: string): void;
  normalize(p: string): string;
  dirname(p: string): string;
  basename(p: string): string;
  join(dir: string, child: string): string;
  stat(p: string): Promise<StatInfo>;
  exists(p: string): Promise<boolean>;
  mkdirp(p: string): Promise<void>;
  readdir(p: string): Promise<DirEntry[]>;
  unlink(p: string): Promise<void>;
  rename(src: string, dst: string, overwrite: boolean): Promise<void>;
  openRead(p: string): Promise<StreamHandle & { stream: Readable }>;
  openWrite(p: string, overwrite: boolean): Promise<StreamHandle & { stream: Writable }>;
}

export function buildTransferFilesTool(
  envMgr: EnvironmentManager,
  getTransport: () => SshTransport,
): ToolDefinition {
  const envs = envMgr.listEnvs();
  const envNames = envs.map(e => e.name);

  return {
    declaration: {
      name: TRANSFER_FILES_TOOL_NAME,
      description: [
        '在本地与远端服务器之间传输文件或目录。支持 local ↔ remote、remote ↔ remote、local ↔ local。',
        '注意：remote ↔ remote 传输会通过当前本地 Iris 实例中转。',
        '路径必须使用全路径/绝对路径：本地如 C:\\path\\file 或 /home/me/file，远端如 /root/file。',
        '路径以 / 或 \\ 结尾表示目录；否则表示文件。type=auto 时也会 stat 源路径自动判断。',
        '传目录时，toPath 表示目标目录本身，例如 fromPath=/data/app/ toPath=/backup/app/。',
        '默认 overwrite=false，目标存在会失败；需要覆盖时显式设置 overwrite=true。',
        '文件写入采用临时文件 + 校验 + rename 的原子提交方式；失败会尽力清理临时文件。',
      ].join('\n'),
      parameters: {
        type: 'object',
        properties: {
          transfers: {
            type: 'array',
            description: '批量传输任务数组。若提供 transfers，则忽略单条快捷字段。',
            items: {
              type: 'object',
              properties: transferProperties(envNames),
              required: ['fromEnvironment', 'fromPath', 'toEnvironment', 'toPath'],
            },
          },
          ...transferProperties(envNames),
          verify: {
            type: 'string',
            enum: ['none', 'size'],
            description: '校验模式。none=不校验；size=比较源/目标文件大小（默认）。目录逐文件校验。',
          },
        },
      },
    },
    handler: async (args, context) => {
      const items = normalizeTransfers(args);
      if (items.length === 0) {
        throw new Error('transfer_files: 请提供 transfers 数组，或提供 fromEnvironment/fromPath/toEnvironment/toPath 单条参数。');
      }
      const verify: VerifyMode = args.verify === 'none' ? 'none' : 'size';

      const results: Record<string, unknown>[] = [];
      let successCount = 0;
      let failCount = 0;

      for (let i = 0; i < items.length; i++) {
        const started = Date.now();
        const item = items[i];
        try {
          const result = await runTransfer(item, verify, envMgr, getTransport(), context, i);
          results.push({ ...result, durationMs: Date.now() - started });
          successCount++;
        } catch (err) {
          results.push({
            success: false,
            index: i,
            type: item.type,
            from: { environment: item.fromEnvironment, path: item.fromPath },
            to: { environment: item.toEnvironment, path: item.toPath },
            error: err instanceof Error ? err.message : String(err),
            durationMs: Date.now() - started,
          });
          failCount++;
        }
      }

      return { results, successCount, failCount, totalCount: items.length };
    },
  };
}

function transferProperties(envNames: string[]): Record<string, Record<string, unknown>> {
  return {
    fromEnvironment: {
      type: 'string',
      enum: envNames,
      description: `源服务器。可选值：${envNames.join(' | ')}`,
    },
    fromPath: {
      type: 'string',
      description: '源路径，必须是全路径/绝对路径。目录建议以 / 或 \\ 结尾。',
    },
    toEnvironment: {
      type: 'string',
      enum: envNames,
      description: `目标服务器。可选值：${envNames.join(' | ')}`,
    },
    toPath: {
      type: 'string',
      description: '目标路径，必须是全路径/绝路径。传目录时表示目标目录本身。',
    },
    type: {
      type: 'string',
      enum: ['auto', 'file', 'directory'],
      description: '传输类型。auto 会根据 fromPath 尾部斜杠和源路径 stat 自动判断。默认 auto。',
    },
    overwrite: {
      type: 'boolean',
      description: '目标存在时是否覆盖。默认 false。',
    },
    createDirs: {
      type: 'boolean',
      description: '是否自动创建目标父目录/目标目录。默认 true。',
    },
  };
}

function normalizeTransfers(args: Record<string, unknown>): TransferItem[] {
  const rawList = Array.isArray(args.transfers) && args.transfers.length > 0 ? args.transfers : [args];
  const out: TransferItem[] = [];
  for (const raw of rawList) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const obj = raw as Record<string, unknown>;
    const fromEnvironment = str(obj.fromEnvironment);
    const fromPath = str(obj.fromPath);
    const toEnvironment = str(obj.toEnvironment);
    const toPath = str(obj.toPath);
    if (!fromEnvironment || !fromPath || !toEnvironment || !toPath) continue;
    const typeRaw = str(obj.type);
    out.push({
      fromEnvironment,
      fromPath,
      toEnvironment,
      toPath,
      type: typeRaw === 'file' || typeRaw === 'directory' ? typeRaw : 'auto',
      overwrite: obj.overwrite === true,
      createDirs: obj.createDirs !== false,
    });
  }
  return out;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

async function runTransfer(
  item: TransferItem,
  verify: VerifyMode,
  envMgr: EnvironmentManager,
  transport: SshTransport,
  context: ToolExecutionContext | undefined,
  index: number,
): Promise<Record<string, unknown>> {
  const from = await createEndpoint(item.fromEnvironment, envMgr, transport);
  const to = await createEndpoint(item.toEnvironment, envMgr, transport);

  from.assertAbsolute(item.fromPath);
  to.assertAbsolute(item.toPath);

  const sourcePath = from.normalize(item.fromPath);
  let targetPath = to.normalize(item.toPath);
  const sourceStat = await from.stat(sourcePath);
  const kind: ResolvedKind = item.type === 'auto'
    ? (hasTrailingSlash(item.fromPath) ? 'directory' : sourceStat.type)
    : item.type;

  if (kind === 'file' && hasTrailingSlash(item.toPath)) {
    targetPath = to.join(targetPath, from.basename(sourcePath));
  }

  if (kind === 'file') {
    const tracker = createTransferTracker(context, { files: 1, dirs: 0, bytes: sourceStat.size }, true);
    reportTransferProgress(tracker, false, true);
    const copied = await copyFile({ from, to, sourcePath, targetPath, overwrite: item.overwrite, createDirs: item.createDirs, verify, tracker, knownSize: sourceStat.size });
    reportTransferProgress(tracker, true, true);
    return {
      success: true,
      index,
      type: 'file',
      from: { environment: item.fromEnvironment, path: item.fromPath },
      to: { environment: item.toEnvironment, path: item.toPath },
      files: 1,
      dirs: 0,
      bytes: copied.bytes,
      verify: { mode: verify, ok: copied.verifyOk },
    };
  }

  // 目录传输：不再预扫描 collectTransferStats，边传边统计
  const tracker = createTransferTracker(context, { files: 0, dirs: 0, bytes: 0 }, false);
  const mkdirCache = new Set<string>();
  reportTransferProgress(tracker, false, true);
  const copied = await copyDirectory({ from, to, sourceDir: sourcePath, targetDir: targetPath, overwrite: item.overwrite, createDirs: item.createDirs, verify, tracker, mkdirCache });
  reportTransferProgress(tracker, true, true);
  return {
    success: true,
    index,
    type: 'directory',
    from: { environment: item.fromEnvironment, path: item.fromPath },
    to: { environment: item.toEnvironment, path: item.toPath },
    files: copied.files,
    dirs: copied.dirs,
    bytes: copied.bytes,
    verify: { mode: verify, ok: copied.verifyOk },
  };
}

async function createEndpoint(environment: string, envMgr: EnvironmentManager, transport: SshTransport): Promise<Endpoint> {
  if (environment === LOCAL_ENV) return new LocalEndpoint();
  const env = envMgr.listEnvs().find(e => e.name === environment && !e.isLocal);
  if (!env) throw new Error(`未知传输服务器: ${environment}`);
  const mode = transport.getTransportMode(environment);
  if (mode === 'bash') return new RemoteBashEndpoint(environment, transport);
  try {
    const sftp = await transport.getSftp(environment);
    return new RemoteSftpEndpoint(environment, sftp);
  } catch (err) {
    if (mode === 'sftp') throw err;
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('SFTP 子系统不可用')) return new RemoteBashEndpoint(environment, transport);
    throw err;
  }
}


function createTransferTracker(context: ToolExecutionContext | undefined, stats: { files: number; dirs: number; bytes: number }, totalKnown: boolean): TransferProgressTracker {
  const now = Date.now();
  return {
    context,
    startedAt: now,
    prevReportTs: now,
    prevReportBytes: 0,
    lastSpeed: 0,
    totalBytes: stats.bytes,
    totalFiles: stats.files,
    totalKnown,
    transferredBytes: 0,
    completedFiles: 0,
    lastReportTs: 0,
  };
}

function reportTransferProgress(tracker: TransferProgressTracker, final: boolean, force: boolean): void {
  const now = Date.now();
  if (!force) {
    if (now - tracker.lastReportTs < PROGRESS_THROTTLE_MS) return;
    tracker.lastReportTs = now;
  }

  const elapsedMs = Math.max(1, now - tracker.startedAt);

  // 速度计算：只在有新数据流入时重新计算，否则保持上次速度
  const dt = now - tracker.prevReportTs;
  const db = tracker.transferredBytes - tracker.prevReportBytes;
  let speedBytesPerSec: number;
  if (final) {
    speedBytesPerSec = tracker.transferredBytes / (elapsedMs / 1000);
  } else if (dt >= 500 && db > 0) {
    // 有新数据到达——计算区间即时速度，更新锚点
    speedBytesPerSec = db / (dt / 1000);
    tracker.lastSpeed = speedBytesPerSec;
    tracker.prevReportTs = now;
    tracker.prevReportBytes = tracker.transferredBytes;
  } else if (tracker.lastSpeed > 0) {
    // 无新数据——保持上次速度，不更新锚点
    speedBytesPerSec = tracker.lastSpeed;
  } else {
    speedBytesPerSec = 0;
  }

  let percent: number;
  let etaSec: number | undefined;
  if (final) {
    percent = 100;
  } else if (tracker.totalKnown && tracker.totalBytes > 0) {
    const remainingBytes = Math.max(0, tracker.totalBytes - tracker.transferredBytes);
    percent = Math.min(99, Math.round((tracker.transferredBytes / tracker.totalBytes) * 100));
    etaSec = speedBytesPerSec > 0 ? Math.ceil(remainingBytes / speedBytesPerSec) : undefined;
  } else {
    // 目录传输：总量未知，不计算百分比
    percent = -1;
    etaSec = undefined;
  }

  tracker.context?.reportProgress?.({
    kind: 'transfer_files',
    sourcePath: tracker.currentSourcePath,
    targetPath: tracker.currentTargetPath,
    bytesTransferred: tracker.transferredBytes,
    totalBytes: tracker.totalKnown ? tracker.totalBytes : undefined,
    percent,
    speedBytesPerSec,
    etaSec,
    elapsedMs,
    filesTransferred: tracker.completedFiles,
    totalFiles: tracker.totalKnown ? tracker.totalFiles : undefined,
  });
}

async function copyDirectory(input: {
  from: Endpoint;
  to: Endpoint;
  sourceDir: string;
  targetDir: string;
  overwrite: boolean;
  createDirs: boolean;
  verify: VerifyMode;
  tracker: TransferProgressTracker;
  mkdirCache: Set<string>;
}): Promise<{ files: number; dirs: number; bytes: number; verifyOk: boolean }> {
  const { from, to, sourceDir, targetDir, overwrite, createDirs, verify, tracker, mkdirCache } = input;
  if (createDirs) await mkdirpCached(to, targetDir, mkdirCache);

  let files = 0;
  let dirs = 1;
  let bytes = 0;
  let verifyOk = true;

  const entries = await from.readdir(sourceDir);
  const dirEntries = entries.filter(e => e.type === 'directory');
  const fileEntries = entries.filter(e => e.type === 'file');

  // 先为子目录在目标端创建对应目录（保证后续文件写入的父目录存在）
  for (const dir of dirEntries) {
    const dst = to.join(targetDir, dir.name);
    if (createDirs) await mkdirpCached(to, dst, mkdirCache);
  }

  // 文件级并发传输
  if (fileEntries.length > 0) {
    const fileResults = await pMap(fileEntries, FILE_CONCURRENCY, async (entry) => {
      const src = from.join(sourceDir, entry.name);
      const dst = to.join(targetDir, entry.name);
      return copyFile({ from, to, sourcePath: src, targetPath: dst, overwrite, createDirs, verify, tracker, knownSize: entry.size, mkdirCache });
    });
    for (const one of fileResults) {
      files += 1;
      bytes += one.bytes;
      verifyOk = verifyOk && one.verifyOk;
    }
  }

  // 子目录递归
  for (const dir of dirEntries) {
    const src = from.join(sourceDir, dir.name);
    const dst = to.join(targetDir, dir.name);
    const nested = await copyDirectory({ from, to, sourceDir: src, targetDir: dst, overwrite, createDirs, verify, tracker, mkdirCache });
    files += nested.files;
    dirs += nested.dirs;
    bytes += nested.bytes;
    verifyOk = verifyOk && nested.verifyOk;
  }

  return { files, dirs, bytes, verifyOk };
}

async function copyFile(input: {
  from: Endpoint;
  to: Endpoint;
  sourcePath: string;
  targetPath: string;
  overwrite: boolean;
  createDirs: boolean;
  verify: VerifyMode;
  tracker: TransferProgressTracker;
  /** 已知源文件大小（从 readdir 的 DirEntry.size 传入，省掉 stat RTT） */
  knownSize?: number;
  /** 目录缓存（跳过已知存在的目录的 mkdirp） */
  mkdirCache?: Set<string>;
}): Promise<{ bytes: number; verifyOk: boolean }> {
  const { from, to, sourcePath, targetPath, overwrite, createDirs, verify, tracker, knownSize, mkdirCache } = input;

  // 只有 knownSize 未知时才 stat（从 copyDirectory 调用时 readdir 已提供 size）
  let sourceSize: number;
  if (knownSize !== undefined && knownSize >= 0) {
    sourceSize = knownSize;
  } else {
    const st = await from.stat(sourcePath);
    if (st.type !== 'file') throw new Error(`源路径不是文件: ${sourcePath}`);
    sourceSize = st.size;
  }

  // overwrite=true 时不需要 exists 检查（反正会覆盖/rename 会处理）
  if (!overwrite && await to.exists(targetPath)) {
    throw new Error(`目标已存在: ${targetPath}`);
  }

  // 使用缓存版本避免重复 mkdirp
  if (createDirs) {
    const dir = to.dirname(targetPath);
    if (mkdirCache) await mkdirpCached(to, dir, mkdirCache);
    else await to.mkdirp(dir);
  }

  const tempPath = makeTempPath(to, targetPath);
  tracker.currentSourcePath = sourcePath;
  tracker.currentTargetPath = targetPath;

  // 快速路径：local ↔ SFTP 使用 ssh2 的 fastPut/fastGet（绕过流管道，精确进度）
  const useFastPut = from instanceof LocalEndpoint && to instanceof RemoteSftpEndpoint;
  const useFastGet = from instanceof RemoteSftpEndpoint && to instanceof LocalEndpoint;

  try {
    if (useFastPut) {
      await sftpFastPut((to as RemoteSftpEndpoint).sftp, sourcePath, tempPath, sourceSize, tracker, (to as RemoteSftpEndpoint).fastOptions);
    } else if (useFastGet) {
      await sftpFastGet((from as RemoteSftpEndpoint).sftp, sourcePath, tempPath, sourceSize, tracker, (from as RemoteSftpEndpoint).fastOptions);
    } else {
      // 通用路径：流管道（用于 remote↔remote、bash endpoint 等）
      await copyFileViaStream(from, to, sourcePath, tempPath, tracker);
    }

    let verifyOk = true;
    if (verify === 'size') {
      const tempStat = await to.stat(tempPath);
      verifyOk = tempStat.type === 'file' && tempStat.size === sourceSize;
      if (!verifyOk) throw new Error(`size 校验失败: source=${sourceSize}, temp=${tempStat.size}`);
    }

    await to.rename(tempPath, targetPath, overwrite);
    tracker.completedFiles += 1;
    reportTransferProgress(tracker, false, true);
    return { bytes: sourceSize, verifyOk };
  } catch (err) {
    await safeUnlink(to, tempPath);
    throw err;
  }
}

/** ssh2 fastPut：本地→远端 SFTP，精确进度（step 计数 + 定时器显示） */
function sftpFastPut(sftp: SFTPWrapper, localPath: string, remotePath: string, totalSize: number, tracker: TransferProgressTracker, options: SftpFastOptions): Promise<void> {
  const baseBytes = tracker.transferredBytes;
  const timer = setInterval(() => reportTransferProgress(tracker, false, true), PROGRESS_THROTTLE_MS);
  return new Promise((resolve, reject) => {
    sftp.fastPut(localPath, remotePath, {
      concurrency: options.concurrency,
      chunkSize: options.chunkSize,
      step(transferred) {
        // transferred = 本文件累计已传字节（由 ssh2 精确统计）
        tracker.transferredBytes = baseBytes + transferred;
      },
    }, (err) => { clearInterval(timer); err ? reject(err) : resolve(); });
  });
}

/** ssh2 fastGet：远端 SFTP→本地，精确进度（step 计数 + 定时器显示） */
function sftpFastGet(sftp: SFTPWrapper, remotePath: string, localPath: string, totalSize: number, tracker: TransferProgressTracker, options: SftpFastOptions): Promise<void> {
  const baseBytes = tracker.transferredBytes;
  const timer = setInterval(() => reportTransferProgress(tracker, false, true), PROGRESS_THROTTLE_MS);
  return new Promise((resolve, reject) => {
    sftp.fastGet(remotePath, localPath, {
      concurrency: options.concurrency,
      chunkSize: options.chunkSize,
      step(transferred) {
        tracker.transferredBytes = baseBytes + transferred;
      },
    }, (err) => { clearInterval(timer); err ? reject(err) : resolve(); });
  });
}

/** 通用流管道传输（remote↔remote、bash endpoint 等非 SFTP 直连场景） */
async function copyFileViaStream(from: Endpoint, to: Endpoint, sourcePath: string, tempPath: string, tracker: TransferProgressTracker): Promise<void> {
  const progress = new Transform({
    highWaterMark: STREAM_HIGH_WATER_MARK,
    transform(chunk, _encoding, callback) {
      const n = Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk);
      tracker.transferredBytes += n;
      callback(null, chunk);
    },
  });
  const reader = await from.openRead(sourcePath);
  const writer = await to.openWrite(tempPath, false);
  const progressTimer = setInterval(() => reportTransferProgress(tracker, false, true), PROGRESS_THROTTLE_MS);
  try {
    await pipeline(reader.stream, progress, writer.stream);
    if (reader.done) await reader.done();
    if (writer.done) await writer.done();
  } finally {
    clearInterval(progressTimer);
  }
}

function makeTempPath(endpoint: Endpoint, targetPath: string): string {
  const dir = endpoint.dirname(targetPath);
  const base = endpoint.basename(targetPath) || 'target';
  const suffix = `${Date.now()}-${process.pid}-${randomBytes(4).toString('hex')}`;
  return endpoint.join(dir, `.${base}.remote-exec-tmp-${suffix}`);
}

async function safeUnlink(endpoint: Endpoint, p: string): Promise<void> {
  try { await endpoint.unlink(p); } catch { /* ignore cleanup errors */ }
}

function hasTrailingSlash(p: string): boolean {
  return /[\\/]$/.test(p);
}

function trimTrailingSeparators(p: string, isRemote: boolean): string {
  const root = isRemote ? '/' : path.parse(p).root;
  let out = p;
  while (out.length > root.length && /[\\/]$/.test(out)) out = out.slice(0, -1);
  return out;
}

// ── mkdirp 缓存：已确认创建的目录加入 Set，后续跳过 ──

async function mkdirpCached(endpoint: Endpoint, p: string, cache: Set<string>): Promise<void> {
  const normalized = endpoint.normalize(p);
  if (cache.has(normalized)) return;
  await endpoint.mkdirp(normalized);
  // 将该路径及其所有父路径都加入缓存
  let cur = normalized;
  while (cur && cur !== '/' && cur !== '.' && !cache.has(cur)) {
    cache.add(cur);
    const parent = endpoint.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
}

// ── 简单并发控制（不引入外部依赖） ──

async function pMap<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let index = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

// ── LocalEndpoint ──

class LocalEndpoint implements Endpoint {
  environment = LOCAL_ENV;
  isLocal = true;

  assertAbsolute(p: string): void {
    if (!path.isAbsolute(p) && !path.win32.isAbsolute(p) && !path.posix.isAbsolute(p)) {
      throw new Error(`本地路径必须是全路径/绝对路径: ${p}`);
    }
  }
  normalize(p: string): string { return path.normalize(trimTrailingSeparators(p, false)); }
  dirname(p: string): string { return path.dirname(p); }
  basename(p: string): string { return path.basename(p); }
  join(dir: string, child: string): string { return path.join(dir, child); }
  async stat(p: string): Promise<StatInfo> {
    const st = await fsp.stat(p);
    if (st.isDirectory()) return { type: 'directory', size: 0 };
    if (st.isFile()) return { type: 'file', size: st.size };
    throw new Error(`不支持的本地路径类型: ${p}`);
  }
  async exists(p: string): Promise<boolean> { try { await fsp.stat(p); return true; } catch { return false; } }
  async mkdirp(p: string): Promise<void> { await fsp.mkdir(p, { recursive: true }); }
  async readdir(p: string): Promise<DirEntry[]> {
    const entries = await fsp.readdir(p, { withFileTypes: true });
    const out: DirEntry[] = [];
    for (const e of entries) {
      if (e.isDirectory()) {
        out.push({ name: e.name, type: 'directory' });
      } else if (e.isFile()) {
        // 本地 readdir 也顺带 stat 获取文件大小（批量 lstat 比逐个 stat 更快）
        try {
          const st = await fsp.stat(path.join(p, e.name));
          out.push({ name: e.name, type: 'file', size: st.size });
        } catch {
          out.push({ name: e.name, type: 'file' });
        }
      }
    }
    return out;
  }
  async unlink(p: string): Promise<void> { await fsp.rm(p, { force: true }); }
  async rename(src: string, dst: string, overwrite: boolean): Promise<void> {
    try {
      await fsp.rename(src, dst);
    } catch (err) {
      if (!overwrite) throw err;
      await fsp.rm(dst, { force: true });
      await fsp.rename(src, dst);
    }
  }
  async openRead(p: string): Promise<StreamHandle & { stream: Readable }> {
    return { stream: fs.createReadStream(p, { highWaterMark: STREAM_HIGH_WATER_MARK }) };
  }
  async openWrite(p: string, overwrite: boolean): Promise<StreamHandle & { stream: Writable }> {
    return { stream: fs.createWriteStream(p, { flags: overwrite ? 'w' : 'wx', highWaterMark: STREAM_HIGH_WATER_MARK }) };
  }
}

// ── RemoteSftpEndpoint ──

class RemoteSftpEndpoint implements Endpoint {
  isLocal = false;
  /** public 以供 fastPut/fastGet 快速路径访问 */
  readonly fastOptions = SFTP_FAST_OPTIONS;
  constructor(public environment: string, public sftp: SFTPWrapper) {}

  assertAbsolute(p: string): void { if (!p.startsWith('/')) throw new Error(`远端路径必须是 / 开头的绝对路径: ${p}`); }
  normalize(p: string): string { return path.posix.normalize(trimTrailingSeparators(p.replace(/\\/g, '/'), true)); }
  dirname(p: string): string { return path.posix.dirname(p); }
  basename(p: string): string { return path.posix.basename(p); }
  join(dir: string, child: string): string { return path.posix.join(dir, child); }
  async stat(p: string): Promise<StatInfo> {
    const st = await new Promise<any>((resolve, reject) => this.sftp.stat(p, (err, stats) => err ? reject(err) : resolve(stats)));
    if (st.isDirectory()) return { type: 'directory', size: 0 };
    if (st.isFile()) return { type: 'file', size: st.size };
    throw new Error(`不支持的远端路径类型: ${p}`);
  }
  async exists(p: string): Promise<boolean> { try { await this.stat(p); return true; } catch { return false; } }

  /**
   * mkdirp 优化：先直接 mkdir 目标目录（快速路径，1 RTT），
   * 如果目标已存在则 stat 确认后直接返回；否则逐层 mkdir。
   */
  async mkdirp(p: string): Promise<void> {
    const normalized = this.normalize(p);
    if (!normalized || normalized === '/') return;
    // 快速路径：直接 mkdir 最终目录
    try {
      await sftpMkdir(this.sftp, normalized);
      return;
    } catch { /* 可能已存在，也可能父目录不存在 */ }

    // 常见路径（如 /root）已存在：确认是目录后直接返回，避免重复逐层 mkdir
    try {
      const st = await this.stat(normalized);
      if (st.type === 'directory') return;
      throw new Error(`${normalized} 已存在但不是目录`);
    } catch { /* 不存在或 stat 失败，走慢路径 */ }

    // 慢路径：逐层创建；每层失败时确认是否已经是目录
    const parts = normalized.split('/').filter(Boolean);
    let cur = '/';
    for (const part of parts) {
      cur = cur === '/' ? `/${part}` : path.posix.join(cur, part);
      try { await sftpMkdir(this.sftp, cur); }
      catch { const st = await this.stat(cur); if (st.type !== 'directory') throw new Error(`${cur} 已存在但不是目录`); }
    }
  }

  /**
   * readdir 优化：从 SFTP readdir 的 attrs 中直接提取文件大小，
   * 省掉后续每个文件单独 stat 的 RTT。
   */
  async readdir(p: string): Promise<DirEntry[]> {
    const list = await new Promise<any[]>((resolve, reject) => this.sftp.readdir(p, (err, entries) => err ? reject(err) : resolve(entries)));
    return list
      .filter(e => e.attrs?.isFile?.() || e.attrs?.isDirectory?.())
      .map(e => ({
        name: e.filename,
        type: e.attrs.isDirectory() ? 'directory' as const : 'file' as const,
        size: e.attrs.isFile?.() ? (e.attrs.size as number | undefined) : undefined,
      }));
  }
  async unlink(p: string): Promise<void> {
    await new Promise<void>((resolve, reject) => this.sftp.unlink(p, err => err ? reject(err) : resolve()));
  }
  async rename(src: string, dst: string, overwrite: boolean): Promise<void> {
    try {
      await new Promise<void>((resolve, reject) => this.sftp.rename(src, dst, err => err ? reject(err) : resolve()));
    } catch (err) {
      if (!overwrite) throw err;
      try { await this.unlink(dst); } catch { /* ignore target missing */ }
      await new Promise<void>((resolve, reject) => this.sftp.rename(src, dst, err2 => err2 ? reject(err2) : resolve()));
    }
  }

  /**
   * SFTP 读流：大幅增加 chunkSize 和 highWaterMark 以提升吞吐
   * - chunkSize 256KB（原 32KB）：减少 SFTP READ 请求次数
   * - highWaterMark 1MB（原 64KB）：增大 Node.js 流缓冲区
   * - concurrency 64（保持默认）：并发读请求数已足够
   */
  async openRead(p: string): Promise<StreamHandle & { stream: Readable }> {
    return {
      stream: this.sftp.createReadStream(p, {
        chunkSize: SFTP_CHUNK_SIZE,
        highWaterMark: STREAM_HIGH_WATER_MARK,
        concurrency: SFTP_READ_CONCURRENCY,
      }) as unknown as Readable,
    };
  }

  /**
   * SFTP 写流：这是原实现最大的瓶颈所在
   * - chunkSize 256KB（原 32KB）：减少 SFTP WRITE 请求次数
   * - highWaterMark 1MB（原 64KB）：增大 Node.js 流缓冲区
   * - concurrency 32（原 5！）：大幅增加并发写请求，充分利用带宽
   *   原实现 5 并发 × 32KB = 160KB 在途数据，100ms RTT 下仅 1.6MB/s
   *   优化后 32 并发 × 256KB = 8MB 在途数据，100ms RTT 下可达 80MB/s
   */
  async openWrite(p: string, overwrite: boolean): Promise<StreamHandle & { stream: Writable }> {
    return {
      stream: this.sftp.createWriteStream(p, {
        flags: overwrite ? 'w' : 'wx',
        chunkSize: SFTP_CHUNK_SIZE,
        highWaterMark: STREAM_HIGH_WATER_MARK,
        concurrency: SFTP_WRITE_CONCURRENCY,
      }) as unknown as Writable,
    };
  }
}

// ── SFTP 辅助 ──

function sftpMkdir(sftp: SFTPWrapper, p: string): Promise<void> {
  return new Promise<void>((resolve, reject) => sftp.mkdir(p, err => err ? reject(err) : resolve()));
}

// ── RemoteBashEndpoint ──

function decodeNulListFromBase64(stdout: string): string[] {
  return Buffer.from(stdout.replace(/\s+/g, ''), 'base64').toString('utf8').split('\0').filter(Boolean);
}

function assertExecOk(result: ExecResult, op: string): void {
  if ((result.exitCode ?? 0) !== 0 || result.timedOut) {
    throw new Error(`${op} 失败: exitCode=${result.exitCode} stderr=${result.stderr}`);
  }
}

class RemoteBashEndpoint implements Endpoint {
  isLocal = false;

  constructor(public environment: string, private transport: SshTransport) {}

  assertAbsolute(p: string): void {
    if (!p.startsWith('/')) throw new Error(`远端路径必须是 / 开头的绝对路径: ${p}`);
  }

  normalize(p: string): string { return path.posix.normalize(trimTrailingSeparators(p.replace(/\\/g, '/'), true)); }
  dirname(p: string): string { return path.posix.dirname(p); }
  basename(p: string): string { return path.posix.basename(p); }
  join(dir: string, child: string): string { return path.posix.join(dir, child); }

  private async run(script: string): Promise<ExecResult> {
    return this.transport.execCommand(this.environment, `bash -lc ${shQuote(script)}`);
  }

  async stat(p: string): Promise<StatInfo> {
    const script = `if [ -d ${shQuote(p)} ]; then printf 'directory\\t0'; elif [ -f ${shQuote(p)} ]; then printf 'file\\t%s' "$(wc -c < ${shQuote(p)})"; else echo 'path not found' >&2; exit 44; fi`;
    const result = await this.run(script);
    assertExecOk(result, `stat ${p}`);
    const [type, size] = result.stdout.trim().split('\t');
    if (type === 'directory') return { type: 'directory', size: 0 };
    if (type === 'file') return { type: 'file', size: Number.parseInt(size, 10) || 0 };
    throw new Error(`无法识别远端路径类型: ${p}`);
  }

  async exists(p: string): Promise<boolean> {
    const result = await this.run(`[ -e ${shQuote(p)} ]`);
    return (result.exitCode ?? 1) === 0;
  }

  async mkdirp(p: string): Promise<void> {
    const result = await this.run(`mkdir -p -- ${shQuote(p)}`);
    assertExecOk(result, `mkdir -p ${p}`);
  }

  async readdir(p: string): Promise<DirEntry[]> {
    const script = `cd -- ${shQuote(p)} && find . -mindepth 1 -maxdepth 1 \\( -type d -print0 -o -type f -print0 \\) 2>/dev/null | while IFS= read -r -d '' x; do rel="\${x#./}"; if [ -d "$x" ]; then printf 'd\\t%s\\0' "$rel"; elif [ -f "$x" ]; then printf 'f\\t%s\\0' "$rel"; fi; done | base64 | tr -d '\\n\\r'`;
    const result = await this.run(script);
    assertExecOk(result, `readdir ${p}`);
    return decodeNulListFromBase64(result.stdout)
      .map((rec) => {
        const tab = rec.indexOf('\t');
        if (tab < 0) return undefined;
        const t = rec.slice(0, tab);
        const name = rec.slice(tab + 1);
        if (!name) return undefined;
        return { name, type: t === 'd' ? 'directory' : 'file' } as DirEntry;
      })
      .filter((x): x is DirEntry => !!x);
  }

  async unlink(p: string): Promise<void> {
    const result = await this.run(`rm -f -- ${shQuote(p)}`);
    assertExecOk(result, `rm -f ${p}`);
  }

  async rename(src: string, dst: string, overwrite: boolean): Promise<void> {
    const script = overwrite
      ? `mv -f -- ${shQuote(src)} ${shQuote(dst)}`
      : `if [ -e ${shQuote(dst)} ]; then echo 'target exists' >&2; exit 17; fi; mv -- ${shQuote(src)} ${shQuote(dst)}`;
    const result = await this.run(script);
    assertExecOk(result, `rename ${src} -> ${dst}`);
  }

  async openRead(p: string): Promise<StreamHandle & { stream: Readable }> {
    const handle = await this.transport.execStream(this.environment, `cat -- ${shQuote(p)}`);
    return {
      stream: handle.stdout,
      done: async () => assertExecOk(await handle.done, `cat ${p}`),
    };
  }

  async openWrite(p: string, _overwrite: boolean): Promise<StreamHandle & { stream: Writable }> {
    const handle = await this.transport.execStream(this.environment, `cat > ${shQuote(p)}`);
    return {
      stream: handle.stdin,
      done: async () => assertExecOk(await handle.done, `write ${p}`),
    };
  }
}
