/** @jsxImportSource @opentui/react */

/**
 * diff 审批视图
 *
 * 支持 apply_diff / write_file / insert_code / delete_code / search_in_files(replace) 的预览。
 */

import React, { useMemo } from 'react';
import * as fs from 'fs';
import * as path from 'path';
import type { ToolInvocation, ToolPreviewUtilsLike, UnifiedDiffHunkLike, UnifiedDiffLineLike, WriteEntryLike, InsertEntryLike, DeleteCodeEntryLike } from '@irises/extension-sdk';
import { C } from '../theme';

// ============ 类型 ============

interface DiffApprovalViewProps {
  invocation: ToolInvocation;
  pendingCount: number;
  choice: 'approve' | 'reject';
  view: 'unified' | 'split';
  showLineNumbers: boolean;
  wrapMode: 'none' | 'word';
  previewIndex?: number;
  toolPreviewUtils: ToolPreviewUtilsLike;
}

interface DiffPreviewItem {
  id: string;
  filePath: string;
  label: string;
  diff?: string;
  filetype?: string;
  message?: string;
}

interface DiffApprovalPreview {
  title: string;
  toolLabel: string;
  summary: string[];
  items: DiffPreviewItem[];
}

// ============ 常量 ============

const DEFAULT_SEARCH_PATTERN = '**/*';
const DEFAULT_SEARCH_MAX_FILES = 50;
const DEFAULT_SEARCH_MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024;

// ============ 工具函数 ============

function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
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
  return out.join('\n').trim();
}

function getSafePatch(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}

function toDiffLinePrefix(type: 'context' | 'add' | 'del'): string {
  if (type === 'add') return '+';
  if (type === 'del') return '-';
  return ' ';
}

function buildDisplayDiff(filePath: string, patch: string, utils: ToolPreviewUtilsLike): string {
  const cleaned = sanitizePatchText(patch);
  if (!cleaned) return '';
  try {
    const parsed = utils.parseUnifiedDiff(cleaned);
    const fallbackOld = `a/${filePath || 'file'}`;
    const fallbackNew = `b/${filePath || 'file'}`;
    const body = parsed.hunks
      .map((hunk: UnifiedDiffHunkLike) => {
        const lines = hunk.lines.map((line: UnifiedDiffLineLike) => `${toDiffLinePrefix(line.type)}${line.content}`);
        // Recalculate correct line counts from actual parsed lines
        const oldCount = hunk.lines.filter((l: UnifiedDiffLineLike) => l.type === 'context' || l.type === 'del').length;
        const newCount = hunk.lines.filter((l: UnifiedDiffLineLike) => l.type === 'context' || l.type === 'add').length;
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

function toWholeFileDiffLines(text: string): string[] {
  if (!text) return [];
  const lines = normalizeLineEndings(text).split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

function buildWholeFileDiff(filePath: string, before: string, after: string, existed: boolean): string {
  if (before === after) return '';
  const beforeLines = toWholeFileDiffLines(before);
  const afterLines = toWholeFileDiffLines(after);
  const bodyLines = [
    ...beforeLines.map(line => `-${line}`),
    ...afterLines.map(line => `+${line}`),
  ];
  if (bodyLines.length === 0) return '';
  const oldFile = existed ? `a/${filePath}` : '/dev/null';
  return [
    `--- ${oldFile}`,
    `+++ b/${filePath}`,
    `@@ -${beforeLines.length > 0 ? 1 : 0},${beforeLines.length} +${afterLines.length > 0 ? 1 : 0},${afterLines.length} @@`,
    ...bodyLines,
  ].join('\n');
}

function createMsg(id: string, filePath: string, label: string, message: string): DiffPreviewItem {
  return { id, filePath, label, filetype: inferFiletype(filePath), message };
}

// ============ apply_diff 预览 ============

function buildApplyDiffPreview(inv: ToolInvocation, utils: ToolPreviewUtilsLike): DiffApprovalPreview {
  const filePath = typeof inv.args.path === 'string' ? inv.args.path : '';
  const rawPatch = getSafePatch(inv.args.patch);
  const displayDiff = buildDisplayDiff(filePath, rawPatch, utils);
  return {
    title: 'Diff 审批', toolLabel: 'apply_diff',
    summary: [filePath ? `目标文件：${filePath}` : '目标文件：未提供'],
    items: [displayDiff
      ? { id: `${inv.id}:apply_diff`, filePath, label: filePath || '补丁预览', diff: displayDiff, filetype: inferFiletype(filePath) }
      : createMsg(`${inv.id}:apply_diff.empty`, filePath, filePath || '补丁预览', '当前补丁为空，无法显示 diff。')],
  };
}

// ============ write_file 预览 ============

function buildWriteFilePreview(inv: ToolInvocation, utils: ToolPreviewUtilsLike): DiffApprovalPreview {
  const fileList = utils.normalizeWriteArgs(inv.args);
  if (!fileList || fileList.length === 0) {
    return {
      title: 'Diff 审批', toolLabel: 'write_file',
      summary: ['参数不完整，无法生成 write_file 预览。'],
      items: [createMsg(`${inv.id}:write_file.invalid`, '', 'write_file', 'files 参数无效。')],
    };
  }
  const items: DiffPreviewItem[] = [];
  let created = 0, modified = 0, unchanged = 0, errored = 0;
  fileList.forEach((entry: WriteEntryLike, i: number) => {
    try {
      const resolved = utils.resolveProjectPath(entry.path);
      let existed = false, before = '';
      if (fs.existsSync(resolved)) { before = fs.readFileSync(resolved, 'utf-8'); existed = true; }
      if (existed && before === entry.content) { unchanged++; return; }
      const diff = buildWholeFileDiff(entry.path, before, entry.content, existed);
      const action = existed ? '修改' : '新增';
      items.push(diff
        ? { id: `${inv.id}:write_file:${i}`, filePath: entry.path, label: `${entry.path} · ${action}`, diff, filetype: inferFiletype(entry.path) }
        : createMsg(`${inv.id}:write_file:${i}`, entry.path, `${entry.path} · ${action}`, existed ? '内容变化特殊，无法显示 diff。' : '将创建空文件。'));
      if (existed) modified++; else created++;
    } catch (err: unknown) {
      errored++;
      items.push(createMsg(`${inv.id}:write_file:${i}`, entry.path, `${entry.path} · 预览失败`, err instanceof Error ? err.message : String(err)));
    }
  });
  const summary = [`共 ${fileList.length} 个文件`, `新增 ${created}，修改 ${modified}，未变化 ${unchanged}`];
  if (errored > 0) summary.push(`${errored} 个文件无法生成预览`);
  if (items.length === 0) items.push(createMsg(`${inv.id}:write_file.empty`, '', 'write_file', '本次 write_file 不会产生实际变更。'));
  return { title: 'Diff 审批', toolLabel: 'write_file', summary, items };
}

// ============ insert_code 预览 ============

function buildInsertCodePreview(inv: ToolInvocation, utils: ToolPreviewUtilsLike): DiffApprovalPreview {
  const fileList = utils.normalizeInsertArgs(inv.args);
  if (!fileList || fileList.length === 0) {
    return {
      title: 'Diff 审批', toolLabel: 'insert_code',
      summary: ['参数不完整，无法生成 insert_code 预览。'],
      items: [createMsg(`${inv.id}:insert_code.invalid`, '', 'insert_code', 'files 参数无效。')],
    };
  }
  const items: DiffPreviewItem[] = [];
  let successCount = 0, errored = 0;
  fileList.forEach((entry: InsertEntryLike, i: number) => {
    try {
      const resolved = utils.resolveProjectPath(entry.path);
      const before = fs.readFileSync(resolved, 'utf-8');
      const lines = before.split('\n');
      const insertLines = entry.content.split('\n');
      const idx = entry.line - 1;
      const after = [...lines.slice(0, idx), ...insertLines, ...lines.slice(idx)].join('\n');
      const diff = buildWholeFileDiff(entry.path, before, after, true);
      items.push(diff
        ? { id: `${inv.id}:insert_code:${i}`, filePath: entry.path, label: `${entry.path} · 第 ${entry.line} 行前插入 ${insertLines.length} 行`, diff, filetype: inferFiletype(entry.path) }
        : createMsg(`${inv.id}:insert_code:${i}`, entry.path, `${entry.path} · 插入`, '无法显示 diff。'));
      successCount++;
    } catch (err: unknown) {
      errored++;
      items.push(createMsg(`${inv.id}:insert_code:${i}`, entry.path, `${entry.path} · 预览失败`, err instanceof Error ? err.message : String(err)));
    }
  });
  const summary = [`共 ${fileList.length} 个操作`, `可预览 ${successCount} 个`];
  if (errored > 0) summary.push(`${errored} 个操作无法生成预览`);
  if (items.length === 0) items.push(createMsg(`${inv.id}:insert_code.empty`, '', 'insert_code', '无可预览的变更。'));
  return { title: 'Diff 审批', toolLabel: 'insert_code', summary, items };
}

// ============ delete_code 预览 ============

function buildDeleteCodePreview(inv: ToolInvocation, utils: ToolPreviewUtilsLike): DiffApprovalPreview {
  const fileList = utils.normalizeDeleteCodeArgs(inv.args);
  if (!fileList || fileList.length === 0) {
    return {
      title: 'Diff 审批', toolLabel: 'delete_code',
      summary: ['参数不完整，无法生成 delete_code 预览。'],
      items: [createMsg(`${inv.id}:delete_code.invalid`, '', 'delete_code', 'files 参数无效。')],
    };
  }
  const items: DiffPreviewItem[] = [];
  let successCount = 0, errored = 0;
  fileList.forEach((entry: DeleteCodeEntryLike, i: number) => {
    try {
      const resolved = utils.resolveProjectPath(entry.path);
      const before = fs.readFileSync(resolved, 'utf-8');
      const lines = before.split('\n');
      const after = [...lines.slice(0, entry.start_line - 1), ...lines.slice(entry.end_line)].join('\n');
      const deletedCount = entry.end_line - entry.start_line + 1;
      const diff = buildWholeFileDiff(entry.path, before, after, true);
      items.push(diff
        ? { id: `${inv.id}:delete_code:${i}`, filePath: entry.path, label: `${entry.path} · 删除第 ${entry.start_line}-${entry.end_line} 行（${deletedCount} 行）`, diff, filetype: inferFiletype(entry.path) }
        : createMsg(`${inv.id}:delete_code:${i}`, entry.path, `${entry.path} · 删除`, '无法显示 diff。'));
      successCount++;
    } catch (err: unknown) {
      errored++;
      items.push(createMsg(`${inv.id}:delete_code:${i}`, entry.path, `${entry.path} · 预览失败`, err instanceof Error ? err.message : String(err)));
    }
  });
  const summary = [`共 ${fileList.length} 个操作`, `可预览 ${successCount} 个`];
  if (errored > 0) summary.push(`${errored} 个操作无法生成预览`);
  if (items.length === 0) items.push(createMsg(`${inv.id}:delete_code.empty`, '', 'delete_code', '无可预览的变更。'));
  return { title: 'Diff 审批', toolLabel: 'delete_code', summary, items };
}

// ============ search_in_files.replace 预览 ============

function buildSearchReplacePreview(inv: ToolInvocation, utils: ToolPreviewUtilsLike): DiffApprovalPreview {
  const inputPath = typeof inv.args.path === 'string' ? inv.args.path : '.';
  const pattern = typeof inv.args.pattern === 'string' ? inv.args.pattern : DEFAULT_SEARCH_PATTERN;
  const isRegex = inv.args.isRegex === true;
  const query = String(inv.args.query ?? '');
  const replace = inv.args.replace;
  const maxFiles = normalizePositiveInteger(inv.args.maxFiles, DEFAULT_SEARCH_MAX_FILES);
  const maxFileSizeBytes = normalizePositiveInteger(inv.args.maxFileSizeBytes, DEFAULT_SEARCH_MAX_FILE_SIZE_BYTES);

  if (typeof replace !== 'string') {
    return {
      title: 'Diff 审批', toolLabel: 'search_in_files.replace',
      summary: ['replace 参数缺失。'],
      items: [createMsg(`${inv.id}:search_replace.invalid`, inputPath, 'search_in_files.replace', 'replace 模式下必须提供 replace 参数。')],
    };
  }

  try {
    const regex = utils.buildSearchRegex(query, isRegex);
    const rootAbs = utils.resolveProjectPath(inputPath);
    const stat = fs.statSync(rootAbs);
    const patternRe = utils.globToRegExp(pattern);

    const items: DiffPreviewItem[] = [];
    let processedFiles = 0, changedFiles = 0, unchangedFiles = 0;
    let skippedBinary = 0, skippedTooLarge = 0, totalReplacements = 0;
    let truncated = false;
    const shouldStop = () => processedFiles >= maxFiles;

    const processFile = (fileAbs: string, relPosix: string) => {
      if (shouldStop()) return;
      if (stat.isDirectory() && !patternRe.test(relPosix)) return;
      processedFiles++;
      const displayPath = stat.isDirectory() ? utils.toPosix(path.join(inputPath, relPosix)) : utils.toPosix(inputPath);
      const buf = fs.readFileSync(fileAbs);
      if (buf.length > maxFileSizeBytes) { skippedTooLarge++; return; }
      if (utils.isLikelyBinary(buf)) { skippedBinary++; return; }

      const decoded = utils.decodeText(buf);
      const countRegex = new RegExp(regex.source, regex.flags);
      let replacements = 0;
      for (;;) {
        const m = countRegex.exec(decoded.text);
        if (!m) break;
        if (m[0].length === 0) { countRegex.lastIndex++; continue; }
        replacements++;
      }
      if (replacements === 0) { unchangedFiles++; return; }

      const replaceRegex = new RegExp(regex.source, regex.flags);
      const newText = decoded.text.replace(replaceRegex, replace);
      if (newText === decoded.text) { unchangedFiles++; return; }

      const diff = buildWholeFileDiff(displayPath, decoded.text, newText, true);
      items.push(diff
        ? { id: `${inv.id}:search_replace:${displayPath}`, filePath: displayPath, label: `${displayPath} · ${replacements} 处替换`, diff, filetype: inferFiletype(displayPath) }
        : createMsg(`${inv.id}:search_replace:${displayPath}`, displayPath, `${displayPath} · ${replacements} 处替换`, '文件将变化，但无法显示 diff。'));
      changedFiles++;
      totalReplacements += replacements;
    };

    if (stat.isFile()) processFile(rootAbs, utils.toPosix(path.basename(rootAbs)));
    else { utils.walkFiles(rootAbs, processFile, shouldStop); if (processedFiles >= maxFiles) truncated = true; }

    const summary = [
      `路径 ${inputPath} · pattern ${pattern}`,
      `已处理 ${processedFiles} 个文件 · 将变更 ${changedFiles} 个文件 · 共 ${totalReplacements} 处替换`,
    ];
    if (unchangedFiles > 0) summary.push(`无实际变化 ${unchangedFiles} 个文件`);
    if (skippedBinary > 0 || skippedTooLarge > 0) summary.push(`跳过二进制 ${skippedBinary} 个 · 跳过过大文件 ${skippedTooLarge} 个`);
    if (truncated) summary.push(`已达到 maxFiles=${maxFiles}，预览已截断`);
    if (items.length === 0) items.push(createMsg(`${inv.id}:search_replace.empty`, inputPath, 'search_in_files.replace', '当前 replace 不会修改任何文件。'));

    return { title: 'Diff 审批', toolLabel: 'search_in_files.replace', summary, items };
  } catch (err: unknown) {
    return {
      title: 'Diff 审批', toolLabel: 'search_in_files.replace',
      summary: ['生成预览时发生错误。'],
      items: [createMsg(`${inv.id}:search_replace.error`, inputPath, 'search_in_files.replace', err instanceof Error ? err.message : String(err))],
    };
  }
}

// ============ 路由 ============

function buildPreview(invocation: ToolInvocation, utils: ToolPreviewUtilsLike): DiffApprovalPreview {
  switch (invocation.toolName) {
    case 'apply_diff': return buildApplyDiffPreview(invocation, utils);
    case 'write_file': return buildWriteFilePreview(invocation, utils);
    case 'insert_code': return buildInsertCodePreview(invocation, utils);
    case 'delete_code': return buildDeleteCodePreview(invocation, utils);
    case 'search_in_files':
      if (((invocation.args.mode as string | undefined) ?? 'search') === 'replace') {
        return buildSearchReplacePreview(invocation, utils);
      }
      break;
  }
  return {
    title: 'Diff 审批', toolLabel: invocation.toolName,
    summary: ['当前工具不支持 diff 审批预览。'],
    items: [createMsg(`${invocation.id}:unsupported`, '', invocation.toolName, '当前工具不支持 diff 审批预览。')],
  };
}

// ============ 组件 ============

export function DiffApprovalView({ invocation, pendingCount, choice, view, showLineNumbers, wrapMode, previewIndex = 0, toolPreviewUtils }: DiffApprovalViewProps) {
  const preview = useMemo(() => buildPreview(invocation, toolPreviewUtils), [invocation, toolPreviewUtils]);

  const normalizedPreviewIndex = preview.items.length > 0
    ? ((previewIndex % preview.items.length) + preview.items.length) % preview.items.length
    : 0;
  const currentItem = preview.items[normalizedPreviewIndex];

  return (
    <box flexDirection="column" width="100%" height="100%" padding={1} backgroundColor="#0d1117">
      {/* 头部信息 */}
      <box flexDirection="column" borderStyle="double" borderColor={C.warn} paddingX={1} paddingY={0} flexShrink={0}>
        <text>
          <span fg={C.warn}><strong>{preview.title}</strong></span>
          <span fg={C.dim}>{`  ${preview.toolLabel}`}</span>
          {pendingCount > 1 ? <span fg={C.dim}>{`  (剩余 ${pendingCount - 1} 个)`}</span> : null}
          {preview.items.length > 1 ? <span fg={C.dim}>{`  (预览 ${normalizedPreviewIndex + 1}/${preview.items.length})`}</span> : null}
        </text>
        <text>
          <span fg={C.text}>文件 </span>
          <span fg={C.primaryLight}>{currentItem?.filePath || '(未提供路径)'}</span>
          <span fg={C.dim}>{`  视图:${view === 'split' ? '分栏' : '统一'}  行号:${showLineNumbers ? '开' : '关'}  换行:${wrapMode === 'word' ? '开' : '关'}`}</span>
        </text>
        {currentItem?.label ? <text fg={C.dim}>{currentItem.label}</text> : null}
        {preview.summary.map((line: string, index: number) => (
          <text key={`${preview.toolLabel}.summary.${index}`} fg={C.dim}>{line}</text>
        ))}
      </box>

      {/* diff 内容区（带滚动条） */}
      <scrollbox
        flexGrow={1}
        flexShrink={1}
        marginTop={1}
        borderStyle="single"
        borderColor={C.border}
        verticalScrollbarOptions={{ visible: true }}
        horizontalScrollbarOptions={{ visible: false }}
      >
        {currentItem?.diff ? (
          <diff
            diff={currentItem.diff}
            view={view}
            filetype={currentItem.filetype}
            showLineNumbers={showLineNumbers}
            wrapMode={wrapMode}
            addedBg="#17361f"
            removedBg="#3b1f24"
            contextBg="#0d1117"
            lineNumberFg="#6b7280"
            lineNumberBg="#111827"
            addedLineNumberBg="#122b18"
            removedLineNumberBg="#2f161b"
            addedSignColor="#22c55e"
            removedSignColor="#ef4444"
            selectionBg="#264f78"
            selectionFg="#ffffff"
            style={{ width: '100%' }}
          />
        ) : (
          <text fg={currentItem?.message ? C.textSec : C.dim} paddingX={1} paddingY={1}>
            {currentItem?.message ?? '当前补丁为空，无法显示 diff。'}
          </text>
        )}
      </scrollbox>

      {/* 底部操作区 */}
      <box flexDirection="column" marginTop={1} borderStyle="single" borderColor={choice === 'approve' ? C.accent : C.error} paddingX={1} paddingY={0} flexShrink={0}>
        <text>
          <span fg={C.text}>审批结果 </span>
          <span fg={choice === 'approve' ? C.accent : C.textSec}>{choice === 'approve' ? '[批准]' : ' 批准 '}</span>
          <span fg={C.dim}> </span>
          <span fg={choice === 'reject' ? C.error : C.textSec}>{choice === 'reject' ? '[拒绝]' : ' 拒绝 '}</span>
        </text>
        <text fg={C.dim}>
          {preview.items.length > 1 ? '↑ / ↓ 切换文件　' : ''}
          Tab / ← / → 切换　Enter 确认　Y 批准　N 拒绝　V 切换视图　L 切换行号　W 切换换行　Esc 中断本次生成
        </text>
      </box>
    </box>
  );
}
