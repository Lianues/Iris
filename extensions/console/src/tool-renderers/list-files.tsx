/** @jsxImportSource @opentui/react */

/**
 * list_files 工具渲染器
 */

import React from 'react';
import { ToolRendererProps } from './default.js';

interface ListResultItem {
  path?: string;
  fileCount?: number;
  dirCount?: number;
  success?: boolean;
  error?: string;
}

interface ListFilesResult {
  results?: ListResultItem[];
  totalFiles?: number;
  totalDirs?: number;
  totalPaths?: number;
}

export function ListFilesRenderer({ result }: ToolRendererProps) {
  const r = (result || {}) as ListFilesResult;
  const items = r.results || [];
  const totalFiles = r.totalFiles ?? 0;
  const totalDirs = r.totalDirs ?? 0;
  const failCount = items.filter(i => !i.success).length;

  const paths = items
    .filter(i => i.success)
    .map(i => i.path ?? '?')
    .join(', ');

  let summary = `${totalFiles} files, ${totalDirs} dirs`;
  if (paths) summary += ` (${paths})`;
  if (failCount > 0) summary += ` | ${failCount} failed`;

  return (
    <text fg={failCount > 0 ? '#ffff00' : '#888'}>
      <em>{' \u21B3 '}{summary}</em>
    </text>
  );
}
