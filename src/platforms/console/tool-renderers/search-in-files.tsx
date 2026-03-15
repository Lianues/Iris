/**
 * search_in_files 工具渲染器
 */

import React from 'react';
import { ToolRendererProps } from './default.js';

interface SearchInFilesResult {
  mode?: 'search' | 'replace';
  count?: number;
  truncated?: boolean;
  processedFiles?: number;
  totalReplacements?: number;
}

export function SearchInFilesRenderer({ result }: ToolRendererProps) {
  const r = (result || {}) as SearchInFilesResult;

  if (r.mode === 'replace') {
    const total = r.totalReplacements ?? 0;
    const files = r.processedFiles ?? 0;
    const suffix = r.truncated ? ' (truncated)' : '';
    return <text fg="#888"><em>{' \u21B3 '} {total} replacements in {files} files{suffix}</em></text>;
  }

  const count = r.count ?? 0;
  const suffix = r.truncated ? ' (truncated)' : '';
  return <text fg="#888"><em>{' \u21B3 '} {count} matches found{suffix}</em></text>;
}
