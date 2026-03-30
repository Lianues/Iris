/** @jsxImportSource @opentui/react */

/**
 * search_in_files 工具渲染器
 *
 * search 模式：显示匹配数
 * replace 模式：显示替换数、文件数及 query → replace 概要
 */

import React from 'react';
import { ToolRendererProps } from './default.js';

interface SearchInFilesResult {
  mode?: 'search' | 'replace';
  query?: string;
  replace?: string;
  count?: number;
  truncated?: boolean;
  processedFiles?: number;
  totalReplacements?: number;
  results?: Array<{
    file?: string;
    replacements?: number;
    changed?: boolean;
  }>;
}

function truncStr(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '\u2026' : s;
}

export function SearchInFilesRenderer({ args, result }: ToolRendererProps) {
  const r = (result || {}) as SearchInFilesResult;

  if (r.mode === 'replace') {
    const total = r.totalReplacements ?? 0;
    const files = r.processedFiles ?? 0;
    const suffix = r.truncated ? ' (truncated)' : '';

    // 显示 query → replace 的简短概要
    const query = typeof args?.query === 'string' ? truncStr(args.query, 16) : '';
    const replace = typeof args?.replace === 'string' ? truncStr(args.replace, 16) : '';
    const transform = query ? ` "${query}" → "${replace}"` : '';

    // 统计实际变更的文件数
    const changedFiles = r.results
      ? r.results.filter(f => f.changed).length
      : files;

    return (
      <text fg="#888">
        <em>
          {' \u21B3 '}
          <span fg="#d2a8ff">{total}</span> replacements in{' '}
          <span fg="#d2a8ff">{changedFiles}</span>/{files} files
          {transform}{suffix}
        </em>
      </text>
    );
  }

  const count = r.count ?? 0;
  const suffix = r.truncated ? ' (truncated)' : '';
  return <text fg="#888"><em>{' \u21B3 '}<span fg="#d2a8ff">{count}</span> matches found{suffix}</em></text>;
}
