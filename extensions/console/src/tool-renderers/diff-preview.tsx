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
import type { ToolDiffPreviewResponseLike } from 'irises-extension-sdk';
import { ICONS } from '../terminal-compat';
import {
  formatDiffPreviewLineNumber,
  layoutCompactDiffPreview,
  type DiffLineKind,
  type HunkStatus,
} from './diff-preview-layout.js';

const DEFAULT_MAX_ITEMS = 3;
const DEFAULT_MAX_LINES = 80;

interface CompactDiffPreviewProps {
  preview?: ToolDiffPreviewResponseLike;
  maxItems?: number;
  maxLines?: number;
  hunkStatuses?: HunkStatus[];
}

export { extractResultDiffPreview } from './diff-preview-meta.js';

function getLineColor(kind: DiffLineKind, hunkStatus?: HunkStatus): string {
  switch (kind) {
    case 'file': return '#9ca3af';
    case 'hunk':
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
  const layout = layoutCompactDiffPreview({ preview, terminalWidth, maxItems, maxLines, hunkStatuses });
  if (!layout || layout.rows.length === 0) return null;

  const {
    rows,
    hiddenLines,
    hiddenItems,
    clippedRows,
    lineNumberWidth,
    separatorText,
  } = layout;

  return (
    <box flexDirection="column">
      {rows.map((row) => (
        <text key={row.key} wrapMode="none">
          {row.showGutter ? (() => {
            const oldNum = lineNumberWidth > 0 ? formatDiffPreviewLineNumber(row.oldLineNumber, lineNumberWidth) : '';
            const newNum = lineNumberWidth > 0 ? formatDiffPreviewLineNumber(row.newLineNumber, lineNumberWidth) : '';
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
