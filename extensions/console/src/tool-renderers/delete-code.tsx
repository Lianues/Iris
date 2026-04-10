/** @jsxImportSource @opentui/react */

/**
 * delete_code 工具渲染器
 *
 * 显示删除的行数、行范围及文件路径。
 */

import React from 'react';
import { ICONS } from '../terminal-compat';
import { ToolRendererProps } from './default.js';

interface DeleteCodeResult {
  path?: string;
  success?: boolean;
  start_line?: number;
  end_line?: number;
  deletedLines?: number;
  error?: string;
}

export function DeleteCodeRenderer({ result }: ToolRendererProps) {
  const r = (result || {}) as DeleteCodeResult;

  if (!r.path) {
    return <text fg="#888"><em>{` ${ICONS.resultArrow}`} deleted 0 lines</em></text>;
  }

  if (r.success === false) {
    return <text fg="#ff0000"><em>{` ${ICONS.resultArrow}`} failed ({r.error ?? r.path ?? '?'})</em></text>;
  }

  const deleted = r.deletedLines ?? 0;
  const range = r.start_line != null && r.end_line != null
    ? `:${r.start_line}-${r.end_line}`
    : '';
  return (
    <text fg="#888">
      <em>{` ${ICONS.resultArrow}`} <span fg="#f47067">-{deleted}</span> lines ({r.path}{range})</em>
    </text>
  );
}
