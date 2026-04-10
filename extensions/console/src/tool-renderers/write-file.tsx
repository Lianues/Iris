/** @jsxImportSource @opentui/react */

/**
 * write_file 工具渲染器
 *
 * 显示写入操作的 action、行数及文件路径。
 * 从 args.content 统计写入行数。
 */

import React from 'react';
import { ICONS } from '../terminal-compat';
import { ToolRendererProps } from './default.js';

interface WriteFileResult {
  path?: string;
  success?: boolean;
  action?: 'created' | 'modified' | 'unchanged';
  error?: string;
}

/** 统计字符串的行数 */
function countLines(content: unknown): number {
  if (typeof content !== 'string') return 0;
  if (content.length === 0) return 0;
  // 按换行符拆分，末尾换行不多算一行
  return content.endsWith('\n')
    ? content.split('\n').length - 1
    : content.split('\n').length;
}

export function WriteFileRenderer({ args, result }: ToolRendererProps) {
  const r = (result || {}) as WriteFileResult;
  const action = r.action ?? (r.success ? 'written' : 'failed');
  const fg = r.success === false ? '#ff0000' : '#888';
  const lines = countLines((args || {}).content);
  const hasLines = lines > 0 && action !== 'unchanged';

  if (!r.path) {
    return <text fg="#888"><em>{` ${ICONS.resultArrow}`} wrote 0 files</em></text>;
  }

  return (
    <text fg={fg}>
      <em>
        {` ${ICONS.resultArrow} `}
        {hasLines && (action === 'created'
          ? <span fg="#57ab5a">+{lines}</span>
          : <span fg="#d2a8ff">~{lines}</span>)}
        {hasLines ? ' lines, ' : ''}
        {action} ({r.path})
      </em>
    </text>
  );
}
