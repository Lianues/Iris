/**
 * search_in_files 工具渲染器 - 极致紧凑版
 */

import React from 'react';
import { Text } from 'ink';
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
    return (
      <Text dimColor italic>
        {' ↳ '} {total} replacements in {files} files{suffix}
      </Text>
    );
  }

  const count = r.count ?? 0;
  const suffix = r.truncated ? ' (truncated)' : '';
  return (
    <Text dimColor italic>
      {' ↳ '} {count} matches found{suffix}
    </Text>
  );
}
