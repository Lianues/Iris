/** @jsxImportSource @opentui/react */

/**
 * 终态工具结果中的紧凑 diff 预览。
 *
 * Claude Code 在自动批准编辑工具时，仍会在工具完成消息里显示一小段结构化 diff；
 * 这里采用同样思路：审批页继续用于完整 diff，聊天区只渲染有限行数的改动摘要，
 * 避免开启 autoApproveDiff / Auto Edit 后只剩 `+N -N` 这类不可读统计。
 */

import React from 'react';
import type { ToolDiffPreviewItemLike, ToolDiffPreviewResponseLike } from 'irises-extension-sdk';
import { BORDER_CHARS, ICONS } from '../terminal-compat';

const DEFAULT_MAX_ITEMS = 3;
const DEFAULT_MAX_LINES = 80;
const MAX_LINE_CHARS = 180;

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

function truncateLine(line: string, max = MAX_LINE_CHARS): string {
  if (line.length <= max) return line;
  const head = Math.max(20, Math.floor(max * 0.72));
  const tail = Math.max(8, Math.floor(max * 0.16));
  return `${line.slice(0, head)} ${ICONS.ellipsis} ${line.slice(-tail)}`;
}

function parseHunkHeader(header: string): { oldStart: number; newStart: number } | undefined {
  const m = header.match(/^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/);
  if (!m) return undefined;
  return {
    oldStart: Number.parseInt(m[1], 10),
    newStart: Number.parseInt(m[3], 10),
  };
}

function formatLineNumber(value: number | undefined, width: number): string {
  if (width <= 0) return '';
  if (value === undefined || !Number.isFinite(value)) {
    return ' '.repeat(width);
  }
  return String(value).padStart(width, ' ');
}

function classifyDiffLine(rawLine: string, hunkIndex?: number, hunkStatus?: HunkStatus): RenderLine {
  const line = truncateLine(rawLine);
  const displayLine = rawLine.startsWith('@@') && hunkStatus?.correctedHeader
    ? truncateLine(hunkStatus.correctedHeader)
    : line;
  if (displayLine.startsWith('@@')) {
    return {
      kind: 'hunk', text: displayLine, hunkIndex, hunkStatus,
    };
  }
  if (line.startsWith('+') && !isUnifiedFileHeader(rawLine)) return { kind: 'add', text: line };
  if (line.startsWith('-') && !isUnifiedFileHeader(rawLine)) return { kind: 'del', text: line };
  if (line.startsWith(' ')) return { kind: 'ctx', text: line };
  return { kind: 'meta', text: line };
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
    if (lines.length >= maxLines) {
      hiddenLines++;
      return false;
    }
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

        if (!pushLine({ ...classifyDiffLine(rawLine, currentHunkIndex, hunkStatus), oldLineNumber, newLineNumber })) {
          hiddenLines += diffLines.slice(i + 1)
            .filter(line => line.length > 0 && !isUnifiedFileHeader(line))
            .length;
          break;
        }
        if (rawLine.startsWith('@@') && hunkStatus?.fallbackMessage) {
          pushLine({ kind: 'message', text: `fallback: ${truncateLine(hunkStatus.fallbackMessage)}` });
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
  if (!preview || !Array.isArray(preview.items) || preview.items.length === 0) return null;

  const { lines, hiddenLines, hiddenItems } = collectRenderLines(preview, maxItems, maxLines, hunkStatuses);
  if (lines.length === 0) return null;

  const lineNumberWidth = lines.reduce((max, line) => {
    const oldWidth = line.oldLineNumber !== undefined ? String(line.oldLineNumber).length : 0;
    const newWidth = line.newLineNumber !== undefined ? String(line.newLineNumber).length : 0;
    return Math.max(max, oldWidth, newWidth);
  }, 0);

  return (
    <box flexDirection="column">
      {lines.map((line, index) => (
        <text key={`diff-preview.${index}`}>
          {line.kind === 'hunk' && line.hunkStatus?.success !== undefined ? (
            <>
              <span fg={getLineColor(line.kind, line.hunkStatus)}>{`  ${line.hunkStatus.success ? '✓' : '✗'} `}</span>
              <span fg={getLineColor(line.kind, line.hunkStatus)}>{line.text}</span>
            </>
          ) : (
            <>
              {lineNumberWidth > 0 ? (
                <span fg="#6b7280">{`  ${formatLineNumber(line.oldLineNumber, lineNumberWidth)} ${formatLineNumber(line.newLineNumber, lineNumberWidth)} ${BORDER_CHARS.vertical} `}</span>
              ) : (
                <span fg="#6b7280">{'  '}</span>
              )}
              <span fg={getLineColor(line.kind, line.hunkStatus)}>{line.text}</span>
            </>
          )}
        </text>
      ))}
      {(hiddenLines > 0 || hiddenItems > 0) ? (
        <text>
          <span fg="#6b7280"><em>{`  ${ICONS.ellipsis} 已截断${hiddenItems > 0 ? ` ${hiddenItems} 个文件` : ''}${hiddenLines > 0 ? ` ${hiddenLines} 行` : ''}`}</em></span>
        </text>
      ) : null}
    </box>
  );
}
