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
}

interface TransferStats {
  files: number;
  dirs: number;
  bytes: number;
}

interface TransferProgressTracker {
  context?: ToolExecutionContext;
  startedAt: number;
  totalBytes: number;
  totalFiles: number;
  transferredBytes: number;
  completedFiles: number;
  currentSourcePath?: string;
  currentTargetPath?: string;
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
    const tracker = createTransferTracker(context, { files: 1, dirs: 0, bytes: sourceStat.size });
    reportTransferProgress(tracker);
    const copied = await copyFile({ from, to, sourcePath, targetPath, overwrite: item.overwrite, createDirs: item.createDirs, verify, tracker });
    reportTransferProgress(tracker, true);
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

  const planned = await collectTransferStats(from, sourcePath, sourceStat);
  const tracker = createTransferTracker(context, planned);
  reportTransferProgress(tracker);
  const copied = await copyDirectory({ from, to, sourceDir: sourcePath, targetDir: targetPath, overwrite: item.overwrite, createDirs: item.createDirs, verify, tracker });
  reportTransferProgress(tracker, true);
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


function createTransferTracker(context: ToolExecutionContext | undefined, stats: TransferStats): TransferProgressTracker {
  return {
    context,
    startedAt: Date.now(),
    totalBytes: stats.bytes,
    totalFiles: stats.files,
    transferredBytes: 0,
    completedFiles: 0,
  };
}

async function collectTransferStats(endpoint: Endpoint, p: string, knownStat?: StatInfo): Promise<TransferStats> {
  const st = knownStat ?? await endpoint.stat(p);
  if (st.type === 'file') return { files: 1, dirs: 0, bytes: st.size };

  let files = 0;
  let dirs = 1;
  let bytes = 0;
  const entries = await endpoint.readdir(p);
  for (const entry of entries) {
    const child = endpoint.join(p, entry.name);
    if (entry.type === 'directory') {
      const nested = await collectTransferStats(endpoint, child);
      files += nested.files;
      dirs += nested.dirs;
      bytes += nested.bytes;
    } else {
      const childStat = await endpoint.stat(child);
      files += 1;
      bytes += childStat.size;
    }
  }
  return { files, dirs, bytes };
}

function reportTransferProgress(tracker: TransferProgressTracker, final = false): void {
  const elapsedMs = Math.max(1, Date.now() - tracker.startedAt);
  const speedBytesPerSec = tracker.transferredBytes / (elapsedMs / 1000);
  const remainingBytes = Math.max(0, tracker.totalBytes - tracker.transferredBytes);
  const percent = tracker.totalBytes > 0
    ? Math.min(100, Math.round((tracker.transferredBytes / tracker.totalBytes) * 100))
    : 100;

  tracker.context?.reportProgress?.({
    kind: 'transfer_files',
    sourcePath: tracker.currentSourcePath,
    targetPath: tracker.currentTargetPath,
    bytesTransferred: tracker.transferredBytes,
    totalBytes: tracker.totalBytes,
    percent: final ? 100 : percent,
    speedBytesPerSec,
    etaSec: speedBytesPerSec > 0 ? Math.ceil(remainingBytes / speedBytesPerSec) : undefined,
    elapsedMs,
    filesTransferred: tracker.completedFiles,
    totalFiles: tracker.totalFiles,
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
}): Promise<{ files: number; dirs: number; bytes: number; verifyOk: boolean }> {
  const { from, to, sourceDir, targetDir, overwrite, createDirs, verify, tracker } = input;
  const st = await from.stat(sourceDir);
  if (st.type !== 'directory') throw new Error(`源路径不是目录: ${sourceDir}`);
  if (createDirs) await to.mkdirp(targetDir);

  let files = 0;
  let dirs = 1;
  let bytes = 0;
  let verifyOk = true;

  const entries = await from.readdir(sourceDir);
  for (const entry of entries) {
    const src = from.join(sourceDir, entry.name);
    const dst = to.join(targetDir, entry.name);
    if (entry.type === 'directory') {
      const nested = await copyDirectory({ from, to, sourceDir: src, targetDir: dst, overwrite, createDirs, verify, tracker });
      files += nested.files;
      dirs += nested.dirs;
      bytes += nested.bytes;
      verifyOk = verifyOk && nested.verifyOk;
    } else {
      const one = await copyFile({ from, to, sourcePath: src, targetPath: dst, overwrite, createDirs, verify, tracker });
      files += 1;
      bytes += one.bytes;
      verifyOk = verifyOk && one.verifyOk;
    }
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
}): Promise<{ bytes: number; verifyOk: boolean }> {
  const { from, to, sourcePath, targetPath, overwrite, createDirs, verify, tracker } = input;
  const st = await from.stat(sourcePath);
  if (st.type !== 'file') throw new Error(`源路径不是文件: ${sourcePath}`);

  if (!overwrite && await to.exists(targetPath)) {
    throw new Error(`目标已存在: ${targetPath}`);
  }
  if (createDirs) await to.mkdirp(to.dirname(targetPath));

  const tempPath = makeTempPath(to, targetPath);
  tracker.currentSourcePath = sourcePath;
  tracker.currentTargetPath = targetPath;
  const progress = new Transform({
    transform(chunk, _encoding, callback) {
      const n = Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk);
      tracker.transferredBytes += n;
      reportTransferProgress(tracker);
      callback(null, chunk);
    },
  });

  const reader = await from.openRead(sourcePath);
  const writer = await to.openWrite(tempPath, false);

  try {
    await pipeline(reader.stream, progress, writer.stream);
    if (reader.done) await reader.done();
    if (writer.done) await writer.done();

    let verifyOk = true;
    if (verify === 'size') {
      const tempStat = await to.stat(tempPath);
      verifyOk = tempStat.type === 'file' && tempStat.size === st.size;
      if (!verifyOk) throw new Error(`size 校验失败: source=${st.size}, temp=${tempStat.size}`);
    }

    await to.rename(tempPath, targetPath, overwrite);
    tracker.completedFiles += 1;
    reportTransferProgress(tracker);
    return { bytes: st.size, verifyOk };
  } catch (err) {
    await safeUnlink(to, tempPath);
    throw err;
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
    return entries
      .filter(e => e.isFile() || e.isDirectory())
      .map(e => ({ name: e.name, type: e.isDirectory() ? 'directory' : 'file' }));
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
  async openRead(p: string): Promise<StreamHandle & { stream: Readable }> { return { stream: fs.createReadStream(p) }; }
  async openWrite(p: string, overwrite: boolean): Promise<StreamHandle & { stream: Writable }> { return { stream: fs.createWriteStream(p, { flags: overwrite ? 'w' : 'wx' }) }; }
}

class RemoteSftpEndpoint implements Endpoint {
  isLocal = false;
  constructor(public environment: string, private sftp: SFTPWrapper) {}

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
  async mkdirp(p: string): Promise<void> {
    const normalized = this.normalize(p);
    if (!normalized || normalized === '/') return;
    const parts = normalized.split('/').filter(Boolean);
    let cur = '/';
    for (const part of parts) {
      cur = cur === '/' ? `/${part}` : path.posix.join(cur, part);
      try {
        const st = await this.stat(cur);
        if (st.type !== 'directory') throw new Error(`${cur} 已存在但不是目录`);
      } catch {
        await new Promise<void>((resolve, reject) => this.sftp.mkdir(cur, err => err ? reject(err) : resolve()));
      }
    }
  }
  async readdir(p: string): Promise<DirEntry[]> {
    const list = await new Promise<any[]>((resolve, reject) => this.sftp.readdir(p, (err, entries) => err ? reject(err) : resolve(entries)));
    return list
      .filter(e => e.attrs?.isFile?.() || e.attrs?.isDirectory?.())
      .map(e => ({ name: e.filename, type: e.attrs.isDirectory() ? 'directory' : 'file' }));
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
  async openRead(p: string): Promise<StreamHandle & { stream: Readable }> { return { stream: this.sftp.createReadStream(p) as unknown as Readable }; }
  async openWrite(p: string, overwrite: boolean): Promise<StreamHandle & { stream: Writable }> { return { stream: this.sftp.createWriteStream(p, { flags: overwrite ? 'w' : 'wx' }) as unknown as Writable }; }
}

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
