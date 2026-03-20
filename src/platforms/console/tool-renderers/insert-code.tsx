/** @jsxImportSource @opentui/react */

/**
 * insert_code 工具渲染器
 *
 * 显示插入的行数、插入位置及文件路径。
 */

import React from 'react';
import { ToolRendererProps } from './default.js';

interface InsertCodeResultItem {
  path?: string;
  success?: boolean;
  line?: number;
  insertedLines?: number;
  error?: string;
}

interface InsertCodeResult {
  results?: InsertCodeResultItem[];
  successCount?: number;
  failCount?: number;
  totalCount?: number;
}

export function InsertCodeRenderer({ result }: ToolRendererProps) {
  const r = (result || {}) as InsertCodeResult;
  const items = r.results || [];
  const failCount = r.failCount ?? 0;

  if (items.length === 0) {
    return <text fg="#888"><em>{' \u21B3'} inserted 0 lines</em></text>;
  }

  if (items.length === 1) {
    const item = items[0];
    if (item.success === false) {
      return <text fg="#ff0000"><em>{' \u21B3'} failed ({item.error ?? item.path ?? '?'})</em></text>;
    }
    const inserted = item.insertedLines ?? 0;
    const pos = item.line != null ? ` at L${item.line}` : '';
    return (
      <text fg="#888">
        <em>{' \u21B3'} <span fg="#57ab5a">+{inserted}</span> lines{pos} ({item.path ?? '?'})</em>
      </text>
    );
  }

  // 多文件：汇总插入行数
  const totalInserted = items.reduce((sum, i) => sum + (i.insertedLines ?? 0), 0);
  const names = items.map(i => i.path ?? '?').join(', ');
  return (
    <text fg={failCount > 0 ? '#ffff00' : '#888'}>
      <em>{' \u21B3'} <span fg="#57ab5a">+{totalInserted}</span> lines in {items.length} files ({names})</em>
    </text>
  );
}
