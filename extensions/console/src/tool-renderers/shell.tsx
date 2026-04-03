/** @jsxImportSource @opentui/react */

/**
 * shell / bash 工具渲染器
 *
 * 成功时：显示输出行数
 * 失败时：显示 stderr 内容（截断），让用户直接看到原因
 */

import React from 'react';
import { ToolRendererProps } from './default.js';

interface ShellResult {
  command?: string;
  exitCode?: number;
  killed?: boolean;
  stdout?: string;
  stderr?: string;
}

/** 统计非空行数 */
function lineCount(text: string | undefined): number {
  if (!text) return 0;
  return text.split('\n').filter(Boolean).length;
}

/** 取第一行并截断 */
function firstLine(text: string | undefined, max: number): string {
  if (!text) return '';
  const line = text.trimStart().split('\n')[0] ?? '';
  return line.length > max ? line.slice(0, max) + '…' : line;
}

export function ShellRenderer({ result }: ToolRendererProps) {
  const r = (result || {}) as ShellResult;
  const exitCode = r.exitCode ?? 0;
  const isError = exitCode !== 0;

  // ---- 被超时杀死 ----
  if (r.killed) {
    return (
      <text fg="#ff0000">
        <em>{' \u21B3 '}killed (timeout)</em>
      </text>
    );
  }

  // ---- 失败：显示 stderr 内容 ----
  if (isError) {
    const reason = firstLine(r.stderr, 100) || `exit ${exitCode}`;
    return (
      <text fg="#ff0000">
        <em>{' \u21B3 '}{reason}</em>
      </text>
    );
  }

  // ---- 成功：显示输出行数 ----
  const lines = lineCount(r.stdout);
  const summary = lines > 0 ? `${lines} lines output` : 'done (no output)';
  return (
    <text fg="#888">
      <em>{' \u21B3 '}{summary}</em>
    </text>
  );
}
