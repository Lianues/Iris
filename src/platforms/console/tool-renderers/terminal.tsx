/**
 * terminal 工具渲染器 - 极致紧凑版
 */

import React from 'react';
import { Text } from 'ink';
import { ToolRendererProps } from './default.js';

interface TerminalResult {
  command?: string;
  exitCode?: number;
  killed?: boolean;
stdout?: string;
  stderr?: string;
}

export function TerminalRenderer({ result }: ToolRendererProps) {
  const r = (result || {}) as TerminalResult;
  const isError = r.exitCode !== 0;
  
  const stdoutLen = r.stdout?.length ?? 0;
  const stderrLen = r.stderr?.length ?? 0;
  
  let summary = `exited with ${r.exitCode}`;
  if (r.killed) summary += ' (killed)';
  summary += `, out: ${stdoutLen}b, err: ${stderrLen}b`;

  return (
    <Text color={isError ? 'red' : 'gray'} dimColor={!isError} italic>
      {' ↳ '}{summary}
    </Text>
  );
}
