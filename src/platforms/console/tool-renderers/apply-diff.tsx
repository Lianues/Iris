/**
 * apply_diff 工具渲染器 - 极致紧凑版
 */

import React from 'react';
import { Text } from 'ink';
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
    <Text color={isError ? 'yellow' : 'gray'} dimColor={!isError} italic>
      {' ↳ '} {r.applied}/{r.totalHunks} hunks applied{isError ? `, ${r.failed} failed` : ''}
    </Text>
  );
}
