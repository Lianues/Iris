/**
 * 默认工具结果渲染器 - 极致紧凑版
 * 将 JSON 压平为一行，最多显示 100 字符。
 */

import React from 'react';
import { Text } from 'ink';

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

  return <Text dimColor italic> ↳ {truncated}</Text>;
}
