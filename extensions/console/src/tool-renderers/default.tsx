/** @jsxImportSource @opentui/react */

/**
 * 默认工具结果渲染器
 * 将 JSON 压平为一行，最多显示 80 字符。
 */

import React from 'react';

export interface ToolRendererProps {
  toolName: string;
  args: Record<string, unknown>;
  result: unknown;
}

export function DefaultRenderer({ result }: ToolRendererProps) {
  const text = typeof result === 'string'
    ? result.replace(/\n/g, ' ')
    : JSON.stringify(result).replace(/\n/g, ' ');

  const truncated = text.length > 80 ? text.slice(0, 80) + '...' : text;

  return <text fg="#888"><em> ↳ {truncated}</em></text>;
}
