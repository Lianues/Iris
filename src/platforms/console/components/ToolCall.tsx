/**
 * 工具调用卡片
 */

import React from 'react';
import { Box, Text } from 'ink';
import { Spinner } from './Spinner';
import { ToolInvocation, ToolStatus } from '../../../types';
import { getToolRenderer } from '../tool-renderers';

interface ToolCallProps {
  invocation: ToolInvocation;
  lineColor?: string;
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

      if (filePaths.length > 1) {
        return `${filePaths[0]} +${filePaths.length - 1}`;
      }
      if (filePaths.length === 1) {
        return filePaths[0];
      }

      const singleFilePath = args.file && typeof args.file === 'object'
        ? String((args.file as Record<string, unknown>).path ?? '').trim()
        : '';
      return singleFilePath || String(args.path || '');
    }
    case 'apply_diff':
      return String(args.path || '');
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

export function ToolCall({ invocation, lineColor = 'green' }: ToolCallProps) {
  const { toolName, status, args, result, error, createdAt, updatedAt } = invocation;
  const isFinal = TERMINAL_STATUSES.has(status);
  const isExecuting = status === 'executing';
  const isAwaitingApproval = status === 'awaiting_approval';

  const argsSummary = getArgsSummary(toolName, args);
  const Renderer = isFinal && result != null ? getToolRenderer(toolName) : null;
  const duration = isFinal ? ((updatedAt - createdAt) / 1000).toFixed(1) + 's' : '';

  return (
    <Box flexDirection="column">
      <Box>
        <Text>
          <Text dimColor color={lineColor}>{"\u251C\u2500 "}</Text>
          <Text bold={!isFinal} color={isFinal ? 'gray' : (isAwaitingApproval ? 'yellow' : undefined)}>{toolName}</Text>
          {argsSummary.length > 0 && <Text dimColor> {argsSummary}</Text>}
          {status === 'success' && <Text dimColor> {'\u2713'}</Text>}
          {status === 'warning' && <Text color="yellow"> !</Text>}
          {status === 'error' && <Text color="red"> {'\u2717'}</Text>}
          {isAwaitingApproval && <Text color="yellow"> [待确认]</Text>}
          {!isFinal && !isExecuting && !isAwaitingApproval && <Text dimColor> [{status}]</Text>}
          {duration && <Text dimColor> {duration}</Text>}
        </Text>
        {isExecuting && <Spinner />}
      </Box>
      {status === 'error' && error && (
        <Text>
          <Text dimColor color={lineColor}>{"\u2502  "}</Text>
          <Text color="red" italic>{'\u21B3'} {error}</Text>
        </Text>
      )}
      {Renderer && result != null && (
        <Box>
          <Text dimColor color={lineColor}>{"\u2502  "}</Text>
          <Renderer toolName={toolName} args={args} result={result} />
        </Box>
      )}
    </Box>
  );
}
