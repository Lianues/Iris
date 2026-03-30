/** @jsxImportSource @opentui/react */

/**
 * delete_code 工具渲染器
 *
 * 显示删除的行数、行范围及文件路径。
 */

import React from 'react';
import { ToolRendererProps } from './default.js';

interface DeleteCodeResultItem {
  path?: string;
  success?: boolean;
  start_line?: number;
  end_line?: number;
  deletedLines?: number;
  error?: string;
}

interface DeleteCodeResult {
  results?: DeleteCodeResultItem[];
  successCount?: number;
  failCount?: number;
  totalCount?: number;
}

export function DeleteCodeRenderer({ result }: ToolRendererProps) {
  const r = (result || {}) as DeleteCodeResult;
  const items = r.results || [];
  const failCount = r.failCount ?? 0;

  if (items.length === 0) {
    return <text fg="#888"><em>{' \u21B3'} deleted 0 lines</em></text>;
  }

  if (items.length === 1) {
    const item = items[0];
    if (item.success === false) {
      return <text fg="#ff0000"><em>{' \u21B3'} failed ({item.error ?? item.path ?? '?'})</em></text>;
    }
    const deleted = item.deletedLines ?? 0;
    const range = item.start_line != null && item.end_line != null
      ? `:${item.start_line}-${item.end_line}`
      : '';
    return (
      <text fg="#888">
        <em>{' \u21B3'} <span fg="#f47067">-{deleted}</span> lines ({item.path ?? '?'}{range})</em>
      </text>
    );
  }

  // 多文件：汇总删除行数
  const totalDeleted = items.reduce((sum, i) => sum + (i.deletedLines ?? 0), 0);
  const names = items.map(i => i.path ?? '?').join(', ');
  return (
    <text fg={failCount > 0 ? '#ffff00' : '#888'}>
      <em>{' \u21B3'} <span fg="#f47067">-{totalDeleted}</span> lines in {items.length} files ({names})</em>
    </text>
  );
}
