/** @jsxImportSource @opentui/react */

/**
 * write_file 工具渲染器
 */

import React from 'react';
import { ToolRendererProps } from './default.js';

interface WriteResultItem {
  path?: string;
  success?: boolean;
  action?: 'created' | 'modified' | 'unchanged';
  error?: string;
}

interface WriteFileResult {
  results?: WriteResultItem[];
  successCount?: number;
  failCount?: number;
  totalCount?: number;
}

function basename(p: string): string {
  return p.split('/').pop() || p;
}

export function WriteFileRenderer({ result }: ToolRendererProps) {
  const r = (result || {}) as WriteFileResult;
  const items = r.results || [];
  const failCount = r.failCount ?? 0;

  if (items.length === 0) {
    return <text fg="#888"><em>{' \u21B3'} wrote 0 files</em></text>;
  }

  // 单文件：直接显示 action 和完整路径
  if (items.length === 1) {
    const item = items[0];
    const action = item.action ?? (item.success ? 'written' : 'failed');
    const fg = item.success === false ? '#ff0000' : '#888';
    return (
      <text fg={fg}>
        <em>{' \u21B3'} {action} ({item.path ?? '?'})</em>
      </text>
    );
  }

  // 多文件：按 action 分组统计
  const counts: Record<string, number> = {};
  for (const item of items) {
    const key = item.success === false ? 'failed' : (item.action ?? 'written');
    counts[key] = (counts[key] || 0) + 1;
  }

  const parts: string[] = [];
  for (const action of ['created', 'modified', 'unchanged', 'written', 'failed']) {
    if (counts[action]) {
      parts.push(`${counts[action]} ${action}`);
    }
  }

  const names = items.map(i => basename(i.path ?? '?')).join(', ');
  const summary = `${parts.join(', ')} (${names})`;

  return (
    <text fg={failCount > 0 ? '#ffff00' : '#888'}>
      <em>{' \u21B3 '}{summary}</em>
    </text>
  );
}
