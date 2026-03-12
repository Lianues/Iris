/**
 * read_file 工具渲染器 - 极致紧凑版
 */

import React from 'react';
import { Text } from 'ink';
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

/** 取文件名（路径最后一段） */
function basename(p: string): string {
  return p.split('/').pop() || p;
}

export function ReadFileRenderer({ result }: ToolRendererProps) {
  const r = (result || {}) as ReadFileResult;
  const items = r.results || [];

  if (items.length === 0) {
    return (
      <Text dimColor italic>
        {' ↳'} read 0 lines (-)
      </Text>
    );
  }

  // 单文件
  if (items.length === 1) {
    const item = items[0];
    const lines = item.lineCount ?? 0;
    const name = item.path ?? '?';
    const range = item.startLine !== undefined && item.endLine !== undefined
      ? `:${item.startLine}-${item.endLine}`
      : '';
    return (
      <Text dimColor italic>
        {' ↳'} read {lines} lines ({name}{range})
      </Text>
    );
  }

  // 多文件：显示文件名列表
  const totalLines = items.reduce((sum, item) => sum + (item.lineCount ?? 0), 0);
  const names = items.map(item => basename(item.path ?? '?')).join(', ');
  return (
    <Text dimColor italic>
      {' ↳'} read {totalLines} lines ({names})
    </Text>
  );
}
