/** @jsxImportSource @opentui/react */

/**
 * write_file 工具渲染器
 *
 * 显示写入操作的 action、行数及文件路径。
 * 从 args.files[].content 统计写入行数。
 */

import React from 'react';
import { ToolRendererProps } from './default.js';

interface WriteResultItem {
  path?: string;
  success?: boolean;
  action?: 'created' | 'modified' | 'unchanged';
  error?: string;
}

interface WriteFileResult {
  results?: WriteResultItem[];
  successCount?: number;
  failCount?: number;
  totalCount?: number;
}

interface ArgsFileEntry {
  path?: string;
  content?: string;
}

function basename(p: string): string {
  return p.split('/').pop() || p;
}

/** 从 args 中提取 files 数组（兼容多种传入格式） */
function extractArgsFiles(args: Record<string, unknown>): ArgsFileEntry[] {
  if (Array.isArray(args.files)) return args.files as ArgsFileEntry[];
  if (args.files && typeof args.files === 'object') return [args.files as ArgsFileEntry];
  if (args.file && typeof args.file === 'object') return [args.file as ArgsFileEntry];
  if (typeof args.path === 'string' && typeof args.content === 'string') {
    return [{ path: args.path, content: args.content }];
  }
  return [];
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

/** 根据 path 从 argsFiles 中找到匹配的 content 并算行数 */
function getLineCount(path: string | undefined, argsFiles: ArgsFileEntry[]): number {
  if (!path) return 0;
  const entry = argsFiles.find(f => f.path === path);
  return entry ? countLines(entry.content) : 0;
}

export function WriteFileRenderer({ args, result }: ToolRendererProps) {
  const r = (result || {}) as WriteFileResult;
  const items = r.results || [];
  const failCount = r.failCount ?? 0;
  const argsFiles = extractArgsFiles(args || {});

  if (items.length === 0) {
    return <text fg="#888"><em>{' \u21B3'} wrote 0 files</em></text>;
  }

  // 单文件：显示 行数 + action + 完整路径
  if (items.length === 1) {
    const item = items[0];
    const action = item.action ?? (item.success ? 'written' : 'failed');
    const fg = item.success === false ? '#ff0000' : '#888';
    const lines = getLineCount(item.path, argsFiles);
    const hasLines = lines > 0 && action !== 'unchanged';
    return (
      <text fg={fg}>
        <em>
          {' \u21B3 '}
          {hasLines && (action === 'created'
            ? <span fg="#57ab5a">+{lines}</span>
            : <span fg="#d2a8ff">~{lines}</span>)}
          {hasLines ? ' lines, ' : ''}
          {action} ({item.path ?? '?'})
        </em>
      </text>
    );
  }

  // 多文件：按 action 分组统计 + 总行数
  const counts: Record<string, number> = {};
  let totalLines = 0;
  for (const item of items) {
    const key = item.success === false ? 'failed' : (item.action ?? 'written');
    counts[key] = (counts[key] || 0) + 1;
    if (item.success !== false && item.action !== 'unchanged') {
      totalLines += getLineCount(item.path, argsFiles);
    }
  }

  const parts: string[] = [];
  for (const action of ['created', 'modified', 'unchanged', 'written', 'failed']) {
    if (counts[action]) {
      parts.push(`${counts[action]} ${action}`);
    }
  }

  const names = items.map(i => basename(i.path ?? '?')).join(', ');

  return (
    <text fg={failCount > 0 ? '#ffff00' : '#888'}>
      <em>
        {' \u21B3 '}
        {totalLines > 0 && <span fg="#d2a8ff">~{totalLines}</span>}
        {totalLines > 0 ? ' lines, ' : ''}
        {parts.join(', ')} ({names})
      </em>
    </text>
  );
}
