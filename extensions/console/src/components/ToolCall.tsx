/** @jsxImportSource @opentui/react */

/**
 * 工具调用卡片
 */

import React from 'react';
import { Spinner } from './Spinner';
import type { ToolInvocation, ToolStatus } from '@irises/extension-sdk';
import { getToolRenderer } from '../tool-renderers';
import { C } from '../theme';

interface ToolCallProps {
  invocation: ToolInvocation;
}

const TERMINAL_STATUSES = new Set<ToolStatus>(['success', 'warning', 'error']);

// 数据驱动的 spinner 帧序列（用于工具执行中的 chunk 心跳进度展示）
const SPINNER_FRAMES = ['\u280B', '\u2819', '\u2839', '\u2838', '\u283C', '\u2834', '\u2826', '\u2827', '\u2807', '\u280F'];

function getArgsSummary(toolName: string, args: Record<string, unknown>): string {
  switch (toolName) {
    case 'shell': {
      const cmd = String(args.command || '');
      return cmd.length > 30 ? `"${cmd.slice(0, 30)}\u2026"` : `"${cmd}"`;
    }
    case 'read_file': {
      const files = Array.isArray(args.files) ? args.files as unknown[] : [];
      const filePaths = files
        .map((entry) => {
          if (!entry || typeof entry !== 'object') return '';
          return String((entry as Record<string, unknown>).path ?? '').trim();
        })
        .filter(Boolean);
      if (filePaths.length > 1) return `${filePaths[0]} +${filePaths.length - 1}`;
      if (filePaths.length === 1) return filePaths[0];
      const singleFilePath = args.file && typeof args.file === 'object'
        ? String((args.file as Record<string, unknown>).path ?? '').trim() : '';
      return singleFilePath || String(args.path || '');
    }
    case 'apply_diff':
      return String(args.path || '');
    case 'write_file': {
      const files = Array.isArray(args.files) ? args.files as unknown[] : [];
      if (files.length > 1) {
        const first = files[0] && typeof files[0] === 'object'
          ? String((files[0] as Record<string, unknown>).path ?? '') : '';
        return first ? `${first} +${files.length - 1}` : `${files.length} files`;
      }
      if (files.length === 1 && files[0] && typeof files[0] === 'object') {
        return String((files[0] as Record<string, unknown>).path ?? '');
      }
      return String(args.path || '');
    }
    case 'delete_code':
    case 'insert_code': {
      const files = Array.isArray(args.files) ? args.files as unknown[] : [];
      if (files.length > 1) {
        const first = files[0] && typeof files[0] === 'object'
          ? String((files[0] as Record<string, unknown>).path ?? '') : '';
        return first ? `${first} +${files.length - 1}` : `${files.length} files`;
      }
      if (files.length === 1 && files[0] && typeof files[0] === 'object') {
        return String((files[0] as Record<string, unknown>).path ?? '');
      }
      return String(args.path || '');
    }
    case 'search_in_files': {
      const q = String(args.query || '');
      const p = String(args.path || '');
      const head = q.length > 20 ? `"${q.slice(0, 20)}\u2026"` : `"${q}"`;
      return p ? `${head} in ${p}` : head;
    }
    case 'find_files': {
      const patterns = Array.isArray(args.patterns) ? (args.patterns as unknown[]).map(String) : [];
      const first = patterns[0] ?? '';
      return first ? `"${first}"` : '';
    }
    default:
      return '';
  }
}

export function ToolCall({ invocation }: ToolCallProps) {
  const { toolName, status, args, result, error, createdAt, updatedAt } = invocation;

  // 通用进度字段（由 handler yield 的中间值填充，scheduler 推送到 ToolStateManager.progress）
  // 各工具自行定义结构，如 sub_agent: { tokens: number, frame: number }
  const progress = invocation.progress as Record<string, unknown> | undefined;
  const progressTokens = typeof progress?.tokens === 'number' ? progress.tokens : undefined;
  const progressFrame = typeof progress?.frame === 'number' ? progress.frame : undefined;
  const hasProgress = progress != null;

  const isFinal = TERMINAL_STATUSES.has(status);
  const isExecuting = status === 'executing';
  const isAwaitingApproval = status === 'awaiting_approval';

  const argsSummary = getArgsSummary(toolName, args);
  const Renderer = isFinal && result != null ? getToolRenderer(toolName) : null;
  const durationSec = (updatedAt - createdAt) / 1000;
  const duration = isFinal && durationSec > 0 ? durationSec.toFixed(1) + 's' : '';

  const nameColor = isAwaitingApproval ? C.warn : C.dim;

  return (
    <box flexDirection="column">
      <box flexDirection="row" gap={1}>
        <text>
          <span fg={nameColor}>{toolName}</span>
          {argsSummary.length > 0 && <span fg={C.dim}> {argsSummary}</span>}
          {status === 'success' ? <span fg={C.accent}> {'\u2713'}</span> : null}
          {status === 'warning' ? <span fg={C.warn}> !</span> : null}
          {status === 'error' ? <span fg={C.error}> {'\u2717'}</span> : null}
          {isAwaitingApproval ? <span fg={C.warn}> [待确认]</span> : null}
          {!isFinal && !isExecuting && !isAwaitingApproval ? <span fg={C.dim}> [{status}]</span> : null}
          {duration ? <span fg={C.dim}> {duration}</span> : null}
          {/* 工具执行中进度：实时 token 计数 */}
          {isExecuting && progressTokens != null && progressTokens > 0 ? (
            <span fg={C.dim}> {'\u2191'}{progressTokens.toLocaleString()}tk</span>
          ) : null}
        </text>
        {/* executing 状态的 spinner：有进度数据时用数据驱动帧，否则用定时器驱动 */}
        {isExecuting && hasProgress ? (
          <text><span fg={C.accent}>{SPINNER_FRAMES[(progressFrame ?? 0) % SPINNER_FRAMES.length]}</span></text>
        ) : isExecuting ? (
          <text><Spinner /></text>
        ) : null}
      </box>
      {status === 'error' && error && (
        <text fg={C.error}><em>  {error}</em></text>
      )}
      {Renderer && result != null && (
        <box paddingLeft={2}>
          {Renderer({ toolName, args, result }) as React.ReactNode}
        </box>
      )}
    </box>
  );
}
