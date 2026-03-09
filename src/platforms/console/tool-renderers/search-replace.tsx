/**
 * search_replace 工具渲染器 - 极致紧凑版
 */

import React from 'react';
import { Text } from 'ink';
import { ToolRendererProps } from './default.js';

interface SearchReplaceResult {
  mode?: 'search' | 'replace';
  matchCount?: number;
  replaced?: boolean;
}

export function SearchReplaceRenderer({ result }: ToolRendererProps) {
  const r = (result || {}) as SearchReplaceResult;

  if (r.mode === 'replace') {
    return (
      <Text color={r.replaced ? 'gray' : 'yellow'} dimColor={!!r.replaced} italic>
        {' ↳ '} {r.matchCount} matches {r.replaced ? 'replaced' : 'unchanged'}
      </Text>
    );
  }

  return (
    <Text dimColor italic>
      {' ↳ '} {r.matchCount} matches found
    </Text>
  );
}
