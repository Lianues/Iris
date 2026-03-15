/**
 * shell 工具渲染器
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

export function ShellRenderer({ result }: ToolRendererProps) {
  const r = (result || {}) as ShellResult;
  const isError = r.exitCode !== 0;

  const stdoutLen = r.stdout?.length ?? 0;
  const stderrLen = r.stderr?.length ?? 0;

  let summary = `exited with ${r.exitCode}`;
  if (r.killed) summary += ' (killed)';
  summary += `, out: ${stdoutLen}b, err: ${stderrLen}b`;

  return (
    <text fg={isError ? '#ff0000' : '#888'}>
      <em>{' \u21B3 '}{summary}</em>
    </text>
  );
}
