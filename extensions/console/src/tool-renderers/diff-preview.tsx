/** @jsxImportSource @opentui/react */

/**
 * 终态工具结果中的紧凑 diff 预览。
 *
 * Claude Code 在自动批准编辑工具时，仍会在工具完成消息里显示一小段结构化 diff；
 * 这里采用同样思路：审批页继续用于完整 diff，聊天区只渲染有限行数的改动摘要，
 * 避免开启 autoApproveDiff / Auto Edit 后只剩 `+N -N` 这类不可读统计。
 */

import React from 'react';
import { useTerminalDimensions } from '@opentui/react';
import type { ToolDiffPreviewItemLike, ToolDiffPreviewResponseLike } from 'irises-extension-sdk';
import { BORDER_CHARS, ICONS } from '../terminal-compat';
import { getTextWidth, splitGraphemes } from '../text-layout';

const DEFAULT_MAX_ITEMS = 3;
const DEFAULT_MAX_LINES = 80;

type DiffLineKind = 'file' | 'hunk' | 'add' | 'del' | 'ctx' | 'meta' | 'message';

interface HunkStatus {
  success?: boolean;
  error?: string;
  correctedHeader?: string;
  fallbackMessage?: string;
}

interface RenderLine {
  kind: DiffLineKind;
  text: string;
  hunkIndex?: number;
  hunkStatus?: HunkStatus;
  oldLineNumber?: number;
  newLineNumber?: number;
}

interface ResultWithUiPreview {
  __ui?: {
    diffPreview?: ToolDiffPreviewResponseLike;
  };
}

interface CompactDiffPreviewProps {
  preview?: ToolDiffPreviewResponseLike;
  maxItems?: number;
  maxLines?: number;
  hunkStatuses?: HunkStatus[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function isDiffPreviewResponse(value: unknown): value is ToolDiffPreviewResponseLike {
  return isRecord(value)
    && typeof value.toolName === 'string'
    && Array.isArray(value.items);
}

export function extractResultDiffPreview(result: unknown): ToolDiffPreviewResponseLike | undefined {
  if (!isRecord(result)) return undefined;
  const ui = (result as ResultWithUiPreview).__ui;
  return isDiffPreviewResponse(ui?.diffPreview) ? ui.diffPreview : undefined;
}

export function createInlineDiffPreview(input: {
  toolName: string;
  filePath: string;
  diff: unknown;
  added?: number;
  removed?: number;
  label?: string;
}): ToolDiffPreviewResponseLike | undefined {
  if (typeof input.diff !== 'string' || input.diff.trim().length === 0) return undefined;
  const filePath = input.filePath || 'patch';
  return {
    toolName: input.toolName,
    title: 'Diff 预览',
    toolLabel: input.toolName,
    summary: [],
    items: [{
      filePath,
      label: input.label ?? filePath,
      diff: input.diff,
      added: input.added ?? 0,
      removed: input.removed ?? 0,
    }],
  };
}

function normalizeDiffText(diff: string): string {
  return diff.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function isUnifiedFileHeader(line: string): boolean {
  return /^(---|\+\+\+)\s+(a\/|b\/|\/dev\/null)/.test(line);
}

function wrapToWidth(text: string, maxWidth: number): string[] {
  if (maxWidth <= 0) return [''];
  if (!text) return [''];
  const rows: string[] = [];
  let width = 0;
  let result = '';
  for (const grapheme of splitGraphemes(text)) {
    const nextWidth = getTextWidth(grapheme);
    if (result && width + nextWidth > maxWidth) {
      rows.push(result);
      result = grapheme;
      width = nextWidth;
    } else {
      result += grapheme;
      width += nextWidth;
    }
  }
  rows.push(result || '');
  return rows;
}

function parseHunkHeader(header: string): { oldStart: number; newStart: number } | undefined {
  const m = header.match(/^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/);
  if (!m) return undefined;
  return {
    oldStart: Number.parseInt(m[1], 10),
    newStart: Number.parseInt(m[3], 10),
  };
}

function extractDisplayHunkHeader(header: string): string {
  const m = header.match(/^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/);
  return m ? m[0] : header;
}

function formatLineNumber(value: number | undefined, width: number): string {
  if (width <= 0) return '';
  if (value === undefined || !Number.isFinite(value)) {
    return ' '.repeat(width);
  }
  return String(value).padStart(width, ' ');
}

function classifyDiffLine(rawLine: string, hunkIndex?: number, hunkStatus?: HunkStatus): RenderLine {
  const displayLine = rawLine.startsWith('@@') && hunkStatus?.correctedHeader
    ? extractDisplayHunkHeader(hunkStatus.correctedHeader)
    : rawLine.startsWith('@@') ? extractDisplayHunkHeader(rawLine) : rawLine;
  if (displayLine.startsWith('@@')) {
    return {
      kind: 'hunk', text: displayLine, hunkIndex, hunkStatus,
    };
  }
  if (rawLine.startsWith('+') && !isUnifiedFileHeader(rawLine)) return { kind: 'add', text: rawLine };
  if (rawLine.startsWith('-') && !isUnifiedFileHeader(rawLine)) return { kind: 'del', text: rawLine };
  if (rawLine.startsWith(' ')) return { kind: 'ctx', text: rawLine };
  return { kind: 'meta', text: rawLine };
}

function formatStats(item: ToolDiffPreviewItemLike): string {
  const parts: string[] = [];
  if (item.added > 0) parts.push(`+${item.added}`);
  if (item.removed > 0) parts.push(`-${item.removed}`);
  return parts.length > 0 ? ` ${parts.join(' ')}` : '';
}

function estimateRenderableLines(item: ToolDiffPreviewItemLike): number {
  if (!item.diff) return item.message ? 1 : 0;
  return normalizeDiffText(item.diff)
    .split('\n')
    .filter(line => line.length > 0 && !isUnifiedFileHeader(line))
    .length;
}

function collectRenderLines(
  preview: ToolDiffPreviewResponseLike,
  maxItems: number,
  maxLines: number,
  hunkStatuses: HunkStatus[],
): { lines: RenderLine[]; hiddenLines: number; hiddenItems: number } {
  const lines: RenderLine[] = [];
  let hiddenLines = 0;
  let hiddenItems = 0;
  let renderedItems = 0;
  let currentOldLine: number | undefined;
  let currentNewLine: number | undefined;
  let hunkCounter = 0;

  const pushLine = (line: RenderLine): boolean => {
    lines.push(line);
    return true;
  };

  for (const item of preview.items ?? []) {
    if (!item.diff && !item.message) continue;

    if (renderedItems >= maxItems) {
      hiddenItems++;
      hiddenLines += estimateRenderableLines(item);
      continue;
    }

    renderedItems++;
    const header = `${item.filePath || item.label || 'diff'}${formatStats(item)}`;
    pushLine({ kind: 'file', text: header });

    if (item.diff) {
      const diffLines = normalizeDiffText(item.diff).split('\n');
      for (let i = 0; i < diffLines.length; i++) {
        const rawLine = diffLines[i];
        if (rawLine.length === 0 || isUnifiedFileHeader(rawLine)) continue;

        const currentHunkIndex = rawLine.startsWith('@@') ? hunkCounter++ : undefined;
        const hunkStatus = currentHunkIndex !== undefined ? hunkStatuses[currentHunkIndex] : undefined;

        if (rawLine.startsWith('@@')) {
          const parsedHeader = parseHunkHeader(hunkStatus?.correctedHeader ?? rawLine);
          currentOldLine = parsedHeader?.oldStart;
          currentNewLine = parsedHeader?.newStart;
        }

        let oldLineNumber: number | undefined;
        let newLineNumber: number | undefined;
        if (!rawLine.startsWith('@@')) {
          if (rawLine.startsWith(' ')) {
            oldLineNumber = currentOldLine;
            newLineNumber = currentNewLine;
            currentOldLine = currentOldLine !== undefined ? currentOldLine + 1 : undefined;
            currentNewLine = currentNewLine !== undefined ? currentNewLine + 1 : undefined;
          } else if (rawLine.startsWith('-')) {
            oldLineNumber = currentOldLine;
            currentOldLine = currentOldLine !== undefined ? currentOldLine + 1 : undefined;
          } else if (rawLine.startsWith('+')) {
            newLineNumber = currentNewLine;
            currentNewLine = currentNewLine !== undefined ? currentNewLine + 1 : undefined;
          }
        }

        pushLine({ ...classifyDiffLine(rawLine, currentHunkIndex, hunkStatus), oldLineNumber, newLineNumber });
        if (rawLine.startsWith('@@') && hunkStatus?.fallbackMessage) {
          pushLine({ kind: 'message', text: `fallback: ${hunkStatus.fallbackMessage}` });
        }
      }
    } else if (item.message) {
      pushLine({ kind: 'message', text: item.message });
    }
  }

  return { lines, hiddenLines, hiddenItems };
}

function getLineColor(kind: DiffLineKind, hunkStatus?: HunkStatus): string {
  switch (kind) {
    case 'file': return '#9ca3af';
    case 'hunk':
      if (hunkStatus?.success === true) return '#57ab5a';
      if (hunkStatus?.success === false) return '#f47067';
      return '#79c0ff';
    case 'add': return '#57ab5a';
    case 'del': return '#f47067';
    case 'ctx': return '#8b949e';
    case 'message': return '#d2a8ff';
    case 'meta':
    default:
      return '#6b7280';
  }
}

export function CompactDiffPreview({
  preview,
  maxItems = DEFAULT_MAX_ITEMS,
  maxLines = DEFAULT_MAX_LINES,
  hunkStatuses = [],
}: CompactDiffPreviewProps) {
  const { width: terminalWidth } = useTerminalDimensions();
  if (!preview || !Array.isArray(preview.items) || preview.items.length === 0) return null;

  const { lines, hiddenLines, hiddenItems } = collectRenderLines(preview, maxItems, maxLines, hunkStatuses);
  if (lines.length === 0) return null;

  const lineNumberWidth = lines.reduce((max, line) => {
    const oldWidth = line.oldLineNumber !== undefined ? String(line.oldLineNumber).length : 0;
    const newWidth = line.newLineNumber !== undefined ? String(line.newLineNumber).length : 0;
    return Math.max(max, oldWidth, newWidth);
  }, 0);

  const safeTerminalWidth = Math.max(20, terminalWidth || 80);
  const standaloneLineWidth = Math.max(12, safeTerminalWidth - 2);
  const lineNumberColumnsWidth = lineNumberWidth > 0 ? getTextWidth(`${' '.repeat(lineNumberWidth)} ${' '.repeat(lineNumberWidth)}`) : 0;
  const separatorText = ` ${BORDER_CHARS.vertical} `;
  const separatorWidth = getTextWidth(separatorText);
  const prefixWidth = lineNumberColumnsWidth + separatorWidth;
  const availableTextWidth = Math.max(12, safeTerminalWidth - prefixWidth - 6);

  type WrappedRenderRow = {
    key: string;
    kind: DiffLineKind;
    text: string;
    hunkStatus?: HunkStatus;
    showGutter: boolean;
    oldLineNumber?: number;
    newLineNumber?: number;
  };

  const rows: WrappedRenderRow[] = [];
  let clippedRows = 0;
  for (const [index, line] of lines.entries()) {
    const renderText = line.kind === 'hunk' && line.hunkStatus?.success !== undefined
      ? `${line.hunkStatus.success ? '✓' : '✗'} ${line.text}`
      : line.text;

    const wrappedSegments = wrapToWidth(
      renderText,
      line.kind === 'file' || line.kind === 'hunk' || line.kind === 'message' ? standaloneLineWidth : availableTextWidth,
    );
    for (let segmentIndex = 0; segmentIndex < wrappedSegments.length; segmentIndex++) {
      if (rows.length >= maxLines) {
        clippedRows += wrappedSegments.length - segmentIndex;
        break;
      }
      rows.push({
        key: `diff-preview.${index}.${segmentIndex}`,
        kind: line.kind,
        text: wrappedSegments[segmentIndex],
        hunkStatus: line.hunkStatus,
        showGutter: line.kind === 'ctx' || line.kind === 'add' || line.kind === 'del',
        oldLineNumber: segmentIndex === 0 ? line.oldLineNumber : undefined,
        newLineNumber: segmentIndex === 0 ? line.newLineNumber : undefined,
      });
    }
    if (rows.length >= maxLines) break;
  }

  if (rows.length === 0) return null;

  return (
    <box flexDirection="column">
      {rows.map((row) => (
        <text key={row.key} wrapMode="none">
          {row.showGutter ? (() => {
            const oldNum = lineNumberWidth > 0 ? formatLineNumber(row.oldLineNumber, lineNumberWidth) : '';
            const newNum = lineNumberWidth > 0 ? formatLineNumber(row.newLineNumber, lineNumberWidth) : '';
            const numberColumns = lineNumberWidth > 0 ? `${oldNum} ${newNum}` : '';
            return (
              <>
                {lineNumberWidth > 0 ? <span fg="#6b7280">{numberColumns}</span> : null}
                <span fg="#6b7280">{separatorText}</span>
                <span fg={getLineColor(row.kind, row.hunkStatus)}>{row.text}</span>
              </>
            );
          })() : (
            <span fg={getLineColor(row.kind, row.hunkStatus)}>{row.text}</span>
          )}
        </text>
      ))}
      {(hiddenLines > 0 || hiddenItems > 0 || clippedRows > 0) ? (
        <text>
          <span fg="#6b7280"><em>{`${ICONS.ellipsis} 已截断${hiddenItems > 0 ? ` ${hiddenItems} 个文件` : ''}${hiddenLines + clippedRows > 0 ? ` ${hiddenLines + clippedRows} 行` : ''}`}</em></span>
        </text>
      ) : null}
    </box>
  );
}
