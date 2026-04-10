/** @jsxImportSource @opentui/react */

/**
 * insert_code 工具渲染器
 *
 * 显示插入的行数、插入位置及文件路径。
 */

import React from 'react';
import { ICONS } from '../terminal-compat';
import { ToolRendererProps } from './default.js';

interface InsertCodeResult {
  path?: string;
  success?: boolean;
  line?: number;
  insertedLines?: number;
  error?: string;
}

export function InsertCodeRenderer({ result }: ToolRendererProps) {
  const r = (result || {}) as InsertCodeResult;

  if (!r.path) {
    return <text fg="#888"><em>{` ${ICONS.resultArrow}`} inserted 0 lines</em></text>;
  }

  if (r.success === false) {
    return <text fg="#ff0000"><em>{` ${ICONS.resultArrow}`} failed ({r.error ?? r.path ?? '?'})</em></text>;
  }

  const inserted = r.insertedLines ?? 0;
  const pos = r.line != null ? ` at L${r.line}` : '';
  return (
    <text fg="#888">
      <em>{` ${ICONS.resultArrow}`} <span fg="#57ab5a">+{inserted}</span> lines{pos} ({r.path})</em>
    </text>
  );
}
