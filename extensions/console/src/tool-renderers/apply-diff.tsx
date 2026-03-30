/** @jsxImportSource @opentui/react */

/**
 * apply_diff 工具渲染器
 *
 * 显示 hunk 应用情况及增删行数统计。
 */

import React from 'react';
import { ToolRendererProps } from './default.js';

interface ApplyDiffResult {
  path?: string;
  totalHunks?: number;
  applied?: number;
  failed?: number;
}

/**
 * 从 unified diff patch 文本中统计新增和删除的行数。
 * 只计算以 `+`/`-` 开头的实际变更行，排除 `---`/`+++` 文件头和 `@@` hunk 头。
 */
function countPatchLines(patch: unknown): { added: number; deleted: number } {
  if (typeof patch !== 'string') return { added: 0, deleted: 0 };
  let added = 0;
  let deleted = 0;
  const lines = patch.split('\n');
  for (const line of lines) {
    if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('@@')) continue;
    if (line.startsWith('+')) added++;
    else if (line.startsWith('-')) deleted++;
  }
  return { added, deleted };
}

export function ApplyDiffRenderer({ args, result }: ToolRendererProps) {
  const r = (result || {}) as ApplyDiffResult;
  const isError = (r.failed ?? 0) > 0;
  const { added, deleted } = countPatchLines(args?.patch);

  const hasStats = added > 0 || deleted > 0;

  return (
    <text fg={isError ? '#ffff00' : '#888'}>
      <em>
        {' \u21B3 '}
        {added > 0 && <span fg="#57ab5a">+{added}</span>}
        {added > 0 && deleted > 0 && ' '}
        {deleted > 0 && <span fg="#f47067">-{deleted}</span>}
        {hasStats && ', '}
        {r.applied}/{r.totalHunks} hunks
        {isError ? `, ${r.failed} failed` : ''}
        {r.path ? ` (${r.path})` : ''}
      </em>
    </text>
  );
}
