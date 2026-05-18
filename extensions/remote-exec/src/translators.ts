/**
 * translators.ts —— 工具调用 → 远端执行
 *
 * 性能最小策略：
 *   - 文件精确读写：auto/sftp 下走 SFTP（不启动远端进程，不 base64 膨胀）
 *   - 扫描/搜索/shell：走 SSH exec + bash/find/grep（避免大量 SFTP RTT）
 *   - Transport bash：所有文件读写也退化为纯 bash/coreutils，适配无 SFTP 服务器
 *   - 不依赖 Python。
 */

import path from 'node:path';
import { minimatch } from 'minimatch';
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

async function readRemoteTextSlice(ctx: TranslatorContext, toolPath: string, startLine: number, endLine: number | undefined): Promise<{ text: string; totalLines: number }> {
  const remotePath = resolveRemotePath(toolPath, ctx.remoteCwd);
  const safeStart = Math.max(1, Math.floor(startLine));
  const safeEnd = endLine !== undefined && Number.isFinite(endLine) ? Math.max(0, Math.floor(endLine)) : 0;
  const script = `set -euo pipefail
FILE=${shQuote(remotePath)}
START=${safeStart}
RANGE_END=${safeEnd}
bytes="$(wc -c < "$FILE" 2>/dev/null || printf '0')"
case "$bytes" in ''|*[!0-9]*) bytes=0 ;; esac
records="$(awk 'END { print NR }' "$FILE")"
case "$records" in ''|*[!0-9]*) records=0 ;; esac
last_hex=""
if [ "$bytes" -gt 0 ]; then
  last_hex="$(tail -c 1 "$FILE" | od -An -tx1 | tr -d ' \\n\\r')"
fi
if [ "$bytes" -eq 0 ]; then
  total=1
elif [ "$last_hex" = "0a" ]; then
  total=$((records + 1))
else
  total=$records
fi
content="$(awk -v start="$START" -v end="$RANGE_END" 'NR >= start && (end <= 0 || NR <= end) { print }' "$FILE")"
if [ "$last_hex" = "0a" ] && [ "$START" -le "$total" ] && { [ "$RANGE_END" -le 0 ] || [ "$RANGE_END" -ge "$total" ]; }; then
  content="\${content}
"
fi
printf '%s\\n' "$total"
printf '%s' "$content" | base64 | tr -d '\\n\\r'`;
  const r = await execBash(ctx, script);
  assertExitOk(r, `读取文件片段 ${toolPath}`);
  const nl = r.stdout.indexOf('\n');
  const totalText = (nl >= 0 ? r.stdout.slice(0, nl) : r.stdout).trim();
  const encoded = nl >= 0 ? r.stdout.slice(nl + 1).replace(/\s+/g, '') : '';
  const totalLines = Number.parseInt(totalText, 10);
  return {
    text: Buffer.from(encoded, 'base64').toString('utf8'),
    totalLines: Number.isFinite(totalLines) ? totalLines : 0,
  };
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
      const startLine = Math.max(1, req.startLine ?? 1);
      const hasLineRange = req.startLine !== undefined || req.endLine !== undefined;
      const size = await statRemoteSize(ctx, req.path);
      if (size !== undefined && size > LIMITS.read_file.maxFileSizeBytes && !hasLineRange) throw new Error(`文件过大 (${size} bytes > ${LIMITS.read_file.maxFileSizeBytes} bytes)，请使用 startLine/endLine 分段读取`);

      let slicedText: string;
      let totalLines: number;
      let endLine: number;
      let lineCount: number;
      if (hasLineRange) {
        const remoteSlice = await readRemoteTextSlice(ctx, req.path, startLine, req.endLine);
        totalLines = remoteSlice.totalLines;
        endLine = req.endLine ? Math.min(req.endLine, totalLines) : totalLines;
        if (startLine > totalLines) throw new Error(`startLine (${startLine}) 超出文件总行数 (${totalLines})`);
        slicedText = remoteSlice.text;
        lineCount = Math.max(0, endLine - startLine + 1);
      } else {
        const raw = (await readRemoteBuffer(ctx, req.path)).toString('utf8');
        const allLines = raw.split('\n');
        totalLines = allLines.length;
        endLine = req.endLine ? Math.min(req.endLine, totalLines) : totalLines;
        if (startLine > totalLines) throw new Error(`startLine (${startLine}) 超出文件总行数 (${totalLines})`);
        const sliced = allLines.slice(startLine - 1, endLine);
        slicedText = sliced.join('\n');
        lineCount = sliced.length;
      }
      const formatted = formatWithLineNumbers(slicedText, startLine);
      totalOutputChars += formatted.length;
      if (totalOutputChars > LIMITS.read_file.maxTotalOutputChars) {
        results.push({ path: req.path, success: false, error: `总输出已达上限 (${LIMITS.read_file.maxTotalOutputChars} chars)，后续文件已跳过。请使用 startLine/endLine 分段读取` });
        failCount++; break;
      }
      const res: any = { path: req.path, success: true, type: 'text', content: formatted, lineCount };
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
  const roots = getRemoteSearchRoots(patternList);
  const fileMap = new Map<string, { rel: string; display: string; toolPath: string }>();
  for (const root of roots) {
    for (const file of await listAllFiles(ctx, root, '**/*')) {
      fileMap.set(file.display, file);
    }
  }
  const files = Array.from(fileMap.values()).sort((a, b) => a.display.localeCompare(b.display));
  const excludeMatchers = buildExcludeMatchers(exclude);
  const patternRes = patternList.map(p => ({ pattern: p, re: globToRegExp(p), matches: [] as string[], truncated: false }));
  for (const f of files) {
    const rel = f.display;
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

const DEFAULT_SEARCH_INCLUDE = ['**/*'];
const DEFAULT_SEARCH_EXCLUDE = [
  '**/.git/**',
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/.next/**',
  '**/.turbo/**',
  '**/.limcode/**',
];

function normalizeRemoteGlobPattern(raw: string, field: 'include' | 'exclude', allowNegation: boolean): string {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error(`${field} 中不能包含空 glob`);
  const negated = trimmed.startsWith('!');
  if (negated && !allowNegation) throw new Error(`${field} 不支持 ! 否定模式；请把排除规则放到 exclude 数组中`);
  const bodyRaw = negated ? trimmed.slice(1).trim() : trimmed;
  if (!bodyRaw) throw new Error(`${field} 中不能包含空 glob`);
  const body = bodyRaw.replace(/\\/g, '/');
  if (path.posix.isAbsolute(body) || /^[A-Za-z]:[\\/]/.test(bodyRaw)) throw new Error(`${field} 只接受相对于远端工作目录的 glob: ${raw}`);
  if (body.split('/').some(part => part === '..')) throw new Error(`${field} 不允许包含 .. 路径段: ${raw}`);
  return negated ? `!${body}` : body;
}

function normalizeRemoteGlobList(value: unknown, field: 'include' | 'exclude', fallback: string[], allowNegation: boolean): string[] {
  if (value === undefined) return [...fallback];
  if (!Array.isArray(value)) throw new Error(`${field} 参数必须是字符串数组`);
  const normalized = value.map((item) => {
    if (typeof item !== 'string') throw new Error(`${field} 参数必须是字符串数组`);
    return normalizeRemoteGlobPattern(item, field, allowNegation);
  });
  if (field === 'include' && normalized.length === 0) throw new Error('include 参数必须是非空字符串数组');
  return Array.from(new Set(normalized));
}

function assertNoLegacySearchArgs(args: Record<string, unknown>): void {
  const legacyKeys = ['path', 'pattern', 'isRegex'].filter(key => args[key] !== undefined);
  if (legacyKeys.length > 0) {
    throw new Error(`search_in_files 已切换为 include/exclude glob 结构，不再支持旧参数: ${legacyKeys.join(', ')}。请使用 include: ["src/**/*", "tests/**/*"]，regex: true。`);
  }
}

function normalizeRemoteSearchGlobArgs(args: Record<string, unknown>): { include: string[]; exclude: string[]; effectiveExclude: string[] } {
  assertNoLegacySearchArgs(args);
  const include = normalizeRemoteGlobList(args.include, 'include', DEFAULT_SEARCH_INCLUDE, true);
  const exclude = normalizeRemoteGlobList(args.exclude, 'exclude', [], false);
  return { include, exclude, effectiveExclude: Array.from(new Set([...DEFAULT_SEARCH_EXCLUDE, ...exclude])) };
}

function matchesIncludeGlob(rel: string, include: string[]): boolean {
  let matched = false;
  for (const pattern of include) {
    if (pattern.startsWith('!')) {
      if (minimatch(rel, pattern.slice(1), { dot: true })) matched = false;
    } else if (minimatch(rel, pattern, { dot: true })) {
      matched = true;
    }
  }
  return matched;
}

function matchesSearchGlob(rel: string, include: string[], effectiveExclude: string[]): boolean {
  return matchesIncludeGlob(rel, include) && !effectiveExclude.some(pattern => minimatch(rel, pattern, { dot: true }));
}

async function listSearchCandidates(ctx: TranslatorContext, include: string[], effectiveExclude: string[]): Promise<Array<{ rel: string; display: string; toolPath: string }>> {
  const files = await listAllFiles(ctx, '.', '**/*');
  return files.filter(f => matchesSearchGlob(f.rel, include, effectiveExclude));
}

function expandSimpleBraceOnce(pattern: string): string[] {
  const start = pattern.indexOf('{');
  if (start < 0) return [pattern];
  const end = pattern.indexOf('}', start + 1);
  if (end < 0) return [pattern];
  const inner = pattern.slice(start + 1, end);
  if (!inner || inner.includes('{') || inner.includes('}')) return [pattern];
  const parts = inner.split(',').map(part => part.trim()).filter(Boolean);
  if (parts.length === 0) return [pattern];
  return parts.map(part => pattern.slice(0, start) + part + pattern.slice(end + 1));
}

function extractStaticSearchRoot(pattern: string): string {
  const body = pattern.startsWith('!') ? pattern.slice(1) : pattern;
  const globIndex = body.search(/[*?{[\]!(+@]/);
  if (globIndex < 0) {
    return body || '.';
  }
  const prefix = body.slice(0, globIndex);
  const slash = prefix.lastIndexOf('/');
  return slash >= 0 ? (prefix.slice(0, slash) || '.') : '.';
}

function getRemoteSearchRoots(include: string[]): string[] {
  const roots = include
    .flatMap(expandSimpleBraceOnce)
    .filter(pattern => !pattern.startsWith('!'))
    .map(extractStaticSearchRoot)
    .map(root => root.replace(/^\.\//, '').replace(/\/$/, '') || '.')
    .sort((a, b) => a.length - b.length || a.localeCompare(b));

  const deduped: string[] = [];
  for (const root of roots) {
    if (deduped.some(parent => parent === '.' || root === parent || root.startsWith(`${parent}/`))) continue;
    deduped.push(root);
  }
  return deduped.length > 0 ? deduped : ['.'];
}

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

interface RemoteGrepSearchResult {
  records: Array<{ file: string; line: number; column: number; match: string; context: string }>;
  filesSearched: number;
  skippedTooLarge: number;
  truncated: boolean;
}

async function grepSearchMatchesRemote(
  ctx: TranslatorContext,
  include: string[],
  effectiveExclude: string[],
  query: string,
  grepMode: 'literal' | 'regex-ere',
  maxResults: number,
  contextLines: number,
  maxFileSizeBytes: number,
): Promise<RemoteGrepSearchResult | undefined> {
  if (!query || query.includes('\n') || query.includes('\r')) return undefined;

  const roots = getRemoteSearchRoots(include);
  const rootArray = roots.map(root => shQuote(root)).join(' ');
  const prunes = DEFAULT_IGNORED_DIRS.map(d => `-name ${shQuote(d)}`).join(' -o ');
  const flag = grepMode === 'literal' ? '-F' : '-E';
  // 远端 grep 先多取一些原始结果；本地还会按 minimatch include/exclude 二次过滤，避免复杂 glob 语义不一致。
  const remoteLimit = Math.min(Math.max(maxResults * 200, maxResults), 5000);
  const modeValue = grepMode === 'literal' ? 'literal' : 'regex';
  const preflight = grepMode === 'regex-ere'
    ? `grep -E -e "$QUERY" </dev/null >/dev/null 2>/dev/null; st=$?; [ "$st" -gt 1 ] && exit 2`
    : '';

  const script = `set +e
QUERY=${shQuote(query)}
MODE=${shQuote(modeValue)}
MAX_RESULTS=${remoteLimit}
CONTEXT_LINES=${contextLines}
MAX_FILE_SIZE=${maxFileSizeBytes}
MAX_LINE_CHARS=${LIMITS.search_in_files.maxLineDisplayChars}
${preflight}
out="$(mktemp)" || exit 2
trap 'rm -f "$out"' EXIT
files_searched=0
skipped_too_large=0
truncated=0
count=0
process_file() {
  file="$1"
  [ -f "$file" ] || return 0
  size="$(stat -c %s -- "$file" 2>/dev/null || wc -c < "$file" 2>/dev/null || printf '0')"
  case "$size" in ''|*[!0-9]*) size=0 ;; esac
  if [ "$size" -gt "$MAX_FILE_SIZE" ]; then
    skipped_too_large=$((skipped_too_large + 1))
    return 0
  fi
  files_searched=$((files_searched + 1))
  while IFS= read -r hit; do
    line_no="\${hit%%:*}"
    text="\${hit#*:}"
    case "$line_no" in ''|*[!0-9]*) continue ;; esac
    matches="$(awk -v mode="$MODE" -v q="$QUERY" -v line="$text" 'BEGIN {
  if (mode == "literal") {
    if (length(q) == 0) exit;
    pos = 1;
    rest = line;
    while ((c = index(rest, q)) > 0) {
      start = pos + c - 1;
      print start "\t" q;
      pos = start + length(q);
      rest = substr(line, pos);
    }
  } else {
    pos = 1;
    rest = line;
    while (match(rest, q)) {
      if (RLENGTH <= 0) exit;
      print (pos + RSTART - 1) "\t" substr(rest, RSTART, RLENGTH);
      pos += RSTART + RLENGTH - 1;
      rest = substr(line, pos);
    }
  }
}')"
    [ -n "$matches" ] || continue
    start=$((line_no - CONTEXT_LINES)); [ "$start" -lt 1 ] && start=1
    end=$((line_no + CONTEXT_LINES))
    context="$(awk -v start="$start" -v end="$end" -v max="$MAX_LINE_CHARS" 'NR >= start && NR <= end {
      line = $0; len = length(line);
      if (len > max) {
        head = int(max * 0.75); tail = int(max * 0.15);
        line = substr(line, 1, head) " ... [" len " chars] ... " substr(line, len - tail + 1);
      }
      printf "%d: %s\\n", NR, line;
    }' "$file")"
    rel="\${file#./}"
    tab="$(printf '\\t')"
    while IFS="$tab" read -r col matched; do
      [ -n "$col" ] || continue
      printf '%s\\0%s\\0%s\\0%s\\0%s\\0' "$rel" "$line_no" "$col" "$matched" "$context" >> "$out"
      count=$((count + 1))
      if [ "$count" -ge "$MAX_RESULTS" ]; then
        truncated=1
        return 1
      fi
    done <<< "$matches"

  done < <(grep -nI ${flag} -e "$QUERY" -- "$file" 2>/dev/null)
  return 0
}
for root in ${rootArray}; do
  [ "$truncated" -eq 1 ] && break
  if [ -f "$root" ]; then
    process_file "$root" || true
  elif [ -d "$root" ]; then
    while IFS= read -r -d '' file; do
      process_file "$file" || true
      [ "$truncated" -eq 1 ] && break
    done < <(find "$root" \\( ${prunes} \\) -prune -o -type f -print0 2>/dev/null)
  fi
done
{ printf 'S\\0%s\\0%s\\0%s\\0' "$files_searched" "$skipped_too_large" "$truncated"; cat "$out"; } | base64 | tr -d '\\n\\r'`;

  const r = await execBash(ctx, script);
  if ((r.exitCode ?? 0) > 1 || r.timedOut) return undefined;
  if (!r.stdout.trim()) return { records: [], filesSearched: 0, skippedTooLarge: 0, truncated: false };

  const fields = decodeNulListFromBase64(r.stdout);
  if (fields.shift() !== 'S') return undefined;
  const filesSearched = Number.parseInt(fields.shift() ?? '0', 10) || 0;
  const skippedTooLarge = Number.parseInt(fields.shift() ?? '0', 10) || 0;
  const truncated = (fields.shift() ?? '0') === '1';
  const records: RemoteGrepSearchResult['records'] = [];
  for (let i = 0; i + 4 < fields.length; i += 5) {
    const line = Number.parseInt(fields[i + 1], 10);
    const column = Number.parseInt(fields[i + 2], 10);
    if (!Number.isFinite(line) || !Number.isFinite(column)) continue;
    records.push({ file: fields[i], line, column, match: fields[i + 3], context: fields[i + 4] });
  }

  return { records, filesSearched, skippedTooLarge, truncated };
}

interface RemoteGrepFileCandidatesResult {
  files: Array<{ rel: string; display: string; toolPath: string }>;
  filesSearched: number;
  skippedTooLarge: number;
  truncated: boolean;
}

async function grepFileCandidatesRemote(
  ctx: TranslatorContext,
  include: string[],
  effectiveExclude: string[],
  query: string,
  grepMode: 'literal' | 'regex-ere',
  maxFiles: number,
  maxFileSizeBytes: number,
): Promise<RemoteGrepFileCandidatesResult | undefined> {
  if (!query || query.includes('\n') || query.includes('\r')) return undefined;

  const roots = getRemoteSearchRoots(include);
  const rootArray = roots.map(root => shQuote(root)).join(' ');
  const prunes = DEFAULT_IGNORED_DIRS.map(d => `-name ${shQuote(d)}`).join(' -o ');
  const flag = grepMode === 'literal' ? '-F' : '-E';
  const remoteLimit = Math.min(Math.max(maxFiles * 100, maxFiles), 10000);
  const preflight = grepMode === 'regex-ere'
    ? `grep -E -e "$QUERY" </dev/null >/dev/null 2>/dev/null; st=$?; [ "$st" -gt 1 ] && exit 2`
    : '';

  const script = `set +e
QUERY=${shQuote(query)}
MAX_FILES=${remoteLimit}
MAX_FILE_SIZE=${maxFileSizeBytes}
${preflight}
out="$(mktemp)" || exit 2
trap 'rm -f "$out"' EXIT
files_searched=0
skipped_too_large=0
truncated=0
count=0
process_file() {
  file="$1"
  [ -f "$file" ] || return 0
  size="$(stat -c %s -- "$file" 2>/dev/null || wc -c < "$file" 2>/dev/null || printf '0')"
  case "$size" in ''|*[!0-9]*) size=0 ;; esac
  if [ "$size" -gt "$MAX_FILE_SIZE" ]; then
    skipped_too_large=$((skipped_too_large + 1))
    return 0
  fi
  files_searched=$((files_searched + 1))
  if grep -Iq ${flag} -e "$QUERY" -- "$file" 2>/dev/null; then
    rel="\${file#./}"
    printf '%s\\0' "$rel" >> "$out"
    count=$((count + 1))
    if [ "$count" -ge "$MAX_FILES" ]; then
      truncated=1
      return 1
    fi
  fi
  return 0
}
for root in ${rootArray}; do
  [ "$truncated" -eq 1 ] && break
  if [ -f "$root" ]; then
    process_file "$root" || true
  elif [ -d "$root" ]; then
    while IFS= read -r -d '' file; do
      process_file "$file" || true
      [ "$truncated" -eq 1 ] && break
    done < <(find "$root" \\( ${prunes} \\) -prune -o -type f -print0 2>/dev/null)
  fi
done
{ printf 'S\\0%s\\0%s\\0%s\\0' "$files_searched" "$skipped_too_large" "$truncated"; cat "$out"; } | base64 | tr -d '\\n\\r'`;

  const r = await execBash(ctx, script);
  if ((r.exitCode ?? 0) > 1 || r.timedOut) return undefined;
  if (!r.stdout.trim()) return { files: [], filesSearched: 0, skippedTooLarge: 0, truncated: false };

  const fields = decodeNulListFromBase64(r.stdout);
  if (fields.shift() !== 'S') return undefined;
  const filesSearched = Number.parseInt(fields.shift() ?? '0', 10) || 0;
  const skippedTooLarge = Number.parseInt(fields.shift() ?? '0', 10) || 0;
  const truncated = (fields.shift() ?? '0') === '1';
  const files = Array.from(new Set(fields))
    .filter(file => matchesSearchGlob(file, include, effectiveExclude))
    .map(file => ({ rel: file, display: file, toolPath: file }));

  return { files, filesSearched, skippedTooLarge, truncated };
}



const tSearchInFiles: ToolTranslator = async (args, ctx) => {
  const modeArg = ((args.mode as 'search' | 'replace' | undefined) ?? 'search');
  if (modeArg !== 'search' && modeArg !== 'replace') throw new Error(`mode 参数无效: ${String(args.mode)}`);
  const query = String(args.query ?? '');
  const { include, exclude, effectiveExclude } = normalizeRemoteSearchGlobArgs(args);
  const regexMode = (args.regex as boolean | undefined) ?? false;
  const maxResults = clampPositiveInteger(args.maxResults, LIMITS.search_in_files.maxResults, LIMITS.search_in_files.maxResults);
  const maxFiles = clampPositiveInteger(args.maxFiles, LIMITS.search_in_files.maxFiles, LIMITS.search_in_files.maxFiles);
  const contextLines = clampPositiveInteger(args.contextLines, LIMITS.search_in_files.contextLines, LIMITS.search_in_files.contextLines);
  const maxFileSizeBytes = clampPositiveInteger(args.maxFileSizeBytes, LIMITS.search_in_files.maxFileSizeBytes, LIMITS.search_in_files.maxFileSizeBytes);
  const regex = buildSearchRegex(query, regexMode);

  if (modeArg === 'search') {
    const grepMode: 'literal' | 'regex-ere' | undefined = !regexMode
      ? 'literal'
      : (canPrefilterRegexWithGrepE(query) ? 'regex-ere' : undefined);

    if (grepMode) {
      const remoteGrep = await grepSearchMatchesRemote(ctx, include, effectiveExclude, query, grepMode, maxResults, contextLines, maxFileSizeBytes);
      if (remoteGrep) {
        const results: any[] = [];
        for (const record of remoteGrep.records) {
          if (!matchesSearchGlob(record.file, include, effectiveExclude)) continue;
          results.push({
            file: record.file,
            line: record.line,
            column: record.column,
            match: truncateLine(record.match, LIMITS.search_in_files.maxMatchDisplayChars),
            context: record.context,
          });
          if (results.length >= maxResults) break;
        }
        const truncated = remoteGrep.truncated || results.length >= maxResults || remoteGrep.records.length > results.length;
        const warning = remoteGrep.filesSearched === 0
          ? '没有文件匹配 include/exclude glob。请检查 include，例如 ["src/**/*", "tests/**/*"] 或 ["{src,tests}/**/*"]。'
          : undefined;
        return { mode: modeArg, query, regex: regexMode, include, exclude, effectiveExclude, results, count: results.length, truncated, filesMatched: remoteGrep.filesSearched, filesSearched: remoteGrep.filesSearched, skippedBinary: 0, skippedTooLarge: remoteGrep.skippedTooLarge, remoteSearch: 'grep', ...(warning ? { warning } : {}) };
      }
    }

    const candidates = await listSearchCandidates(ctx, include, effectiveExclude);
    const emptyMatchWarning = candidates.length === 0 ? '没有文件匹配 include/exclude glob。请检查 include，例如 ["src/**/*", "tests/**/*"] 或 ["{src,tests}/**/*"]。' : undefined;
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
    return { mode: modeArg, query, regex: regexMode, include, exclude, effectiveExclude, results, count: results.length, truncated, filesMatched: candidates.length, filesSearched, skippedBinary, skippedTooLarge, ...(emptyMatchWarning ? { warning: emptyMatchWarning } : {}) };
  }

  const replace = args.replace;
  if (typeof replace !== 'string') throw new Error('replace 模式下必须提供 replace 参数');
  const grepMode: 'literal' | 'regex-ere' | undefined = !regexMode
    ? 'literal'
    : (canPrefilterRegexWithGrepE(query) ? 'regex-ere' : undefined);
  const grepCandidates = grepMode
    ? await grepFileCandidatesRemote(ctx, include, effectiveExclude, query, grepMode, maxFiles, maxFileSizeBytes)
    : undefined;
  const candidates = grepCandidates?.files ?? await listSearchCandidates(ctx, include, effectiveExclude);
  const emptyMatchWarning = candidates.length === 0 ? '没有文件匹配 include/exclude glob。请检查 include，例如 ["src/**/*", "tests/**/*"] 或 ["{src,tests}/**/*"]。' : undefined;
  const results: any[] = [];
  let processedFiles = 0, totalReplacements = 0;
  const truncated = candidates.length > maxFiles || grepCandidates?.truncated === true;
  for (const f of candidates.slice(0, maxFiles)) {
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
  return { mode: modeArg, query, replace, regex: regexMode, include, exclude, effectiveExclude, results, filesMatched: candidates.length, processedFiles, totalReplacements, truncated, ...(grepCandidates ? { remotePrefilter: 'grep', filesSearched: grepCandidates.filesSearched, skippedTooLarge: grepCandidates.skippedTooLarge } : {}), ...(emptyMatchWarning ? { warning: emptyMatchWarning } : {}) };
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
  type TranslatorApplyDiffResultEntry = {
    index: number;
    success: boolean;
    error?: string;
    appliedHeader?: string;
    appliedBy?: string;
    fallback?: {
      strategy: string;
      message: string;
      originalHeader?: string;
      correctedHeader?: string;
    };
  };
  const buildSearchReplaceFallbackMessage = (strategy: 'search_replace' | 'loose_search_replace') => strategy === 'loose_search_replace'
    ? '原始补丁 hunk 头无效，已通过 loose search/replace 兜底应用该 hunk。'
    : '常规 hunk 应用失败，已通过 search/replace 兜底应用该 hunk。';
  const mergeFallbackResults = (
    primaryResults: TranslatorApplyDiffResultEntry[],
    fallbackResults: TranslatorApplyDiffResultEntry[],
    hunkCount: number,
  ) => {
    const primaryMap = new Map(primaryResults.map((item) => [item.index, item]));
    const fallbackMap = new Map(fallbackResults.map((item) => [item.index, item]));
    const merged: TranslatorApplyDiffResultEntry[] = [];
    for (let index = 0; index < hunkCount; index++) {
      const primary = primaryMap.get(index);
      const fallback = fallbackMap.get(index);
      if (primary?.success) { merged.push(primary); continue; }
      if (fallback) { merged.push(fallback); continue; }
      if (primary) { merged.push(primary); continue; }
      merged.push({ index, success: false, error: 'Unknown hunk result' });
    }
    return merged;
  };
  const preservesPrimarySuccesses = (
    primaryResults: TranslatorApplyDiffResultEntry[],
    fallbackResults: TranslatorApplyDiffResultEntry[],
  ) => {
    const fallbackMap = new Map(fallbackResults.map((item) => [item.index, item]));
    return primaryResults.filter((item) => item.success).every((item) => fallbackMap.get(item.index)?.success === true);
  };
  const content = (await readRemoteBuffer(ctx, filePath)).toString('utf8');
  let newContent: string;
  let appliedCount: number;
  let failedCount: number;
  let totalHunks: number;
  let results: TranslatorApplyDiffResultEntry[];
  let fallbackMode = 'none';
  try {
    const parsed = parseUnifiedDiff(patch);
    const applied = applyUnifiedDiffBestEffort(content, parsed);
    totalHunks = parsed.hunks.length;
    appliedCount = applied.results.filter(r => r.ok).length;
    failedCount = totalHunks - appliedCount;
    newContent = applied.newContent;
    results = applied.results.map(r => ({
      index: r.index,
      success: r.ok,
      error: r.error,
      appliedHeader: r.appliedHeader,
      appliedBy: r.appliedBy,
      fallback: r.fallback,
    }));
    if (appliedCount < totalHunks) {
      const srBlocks = convertHunksToSearchReplace(parsed.hunks);
      const srResult = applySearchReplaceBestEffort(content, srBlocks);
      const srMapped = srResult.results.map(r => ({
        index: r.index,
        success: r.success,
        error: r.error,
        appliedHeader: r.appliedHeader,
        appliedBy: r.success ? 'search_replace' : undefined,
        fallback: r.success ? {
          strategy: 'search_replace',
          message: buildSearchReplaceFallbackMessage('search_replace'),
          originalHeader: parsed.hunks[r.index]?.header,
          correctedHeader: r.appliedHeader,
        } : undefined,
      }));
      if (srResult.appliedCount > appliedCount && preservesPrimarySuccesses(results, srMapped)) {
        appliedCount = srResult.appliedCount; failedCount = srResult.failedCount; newContent = srResult.newContent;
        results = mergeFallbackResults(results, srMapped, totalHunks);
        fallbackMode = 'unified_hunks_search_replace';
      }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.startsWith('Invalid hunk header')) {
      const looseBlocks = parseLoosePatchToSearchReplace(patch);
      const looseResult = applySearchReplaceBestEffort(content, looseBlocks);
      totalHunks = looseBlocks.length; appliedCount = looseResult.appliedCount; failedCount = looseResult.failedCount; newContent = looseResult.newContent;
      results = looseResult.results.map(r => ({
        index: r.index,
        success: r.success,
        error: r.error,
        appliedHeader: r.appliedHeader,
        appliedBy: r.success ? 'loose_search_replace' : undefined,
        fallback: r.success ? {
          strategy: 'loose_search_replace',
          message: buildSearchReplaceFallbackMessage('loose_search_replace'),
          originalHeader: looseBlocks[r.index]?.originalHeader,
          correctedHeader: r.appliedHeader,
        } : undefined,
      }));
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
