/**
 * Tool utilities — 可复用的工具辅助函数
 *
 * 包含 diff 解析、文件遍历、参数归一化等纯函数，
 * 供扩展插件和宿主工具共同使用。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

// ── Unified Diff ──────────────────────────────────────────────
// (从 apply_diff/unified_diff.ts 提取的全部类型和函数)

// ============ 类型 ============

export type UnifiedDiffLineType = 'context' | 'add' | 'del';

export interface UnifiedDiffLine {
  type: UnifiedDiffLineType;
  content: string;
  raw: string;
}

export interface UnifiedDiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  header: string;
  lines: UnifiedDiffLine[];
}

export interface ParsedUnifiedDiff {
  oldFile?: string;
  newFile?: string;
  hunks: UnifiedDiffHunk[];
}

export interface AppliedHunkRange {
  index: number;
  startLine: number;
  endLine: number;
}

export interface UnifiedDiffHunkApplyResult {
  index: number;
  ok: boolean;
  error?: string;
  startLine?: number;
  endLine?: number;
}

export interface ApplyUnifiedDiffBestEffortResult {
  newContent: string;
  appliedHunks: AppliedHunkRange[];
  results: UnifiedDiffHunkApplyResult[];
}

/** search/replace 块 */
export interface SearchReplaceBlock {
  search: string;
  replace: string;
  startLine?: number;
}

// ============ 内部工具函数 ============

function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/** 去除 AI 常见的包裹行（markdown fence、ApplyPatch 风格包裹等） */
function sanitizeUnifiedDiffPatch(patch: string): string {
  const normalized = normalizeLineEndings(patch);
  const lines = normalized.split('\n');
  const out: string[] = [];

  for (const line of lines) {
    if (line.startsWith('```')) continue;
    if (line.startsWith('***')) {
      if (
        line === '***' ||
        line.startsWith('*** Begin Patch') ||
        line.startsWith('*** End Patch') ||
        line.startsWith('*** Update File:') ||
        line.startsWith('*** Add File:') ||
        line.startsWith('*** Delete File:') ||
        line.startsWith('*** End of File')
      ) {
        continue;
      }
    }
    out.push(line);
  }

  return out.join('\n');
}

function splitLinesPreserveTrailing(text: string): { lines: string[]; endsWithNewline: boolean } {
  const normalized = normalizeLineEndings(text);
  const endsWithNewline = normalized.endsWith('\n');
  const lines = normalized.split('\n');
  if (endsWithNewline) lines.pop();
  return { lines, endsWithNewline };
}

function joinLinesPreserveTrailing(lines: string[], endsWithNewline: boolean): string {
  const body = lines.join('\n');
  return endsWithNewline ? body + '\n' : body;
}

function computeHunkNewLen(hunk: UnifiedDiffHunk): number {
  return hunk.lines.reduce((acc, l) => acc + (l.type === 'del' ? 0 : 1), 0);
}

// ============ 解析 ============

/** 解析 unified diff patch（单文件） */
export function parseUnifiedDiff(patch: string): ParsedUnifiedDiff {
  const normalized = sanitizeUnifiedDiffPatch(patch);
  const lines = normalized.split('\n');

  let oldFile: string | undefined;
  let newFile: string | undefined;
  const hunks: UnifiedDiffHunk[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith('diff --git ')) {
      if (hunks.length > 0 || oldFile || newFile) {
        throw new Error('Multi-file patch is not supported. Please split into one apply_diff call per file.');
      }
      i++;
      continue;
    }

    if (line.startsWith('--- ')) {
      if (oldFile && (hunks.length > 0 || newFile)) {
        throw new Error('Multi-file patch is not supported.');
      }
      oldFile = line.slice(4).trim().split('\t')[0]?.trim() || '';
      i++;
      continue;
    }

    if (line.startsWith('+++ ')) {
      if (newFile && hunks.length > 0) {
        throw new Error('Multi-file patch is not supported.');
      }
      newFile = line.slice(4).trim().split('\t')[0]?.trim() || '';
      i++;
      continue;
    }

    if (line.startsWith('@@')) {
      const header = line;
      const m = header.match(/^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/);
      if (!m) {
        throw new Error(
          `Invalid hunk header: ${header}. ` +
          `Expected format: @@ -oldStart,oldCount +newStart,newCount @@`
        );
      }

      const oldStart = parseInt(m[1], 10);
      const oldCount = m[2] ? parseInt(m[2], 10) : 1;
      const newStart = parseInt(m[3], 10);
      const newCount = m[4] ? parseInt(m[4], 10) : 1;

      const hunkLines: UnifiedDiffLine[] = [];
      i++;
      while (i < lines.length) {
        const l = lines[i];
        if (l.startsWith('@@') || l.startsWith('--- ') || l.startsWith('diff --git ') || l.startsWith('+++ ')) break;
        if (l === '') { i++; continue; }
        if (l.startsWith('\\')) { i++; continue; }

        const prefix = l[0];
        const content = l.length > 0 ? l.slice(1) : '';

        if (prefix === ' ') {
          hunkLines.push({ type: 'context', content, raw: l });
        } else if (prefix === '+') {
          hunkLines.push({ type: 'add', content, raw: l });
        } else if (prefix === '-') {
          hunkLines.push({ type: 'del', content, raw: l });
        } else {
          throw new Error(`Invalid hunk line prefix '${prefix}' in line: ${l}`);
        }
        i++;
      }

      hunks.push({ oldStart, oldLines: oldCount, newStart, newLines: newCount, header, lines: hunkLines });
      continue;
    }

    i++;
  }

  if (hunks.length === 0) {
    throw new Error('No hunks (@@ ... @@) found in patch.');
  }

  return { oldFile, newFile, hunks };
}

// ============ 应用 ============

/**
 * best-effort 逐 hunk 应用。
 *
 * 每个 hunk 先按行号 + delta 定位，失败时全局搜索 context+del 文本块。
 * 唯一匹配则用匹配位置重新应用，多处匹配或无匹配则报错。
 */
export function applyUnifiedDiffBestEffort(
  originalContent: string,
  parsed: ParsedUnifiedDiff,
): ApplyUnifiedDiffBestEffortResult {
  const { lines, endsWithNewline } = splitLinesPreserveTrailing(originalContent);

  let delta = 0;
  const appliedHunks: AppliedHunkRange[] = [];
  const results: UnifiedDiffHunkApplyResult[] = [];

  for (let hunkIndex = 0; hunkIndex < parsed.hunks.length; hunkIndex++) {
    const hunk = parsed.hunks[hunkIndex];

    const tryApplyAt = (startIndex: number): { added: number; removed: number } => {
      if (startIndex < 0 || startIndex > lines.length) {
        throw new Error(`Hunk start is out of range. ${hunk.header}`);
      }

      let idx = startIndex;
      let removed = 0;
      let added = 0;

      for (const line of hunk.lines) {
        if (line.type === 'context') {
          if (lines[idx] !== line.content) {
            throw new Error(`Context mismatch at ${hunk.header}`);
          }
          idx++;
          continue;
        }
        if (line.type === 'del') {
          if (lines[idx] !== line.content) {
            throw new Error(`Delete mismatch at ${hunk.header}`);
          }
          lines.splice(idx, 1);
          removed++;
          continue;
        }
        // add
        lines.splice(idx, 0, line.content);
        idx++;
        added++;
      }

      return { added, removed };
    };

    const searchHunkInFile = (): number[] => {
      const oldLines = hunk.lines
        .filter(l => l.type === 'context' || l.type === 'del')
        .map(l => l.content);
      if (oldLines.length === 0) return [];
      const matches: number[] = [];
      const scanLimit = lines.length - oldLines.length + 1;
      for (let s = 0; s < scanLimit; s++) {
        let match = true;
        for (let j = 0; j < oldLines.length; j++) {
          if (lines[s + j] !== oldLines[j]) { match = false; break; }
        }
        if (match) matches.push(s);
      }
      return matches;
    };

    let snapshot = lines.slice();
    let applied = false;

    // 第一轮：按行号 + delta 定位
    try {
      if (hunk.oldStart >= 0) {
        const baseOldStart = Math.max(1, hunk.oldStart);
        const startIndex = baseOldStart - 1 + delta;
        const { added, removed } = tryApplyAt(startIndex);

        const newLen = computeHunkNewLen(hunk);
        const startLine = startIndex + 1;
        const endLine = startLine + Math.max(newLen, 1) - 1;
        appliedHunks.push({ index: hunkIndex, startLine, endLine });
        delta += added - removed;
        results.push({ index: hunkIndex, ok: true, startLine, endLine });
        applied = true;
      }
    } catch {
      lines.splice(0, lines.length, ...snapshot);
    }

    // 第二轮：全局搜索
    if (!applied) {
      snapshot = lines.slice();
      const matches = searchHunkInFile();

      if (matches.length === 1) {
        try {
          const startIndex = matches[0];
          const { added, removed } = tryApplyAt(startIndex);

          const newLen = computeHunkNewLen(hunk);
          const startLine = startIndex + 1;
          const endLine = startLine + Math.max(newLen, 1) - 1;
          appliedHunks.push({ index: hunkIndex, startLine, endLine });
          delta += added - removed;
          results.push({ index: hunkIndex, ok: true, startLine, endLine });
          applied = true;
        } catch {
          lines.splice(0, lines.length, ...snapshot);
        }
      }

      if (!applied) {
        const oldLines = hunk.lines
          .filter(l => l.type === 'context' || l.type === 'del')
          .map(l => l.content);
        let errorMsg: string;
        if (matches.length === 0) {
     errorMsg = `Hunk context mismatch at ${hunk.header}. Line-number match failed and global search found no match for the context/delete block (${oldLines.length} lines).`;
        } else {
          const candidateLineNums = matches.map(m => m + 1);
          errorMsg = `Hunk context mismatch at ${hunk.header}. Line-number match failed and global search found ${matches.length} matches (ambiguous). Candidate lines: ${candidateLineNums.join(', ')}.`;
        }
        results.push({ index: hunkIndex, ok: false, error: errorMsg });
      }
    }
  }

  return {
    newContent: joinLinesPreserveTrailing(lines, endsWithNewline),
    appliedHunks,
    results,
  };
}

// ============ Loose @@ 兜底 ============

/**
 * 将带行号的 unified hunks 转换为 search/replace 块。
 * 用于 unified diff 部分 hunk 失败时的兜底路径。
 */
export function convertHunksToSearchReplace(hunks: UnifiedDiffHunk[]): SearchReplaceBlock[] {
  return hunks.map(h => {
    const startLineHint = Number.isFinite(h.oldStart) ? Math.max(1, h.oldStart) : undefined;
    const searchLines: string[] = [];
    const replaceLines: string[] = [];

    for (const l of h.lines) {
      if (l.type === 'context') {
        searchLines.push(l.content);
        replaceLines.push(l.content);
      } else if (l.type === 'del') {
        searchLines.push(l.content);
      } else {
        replaceLines.push(l.content);
      }
    }

    return {
      search: searchLines.join('\n'),
      replace: replaceLines.join('\n'),
      startLine: startLineHint,
    };
  });
}

/**
 * 将裸 @@ 的 patch 解析为 search/replace 块（无行号，全局精确匹配）。
 */
export function parseLoosePatchToSearchReplace(patch: string): SearchReplaceBlock[] {
  const normalized = sanitizeUnifiedDiffPatch(patch);
  const lines = normalized.split('\n');
  const blocks: SearchReplaceBlock[] = [];

  let inHunk = false;
  let searchLines: string[] = [];
  let replaceLines: string[] = [];

  const flush = () => {
    if (!inHunk) return;
    const search = searchLines.join('\n');
    const replace = replaceLines.join('\n');
    if (!search.trim()) {
      throw new Error('Loose @@ hunk has empty search block.');
    }
    blocks.push({ search, replace });
    searchLines = [];
    replaceLines = [];
  };

  for (const line of lines) {
    if (line.startsWith('@@')) {
      flush();
      inHunk = true;
      continue;
    }
    if (!inHunk) continue;
    if (line.startsWith('diff --git ') || line.startsWith('--- ') || line.startsWith('+++ ')) {
      flush();
      inHunk = false;
      continue;
    }
    if (line.startsWith('\\') || line === '') continue;

    const prefix = line[0];
    const content = line.length > 0 ? line.slice(1) : '';
    if (prefix === ' ') {
      searchLines.push(content);
      replaceLines.push(content);
    } else if (prefix === '-') {
      searchLines.push(content);
    } else if (prefix === '+') {
      replaceLines.push(content);
    } else {
      searchLines.push(line);
 replaceLines.push(line);
    }
  }

  flush();

  if (blocks.length === 0) {
    throw new Error('No hunks (@@) found in patch.');
  }

  return blocks;
}

/**
 * 应用 search/replace 块到内容（best-effort）。
 * 用于 loose @@ 兜底和 unified hunk 退化兜底。
 */
export function applySearchReplaceBestEffort(
  originalContent: string,
  blocks: SearchReplaceBlock[],
): {
  newContent: string;
  results: Array<{ index: number; success: boolean; error?: string; matchCount?: number }>;
  appliedCount: number;
  failedCount: number;
} {
  const norm = normalizeLineEndings;
  let currentContent = norm(originalContent);
  const results: Array<{ index: number; success: boolean; error?: string; matchCount?: number }> = [];

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const search = norm(block.search);
    const replace = norm(block.replace);

    if (!search) {
      results.push({ index: i, success: false, error: 'Empty search content' });
      continue;
    }

    // 如果有 startLine 提示，从该行开始搜索
    if (block.startLine && block.startLine > 0) {
      const lines = currentContent.split('\n');
      let charOffset = 0;
      for (let j = 0; j < Math.min(block.startLine - 1, lines.length); j++) {
        charOffset += lines[j].length + 1;
      }
      const idx = currentContent.indexOf(search, charOffset);
      if (idx !== -1) {
        currentContent = currentContent.slice(0, idx) + replace + currentContent.slice(idx + search.length);
        results.push({ index: i, success: true, matchCount: 1 });
        continue;
      }
    }

    // 全局精确匹配
    const matchCount = currentContent.split(search).length - 1;
    if (matchCount === 0) {
      results.push({ index: i, success: false, error: 'No exact match found', matchCount: 0 });
    } else if (matchCount > 1) {
      results.push({ index: i, success: false, error: `Multiple matches found (${matchCount})`, matchCount });
    } else {
      currentContent = currentContent.replace(search, replace);
      results.push({ index: i, success: true, matchCount: 1 });
    }
  }

  const appliedCount = results.filter(r => r.success).length;
  return {
    newContent: currentContent,
    results,
    appliedCount,
    failedCount: results.length - appliedCount,
  };
}

// ── File Search Utilities ─────────────────────────────────────
// (从 search_in_files.ts 提取的 toPosix, globToRegExp, isLikelyBinary, decodeText, buildSearchRegex, walkFiles)

/** 默认忽略目录（仅按目录名判断） */
export const DEFAULT_IGNORED_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  '.next',
  '.turbo',
  '.limcode',
]);

/** 采样字节数，用于二进制检测 */
const BINARY_DETECT_BYTES = 8 * 1024;

export type TextEncoding = 'utf-8' | 'utf-16le' | 'utf-16be';

export interface DetectedText {
  text: string;
  encoding: TextEncoding;
  hasBom: boolean;
  /** 原始是否包含 CRLF（用于更稳定的回写策略） */
  hasCRLF: boolean;
}

export function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function globToRegExp(glob: string): RegExp {
  // 基础 glob：
  // - *  匹配除 / 外任意长度字符
  // - ?  匹配除 / 外单个字符
  // - ** 匹配任意长度字符（包含 /）
  const g = toPosix(glob.trim());
  let re = '^';

  for (let i = 0; i < g.length; i++) {
    const ch = g[i];

    if (ch === '*') {
      const next = g[i + 1];
      if (next === '*') {
        // **
        i++;
        // **/ 这种写法比较常见，做一个更宽松的处理
        if (g[i + 1] === '/') {
          i++;
          re += '(?:.*\\/)?';
        } else {
          re += '.*';
        }
      } else {
        re += '[^/]*';
      }
      continue;
    }

    if (ch === '?') {
      re += '[^/]';
      continue;
    }

    // 普通字符：转义正则特殊字符
    if ('\\.^$+()[]{}|'.includes(ch)) {
      re += '\\' + ch;
    } else {
      re += ch;
    }
  }

  re += '$';
  return new RegExp(re);
}

function shouldIgnoreByPath(relativePosixPath: string): boolean {
  const parts = relativePosixPath.split('/');
  return parts.some(p => DEFAULT_IGNORED_DIRS.has(p));
}

export function isLikelyBinary(buf: Buffer): boolean {
  const n = Math.min(buf.length, BINARY_DETECT_BYTES);
  if (n === 0) return false;

  let suspicious = 0;
  for (let i = 0; i < n; i++) {
    const b = buf[i];

    // NUL 基本可判为二进制
    if (b === 0x00) return true;

    const isAllowedWhitespace = b === 0x09 || b === 0x0A || b === 0x0D; // \t \n \r
    const isControl = (b < 0x20 && !isAllowedWhitespace) || b === 0x7F;
    if (isControl) suspicious++;
  }

  const ratio = suspicious / n;
  return ratio > 0.3;
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

export function decodeText(buf: Buffer): DetectedText {
  const hasCRLF = buf.includes(Buffer.from('\r\n'));

  // UTF-8 BOM
  if (buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) {
    return {
      text: buf.subarray(3).toString('utf8'),
      encoding: 'utf-8',
      hasBom: true,
      hasCRLF,
    };
  }

  // UTF-16 LE BOM
  if (buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xFE) {
    return {
      text: buf.subarray(2).toString('utf16le'),
      encoding: 'utf-16le',
      hasBom: true,
      hasCRLF,
    };
  }

  // UTF-16 BE BOM
  if (buf.length >= 2 && buf[0] === 0xFE && buf[1] === 0xFF) {
    const swapped = swapByteOrder16(buf.subarray(2));
    return {
      text: swapped.toString('utf16le'),
      encoding: 'utf-16be',
      hasBom: true,
      hasCRLF,
    };
  }

  // 默认按 UTF-8
  return {
    text: buf.toString('utf8'),
    encoding: 'utf-8',
    hasBom: false,
    hasCRLF,
  };
}

export function buildSearchRegex(query: string, isRegex: boolean): RegExp {
  if (!query || !query.trim()) {
    throw new Error('query 不能为空');
  }
  return isRegex ? new RegExp(query, 'g') : new RegExp(escapeRegex(query), 'g');
}

export function walkFiles(
  rootAbs: string,
  onFile: (fileAbs: string, relPosix: string) => void,
  shouldStop: () => boolean,
  relPosixDir: string = '',
): void {
  if (shouldStop()) return;

  const dirAbs = relPosixDir ? path.join(rootAbs, relPosixDir) : rootAbs;
  const entries = fs.readdirSync(dirAbs, { withFileTypes: true });

  for (const ent of entries) {
    if (shouldStop()) return;

    const relPosix = relPosixDir ? `${relPosixDir}/${ent.name}` : ent.name;

    if (ent.isDirectory()) {
      if (DEFAULT_IGNORED_DIRS.has(ent.name)) continue;
      if (shouldIgnoreByPath(relPosix)) continue;
      walkFiles(rootAbs, onFile, shouldStop, relPosix);
      continue;
    }

    if (ent.isFile()) {
      if (shouldIgnoreByPath(relPosix)) continue;
      onFile(path.join(dirAbs, ent.name), relPosix);
    }
  }
}

// ── Tool Argument Normalization ───────────────────────────────
// (从 utils.ts 提取的 normalizeObjectArrayArg, normalizeStringArrayArg, resolveProjectPath)

export interface NormalizeObjectArrayArgOptions<T> {
  arrayKey: string;
  singularKeys?: string[];
  isEntry: (value: unknown) => value is T;
}

export interface NormalizeStringArrayArgOptions {
  arrayKey: string;
  singularKeys?: string[];
}

export function normalizeObjectArrayArg<T>(
  args: Record<string, unknown>,
  options: NormalizeObjectArrayArgOptions<T>,
): T[] | undefined {
  const arrayValue = args[options.arrayKey];
  if (Array.isArray(arrayValue) && arrayValue.length > 0) {
    const normalized = arrayValue.filter(options.isEntry);
    return normalized.length === arrayValue.length ? normalized : undefined;
  }

  if (options.isEntry(arrayValue)) {
    return [arrayValue];
  }

  for (const key of options.singularKeys ?? []) {
    const singularValue = args[key];
    if (options.isEntry(singularValue)) {
      return [singularValue];
    }
  }

  if (options.isEntry(args)) {
    return [args];
  }

  return undefined;
}

export function normalizeStringArrayArg(
  args: Record<string, unknown>,
  options: NormalizeStringArrayArgOptions,
): string[] | undefined {
  const arrayValue = args[options.arrayKey];
  if (Array.isArray(arrayValue) && arrayValue.length > 0) {
    return arrayValue.every((item) => typeof item === 'string' && item.trim().length > 0)
      ? arrayValue as string[]
      : undefined;
  }

  for (const value of [arrayValue, ...(options.singularKeys ?? []).map((key) => args[key])]) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return [value];
    }
  }

  return undefined;
}

/**
 * 解析路径并校验是否在项目目录内，防止路径穿越。
 * 返回解析后的绝对路径。
 *
 * @param inputPath 要解析的路径
 * @param baseCwd   项目根目录基准（默认 process.cwd()，多 session 场景下应传入 per-session cwd）
 */
export function resolveProjectPath(inputPath: string, baseCwd?: string): string {
  const cwd = baseCwd ?? process.cwd();
  const resolved = path.resolve(cwd, inputPath);
  if (resolved !== cwd && !resolved.startsWith(cwd + path.sep)) {
    throw new Error(`路径超出项目目录: ${inputPath}`);
  }
  return resolved;
}

// ── Write/Insert/Delete Entry Normalization ───────────────────
// (从 write_file.ts, insert_code.ts, delete_code.ts 提取的 normalize 函数和 Entry 类型)

export interface WriteEntry {
  path: string;
  content: string;
}

function isWriteEntry(value: unknown): value is WriteEntry {
  return !!value
    && typeof value === 'object'
    && !Array.isArray(value)
    && typeof (value as Record<string, unknown>).path === 'string'
    && typeof (value as Record<string, unknown>).content === 'string';
}

export function normalizeWriteArgs(args: Record<string, unknown>): WriteEntry[] | undefined {
  if (Array.isArray(args.files) && args.files.length > 0) {
    const normalized = args.files.filter(isWriteEntry);
    return normalized.length === args.files.length
      ? normalized
      : undefined;
  }

  if (isWriteEntry(args.files)) {
    return [args.files];
  }

  if (isWriteEntry(args.file)) {
    return [args.file];
  }

  if (isWriteEntry(args)) {
    return [{
      path: args.path,
      content: args.content,
    }];
  }

  return undefined;
}

export interface InsertEntry {
  path: string;
  line: number;
  content: string;
}

function isInsertEntry(value: unknown): value is InsertEntry {
  return !!value
    && typeof value === 'object'
    && !Array.isArray(value)
    && typeof (value as Record<string, unknown>).path === 'string'
    && typeof (value as Record<string, unknown>).line === 'number'
    && typeof (value as Record<string, unknown>).content === 'string';
}

export function normalizeInsertArgs(args: Record<string, unknown>): InsertEntry[] | undefined {
  return normalizeObjectArrayArg(args, {
    arrayKey: 'files',
    singularKeys: ['file'],
    isEntry: isInsertEntry,
  });
}

export interface DeleteCodeEntry {
  path: string;
  start_line: number;
  end_line: number;
}

function isDeleteCodeEntry(value: unknown): value is DeleteCodeEntry {
  return !!value
    && typeof value === 'object'
    && !Array.isArray(value)
    && typeof (value as Record<string, unknown>).path === 'string'
    && typeof (value as Record<string, unknown>).start_line === 'number'
    && typeof (value as Record<string, unknown>).end_line === 'number';
}

export function normalizeDeleteCodeArgs(args: Record<string, unknown>): DeleteCodeEntry[] | undefined {
  return normalizeObjectArrayArg(args, {
    arrayKey: 'files',
    singularKeys: ['file'],
    isEntry: isDeleteCodeEntry,
  });
}
