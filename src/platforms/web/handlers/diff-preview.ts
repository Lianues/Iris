/**
 * Diff 预览 API 处理器
 *
 * 为 awaiting_apply 状态的工具调用生成 diff 预览。
 * 从 TUI DiffApprovalView 移植核心逻辑。
 */

import * as fs from 'fs';
import * as path from 'path';
import type { IncomingMessage, ServerResponse } from 'http';
import { Backend } from '../../../core/backend';
import { sendJSON } from '../router';
import { parseUnifiedDiff } from '../../../tools/internal/apply_diff/unified_diff';
import { buildSearchRegex, decodeText, globToRegExp, isLikelyBinary, toPosix, walkFiles } from '../../../tools/internal/search_in_files';
import { normalizeWriteArgs } from '../../../tools/internal/write_file';
import { normalizeInsertArgs } from '../../../tools/internal/insert_code';
import { normalizeDeleteCodeArgs } from '../../../tools/internal/delete_code';
import { resolveProjectPath } from '../../../tools/utils';
import type { ToolInvocation } from '../../../types';

// ---- 类型 ----

interface DiffPreviewItem {
  filePath: string;
  label: string;
  diff?: string;
  added: number;
  removed: number;
  message?: string;
}

interface DiffPreviewResponse {
  toolName: string;
  title: string;
  summary: string[];
  items: DiffPreviewItem[];
}

// ---- 工具函数 ----

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

function buildDisplayDiff(filePath: string, patch: string): string {
  const cleaned = sanitizePatchText(patch);
  if (!cleaned) return '';
  try {
    const parsed = parseUnifiedDiff(cleaned);
    const fallbackOld = `a/${filePath || 'file'}`;
    const fallbackNew = `b/${filePath || 'file'}`;
    const body = parsed.hunks
      .map(hunk => {
        const lines = hunk.lines.map(line => `${toDiffLinePrefix(line.type)}${line.content}`);
        return [hunk.header, ...lines].join('\n');
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

function countDiffStats(diff: string): { added: number; removed: number } {
  let added = 0, removed = 0;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('@@')) continue;
    if (line.startsWith('+')) added++;
    else if (line.startsWith('-')) removed++;
  }
  return { added, removed };
}

function normalizePositiveInteger(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value > 0
    ? value : fallback;
}

function makeItem(filePath: string, label: string, diff: string): DiffPreviewItem {
  const { added, removed } = countDiffStats(diff);
  return { filePath, label, diff, added, removed };
}

function makeMsg(filePath: string, label: string, message: string): DiffPreviewItem {
  return { filePath, label, added: 0, removed: 0, message };
}

// ---- 各工具预览生成 ----

function buildApplyDiffPreview(inv: ToolInvocation): DiffPreviewResponse {
  const filePath = typeof inv.args.path === 'string' ? inv.args.path : '';
  const rawPatch = getSafePatch(inv.args.patch);
  const diff = buildDisplayDiff(filePath, rawPatch);
  return {
    toolName: 'apply_diff', title: 'Diff 审批',
    summary: [filePath ? `目标文件：${filePath}` : '目标文件：未提供'],
    items: [diff ? makeItem(filePath, filePath || '补丁预览', diff) : makeMsg(filePath, filePath || '补丁预览', '补丁为空。')],
  };
}

function buildWriteFilePreview(inv: ToolInvocation): DiffPreviewResponse {
  const fileList = normalizeWriteArgs(inv.args);
  if (!fileList || fileList.length === 0) {
    return { toolName: 'write_file', title: 'Diff 审批', summary: ['参数无效。'], items: [makeMsg('', 'write_file', 'files 参数无效。')] };
  }
  const items: DiffPreviewItem[] = [];
  let created = 0, modified = 0, unchanged = 0;
  for (const entry of fileList) {
    try {
      const resolved = resolveProjectPath(entry.path);
      let existed = false, before = '';
      if (fs.existsSync(resolved)) { before = fs.readFileSync(resolved, 'utf-8'); existed = true; }
      if (existed && before === entry.content) { unchanged++; continue; }
      const diff = buildWholeFileDiff(entry.path, before, entry.content, existed);
      const action = existed ? '修改' : '新增';
      items.push(diff ? makeItem(entry.path, `${entry.path} · ${action}`, diff) : makeMsg(entry.path, `${entry.path} · ${action}`, existed ? '无法显示 diff。' : '将创建空文件。'));
      if (existed) modified++; else created++;
    } catch (err: unknown) {
      items.push(makeMsg(entry.path, `${entry.path} · 错误`, err instanceof Error ? err.message : String(err)));
    }
  }
  const summary = [`共 ${fileList.length} 个文件`, `新增 ${created}，修改 ${modified}，未变化 ${unchanged}`];
  if (items.length === 0) items.push(makeMsg('', 'write_file', '不会产生实际变更。'));
  return { toolName: 'write_file', title: 'Diff 审批', summary, items };
}

function buildInsertCodePreview(inv: ToolInvocation): DiffPreviewResponse {
  const fileList = normalizeInsertArgs(inv.args);
  if (!fileList || fileList.length === 0) {
    return { toolName: 'insert_code', title: 'Diff 审批', summary: ['参数无效。'], items: [makeMsg('', 'insert_code', 'files 参数无效。')] };
  }
  const items: DiffPreviewItem[] = [];
  for (const entry of fileList) {
    try {
      const resolved = resolveProjectPath(entry.path);
      const before = fs.readFileSync(resolved, 'utf-8');
      const lines = before.split('\n');
      const insertLines = entry.content.split('\n');
      const idx = entry.line - 1;
      const after = [...lines.slice(0, idx), ...insertLines, ...lines.slice(idx)].join('\n');
      const diff = buildWholeFileDiff(entry.path, before, after, true);
      items.push(diff ? makeItem(entry.path, `${entry.path} · 第 ${entry.line} 行前插入`, diff) : makeMsg(entry.path, entry.path, '无法显示 diff。'));
    } catch (err: unknown) {
      items.push(makeMsg(entry.path, `${entry.path} · 错误`, err instanceof Error ? err.message : String(err)));
    }
  }
  if (items.length === 0) items.push(makeMsg('', 'insert_code', '无可预览的变更。'));
  return { toolName: 'insert_code', title: 'Diff 审批', summary: [`共 ${fileList.length} 个操作`], items };
}

function buildDeleteCodePreview(inv: ToolInvocation): DiffPreviewResponse {
  const fileList = normalizeDeleteCodeArgs(inv.args);
  if (!fileList || fileList.length === 0) {
    return { toolName: 'delete_code', title: 'Diff 审批', summary: ['参数无效。'], items: [makeMsg('', 'delete_code', 'files 参数无效。')] };
  }
  const items: DiffPreviewItem[] = [];
  for (const entry of fileList) {
    try {
      const resolved = resolveProjectPath(entry.path);
      const before = fs.readFileSync(resolved, 'utf-8');
      const lines = before.split('\n');
      const after = [...lines.slice(0, entry.start_line - 1), ...lines.slice(entry.end_line)].join('\n');
      const diff = buildWholeFileDiff(entry.path, before, after, true);
      items.push(diff ? makeItem(entry.path, `${entry.path} · 删除 L${entry.start_line}-${entry.end_line}`, diff) : makeMsg(entry.path, entry.path, '无法显示 diff。'));
    } catch (err: unknown) {
      items.push(makeMsg(entry.path, `${entry.path} · 错误`, err instanceof Error ? err.message : String(err)));
    }
  }
  if (items.length === 0) items.push(makeMsg('', 'delete_code', '无可预览的变更。'));
  return { toolName: 'delete_code', title: 'Diff 审批', summary: [`共 ${fileList.length} 个操作`], items };
}

function buildSearchReplacePreview(inv: ToolInvocation): DiffPreviewResponse {
  const inputPath = typeof inv.args.path === 'string' ? inv.args.path : '.';
  const pattern = typeof inv.args.pattern === 'string' ? inv.args.pattern : '**/*';
  const isRegex = inv.args.isRegex === true;
  const query = String(inv.args.query ?? '');
  const replace = inv.args.replace;
  const maxFiles = normalizePositiveInteger(inv.args.maxFiles, 50);
  const maxFileSizeBytes = normalizePositiveInteger(inv.args.maxFileSizeBytes, 2 * 1024 * 1024);

  if (typeof replace !== 'string') {
    return { toolName: 'search_in_files', title: 'Diff 审批', summary: ['缺少 replace 参数。'], items: [makeMsg(inputPath, 'search_in_files', '缺少 replace 参数。')] };
  }

  try {
    const regex = buildSearchRegex(query, isRegex);
    const rootAbs = resolveProjectPath(inputPath);
    const stat = fs.statSync(rootAbs);
    const patternRe = globToRegExp(pattern);

    const items: DiffPreviewItem[] = [];
    let processedFiles = 0, totalReplacements = 0;
    const shouldStop = () => processedFiles >= maxFiles;

    const processFile = (fileAbs: string, relPosix: string) => {
      if (shouldStop()) return;
      if (stat.isDirectory() && !patternRe.test(relPosix)) return;
      processedFiles++;
      const displayPath = stat.isDirectory() ? toPosix(path.join(inputPath, relPosix)) : toPosix(inputPath);
      const buf = fs.readFileSync(fileAbs);
      if (buf.length > maxFileSizeBytes || isLikelyBinary(buf)) return;

      const decoded = decodeText(buf);
      const replaceRegex = new RegExp(regex.source, regex.flags);
      const newText = decoded.text.replace(replaceRegex, replace);
      if (newText === decoded.text) return;

      // 统计替换次数
      const countRegex = new RegExp(regex.source, regex.flags);
      let replacements = 0;
      for (;;) {
        const m = countRegex.exec(decoded.text);
        if (!m) break;
        if (m[0].length === 0) { countRegex.lastIndex++; continue; }
        replacements++;
      }

      const diff = buildWholeFileDiff(displayPath, decoded.text, newText, true);
      if (diff) {
        items.push(makeItem(displayPath, `${displayPath} · ${replacements} 处替换`, diff));
        totalReplacements += replacements;
      }
    };

    if (stat.isFile()) processFile(rootAbs, toPosix(path.basename(rootAbs)));
    else walkFiles(rootAbs, processFile, shouldStop);

    const summary = [`路径 ${inputPath}`, `共 ${totalReplacements} 处替换，${items.length} 个文件变更`];
    if (items.length === 0) items.push(makeMsg(inputPath, 'search_in_files', '不会修改任何文件。'));
    return { toolName: 'search_in_files', title: 'Diff 审批', summary, items };
  } catch (err: unknown) {
    return { toolName: 'search_in_files', title: 'Diff 审批', summary: ['生成预览失败。'], items: [makeMsg(inputPath, 'search_in_files', err instanceof Error ? err.message : String(err))] };
  }
}

function buildPreview(inv: ToolInvocation): DiffPreviewResponse {
  switch (inv.toolName) {
    case 'apply_diff': return buildApplyDiffPreview(inv);
    case 'write_file': return buildWriteFilePreview(inv);
    case 'insert_code': return buildInsertCodePreview(inv);
    case 'delete_code': return buildDeleteCodePreview(inv);
    case 'search_in_files':
      if (((inv.args.mode as string | undefined) ?? 'search') === 'replace') {
        return buildSearchReplacePreview(inv);
      }
      break;
  }
  return { toolName: inv.toolName, title: 'Diff 审批', summary: ['此工具不支持 diff 预览。'], items: [makeMsg('', inv.toolName, '此工具不支持 diff 预览。')] };
}

// ---- HTTP Handler ----

export function createDiffPreviewHandler(backend: Backend) {
  return async (_req: IncomingMessage, res: ServerResponse, params: Record<string, string>) => {
    const toolId = params.id;
    if (!toolId) {
      sendJSON(res, 400, { error: '缺少工具 ID' });
      return;
    }

    const inv = backend.getToolState().get(toolId);
    if (!inv) {
      sendJSON(res, 404, { error: '未找到工具调用' });
      return;
    }

    try {
      const preview = buildPreview(inv);
      sendJSON(res, 200, preview);
    } catch (err: unknown) {
      sendJSON(res, 500, { error: err instanceof Error ? err.message : '生成 diff 预览失败' });
    }
  };
}
