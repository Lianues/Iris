/**
 * apply_diff 工具渲染器
 */

import React from 'react';
import { ToolRendererProps } from './default.js';

interface ApplyDiffResult {
  path?: string;
  totalHunks?: number;
  applied?: number;
  failed?: number;
}

export function ApplyDiffRenderer({ result }: ToolRendererProps) {
  const r = (result || {}) as ApplyDiffResult;
  const isError = (r.failed ?? 0) > 0;

  return (
    <text fg={isError ? '#ffff00' : '#888'}>
      <em>{' \u21B3 '} {r.applied}/{r.totalHunks} hunks applied{isError ? `, ${r.failed} failed` : ''}</em>
    </text>
  );
}
