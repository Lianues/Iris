/**
 * find_files 工具渲染器
 */

import React from 'react';
import { ToolRendererProps } from './default.js';

interface FindFilesResult {
  count?: number;
  truncated?: boolean;
}

export function FindFilesRenderer({ result }: ToolRendererProps) {
  const r = (result || {}) as FindFilesResult;
  const count = r.count ?? 0;
  const suffix = r.truncated ? ' (truncated)' : '';

  return <text fg="#888"><em>{' \u21B3 '} {count} files found{suffix}</em></text>;
}
