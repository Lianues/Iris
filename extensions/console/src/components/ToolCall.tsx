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
        </text>
        {isExecuting && <text><Spinner /></text>}
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
