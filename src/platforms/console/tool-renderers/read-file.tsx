/**
 * read_file 工具渲染器
 */

import React from 'react';
import { ToolRendererProps } from './default.js';

interface ReadResultItem {
  path?: string;
  success?: boolean;
  lineCount?: number;
  totalLines?: number;
  startLine?: number;
  endLine?: number;
}

interface ReadFileResult {
  results?: ReadResultItem[];
  successCount?: number;
  failCount?: number;
  totalCount?: number;
}

function basename(p: string): string {
  return p.split('/').pop() || p;
}

export function ReadFileRenderer({ result }: ToolRendererProps) {
  const r = (result || {}) as ReadFileResult;
  const items = r.results || [];

  if (items.length === 0) {
    return <text fg="#888"><em>{' \u21B3'} read 0 lines (-)</em></text>;
  }

  if (items.length === 1) {
    const item = items[0];
    const lines = item.lineCount ?? 0;
    const name = item.path ?? '?';
    const range = item.startLine !== undefined && item.endLine !== undefined
      ? `:${item.startLine}-${item.endLine}`
      : '';
    return <text fg="#888"><em>{' \u21B3'} read {lines} lines ({name}{range})</em></text>;
  }

  const totalLines = items.reduce((sum, item) => sum + (item.lineCount ?? 0), 0);
  const names = items.map(item => basename(item.path ?? '?')).join(', ');
  return <text fg="#888"><em>{' \u21B3'} read {totalLines} lines ({names})</em></text>;
}
