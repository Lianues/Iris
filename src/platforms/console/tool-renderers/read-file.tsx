/**
 * read_file 工具渲染器 - 极致紧凑版
 */

import React from 'react';
import { Text } from 'ink';
import { ToolRendererProps } from './default.js';

interface ReadFileResult {
  path?: string;
  totalLines?: number;
  startLine?: number;
  endLine?: number;
}

export function ReadFileRenderer({ result }: ToolRendererProps) {
  const r = (result || {}) as ReadFileResult;

  return (
    <Text dimColor italic>
      {' ↳'} read {r.totalLines ?? 0} lines ({r.startLine}-{r.endLine})
    </Text>
  );
}
