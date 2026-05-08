/**
 * translators.ts —— 工具调用 → 远端执行
 *
 * 性能最小策略：
 *   - 文件精确读写：auto/sftp 下走 SFTP（不启动远端进程，不 base64 膨胀）
 *   - 扫描/搜索/shell：走 SSH exec + bash/find/grep（避免大量 SFTP RTT）
 *   - Transport bash：所有文件读写也退化为纯 bash/coreutils，适配无 SFTP 环境
 *   - 不依赖 Python。
 */

import path from 'node:path';
import {
  applySearchReplaceBestEffort,
  applyUnifiedDiffBestEffort,
  buildSearchRegex,
  convertHunksToSearchReplace,
  decodeText,
  globToRegExp,
  isLikelyBinary,
  normalizeDeleteCodeArgs,
  normalizeInsertArgs,
  normalizeObjectArrayArg,
  normalizeStringArrayArg,
  parseLoosePatchToSearchReplace,
  parseUnifiedDiff,
  type TextEncoding,
} from 'irises-extension-sdk/tool-utils';
import type { ExecResult, SshTransport } from './transport.js';
import { shQuote, withCwd } from './remote-shell.js';

// ─────────────────────────── limits（对齐宿主默认值） ───────────────────────────

const LIMITS = {
  read_file: { maxFiles: 10, maxFileSizeBytes: 2 * 1024 * 1024, maxTotalOutputChars: 200_000 },
  list_files: { maxEntries: 2000 },
  find_files: { maxResults: 500 },
  search_in_files: {
    maxResults: 100,
    maxFiles: 50,
    contextLines: 2,
    maxFileSizeBytes: 2 * 1024 * 1024,
    maxLineDisplayChars: 500,
    maxMatchDisplayChars: 200,
  },
  shell: { defaultTimeout: 30_000, maxOutputChars: 50_000 },
};

export interface TranslatorContext {
  transport: SshTransport;
  serverAlias: string;
  /** 远端工作目录（已合并 server.workdir + 全局 remoteWorkdir） */
  remoteCwd?: string;
  signal?: AbortSignal;
}

export type ToolTranslator = (args: Record<string, unknown>, ctx: TranslatorContext) => Promise<unknown>;

type TransportMode = 'auto' | 'sftp' | 'bash';

// ─────────────────────────── common helpers ───────────────────────────

function mode(ctx: TranslatorContext): TransportMode {
  return ctx.transport.getTransportMode(ctx.serverAlias);
}

function posixNormalize(p: string): string {
  return path.posix.normalize(p.replace(/\\/g, '/'));
}

function hasParentTraversal(p: string): boolean {
  return p.split('/').some(part => part === '..');
}

/**
 * 将工具入参路径解析为远端路径。
 * 与本地 resolveProjectPath 的安全语义对齐：默认禁止逃离 remoteCwd（项目根）。
 */
function resolveRemotePath(input: string, cwd?: string): string {
  if (!input || input.includes('\0')) throw new Error(`非法路径: ${input}`);
  const normalizedInput = posixNormalize(input);
  const normalizedCwd = cwd ? posixNormalize(cwd) : undefined;

  if (path.posix.isAbsolute(normalizedInput)) {
    if (!normalizedCwd) return normalizedInput;
    const rel = path.posix.relative(normalizedCwd, normalizedInput);
    if (rel === '' || (!rel.startsWith('..') && !path.posix.isAbsolute(rel))) return normalizedInput;
    throw new Error(`路径超出远端工作目录: ${input}`);
  }

  if (hasParentTraversal(normalizedInput)) throw new Error(`路径超出远端工作目录: ${input}`);
  return normalizedCwd ? path.posix.join(normalizedCwd, normalizedInput) : normalizedInput;
}

function resolveRemoteCwd(inputCwd: string | undefined, baseCwd?: string): string | undefined {
  if (!inputCwd) return baseCwd;
  return resolveRemotePath(inputCwd, baseCwd);
}

function dirnameRemote(p: string): string {
  const d = path.posix.dirname(p);
  return d || '.';
}

async function execBash(ctx: TranslatorContext, script: string, input?: Buffer | string): Promise<ExecResult> {
  const cmd = withCwd(`bash -lc ${shQuote(script)}`, ctx.remoteCwd);
  return await ctx.transport.execCommand(ctx.serverAlias, cmd, ctx.signal, input);
}

function assertExitOk(r: ExecResult, op: string): void {
  if ((r.exitCode ?? 0) !== 0 || r.timedOut) {
    throw new Error(`${op} 失败: exitCode=${r.exitCode} stderr=${truncate(r.stderr, 800)}`);
  }
}

function isSftpUnavailableError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes('SFTP 子系统不可用');
}

function decodeBase64Stdout(stdout: string): Buffer {
  const clean = stdout.replace(/\s+/g, '');
  return Buffer.from(clean, 'base64');
}

function decodeNulListFromBase64(stdout: string): string[] {
  const text = decodeBase64Stdout(stdout).toString('utf8');
  return text.split('\0').filter(Boolean);
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const half = Math.floor(max / 2);
  return text.slice(0, half) + `\n\n... (已截断，共 ${text.length} 字符) ...\n\n` + text.slice(-half);
}

function clampPositiveInteger(value: unknown, fallback: number, max = Number.POSITIVE_INFINITY): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(Math.floor(value), max);
}

function asStringArray(args: Record<string, unknown>, arrayKey: string, singularKeys: string[] = []): string[] | undefined {
  return normalizeStringArrayArg(args, { arrayKey, singularKeys });
}

function isFileReadRequest(value: unknown): value is { path: string; startLine?: number; endLine?: number } {
  return !!value && typeof value === 'object' && !Array.isArray(value) && typeof (value as Record<string, unknown>).path === 'string';
}

// ─────────────────────────── text helpers ───────────────────────────

const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.markdown',
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.json', '.jsonc', '.json5',
  '.html', '.htm', '.css', '.scss', '.less',
  '.py', '.rb', '.go', '.rs', '.java', '.c', '.cpp', '.h', '.hpp', '.cs',
  '.sh', '.bash', '.zsh', '.bat', '.cmd', '.ps1',
  '.yml', '.yaml', '.toml', '.ini', '.cfg', '.conf',
  '.xml', '.svg', '.csv', '.tsv', '.log',
  '.gitignore', '.dockerignore', '.editorconfig',
  '.sql', '.vue', '.svelte', '.astro',
  '',
]);
const TEXT_FILENAMES = new Set(['Makefile', 'Dockerfile', 'Vagrantfile', 'Gemfile', 'Rakefile', 'LICENSE', 'CHANGELOG', 'README', '.gitignore', '.dockerignore', '.editorconfig', '.prettierrc', '.eslintrc']);

function isTextFile(filePath: string): boolean {
  const ext = path.posix.extname(filePath).toLowerCase();
  if (TEXT_EXTENSIONS.has(ext)) return true;
  const basename = path.posix.basename(filePath);
  if (basename.startsWith('.env')) return true;
  return TEXT_FILENAMES.has(basename);
}

function formatWithLineNumbers(content: string, startLine: number): string {
  const lines = content.split('\n');
  const totalLines = startLine + lines.length - 1;
  const width = String(totalLines).length;
  return lines.map((line, i) => `${String(startLine + i).padStart(width)} | ${line}`).join('\n');
}

function swapByteOrder16(buf: Buffer): Buffer {
  const len = buf.length - (buf.length % 2);
  const out = Buffer.allocUnsafe(len);
  for (let i = 0; i < len; i += 2) {
    out[i] = buf[i + 1];
    out[i + 1] = buf[i];
  }
  return out;
}

function encodeText(text: string, encoding: TextEncoding, hasBom: boolean, preferCRLF: boolean): Buffer {
  const normalized = preferCRLF ? text.replace(/\r?\n/g, '\r\n') : text;
  if (encoding === 'utf-16le') {
    const body = Buffer.from(normalized, 'utf16le');
    return hasBom ? Buffer.concat([Buffer.from([0xff, 0xfe]), body]) : body;
  }
  if (encoding === 'utf-16be') {
    const bodyBE = swapByteOrder16(Buffer.from(normalized, 'utf16le'));
    return hasBom ? Buffer.concat([Buffer.from([0xfe, 0xff]), bodyBE]) : bodyBE;
  }
  const body = Buffer.from(normalized, 'utf8');
  return hasBom ? Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), body]) : body;
}

// ─────────────────────────── remote file primitives ───────────────────────────

async function readRemoteBuffer(ctx: TranslatorContext, toolPath: string): Promise<Buffer> {
  const m = mode(ctx);
  const remotePath = resolveRemotePath(toolPath, ctx.remoteCwd);
  if (m !== 'bash') {
    try {
      return await ctx.transport.sftpReadFile(ctx.serverAlias, remotePath);
    } catch (err) {
      if (m === 'sftp' || !isSftpUnavailableError(err)) throw err;
      // auto: 只有 SFTP 子系统不可用时才回退 bash；普通 ENOENT/EACCES 不重复 IO
    }
  }
  const r = await execBash(ctx, `set -euo pipefail\nbase64 < ${shQuote(remotePath)} | tr -d '\\n\\r'`);
  assertExitOk(r, `读取文件 ${toolPath}`);
  return decodeBase64Stdout(r.stdout);
}

async function statRemoteSize(ctx: TranslatorContext, toolPath: string): Promise<number | undefined> {
  const m = mode(ctx);
  const remotePath = resolveRemotePath(toolPath, ctx.remoteCwd);
  if (m !== 'bash') {
    try {
      const st = await ctx.transport.sftpStat(ctx.serverAlias, remotePath);
      return st.size;
    } catch (err) {
      if (m === 'sftp' || !isSftpUnavailableError(err)) throw err;
    }
  }
  const r = await execBash(ctx, `stat -c %s -- ${shQuote(remotePath)} 2>/dev/null || wc -c < ${shQuote(remotePath)}`);
  assertExitOk(r, `stat ${toolPath}`);
  const n = Number.parseInt(r.stdout.trim(), 10);
  return Number.isFinite(n) ? n : undefined;
}

async function writeRemoteBuffer(ctx: TranslatorContext, toolPath: string, data: Buffer | string): Promise<void> {
  const m = mode(ctx);
  const remotePath = resolveRemotePath(toolPath, ctx.remoteCwd);
  const dir = dirnameRemote(remotePath);
  if (m !== 'bash') {
    try {
      await ensureDirSftp(ctx, dir);
      await ctx.transport.sftpWriteFile(ctx.serverAlias, remotePath, data);
      return;
    } catch (err) {
      if (m === 'sftp' || !isSftpUnavailableError(err)) throw err;
    }
  }
  const script = `set -euo pipefail
mkdir -p -- ${shQuote(dir)}
tmp="$(mktemp)"
cat > "$tmp"
mv "$tmp" ${shQuote(remotePath)}`;
  const r = await execBash(ctx, script, data);
  assertExitOk(r, `写入文件 ${toolPath}`);
}

async function ensureDirSftp(ctx: TranslatorContext, remoteDir: string): Promise<void> {
  const normalized = posixNormalize(remoteDir);
  if (!normalized || normalized === '.' || normalized === '/') return;
  const absolute = path.posix.isAbsolute(normalized);
  const parts = normalized.split('/').filter(Boolean);
  let cur = absolute ? '/' : '';
  for (const part of parts) {
    cur = cur === '/' ? `/${part}` : (cur ? path.posix.join(cur, part) : part);
    try {
      const st = await ctx.transport.sftpStat(ctx.serverAlias, cur);
      if (!st.isDirectory()) throw new Error(`${cur} exists but is not a directory`);
    } catch {
      await ctx.transport.sftpMkdir(ctx.serverAlias, cur);
    }
  }
}

// ─────────────────────────── shell / bash ───────────────────────────

const tShell: ToolTranslator = async (args, ctx) => {
  const command = (args.command as string) ?? (args.cmd as string) ?? '';
  if (!command) throw new Error('shell: 缺少 command 参数');
  const cwd = resolveRemoteCwd(typeof args.cwd === 'string' ? args.cwd : undefined, ctx.remoteCwd);
  const finalCmd = cwd ? `cd ${shQuote(cwd)} && ${command}` : command;
  const result = await ctx.transport.execCommand(ctx.serverAlias, finalCmd, ctx.signal);
  return {
    command,
    stdout: truncate(result.stdout, LIMITS.shell.maxOutputChars),
    stderr: truncate(result.stderr, LIMITS.shell.maxOutputChars),
    exitCode: result.exitCode ?? (result.signal ? -1 : 0),
    killed: result.timedOut === true,
    remote: { target: ctx.serverAlias, signal: result.signal },
  };
};

// ─────────────────────────── list_files ───────────────────────────

interface ListEntry { name: string; type: 'file' | 'directory' }
interface ListResult { path: string; entries: ListEntry[]; fileCount: number; dirCount: number; success: boolean; error?: string }

async function listOneSftp(ctx: TranslatorContext, dirPath: string): Promise<ListResult> {
  const remotePath = resolveRemotePath(dirPath, ctx.remoteCwd);
  const list = await ctx.transport.sftpReaddir(ctx.serverAlias, remotePath);
  const entries: ListEntry[] = [];
  for (const ent of list) {
    if (ent.filename === '.git' || ent.filename === 'node_modules') continue;
    const isDir = ent.attrs.isDirectory();
    const isFile = ent.attrs.isFile();
    if (!isDir && !isFile) continue;
    entries.push({ name: ent.filename + (isDir ? '/' : ''), type: isDir ? 'directory' : 'file' });
  }
  entries.sort((a, b) => a.type !== b.type ? (a.type === 'directory' ? -1 : 1) : a.name.localeCompare(b.name));
  return { path: dirPath, entries, fileCount: entries.filter(e => e.type === 'file').length, dirCount: entries.filter(e => e.type === 'directory').length, success: true };
}

async function listOneBash(ctx: TranslatorContext, dirPath: string, recursive: boolean): Promise<ListResult> {
  const remotePath = resolveRemotePath(dirPath, ctx.remoteCwd);
  const max = LIMITS.list_files.maxEntries;
  const depth = recursive ? '' : '-maxdepth 1';
  const script = `set -euo pipefail
cd -- ${shQuote(remotePath)}
count=0
find . ${depth} -mindepth 1 \\( -name .git -o -name node_modules \\) -prune -o \\( -type d -print0 -o -type f -print0 \\) 2>/dev/null \
  | while IFS= read -r -d '' p; do
      rel="\${p#./}"
      [ -z "$rel" ] && continue
      if [ -d "$p" ]; then printf 'd\\t%s\\0' "$rel"; elif [ -f "$p" ]; then printf 'f\\t%s\\0' "$rel"; fi
      count=$((count + 1))
      [ "$count" -ge ${max} ] && break
    true; done \
  | base64 | tr -d '\\n\\r'`;
  const r = await execBash(ctx, script);
  assertExitOk(r, `列目录 ${dirPath}`);
  const records = decodeNulListFromBase64(r.stdout);
  const entries: ListEntry[] = [];
  for (const rec of records) {
    const tab = rec.indexOf('\t');
    if (tab < 0) continue;
    const y = rec.slice(0, tab);
    const name0 = rec.slice(tab + 1);
    if (!name0) continue;
    if (y === 'd') entries.push({ name: name0 + '/', type: 'directory' });
    else if (y === 'f') entries.push({ name: name0, type: 'file' });
  }
  entries.sort((a, b) => a.type !== b.type ? (a.type === 'directory' ? -1 : 1) : a.name.localeCompare(b.name));
  const out: ListResult = { path: dirPath, entries, fileCount: entries.filter(e => e.type === 'file').length, dirCount: entries.filter(e => e.type === 'directory').length, success: true };
  if (records.length >= max) out.error = `条目数达到上限 (${max})，结果已截断`;
  return out;
}

const tListFiles: ToolTranslator = async (args, ctx) => {
  let pathList = asStringArray(args, 'paths', ['path']);
  if (!pathList || pathList.length === 0) pathList = ['.'];
  const recursive = args.recursive === true;
  const results: ListResult[] = [];
  let totalFiles = 0;
  let totalDirs = 0;
  let truncated = false;
  for (const p of pathList) {
    try {
      let res: ListResult;
      if (!recursive && mode(ctx) !== 'bash') {
        try { res = await listOneSftp(ctx, p); }
        catch (err) { if (mode(ctx) === 'sftp' || !isSftpUnavailableError(err)) throw err; res = await listOneBash(ctx, p, false); }
      } else {
        res = await listOneBash(ctx, p, recursive);
      }
      if (res.error) truncated = true;
      results.push(res); totalFiles += res.fileCount; totalDirs += res.dirCount;
    } catch (err) {
      results.push({ path: p, entries: [], fileCount: 0, dirCount: 0, success: false, error: err instanceof Error ? err.message : String(err) });
    }
  }
  const output: Record<string, unknown> = { results, totalFiles, totalDirs, totalPaths: pathList.length };
  if (truncated) output.truncated = true;
  return output;
};

// ─────────────────────────── read_file / write_file ───────────────────────────

const tReadFile: ToolTranslator = async (args, ctx) => {
  const fileList = normalizeObjectArrayArg(args, { arrayKey: 'files', singularKeys: ['file'], isEntry: isFileReadRequest });
  if (!fileList || fileList.length === 0) throw new Error('files 参数必须是非空数组');
  const cappedList = fileList.length > LIMITS.read_file.maxFiles ? fileList.slice(0, LIMITS.read_file.maxFiles) : fileList;
  const filesCapped = fileList.length > LIMITS.read_file.maxFiles;
  const results: any[] = [];
  let successCount = 0, failCount = 0, totalOutputChars = 0;
  for (const req of cappedList) {
    try {
      if (!isTextFile(req.path)) throw new Error(`不支持的文件类型: ${path.posix.extname(req.path) || '(无扩展名)'}`);
      const size = await statRemoteSize(ctx, req.path);
      if (size !== undefined && size > LIMITS.read_file.maxFileSizeBytes) throw new Error(`文件过大 (${size} bytes > ${LIMITS.read_file.maxFileSizeBytes} bytes)，请使用 startLine/endLine 分段读取`);
      const raw = (await readRemoteBuffer(ctx, req.path)).toString('utf8');
      const allLines = raw.split('\n');
      const totalLines = allLines.length;
      const startLine = Math.max(1, req.startLine ?? 1);
      const endLine = req.endLine ? Math.min(req.endLine, totalLines) : totalLines;
      if (startLine > totalLines) throw new Error(`startLine (${startLine}) 超出文件总行数 (${totalLines})`);
      const sliced = allLines.slice(startLine - 1, endLine);
      const formatted = formatWithLineNumbers(sliced.join('\n'), startLine);
      totalOutputChars += formatted.length;
      if (totalOutputChars > LIMITS.read_file.maxTotalOutputChars) {
        results.push({ path: req.path, success: false, error: `总输出已达上限 (${LIMITS.read_file.maxTotalOutputChars} chars)，后续文件已跳过。请使用 startLine/endLine 分段读取` });
        failCount++; break;
      }
      const res: any = { path: req.path, success: true, type: 'text', content: formatted, lineCount: sliced.length };
      if (req.startLine !== undefined || req.endLine !== undefined) { res.totalLines = totalLines; res.startLine = startLine; res.endLine = endLine; }
      results.push(res); successCount++;
    } catch (err) {
      results.push({ path: req.path, success: false, error: err instanceof Error ? err.message : String(err) }); failCount++;
    }
  }
  const output: Record<string, unknown> = { results, successCount, failCount, totalCount: cappedList.length };
  if (filesCapped) { output.warning = `文件数量已截断: 请求 ${fileList.length} 个，上限 ${LIMITS.read_file.maxFiles} 个`; output.totalCount = fileList.length; }
  return output;
};

const tWriteFile: ToolTranslator = async (args, ctx) => {
  const filePath = args.path as string;
  const content = args.content as string;
  if (!filePath) throw new Error('path 参数不能为空');
  if (typeof content !== 'string') throw new Error('content 参数必须为字符串');
  let exists = false;
  let same = false;
  try {
    const old = await readRemoteBuffer(ctx, filePath);
    exists = true; same = old.toString('utf8') === content;
  } catch { exists = false; }
  if (same) return { path: filePath, success: true, action: 'unchanged' };
  await writeRemoteBuffer(ctx, filePath, content);
  return { path: filePath, success: true, action: exists ? 'modified' : 'created' };
};

// ─────────────────────────── create_directory / delete_file ───────────────────────────

const tCreateDir: ToolTranslator = async (args, ctx) => {
  const paths = asStringArray(args, 'paths', ['path']);
  if (!paths || paths.length === 0) throw new Error('paths 参数必须是非空数组');
  const resolved = paths.map(p => resolveRemotePath(p, ctx.remoteCwd));
  const argsQuoted = resolved.map(shQuote).join(' ');
  const script = `set +e
for p in ${argsQuoted}; do
  if mkdir -p -- "$p"; then printf '1\\t%s\\0' "$p"; else printf '0\\t%s\\tmkdir failed\\0' "$p"; fi
done | base64 | tr -d '\\n\\r'`;
  const r = await execBash(ctx, script);
  assertExitOk(r, '创建目录');
  const recs = decodeNulListFromBase64(r.stdout);
  const byResolved = new Map<string, { success: boolean; error?: string }>();
  for (const rec of recs) { const [ok, p, err] = rec.split('\t'); byResolved.set(p, { success: ok === '1', error: ok === '1' ? undefined : err }); }
  const results = paths.map((p, i) => ({ path: p, success: byResolved.get(resolved[i])?.success ?? false, error: byResolved.get(resolved[i])?.error }));
  return { results, successCount: results.filter(r => r.success).length, failCount: results.filter(r => !r.success).length, totalCount: paths.length };
};

const tDeleteFile: ToolTranslator = async (args, ctx) => {
  const paths = asStringArray(args, 'paths', ['path']);
  if (!paths || paths.length === 0) throw new Error('paths 参数必须是非空数组');
  const resolved = paths.map(p => resolveRemotePath(p, ctx.remoteCwd));
  const argsQuoted = resolved.map(shQuote).join(' ');
  const script = `set +e
for p in ${argsQuoted}; do
  if rm -rf -- "$p"; then printf '1\\t%s\\0' "$p"; else printf '0\\t%s\\trm failed\\0' "$p"; fi
done | base64 | tr -d '\\n\\r'`;
  const r = await execBash(ctx, script);
  assertExitOk(r, '删除文件');
  const recs = decodeNulListFromBase64(r.stdout);
  const byResolved = new Map<string, { success: boolean; error?: string }>();
  for (const rec of recs) { const [ok, p, err] = rec.split('\t'); byResolved.set(p, { success: ok === '1', error: ok === '1' ? undefined : err }); }
  const results = paths.map((p, i) => ({ path: p, success: byResolved.get(resolved[i])?.success ?? false, error: byResolved.get(resolved[i])?.error }));
  return { results, successCount: results.filter(r => r.success).length, failCount: results.filter(r => !r.success).length, totalCount: paths.length };
};

// ─────────────────────────── find candidates / find_files ───────────────────────────

const DEFAULT_EXCLUDE = '**/node_modules/**';
const DEFAULT_IGNORED_DIRS = ['.git', 'node_modules', 'dist', 'build', '.next', '.turbo', '.limcode'];

function parseBraceList(input: string): string[] {
  const s = input.trim();
  if (s.startsWith('{') && s.endsWith('}')) return s.slice(1, -1).split(',').map(x => x.trim()).filter(Boolean);
  return [s];
}
function buildExcludeMatchers(exclude: string): RegExp[] { return parseBraceList(exclude).map(p => globToRegExp(p)); }
function isExcluded(rel: string, matchers: RegExp[]): boolean { return matchers.some(re => re.test(rel)); }

async function listAllFiles(ctx: TranslatorContext, inputPath = '.', pattern = '**/*'): Promise<Array<{ rel: string; display: string; toolPath: string }>> {
  const remotePath = resolveRemotePath(inputPath, ctx.remoteCwd);
  const prunes = DEFAULT_IGNORED_DIRS.map(d => `-name ${shQuote(d)}`).join(' -o ');
  const script = `set -euo pipefail
if [ -f ${shQuote(remotePath)} ]; then
  { printf 'F\\0'; printf '%s\\0' ${shQuote(path.posix.basename(inputPath))}; } | base64 | tr -d '\\n\\r'
else
  cd -- ${shQuote(remotePath)}
  { printf 'D\\0'; find . \\( ${prunes} \\) -prune -o -type f -print0 2>/dev/null; } | base64 | tr -d '\\n\\r'
fi`;
  const r = await execBash(ctx, script);
  assertExitOk(r, `列出候选文件 ${inputPath}`);
  const decoded = decodeNulListFromBase64(r.stdout);
  const marker = decoded.shift();
  const raw = decoded;
  const patternRe = globToRegExp(pattern);
  const isSingle = marker === 'F';
  const out: Array<{ rel: string; display: string; toolPath: string }> = [];
  for (const rel0 of raw) {
    const rel = rel0.replace(/^\.\//, '');
    if (!isSingle && !patternRe.test(rel)) continue;
    const display = isSingle ? inputPath : (inputPath === '.' ? rel : path.posix.join(inputPath, rel));
    out.push({ rel, display, toolPath: display });
  }
  return out;
}

const tFindFiles: ToolTranslator = async (args, ctx) => {
  const patterns = args.patterns as unknown;
  if (!Array.isArray(patterns) || patterns.length === 0 || patterns.some(p => typeof p !== 'string')) throw new Error('patterns 参数必须是非空字符串数组');
  const patternList = patterns.map(p => String(p).trim()).filter(Boolean);
  if (patternList.length === 0) throw new Error('patterns 参数不能为空');
  const exclude = (args.exclude as string | undefined) ?? DEFAULT_EXCLUDE;
  const maxResults = clampPositiveInteger(args.maxResults, LIMITS.find_files.maxResults, LIMITS.find_files.maxResults);
  const files = await listAllFiles(ctx, '.', '**/*');
  const excludeMatchers = buildExcludeMatchers(exclude);
  const patternRes = patternList.map(p => ({ pattern: p, re: globToRegExp(p), matches: [] as string[], truncated: false }));
  for (const f of files) {
    const rel = f.rel;
    if (isExcluded(rel, excludeMatchers)) continue;
    for (const p of patternRes) {
      if (p.matches.length >= maxResults) continue;
      if (p.re.test(rel)) { p.matches.push(rel); if (p.matches.length >= maxResults) p.truncated = true; }
    }
    if (patternRes.every(p => p.matches.length >= maxResults)) break;
  }
  for (const p of patternRes) p.matches.sort();
  const perPattern = patternRes.map(p => ({ pattern: p.pattern, matches: p.matches, count: p.matches.length, truncated: p.truncated }));
  const results = Array.from(new Set(perPattern.flatMap(p => p.matches))).sort();
  return { patterns: patternList, exclude, maxResults, perPattern, results, count: results.length, truncated: perPattern.some(p => p.truncated) };
};

// ─────────────────────────── search_in_files ───────────────────────────

function computeLineStarts(text: string): number[] { const starts = [0]; for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1); return starts; }
function findLineIndex(starts: number[], offset: number): number { let lo = 0, hi = starts.length - 1; while (lo <= hi) { const mid = (lo + hi) >> 1; if (starts[mid] === offset) return mid; if (starts[mid] < offset) lo = mid + 1; else hi = mid - 1; } return Math.max(0, lo - 1); }
function truncateLine(line: string, max: number): string { if (line.length <= max) return line; const head = Math.floor(max * 0.75), tail = Math.floor(max * 0.15); return line.slice(0, head) + ` ... [${line.length} chars] ... ` + line.slice(-tail); }
function buildContext(lines: string[], lineNum: number, ctxLines: number, maxChars: number): string { const start = Math.max(1, lineNum - ctxLines), end = Math.min(lines.length, lineNum + ctxLines); const out: string[] = []; for (let ln = start; ln <= end; ln++) out.push(`${ln}: ${truncateLine(lines[ln - 1] ?? '', maxChars)}`); return out.join('\n'); }

function canPrefilterRegexWithGrepE(query: string): boolean {
  // 只对 POSIX ERE 与 JS RegExp 基本一致的保守子集启用 grep -E 预筛。
  // 复杂 JS 特性会跳过预筛，避免 false negative。
  if (!query || query.includes('\n') || query.includes('\r')) return false;
  const unsafe = [
    /\(\?/,                 // lookaround / non-capturing / named group
    /\\[dDsSwWbBpPkK]/,     // JS 专有字符类/边界/Unicode property
    /\\[nrtfv0xuUc]/,       // JS 转义在 grep -E 中语义不同
    /\[\[:/,                // POSIX class 在 JS 中语义不同
    /(\*|\+|\?|\})\?/,     // lazy quantifier
  ];
  return !unsafe.some(re => re.test(query));
}

async function grepCandidateFiles(
  ctx: TranslatorContext,
  inputPath: string,
  pattern: string,
  query: string,
  grepMode: 'literal' | 'regex-ere',
): Promise<Array<{ rel: string; display: string; toolPath: string }> | undefined> {
  const remotePath = resolveRemotePath(inputPath, ctx.remoteCwd);
  const prunes = DEFAULT_IGNORED_DIRS.map(d => `-name ${shQuote(d)}`).join(' -o ');
  const flag = grepMode === 'literal' ? '-F' : '-E';
  const preflight = grepMode === 'regex-ere'
    ? `grep -E -e ${shQuote(query)} </dev/null >/dev/null 2>/dev/null; st=$?; [ "$st" -gt 1 ] && exit 2`
    : '';
  const script = `set +e
${preflight}
if [ -f ${shQuote(remotePath)} ]; then
  { printf 'F\\0'; grep -IlZ ${flag} -e ${shQuote(query)} -- ${shQuote(remotePath)} 2>/dev/null; } | base64 | tr -d '\\n\\r'
else
  cd -- ${shQuote(remotePath)} || exit 0
  { printf 'D\\0'; find . \\( ${prunes} \\) -prune -o -type f -print0 2>/dev/null | xargs -0 grep -IlZ ${flag} -e ${shQuote(query)} -- 2>/dev/null; } | base64 | tr -d '\\n\\r'
fi`;
  const r = await execBash(ctx, script);
  // grep: 0=有匹配，1=无匹配，2=错误。错误时返回 undefined，让调用方回退全量候选。
  if ((r.exitCode ?? 0) > 1) return undefined;
  if (!r.stdout.trim()) return [];
  const decoded = decodeNulListFromBase64(r.stdout);
  const marker = decoded.shift();
  const rels = decoded;
  const patternRe = globToRegExp(pattern);
  const out: Array<{ rel: string; display: string; toolPath: string }> = [];
  const singleFile = marker === 'F';
  for (const rel0 of rels) {
    const rel = rel0.replace(/^\.\//, '');
    if (!singleFile && !patternRe.test(rel)) continue;
    const display = singleFile ? inputPath : (inputPath === '.' ? rel : path.posix.join(inputPath, rel));
    out.push({ rel, display, toolPath: display });
  }
  return out;
}

const tSearchInFiles: ToolTranslator = async (args, ctx) => {
  const modeArg = ((args.mode as 'search' | 'replace' | undefined) ?? 'search');
  if (modeArg !== 'search' && modeArg !== 'replace') throw new Error(`mode 参数无效: ${String(args.mode)}`);
  const query = String(args.query ?? '');
  const inputPath = (args.path as string | undefined) ?? '.';
  const pattern = (args.pattern as string | undefined) ?? '**/*';
  const isRegex = (args.isRegex as boolean | undefined) ?? false;
  const maxResults = clampPositiveInteger(args.maxResults, LIMITS.search_in_files.maxResults, LIMITS.search_in_files.maxResults);
  const maxFiles = clampPositiveInteger(args.maxFiles, LIMITS.search_in_files.maxFiles, LIMITS.search_in_files.maxFiles);
  const contextLines = clampPositiveInteger(args.contextLines, LIMITS.search_in_files.contextLines, LIMITS.search_in_files.contextLines);
  const maxFileSizeBytes = clampPositiveInteger(args.maxFileSizeBytes, LIMITS.search_in_files.maxFileSizeBytes, LIMITS.search_in_files.maxFileSizeBytes);
  const regex = buildSearchRegex(query, isRegex);

  let candidates: Array<{ rel: string; display: string; toolPath: string }>;
  if (!isRegex) {
    // 字面量：远端 grep -F 预筛，失败才回退全量候选。
    candidates = await grepCandidateFiles(ctx, inputPath, pattern, query, 'literal') ?? await listAllFiles(ctx, inputPath, pattern);
  } else if (canPrefilterRegexWithGrepE(query)) {
    // 安全正则子集：远端 grep -E 预筛；最终匹配/替换仍用 JS RegExp 保证语义一致。
    candidates = await grepCandidateFiles(ctx, inputPath, pattern, query, 'regex-ere') ?? await listAllFiles(ctx, inputPath, pattern);
  } else {
    // 复杂 JS 正则：不能用 grep 预筛，否则可能 false negative。
    candidates = await listAllFiles(ctx, inputPath, pattern);
  }

  if (modeArg === 'search') {
    const results: any[] = [];
    let filesSearched = 0, skippedBinary = 0, skippedTooLarge = 0, truncated = false;
    for (const f of candidates) {
      if (results.length >= maxResults) { truncated = true; break; }
      filesSearched++;
      const buf = await readRemoteBuffer(ctx, f.toolPath);
      if (buf.length > maxFileSizeBytes) { skippedTooLarge++; continue; }
      if (isLikelyBinary(buf)) { skippedBinary++; continue; }
      const textLF = decodeText(buf).text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      const localRegex = new RegExp(regex.source, regex.flags);
      const starts = computeLineStarts(textLF);
      const lines = textLF.split('\n');
      for (;;) {
        const m = localRegex.exec(textLF); if (!m) break;
        if (m[0].length === 0) { localRegex.lastIndex++; continue; }
        const offset = m.index ?? 0;
        const lineIndex0 = findLineIndex(starts, offset);
        const lineNum = lineIndex0 + 1;
        const col = offset - (starts[lineIndex0] ?? 0) + 1;
        results.push({ file: f.display, line: lineNum, column: col, match: truncateLine(m[0], LIMITS.search_in_files.maxMatchDisplayChars), context: buildContext(lines, lineNum, contextLines, LIMITS.search_in_files.maxLineDisplayChars) });
        if (results.length >= maxResults) { truncated = true; break; }
      }
    }
    return { mode: modeArg, query, isRegex, path: inputPath, pattern, results, count: results.length, truncated, filesSearched, skippedBinary, skippedTooLarge };
  }

  const replace = args.replace;
  if (typeof replace !== 'string') throw new Error('replace 模式下必须提供 replace 参数');
  const results: any[] = [];
  let processedFiles = 0, totalReplacements = 0, truncated = false;
  for (const f of candidates) {
    if (processedFiles >= maxFiles) { truncated = true; break; }
    processedFiles++;
    const buf = await readRemoteBuffer(ctx, f.toolPath);
    if (buf.length > maxFileSizeBytes) { results.push({ file: f.display, replacements: 0, changed: false, skipped: true, reason: `file too large (> ${maxFileSizeBytes} bytes)` }); continue; }
    if (isLikelyBinary(buf)) { results.push({ file: f.display, replacements: 0, changed: false, skipped: true, reason: 'binary file' }); continue; }
    const decoded = decodeText(buf);
    const countRegex = new RegExp(regex.source, regex.flags);
    let replacements = 0;
    for (;;) { const m = countRegex.exec(decoded.text); if (!m) break; if (m[0].length === 0) { countRegex.lastIndex++; continue; } replacements++; }
    if (replacements === 0) { results.push({ file: f.display, replacements: 0, changed: false }); continue; }
    const newText = decoded.text.replace(new RegExp(regex.source, regex.flags), replace);
    const changed = newText !== decoded.text;
    if (changed) await writeRemoteBuffer(ctx, f.toolPath, encodeText(newText, decoded.encoding, decoded.hasBom, decoded.hasCRLF));
    results.push({ file: f.display, replacements, changed }); totalReplacements += replacements;
  }
  return { mode: modeArg, query, replace, isRegex, path: inputPath, pattern, results, processedFiles, totalReplacements, truncated };
};

// ─────────────────────────── insert_code / delete_code / apply_diff ───────────────────────────

const tInsertCode: ToolTranslator = async (args, ctx) => {
  const entries = normalizeInsertArgs(args);
  if (!entries || entries.length === 0) throw new Error('参数必须包含 path、line、content');
  const results: any[] = [];
  for (const e of entries) {
    const content = (await readRemoteBuffer(ctx, e.path)).toString('utf8');
    const lines = content.split('\n');
    const totalLines = lines.length;
    if (e.line < 1 || e.line > totalLines + 1) throw new Error(`行号 ${e.line} 超出范围（1~${totalLines + 1}）`);
    const insertLines = e.content.split('\n');
    const idx = e.line - 1;
    const newLines = [...lines.slice(0, idx), ...insertLines, ...lines.slice(idx)];
    await writeRemoteBuffer(ctx, e.path, newLines.join('\n'));
    results.push({ path: e.path, success: true, line: e.line, insertedLines: insertLines.length });
  }
  return results.length === 1 ? results[0] : { results, successCount: results.length, totalCount: results.length };
};

const tDeleteCode: ToolTranslator = async (args, ctx) => {
  const entries = normalizeDeleteCodeArgs(args);
  if (!entries || entries.length === 0) throw new Error('参数必须包含 path、start_line、end_line');
  const results: any[] = [];
  for (const e of entries) {
    const content = (await readRemoteBuffer(ctx, e.path)).toString('utf8');
    const lines = content.split('\n');
    const totalLines = lines.length;
    if (e.start_line < 1 || e.start_line > totalLines) throw new Error(`start_line ${e.start_line} 超出范围（1~${totalLines}）`);
    if (e.end_line < e.start_line || e.end_line > totalLines) throw new Error(`end_line ${e.end_line} 超出范围（${e.start_line}~${totalLines}）`);
    const newLines = [...lines.slice(0, e.start_line - 1), ...lines.slice(e.end_line)];
    await writeRemoteBuffer(ctx, e.path, newLines.join('\n'));
    results.push({ path: e.path, success: true, start_line: e.start_line, end_line: e.end_line, deletedLines: e.end_line - e.start_line + 1 });
  }
  return results.length === 1 ? results[0] : { results, successCount: results.length, totalCount: results.length };
};

const tApplyDiff: ToolTranslator = async (args, ctx) => {
  const filePath = args.path as string;
  const patch = args.patch as string;
  if (!filePath || typeof patch !== 'string') throw new Error('apply_diff: path 和 patch 必填');
  const content = (await readRemoteBuffer(ctx, filePath)).toString('utf8');
  let newContent: string;
  let appliedCount: number;
  let failedCount: number;
  let totalHunks: number;
  let results: Array<{ index: number; success: boolean; error?: string }>;
  let fallbackMode = 'none';
  try {
    const parsed = parseUnifiedDiff(patch);
    const applied = applyUnifiedDiffBestEffort(content, parsed);
    totalHunks = parsed.hunks.length;
    appliedCount = applied.results.filter(r => r.ok).length;
    failedCount = totalHunks - appliedCount;
    newContent = applied.newContent;
    results = applied.results.map(r => ({ index: r.index, success: r.ok, error: r.error }));
    if (appliedCount < totalHunks) {
      const srBlocks = convertHunksToSearchReplace(parsed.hunks);
      const srResult = applySearchReplaceBestEffort(content, srBlocks);
      if (srResult.appliedCount > appliedCount) {
        appliedCount = srResult.appliedCount; failedCount = srResult.failedCount; newContent = srResult.newContent;
        results = srResult.results.map(r => ({ index: r.index, success: r.success, error: r.error }));
        fallbackMode = 'unified_hunks_search_replace';
      }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.startsWith('Invalid hunk header')) {
      const looseBlocks = parseLoosePatchToSearchReplace(patch);
      const looseResult = applySearchReplaceBestEffort(content, looseBlocks);
      totalHunks = looseBlocks.length; appliedCount = looseResult.appliedCount; failedCount = looseResult.failedCount; newContent = looseResult.newContent;
      results = looseResult.results.map(r => ({ index: r.index, success: r.success, error: r.error }));
      fallbackMode = 'loose_hunk_search_replace';
    } else throw e;
  }
  if (appliedCount === 0) throw new Error(`所有 hunk 均失败: ${results.find(r => !r.success)?.error || 'All hunks failed'}`);
  await writeRemoteBuffer(ctx, filePath, newContent);
  return { path: filePath, totalHunks, applied: appliedCount, failed: failedCount, results, fallbackMode };
};

// ─────────────────────────── registry ───────────────────────────

export const TRANSLATORS: Record<string, ToolTranslator> = {
  shell: tShell,
  bash: tShell,
  list_files: tListFiles,
  read_file: tReadFile,
  write_file: tWriteFile,
  create_directory: tCreateDir,
  delete_file: tDeleteFile,
  find_files: tFindFiles,
  search_in_files: tSearchInFiles,
  insert_code: tInsertCode,
  delete_code: tDeleteCode,
  apply_diff: tApplyDiff,
};

export function getTranslator(toolName: string): ToolTranslator | undefined { return TRANSLATORS[toolName]; }
export function listSupportedTools(): string[] { return Object.keys(TRANSLATORS); }
