/** @jsxImportSource @opentui/react */

/**
 * 工具执行列表视图
 * 展示当前会话所有工具调用，支持 ↑↓ 选择、Enter 查看详情。
 */

import React from 'react';
import type { ToolInvocation, ToolStatus } from '@irises/extension-sdk';
import { C } from '../theme';

interface ToolListViewProps {
  tools: ToolInvocation[];
  selectedIndex: number;
}

const STATUS_ICON: Record<string, string> = {
  streaming: '📡', queued: '⏳', awaiting_approval: '🔐', executing: '🔧',
  awaiting_apply: '📋', success: '✅', warning: '⚠️', error: '❌',
};

function formatDuration(startMs: number, endMs: number): string {
  const s = (endMs - startMs) / 1000;
  if (s < 0.05) return '';
  if (s < 60) return `${s.toFixed(1)}s`;
  return `${Math.floor(s / 60)}m${Math.floor(s % 60)}s`;
}

function argsSummary(toolName: string, args: Record<string, unknown>): string {
  switch (toolName) {
    case 'shell': case 'bash': {
      const cmd = String(args.command || '');
      return cmd.length > 40 ? `"${cmd.slice(0, 40)}…"` : `"${cmd}"`;
    }
    case 'read_file': case 'write_file': case 'apply_diff':
    case 'delete_code': case 'insert_code': {
      if (Array.isArray(args.files) && args.files.length > 0) {
        const first = args.files[0];
        const path = typeof first === 'object' && first ? String((first as any).path || '') : '';
        return args.files.length > 1 ? `${path} +${args.files.length - 1}` : path;
      }
      return String(args.path || '');
    }
    case 'search_in_files': {
      const q = String(args.query || '');
      const head = q.length > 20 ? `"${q.slice(0, 20)}…"` : `"${q}"`;
      return args.path ? `${head} in ${args.path}` : head;
    }
    case 'find_files':
      return Array.isArray(args.patterns) ? String(args.patterns[0] || '') : '';
    case 'sub_agent': {
      const prompt = String(args.prompt || '');
      return prompt.length > 50 ? `"${prompt.slice(0, 50)}…"` : `"${prompt}"`;
    }
    default:
      return '';
  }
}

export function ToolListView({ tools, selectedIndex }: ToolListViewProps) {
  if (tools.length === 0) {
    return (
      <box flexDirection="column" paddingX={1}>
        <text fg={C.dim}>当前会话没有工具执行记录。</text>
        <text fg={C.dim}> </text>
        <text fg={C.dim}>Esc 返回</text>
      </box>
    );
  }

  return (
    <box flexDirection="column" paddingX={1}>
      <text>
        <span fg={C.accent}><strong> 工具执行记录 </strong></span>
        <span fg={C.dim}>({tools.length})</span>
      </text>
      <text fg={C.dim}>{'─'.repeat(60)}</text>

      <scrollbox flexGrow={1}>
        {tools.map((inv, i) => {
          const sel = i === selectedIndex;
          const icon = STATUS_ICON[inv.status] || '⏳';
          const d = formatDuration(inv.createdAt, inv.updatedAt);
          const summary = argsSummary(inv.toolName, inv.args);
          const time = new Date(inv.createdAt);
          const timeStr = `${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}:${String(time.getSeconds()).padStart(2, '0')}`;

          return (
            <text key={inv.id}>
              <span fg={sel ? C.accent : C.dim}>{sel ? ' ❯ ' : '   '}</span>
              <span fg={C.dim}>{timeStr} </span>
              <span bg={inv.status === 'error' ? C.error : C.accent} fg={C.cursorFg}> {inv.toolName} </span>
              {summary ? <span fg={sel ? undefined : C.dim}> {summary}</span> : null}
              <span> {icon}</span>
              {d ? <span fg={C.dim}> {d}</span> : null}
            </text>
          );
        })}
      </scrollbox>

      <text fg={C.dim}>{'─'.repeat(60)}</text>
      <text fg={C.dim}> ↑↓ 选择  Enter 查看详情  Esc 返回</text>
    </box>
  );
}
