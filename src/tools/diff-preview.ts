/**
 * Session-aware diff preview builders for edit-like tools.
 *
 * This module is used by Backend.getToolDiffPreview so UI platforms do not need
 * to read files locally or duplicate dry-run logic.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ToolDiffPreviewItemLike, ToolDiffPreviewResponseLike } from 'irises-extension-sdk/plugin';
import {
  buildSearchRegex,
  decodeText,
  isLikelyBinary,
  normalizeDeleteCodeArgs,
  normalizeInsertArgs,
  normalizeWriteArgs,
  parseUnifiedDiff,
  applySearchReplaceBestEffort,
  applyUnifiedDiffBestEffort,
  convertHunksToSearchReplace,
  parseLoosePatchToSearchReplace,
  resolveProjectPath as resolveProjectPathRaw,
} from 'irises-extension-sdk/tool-utils';
import { collectSearchFiles, normalizeSearchGlobArgs } from './internal/search_in_files';
import type {
  DeleteCodeEntry,
  InsertEntry,
  UnifiedDiffHunk,
  UnifiedDiffLine,
  WriteEntry,
} from 'irises-extension-sdk/tool-utils';
import type { ToolInvocation } from '../types/tool';
import { applyDeleteCodeTransform, applyInsertCodeTransform } from './edit-transforms';
import { getToolLimits } from './tool-limits';

const DEFAULT_DIFF_CONTEXT_LINES = 3;
const MAX_LCS_CELLS = 1_000_000;

export interface BuildPreviewOptions {
  cwd: string;
}

type DiffOpType = 'ctx' | 'add' | 'del';

interface RawDiffOp {
  type: DiffOpType;
  content: string;
}

interface NumberedDiffOp extends RawDiffOp {
  /** Next old line number before this op is applied. */
  oldPos: number;
  /** Next new line number before this op is applied. */
  newPos: number;
  oldNum?: number;
  newNum?: number;
}

function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function splitLinesForDiff(text: string): string[] {
  if (!text) return [];
  const lines = normalizeLineEndings(text).split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

function diffSegment(oldLines: string[], newLines: string[]): RawDiffOp[] {
  if (oldLines.length === 0) return newLines.map(content => ({ type: 'add', content }));
  if (newLines.length === 0) return oldLines.map(content => ({ type: 'del', content }));

  // For very large unrelated regions, avoid quadratic memory/time blowups. A full
  // replace is acceptable here because common prefix/suffix has already been
  // stripped, so small localized edits still produce precise hunks.
  if (oldLines.length * newLines.length > MAX_LCS_CELLS) {
    return [
      ...oldLines.map(content => ({ type: 'del' as const, content })),
      ...newLines.map(content => ({ type: 'add' as const, content })),
    ];
  }

  const rows = oldLines.length + 1;
  const cols = newLines.length + 1;
  const dp = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));

  for (let i = oldLines.length - 1; i >= 0; i--) {
    for (let j = newLines.length - 1; j >= 0; j--) {
      dp[i][j] = oldLines[i] === newLines[j]
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const ops: RawDiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < oldLines.length && j < newLines.length) {
    if (oldLines[i] === newLines[j]) {
      ops.push({ type: 'ctx', content: oldLines[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: 'del', content: oldLines[i] });
      i++;
    } else {
      ops.push({ type: 'add', content: newLines[j] });
      j++;
    }
  }
  while (i < oldLines.length) ops.push({ type: 'del', content: oldLines[i++] });
  while (j < newLines.length) ops.push({ type: 'add', content: newLines[j++] });
  return ops;
}

function buildRawDiffOps(beforeLines: string[], afterLines: string[]): RawDiffOp[] {
  let prefix = 0;
  while (
    prefix < beforeLines.length
    && prefix < afterLines.length
    && beforeLines[prefix] === afterLines[prefix]
  ) {
    prefix++;
  }

  let oldEnd = beforeLines.length;
  let newEnd = afterLines.length;
  while (
    oldEnd > prefix
    && newEnd > prefix
    && beforeLines[oldEnd - 1] === afterLines[newEnd - 1]
  ) {
    oldEnd--;
    newEnd--;
  }

  const ops: RawDiffOp[] = [];
  for (let i = 0; i < prefix; i++) ops.push({ type: 'ctx', content: beforeLines[i] });
  ops.push(...diffSegment(beforeLines.slice(prefix, oldEnd), afterLines.slice(prefix, newEnd)));
  for (let i = oldEnd; i < beforeLines.length; i++) ops.push({ type: 'ctx', content: beforeLines[i] });
  return ops;
}

function numberDiffOps(rawOps: RawDiffOp[]): NumberedDiffOp[] {
  let oldLine = 1;
  let newLine = 1;
  return rawOps.map((op) => {
    const base = { ...op, oldPos: oldLine, newPos: newLine };
    if (op.type === 'ctx') {
      const numbered: NumberedDiffOp = { ...base, oldNum: oldLine, newNum: newLine };
      oldLine++;
      newLine++;
      return numbered;
    }
    if (op.type === 'del') {
      const numbered: NumberedDiffOp = { ...base, oldNum: oldLine };
      oldLine++;
      return numbered;
    }
    const numbered: NumberedDiffOp = { ...base, newNum: newLine };
    newLine++;
    return numbered;
  });
}

function hunkRanges(ops: NumberedDiffOp[], contextLines: number): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  for (let i = 0; i < ops.length; i++) {
    if (ops[i].type === 'ctx') continue;
    const start = Math.max(0, i - contextLines);
    const end = Math.min(ops.length, i + contextLines + 1);
    const last = ranges[ranges.length - 1];
    if (last && start <= last.end) {
      last.end = Math.max(last.end, end);
    } else {
      ranges.push({ start, end });
    }
  }
  return ranges;
}

function formatRangeStart(start: number, count: number): string {
  return `${Math.max(0, start)},${count}`;
}

function formatHunk(ops: NumberedDiffOp[]): string {
  const oldCount = ops.filter(op => op.type !== 'add').length;
  const newCount = ops.filter(op => op.type !== 'del').length;
  const first = ops[0];
  const firstOldNum = ops.find(op => op.oldNum !== undefined)?.oldNum;
  const firstNewNum = ops.find(op => op.newNum !== undefined)?.newNum;
  const oldStart = oldCount > 0 ? (firstOldNum ?? 0) : Math.max(0, first.oldPos - 1);
  const newStart = newCount > 0 ? (firstNewNum ?? 0) : Math.max(0, first.newPos - 1);
  const lines = ops.map((op) => {
    if (op.type === 'add') return `+${op.content}`;
    if (op.type === 'del') return `-${op.content}`;
    return ` ${op.content}`;
  });
  return [
    `@@ -${formatRangeStart(oldStart, oldCount)} +${formatRangeStart(newStart, newCount)} @@`,
    ...lines,
  ].join('\n');
}

export function countDiffStats(diff: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('@@')) continue;
    if (line.startsWith('+')) added++;
    else if (line.startsWith('-')) removed++;
  }
  return { added, removed };
}

export function buildUnifiedLineDiff(
  filePath: string,
  before: string,
  after: string,
  existed: boolean,
  contextLines = DEFAULT_DIFF_CONTEXT_LINES,
): string {
  if (before === after) return '';
  const beforeLines = splitLinesForDiff(before);
  const afterLines = splitLinesForDiff(after);
  const ops = numberDiffOps(buildRawDiffOps(beforeLines, afterLines));
  const ranges = hunkRanges(ops, contextLines);
  if (ranges.length === 0) return '';
  const oldFile = existed ? `a/${filePath}` : '/dev/null';
  const hunks = ranges.map(range => formatHunk(ops.slice(range.start, range.end)));
  return [`--- ${oldFile}`, `+++ b/${filePath}`, ...hunks].join('\n');
}

function inferFiletype(filePath: string): string | undefined {
  const ext = filePath.toLowerCase().match(/\.[^.\\/]+$/)?.[0] ?? '';
  const map: Record<string, string> = {
    '.ts': 'typescript', '.tsx': 'typescript',
    '.js': 'javascript', '.jsx': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
    '.json': 'json', '.md': 'markdown', '.markdown': 'markdown',
    '.yaml': 'yaml', '.yml': 'yaml', '.css': 'css',
    '.html': 'html', '.htm': 'html', '.py': 'python',
    '.sh': 'bash', '.rs': 'rust', '.go': 'go',
    '.java': 'java', '.sql': 'sql',
  };
  return map[ext];
}

function normalizePositiveInteger(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value > 0
    ? value : fallback;
}

function resolveProjectPath(inputPath: string, cwd: string): string {
  return resolveProjectPathRaw(inputPath, cwd);
}

function createMsg(id: string, filePath: string, label: string, message: string): ToolDiffPreviewItemLike {
  return { id, filePath, label, filetype: inferFiletype(filePath), added: 0, removed: 0, message };
}

function createItem(
  id: string,
  filePath: string,
  label: string,
  diff: string,
  beforeText?: string,
  afterText?: string,
): ToolDiffPreviewItemLike {
  const { added, removed } = countDiffStats(diff);
  return {
    id, filePath, label, diff, filetype: inferFiletype(filePath), added, removed,
    ...(beforeText !== undefined && afterText !== undefined ? { beforeText, afterText } : {}),
  };
}

function toDiffLinePrefix(type: 'context' | 'add' | 'del'): string {
  if (type === 'add') return '+';
  if (type === 'del') return '-';
  return ' ';
}

function sanitizePatchText(patch: string): string {
  const lines = normalizeLineEndings(patch).split('\n');
  const out: string[] = [];
  for (const line of lines) {
    if (line.startsWith('```')) continue;
    if (
      line === '***' ||
      line.startsWith('*** Begin Patch') ||
      line.startsWith('*** End Patch') ||
      line.startsWith('*** Update File:') ||
      line.startsWith('*** Add File:') ||
      line.startsWith('*** Delete File:') ||
      line.startsWith('*** End of File')
    ) continue;
    out.push(line);
  }
  return out.join('\n');
}

function getSafePatch(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}

function buildDisplayPatchDiff(filePath: string, patch: string): string {
  const cleaned = sanitizePatchText(patch);
  if (!cleaned.trim()) return '';
  try {
    const parsed = parseUnifiedDiff(cleaned);
    const fallbackOld = `a/${filePath || 'file'}`;
    const fallbackNew = `b/${filePath || 'file'}`;
    const body = parsed.hunks
      .map((hunk: UnifiedDiffHunk) => {
        const lines = hunk.lines.map((line: UnifiedDiffLine) => `${toDiffLinePrefix(line.type)}${line.content}`);
        const oldCount = hunk.lines.filter((l: UnifiedDiffLine) => l.type === 'context' || l.type === 'del').length;
        const newCount = hunk.lines.filter((l: UnifiedDiffLine) => l.type === 'context' || l.type === 'add').length;
        const header = `@@ -${hunk.oldStart},${oldCount} +${hunk.newStart},${newCount} @@`;
        return [header, ...lines].join('\n');
      })
      .join('\n');
    return [`--- ${parsed.oldFile ?? fallbackOld}`, `+++ ${parsed.newFile ?? fallbackNew}`, body]
      .filter(Boolean).join('\n');
  } catch {
    if (/^(diff --git |--- |\+\+\+ )/m.test(cleaned)) return cleaned;
    if (/^@@/m.test(cleaned)) {
      const p = filePath || 'file';
      return `--- a/${p}\n+++ b/${p}\n${cleaned}`;
    }
    return cleaned;
  }
}

function applyPatchForFullPreview(before: string, patch: string): string | undefined {
  const cleaned = sanitizePatchText(patch);
  if (!cleaned.trim()) return undefined;

  try {
    const parsed = parseUnifiedDiff(cleaned);
    const applied = applyUnifiedDiffBestEffort(before, parsed);
    let bestContent = applied.newContent;
    let appliedCount = applied.results.filter((result) => result.ok).length;

    if (appliedCount < parsed.hunks.length) {
      const srBlocks = convertHunksToSearchReplace(parsed.hunks);
      const srResult = applySearchReplaceBestEffort(before, srBlocks);
      if (srResult.appliedCount > appliedCount) {
        bestContent = srResult.newContent;
        appliedCount = srResult.appliedCount;
      }
    }

    return appliedCount > 0 ? bestContent : undefined;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.startsWith('Invalid hunk header')) return undefined;
    const looseBlocks = parseLoosePatchToSearchReplace(cleaned);
    const looseResult = applySearchReplaceBestEffort(before, looseBlocks);
    return looseResult.appliedCount > 0 ? looseResult.newContent : undefined;
  }
}

function buildApplyDiffPreview(inv: ToolInvocation, options: BuildPreviewOptions): ToolDiffPreviewResponseLike {
  const filePath = typeof inv.args.path === 'string' ? inv.args.path : '';
  const rawPatch = getSafePatch(inv.args.patch);
  const diff = buildDisplayPatchDiff(filePath, rawPatch);
  let beforeText: string | undefined;
  let afterText: string | undefined;

  if (filePath && diff) {
    try {
      const resolved = resolveProjectPath(filePath, options.cwd);
      beforeText = fs.readFileSync(resolved, 'utf-8');
      afterText = applyPatchForFullPreview(beforeText, rawPatch);
    } catch {
      beforeText = undefined;
      afterText = undefined;
    }
  }

  return {
    toolName: 'apply_diff',
    title: 'Diff 审批',
    toolLabel: 'apply_diff',
    summary: [filePath ? `目标文件：${filePath}` : '目标文件：未提供'],
    items: [diff
      ? createItem(`${inv.id}:apply_diff`, filePath, filePath || '补丁预览', diff, beforeText, afterText)
      : createMsg(`${inv.id}:apply_diff.empty`, filePath, filePath || '补丁预览', '当前补丁为空，无法显示 diff。')],
  };
}



function buildWriteFilePreview(inv: ToolInvocation, options: BuildPreviewOptions): ToolDiffPreviewResponseLike {
  const fileList = normalizeWriteArgs(inv.args);
  if (!fileList || fileList.length === 0) {
    return {
      toolName: 'write_file', title: 'Diff 审批', toolLabel: 'write_file',
      summary: ['参数不完整，无法生成 write_file 预览。'],
      items: [createMsg(`${inv.id}:write_file.invalid`, '', 'write_file', 'files/path/content 参数无效。')],
    };
  }

  const items: ToolDiffPreviewItemLike[] = [];
  let created = 0, modified = 0, unchanged = 0, errored = 0;
  fileList.forEach((entry: WriteEntry, i: number) => {
    try {
      const resolved = resolveProjectPath(entry.path, options.cwd);
      let existed = false;
      let before = '';
      if (fs.existsSync(resolved)) {
        before = fs.readFileSync(resolved, 'utf-8');
        existed = true;
      }
      if (existed && before === entry.content) { unchanged++; return; }
      const diff = buildUnifiedLineDiff(entry.path, before, entry.content, existed);
      const action = existed ? '修改' : '新增';
      items.push(diff
        ? createItem(`${inv.id}:write_file:${i}`, entry.path, `${entry.path} · ${action}`, diff, before, entry.content)
        : createMsg(`${inv.id}:write_file:${i}`, entry.path, `${entry.path} · ${action}`, existed ? '不会产生可显示的 diff。' : '将创建空文件。'));
      if (existed) modified++; else created++;
    } catch (err: unknown) {
      errored++;
      items.push(createMsg(`${inv.id}:write_file:${i}`, entry.path, `${entry.path} · 预览失败`, err instanceof Error ? err.message : String(err)));
    }
  });

  const summary = [`共 ${fileList.length} 个文件`, `新增 ${created}，修改 ${modified}，未变化 ${unchanged}`];
  if (errored > 0) summary.push(`${errored} 个文件无法生成预览`);
  if (items.length === 0) items.push(createMsg(`${inv.id}:write_file.empty`, '', 'write_file', '本次 write_file 不会产生实际变更。'));
  return { toolName: 'write_file', title: 'Diff 审批', toolLabel: 'write_file', summary, items };
}

function buildInsertCodePreview(inv: ToolInvocation, options: BuildPreviewOptions): ToolDiffPreviewResponseLike {
  const fileList = normalizeInsertArgs(inv.args);
  if (!fileList || fileList.length === 0) {
    return {
      toolName: 'insert_code', title: 'Diff 审批', toolLabel: 'insert_code',
      summary: ['参数不完整，无法生成 insert_code 预览。'],
      items: [createMsg(`${inv.id}:insert_code.invalid`, '', 'insert_code', 'files/path/line/content 参数无效。')],
    };
  }

  const items: ToolDiffPreviewItemLike[] = [];
  let successCount = 0, errored = 0;
  fileList.forEach((entry: InsertEntry, i: number) => {
    try {
      const resolved = resolveProjectPath(entry.path, options.cwd);
      const before = fs.readFileSync(resolved, 'utf-8');
      const transformed = applyInsertCodeTransform(before, entry.line, entry.content);
      const diff = buildUnifiedLineDiff(entry.path, before, transformed.newContent, true);
      items.push(diff
        ? createItem(`${inv.id}:insert_code:${i}`, entry.path, `${entry.path} · 第 ${entry.line} 行前插入 ${transformed.insertedLines} 行`, diff, before, transformed.newContent)
        : createMsg(`${inv.id}:insert_code:${i}`, entry.path, `${entry.path} · 插入`, '不会产生可显示的 diff。'));
      successCount++;
    } catch (err: unknown) {
      errored++;
      items.push(createMsg(`${inv.id}:insert_code:${i}`, entry.path, `${entry.path} · 预览失败`, err instanceof Error ? err.message : String(err)));
    }
  });

  const summary = [`共 ${fileList.length} 个操作`, `可预览 ${successCount} 个`];
  if (errored > 0) summary.push(`${errored} 个操作无法生成预览`);
  if (items.length === 0) items.push(createMsg(`${inv.id}:insert_code.empty`, '', 'insert_code', '无可预览的变更。'));
  return { toolName: 'insert_code', title: 'Diff 审批', toolLabel: 'insert_code', summary, items };
}

function buildDeleteCodePreview(inv: ToolInvocation, options: BuildPreviewOptions): ToolDiffPreviewResponseLike {
  const fileList = normalizeDeleteCodeArgs(inv.args);
  if (!fileList || fileList.length === 0) {
    return {
      toolName: 'delete_code', title: 'Diff 审批', toolLabel: 'delete_code',
      summary: ['参数不完整，无法生成 delete_code 预览。'],
      items: [createMsg(`${inv.id}:delete_code.invalid`, '', 'delete_code', 'files/path/start_line/end_line 参数无效。')],
    };
  }

  const items: ToolDiffPreviewItemLike[] = [];
  let successCount = 0, errored = 0;
  fileList.forEach((entry: DeleteCodeEntry, i: number) => {
    try {
      const resolved = resolveProjectPath(entry.path, options.cwd);
      const before = fs.readFileSync(resolved, 'utf-8');
      const transformed = applyDeleteCodeTransform(before, entry.start_line, entry.end_line);
      const diff = buildUnifiedLineDiff(entry.path, before, transformed.newContent, true);
      items.push(diff
        ? createItem(`${inv.id}:delete_code:${i}`, entry.path, `${entry.path} · 删除第 ${entry.start_line}-${entry.end_line} 行（${transformed.deletedLines} 行）`, diff, before, transformed.newContent)
        : createMsg(`${inv.id}:delete_code:${i}`, entry.path, `${entry.path} · 删除`, '不会产生可显示的 diff。'));
      successCount++;
    } catch (err: unknown) {
      errored++;
      items.push(createMsg(`${inv.id}:delete_code:${i}`, entry.path, `${entry.path} · 预览失败`, err instanceof Error ? err.message : String(err)));
    }
  });

  const summary = [`共 ${fileList.length} 个操作`, `可预览 ${successCount} 个`];
  if (errored > 0) summary.push(`${errored} 个操作无法生成预览`);
  if (items.length === 0) items.push(createMsg(`${inv.id}:delete_code.empty`, '', 'delete_code', '无可预览的变更。'));
  return { toolName: 'delete_code', title: 'Diff 审批', toolLabel: 'delete_code', summary, items };
}

function countRegexMatches(regex: RegExp, text: string): number {
  const countRegex = new RegExp(regex.source, regex.flags);
  let replacements = 0;
  for (;;) {
    const m = countRegex.exec(text);
    if (!m) break;
    if (m[0].length === 0) { countRegex.lastIndex++; continue; }
    replacements++;
  }
  return replacements;
}

function buildSearchReplacePreview(inv: ToolInvocation, options: BuildPreviewOptions): ToolDiffPreviewResponseLike {
  const scopeLabel = Array.isArray(inv.args.include)
    ? inv.args.include.map(item => String(item)).join(', ')
    : '**/*';
  const regexMode = inv.args.regex === true;
  const query = String(inv.args.query ?? '');
  const replace = inv.args.replace;
  const limits = getToolLimits().search_in_files;
  const maxFiles = Math.min(normalizePositiveInteger(inv.args.maxFiles, limits.maxFiles), limits.maxFiles);
  const maxFileSizeBytes = Math.min(normalizePositiveInteger(inv.args.maxFileSizeBytes, limits.maxFileSizeBytes), limits.maxFileSizeBytes);

  if (typeof replace !== 'string') {
    return {
      toolName: 'search_in_files', title: 'Diff 审批', toolLabel: 'search_in_files.replace',
      summary: ['replace 参数缺失。'],
      items: [createMsg(`${inv.id}:search_replace.invalid`, scopeLabel, 'search_in_files.replace', 'replace 模式下必须提供 replace 参数。')],
    };
  }

  try {
    const regex = buildSearchRegex(query, regexMode);
    const { include, effectiveExclude } = normalizeSearchGlobArgs(inv.args as Record<string, unknown>);
    const rootAbs = resolveProjectPath('.', options.cwd);
    const matchedFiles = collectSearchFiles(rootAbs, include, effectiveExclude);

    const items: ToolDiffPreviewItemLike[] = [];
    let processedFiles = 0, changedFiles = 0, unchangedFiles = 0;
    let skippedBinary = 0, skippedTooLarge = 0, totalReplacements = 0;
    const truncated = matchedFiles.length > maxFiles;

    const processFile = (fileAbs: string, relPosix: string) => {
      processedFiles++;
      const displayPath = relPosix;
      const buf = fs.readFileSync(fileAbs);
      if (buf.length > maxFileSizeBytes) { skippedTooLarge++; return; }
      if (isLikelyBinary(buf)) { skippedBinary++; return; }

      const decoded = decodeText(buf);
      const replacements = countRegexMatches(regex, decoded.text);
      if (replacements === 0) { unchangedFiles++; return; }

      const replaceRegex = new RegExp(regex.source, regex.flags);
      const newText = decoded.text.replace(replaceRegex, replace);
      if (newText === decoded.text) { unchangedFiles++; return; }

      const diff = buildUnifiedLineDiff(displayPath, decoded.text, newText, true);
      items.push(diff
        ? createItem(`${inv.id}:search_replace:${displayPath}`, displayPath, `${displayPath} · ${replacements} 处替换`, diff, decoded.text, newText)
        : createMsg(`${inv.id}:search_replace:${displayPath}`, displayPath, `${displayPath} · ${replacements} 处替换`, '文件将变化，但无法显示 diff。'));
      changedFiles++;
      totalReplacements += replacements;
    };

    for (const file of matchedFiles.slice(0, maxFiles)) {
      processFile(file.fileAbs, file.relPosix);
    }

    const summary = [
      `include ${include.join(', ')}`,
      `匹配 ${matchedFiles.length} 个文件 · 已处理 ${processedFiles} 个文件 · 将变更 ${changedFiles} 个文件 · 共 ${totalReplacements} 处替换`,
    ];
    if (unchangedFiles > 0) summary.push(`无实际变化 ${unchangedFiles} 个文件`);
    if (skippedBinary > 0 || skippedTooLarge > 0) summary.push(`跳过二进制 ${skippedBinary} 个 · 跳过过大文件 ${skippedTooLarge} 个`);
    if (truncated) summary.push(`已达到 maxFiles=${maxFiles}，预览已截断`);
    if (items.length === 0) items.push(createMsg(`${inv.id}:search_replace.empty`, scopeLabel, 'search_in_files.replace', '当前 replace 不会修改任何文件。'));

    return { toolName: 'search_in_files', title: 'Diff 审批', toolLabel: 'search_in_files.replace', summary, items };
  } catch (err: unknown) {
    return {
      toolName: 'search_in_files', title: 'Diff 审批', toolLabel: 'search_in_files.replace',
      summary: ['生成预览时发生错误。'],
      items: [createMsg(`${inv.id}:search_replace.error`, scopeLabel, 'search_in_files.replace', err instanceof Error ? err.message : String(err))],
    };
  }
}

export function buildToolDiffPreview(invocation: ToolInvocation, options: BuildPreviewOptions): ToolDiffPreviewResponseLike {
  switch (invocation.toolName) {
    case 'apply_diff': return buildApplyDiffPreview(invocation, options);
    case 'write_file': return buildWriteFilePreview(invocation, options);
    case 'insert_code': return buildInsertCodePreview(invocation, options);
    case 'delete_code': return buildDeleteCodePreview(invocation, options);
    case 'search_in_files':
      if (((invocation.args.mode as string | undefined) ?? 'search') === 'replace') {
        return buildSearchReplacePreview(invocation, options);
      }
      break;
  }
  return {
    toolName: invocation.toolName,
    title: 'Diff 审批',
    toolLabel: invocation.toolName,
    summary: ['当前工具不支持 diff 审批预览。'],
    items: [createMsg(`${invocation.id}:unsupported`, '', invocation.toolName, '当前工具不支持 diff 审批预览。')],
  };
}
