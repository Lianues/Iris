/**
 * Diff 预览 API 处理器
 *
 * 为 awaiting_apply 状态的工具调用生成 diff 预览。
 * 通过 IrisAPI.toolPreviewUtils 获取工具函数，不直接引用 src/ 内部模块。
 */

import * as fs from 'fs';
import * as path from 'path';
import type { IncomingMessage, ServerResponse } from 'http';
import type { IrisBackendLike, ToolPreviewUtilsLike } from '@irises/extension-sdk';
import { sendJSON } from '../router';

// ---- 类型 ----

interface ToolInvocationLike {
  id: string;
  toolName: string;
  status: string;
  args: Record<string, unknown>;
}

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

function buildApplyDiffPreview(inv: ToolInvocationLike, utils: ToolPreviewUtilsLike): DiffPreviewResponse {
  const filePath = typeof inv.args.path === 'string' ? inv.args.path : '';
  const rawPatch = getSafePatch(inv.args.patch);

  // 使用 utils.parseUnifiedDiff 构建显示 diff
  const cleaned = sanitizePatchText(rawPatch);
  let diff = '';
  if (cleaned) {
    try {
      const parsed = utils.parseUnifiedDiff(cleaned);
      const fallbackOld = `a/${filePath || 'file'}`;
      const fallbackNew = `b/${filePath || 'file'}`;
      const body = parsed.hunks
        .map(hunk => {
          const lines = hunk.lines.map(line => `${toDiffLinePrefix(line.type)}${line.content}`);
          const oldCount = hunk.lines.filter(l => l.type === 'context' || l.type === 'del').length;
          const newCount = hunk.lines.filter(l => l.type === 'context' || l.type === 'add').length;
          const header = `@@ -${hunk.oldStart},${oldCount} +${hunk.newStart},${newCount} @@`;
          return [header, ...lines].join('\n');
        })
        .join('\n');
      diff = [`--- ${parsed.oldFile ?? fallbackOld}`, `+++ ${parsed.newFile ?? fallbackNew}`, body]
        .filter(Boolean).join('\n');
    } catch {
      if (/^(diff --git |--- |\+\+\+ )/m.test(cleaned)) diff = cleaned;
      else if (/^@@/m.test(cleaned)) {
        const p = filePath || 'file';
        diff = `--- a/${p}\n+++ b/${p}\n${cleaned}`;
      } else diff = cleaned;
    }
  }

  return {
    toolName: 'apply_diff', title: 'Diff 审批',
    summary: [filePath ? `目标文件：${filePath}` : '目标文件：未提供'],
    items: [diff ? makeItem(filePath, filePath || '补丁预览', diff) : makeMsg(filePath, filePath || '补丁预览', '补丁为空。')],
  };
}

function buildWriteFilePreview(inv: ToolInvocationLike, utils: ToolPreviewUtilsLike): DiffPreviewResponse {
  const filePath = (inv.args as Record<string, unknown>).path as string | undefined;
  const content = (inv.args as Record<string, unknown>).content as string | undefined;
  if (!filePath) {
    return { toolName: 'write_file', title: 'Diff 审批', summary: ['参数无效。'], items: [makeMsg('', 'write_file', 'path 参数无效。')] };
  }
  try {
    const resolved = utils.resolveProjectPath(filePath);
    let existed = false, before = '';
    if (fs.existsSync(resolved)) { before = fs.readFileSync(resolved, 'utf-8'); existed = true; }
    if (existed && before === (content ?? '')) {
      return { toolName: 'write_file', title: 'Diff 审批', summary: [`目标文件：${filePath}`, '未变化'], items: [makeMsg(filePath, 'write_file', '不会产生实际变更。')] };
    }
    const diff = buildWholeFileDiff(filePath, before, content ?? '', existed);
    const action = existed ? '修改' : '新增';
    const item = diff ? makeItem(filePath, `${filePath} · ${action}`, diff) : makeMsg(filePath, `${filePath} · ${action}`, existed ? '无法显示 diff。' : '将创建空文件。');
    return { toolName: 'write_file', title: 'Diff 审批', summary: [`目标文件：${filePath}`, action], items: [item] };
  } catch (err: unknown) {
    return { toolName: 'write_file', title: 'Diff 审批', summary: ['错误'], items: [makeMsg(filePath, `${filePath} · 错误`, err instanceof Error ? err.message : String(err))] };
  }
}

function buildInsertCodePreview(inv: ToolInvocationLike, utils: ToolPreviewUtilsLike): DiffPreviewResponse {
  const a = inv.args as Record<string, unknown>;
  const filePath = a.path as string | undefined;
  const line = a.line as number | undefined;
  const content = a.content as string | undefined;
  if (!filePath || line == null) {
    return { toolName: 'insert_code', title: 'Diff 审批', summary: ['参数无效。'], items: [makeMsg('', 'insert_code', 'path/line 参数无效。')] };
  }
  try {
    const resolved = utils.resolveProjectPath(filePath);
    const before = fs.readFileSync(resolved, 'utf-8');
    const lines = before.split('\n');
    const insertLines = (content ?? '').split('\n');
    const idx = line - 1;
    const after = [...lines.slice(0, idx), ...insertLines, ...lines.slice(idx)].join('\n');
    const diff = buildWholeFileDiff(filePath, before, after, true);
    const item = diff ? makeItem(filePath, `${filePath} · 第 ${line} 行前插入`, diff) : makeMsg(filePath, filePath, '无法显示 diff。');
    return { toolName: 'insert_code', title: 'Diff 审批', summary: [`目标文件：${filePath}`, `第 ${line} 行前插入`], items: [item] };
  } catch (err: unknown) {
    return { toolName: 'insert_code', title: 'Diff 审批', summary: ['错误'], items: [makeMsg(filePath, `${filePath} · 错误`, err instanceof Error ? err.message : String(err))] };
  }
}

function buildDeleteCodePreview(inv: ToolInvocationLike, utils: ToolPreviewUtilsLike): DiffPreviewResponse {
  const a = inv.args as Record<string, unknown>;
  const filePath = a.path as string | undefined;
  const startLine = a.start_line as number | undefined;
  const endLine = a.end_line as number | undefined;
  if (!filePath || startLine == null || endLine == null) {
    return { toolName: 'delete_code', title: 'Diff 审批', summary: ['参数无效。'], items: [makeMsg('', 'delete_code', 'path/start_line/end_line 参数无效。')] };
  }
  try {
    const resolved = utils.resolveProjectPath(filePath);
    const before = fs.readFileSync(resolved, 'utf-8');
    const lines = before.split('\n');
    const after = [...lines.slice(0, startLine - 1), ...lines.slice(endLine)].join('\n');
    const diff = buildWholeFileDiff(filePath, before, after, true);
    const item = diff ? makeItem(filePath, `${filePath} · 删除 L${startLine}-${endLine}`, diff) : makeMsg(filePath, filePath, '无法显示 diff。');
    return { toolName: 'delete_code', title: 'Diff 审批', summary: [`目标文件：${filePath}`, `删除 L${startLine}-${endLine}`], items: [item] };
  } catch (err: unknown) {
    return { toolName: 'delete_code', title: 'Diff 审批', summary: ['错误'], items: [makeMsg(filePath, `${filePath} · 错误`, err instanceof Error ? err.message : String(err))] };
  }
}

function buildSearchReplacePreview(inv: ToolInvocationLike, utils: ToolPreviewUtilsLike): DiffPreviewResponse {
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
    const regex = utils.buildSearchRegex(query, isRegex);
    const rootAbs = utils.resolveProjectPath(inputPath);
    const stat = fs.statSync(rootAbs);
    const patternRe = utils.globToRegExp(pattern);

    const items: DiffPreviewItem[] = [];
    let processedFiles = 0, totalReplacements = 0;
    const shouldStop = () => processedFiles >= maxFiles;

    const processFile = (fileAbs: string, relPosix: string) => {
      if (shouldStop()) return;
      if (stat.isDirectory() && !patternRe.test(relPosix)) return;
      processedFiles++;
      const displayPath = stat.isDirectory() ? utils.toPosix(path.join(inputPath, relPosix)) : utils.toPosix(inputPath);
      const buf = fs.readFileSync(fileAbs);
      if (buf.length > maxFileSizeBytes || utils.isLikelyBinary(buf)) return;

      const decoded = utils.decodeText(buf);
      const replaceRegex = new RegExp(regex.source, regex.flags);
      const newText = decoded.text.replace(replaceRegex, replace);
      if (newText === decoded.text) return;

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

    if (stat.isFile()) processFile(rootAbs, utils.toPosix(path.basename(rootAbs)));
    else utils.walkFiles(rootAbs, processFile, shouldStop);

    const summary = [`路径 ${inputPath}`, `共 ${totalReplacements} 处替换，${items.length} 个文件变更`];
    if (items.length === 0) items.push(makeMsg(inputPath, 'search_in_files', '不会修改任何文件。'));
    return { toolName: 'search_in_files', title: 'Diff 审批', summary, items };
  } catch (err: unknown) {
    return { toolName: 'search_in_files', title: 'Diff 审批', summary: ['生成预览失败。'], items: [makeMsg(inputPath, 'search_in_files', err instanceof Error ? err.message : String(err))] };
  }
}

function buildPreview(inv: ToolInvocationLike, utils: ToolPreviewUtilsLike): DiffPreviewResponse {
  switch (inv.toolName) {
    case 'apply_diff': return buildApplyDiffPreview(inv, utils);
    case 'write_file': return buildWriteFilePreview(inv, utils);
    case 'insert_code': return buildInsertCodePreview(inv, utils);
    case 'delete_code': return buildDeleteCodePreview(inv, utils);
    case 'search_in_files':
      if (((inv.args.mode as string | undefined) ?? 'search') === 'replace') {
        return buildSearchReplacePreview(inv, utils);
      }
      break;
  }
  return { toolName: inv.toolName, title: 'Diff 审批', summary: ['此工具不支持 diff 预览。'], items: [makeMsg('', inv.toolName, '此工具不支持 diff 预览。')] };
}

// ---- HTTP Handler ----

export function createDiffPreviewHandler(backend: IrisBackendLike, utils: ToolPreviewUtilsLike) {
  return async (_req: IncomingMessage, res: ServerResponse, params: Record<string, string>) => {
    const toolId = params.id;
    if (!toolId) {
      sendJSON(res, 400, { error: '缺少工具 ID' });
      return;
    }

    const inv = (backend as any).getToolHandle?.(toolId)?.getSnapshot() as ToolInvocationLike | undefined;
    if (!inv) {
      sendJSON(res, 404, { error: '未找到工具调用' });
      return;
    }

    try {
      const preview = buildPreview(inv, utils);
      sendJSON(res, 200, preview);
    } catch (err: unknown) {
      sendJSON(res, 500, { error: err instanceof Error ? err.message : '生成 diff 预览失败' });
    }
  };
}
