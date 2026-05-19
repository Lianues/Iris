import type { ToolDiffPreviewItemLike, ToolDiffPreviewResponseLike } from 'irises-extension-sdk';
import { BORDER_CHARS } from '../terminal-compat';
import { getTextWidth, splitGraphemes } from '../text-layout';

export type DiffLineKind = 'file' | 'hunk' | 'add' | 'del' | 'ctx' | 'meta' | 'message';

export interface HunkStatus {
  success?: boolean;
  error?: string;
  correctedHeader?: string;
  fallbackMessage?: string;
}

interface RenderLine {
  kind: DiffLineKind;
  text: string;
  hunkStatus?: HunkStatus;
  oldLineNumber?: number;
  newLineNumber?: number;
}

export interface WrappedRenderRow {
  key: string;
  kind: DiffLineKind;
  text: string;
  hunkStatus?: HunkStatus;
  showGutter: boolean;
  oldLineNumber?: number;
  newLineNumber?: number;
}

export interface CompactDiffPreviewLayout {
  rows: WrappedRenderRow[];
  hiddenLines: number;
  hiddenItems: number;
  clippedRows: number;
  lineNumberWidth: number;
  separatorText: string;
}

export interface CompactDiffPreviewLayoutOptions {
  preview?: ToolDiffPreviewResponseLike;
  terminalWidth?: number;
  maxItems: number;
  maxLines: number;
  hunkStatuses?: HunkStatus[];
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

export function formatDiffPreviewLineNumber(value: number | undefined, width: number): string {
  if (width <= 0) return '';
  if (value === undefined || !Number.isFinite(value)) {
    return ' '.repeat(width);
  }
  return String(value).padStart(width, ' ');
}

function classifyDiffLine(rawLine: string, hunkStatus?: HunkStatus): RenderLine {
  const displayLine = rawLine.startsWith('@@') && hunkStatus?.correctedHeader
    ? extractDisplayHunkHeader(hunkStatus.correctedHeader)
    : rawLine.startsWith('@@') ? extractDisplayHunkHeader(rawLine) : rawLine;
  if (displayLine.startsWith('@@')) {
    return {
      kind: 'hunk', text: displayLine, hunkStatus,
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
  hunkStatuses: HunkStatus[],
): { lines: RenderLine[]; hiddenLines: number; hiddenItems: number } {
  const lines: RenderLine[] = [];
  let hiddenLines = 0;
  let hiddenItems = 0;
  let renderedItems = 0;
  let currentOldLine: number | undefined;
  let currentNewLine: number | undefined;
  let hunkCounter = 0;

  for (const item of preview.items ?? []) {
    if (!item.diff && !item.message) continue;

    if (renderedItems >= maxItems) {
      hiddenItems++;
      hiddenLines += estimateRenderableLines(item);
      continue;
    }

    renderedItems++;
    lines.push({ kind: 'file', text: `${item.filePath || item.label || 'diff'}${formatStats(item)}` });

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

        lines.push({ ...classifyDiffLine(rawLine, hunkStatus), oldLineNumber, newLineNumber });
        if (rawLine.startsWith('@@') && hunkStatus?.fallbackMessage) {
          lines.push({ kind: 'message', text: `fallback: ${hunkStatus.fallbackMessage}` });
        }
      }
    } else if (item.message) {
      lines.push({ kind: 'message', text: item.message });
    }
  }

  return { lines, hiddenLines, hiddenItems };
}

export function layoutCompactDiffPreview({
  preview,
  terminalWidth,
  maxItems,
  maxLines,
  hunkStatuses = [],
}: CompactDiffPreviewLayoutOptions): CompactDiffPreviewLayout | undefined {
  if (!preview || !Array.isArray(preview.items) || preview.items.length === 0) return undefined;

  const { lines, hiddenLines, hiddenItems } = collectRenderLines(preview, maxItems, hunkStatuses);
  if (lines.length === 0) return undefined;

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
  const rowLimit = Math.max(1, maxLines);

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

    if (rows.length >= rowLimit) {
      // 这里不能 break；尾部提示需要统计所有后续被省略的行。
      clippedRows += wrappedSegments.length;
      continue;
    }

    const visibleSegmentCount = Math.min(rowLimit - rows.length, wrappedSegments.length);
    for (let segmentIndex = 0; segmentIndex < visibleSegmentCount; segmentIndex++) {
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

    if (visibleSegmentCount < wrappedSegments.length) {
      clippedRows += wrappedSegments.length - visibleSegmentCount;
    }
  }

  return { rows, hiddenLines, hiddenItems, clippedRows, lineNumberWidth, separatorText };
}
