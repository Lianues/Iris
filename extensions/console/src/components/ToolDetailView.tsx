/** @jsxImportSource @opentui/react */

/**
 * 工具执行细节页面
 *
 * 全屏视图，展示单个工具执行的完整过程。
 * 支持嵌套：子代理内部工具可递归展示，通过导航栈管理层级。
 * 工具可通过 registerToolDetailRenderer() 注册自定义详情渲染。
 */

import React, { useState, useCallback } from 'react';
import { useKeyboard } from '@opentui/react';
import type { ToolInvocation, ToolOutputEntry, ToolStatus } from '@irises/extension-sdk';
import type { ToolDetailData, ToolDetailBreadcrumb } from '../app-types';
import { getToolRenderer, getToolDetailRenderer } from '../tool-renderers';
import { Spinner } from './Spinner';
import { C } from '../theme';

interface ToolDetailViewProps {
  data: ToolDetailData;
  breadcrumb: ToolDetailBreadcrumb[];
  onNavigateChild: (toolId: string) => void;
  onClose: () => void;
  onAbort?: (toolId: string) => void;
}

const TERMINAL_STATUSES = new Set<ToolStatus>(['success', 'warning', 'error']);

const STATUS_ICON: Record<string, string> = {
  streaming: '📡', queued: '⏳', awaiting_approval: '🔐', executing: '🔧',
  awaiting_apply: '📋', success: '✅', warning: '⚠️', error: '❌',
};
const STATUS_LABEL: Record<string, string> = {
  streaming: '输出中', queued: '等待中', awaiting_approval: '等待审批', executing: '执行中',
  awaiting_apply: '等待应用', success: '成功', warning: '警告', error: '失败',
};
const OUTPUT_LABEL: Record<string, string> = {
  stdout: 'OUT', stderr: 'ERR', log: 'LOG', chat: 'CHAT', data: 'DATA',
};
const OUTPUT_COLOR: Record<string, string> = {
  stdout: '#aaa', stderr: '#ff6b6b', log: '#888', chat: '#7ec8e3', data: '#b8bb26',
};

// ── 工具函数 ──

function ts(t: number): string {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

function dur(startMs: number, endMs: number): string {
  const s = (endMs - startMs) / 1000;
  if (s < 0.05) return '';
  if (s < 60) return `${s.toFixed(1)}s`;
  return `${Math.floor(s / 60)}m${Math.floor(s % 60)}s`;
}

function truncate(text: string, max: number): string {
  const oneLine = text.replace(/\n/g, '↵ ');
  return oneLine.length > max ? oneLine.slice(0, max) + '…' : oneLine;
}

function childArgsSummary(toolName: string, args: Record<string, unknown>): string {
  switch (toolName) {
    case 'shell': case 'bash':
      return truncate(String(args.command || ''), 40);
    case 'read_file': case 'write_file': case 'apply_diff':
    case 'delete_code': case 'insert_code': {
      if (Array.isArray(args.files) && args.files.length > 0) {
        const first = args.files[0];
        const path = typeof first === 'object' && first ? String((first as any).path || '') : '';
        return args.files.length > 1 ? `${path} +${args.files.length - 1}` : path;
      }
      return String(args.path || '');
    }
    case 'search_in_files':
      return `"${truncate(String(args.query || ''), 20)}" in ${args.path || '.'}`;
    case 'find_files':
      return Array.isArray(args.patterns) ? String(args.patterns[0] || '') : '';
    case 'sub_agent':
      return truncate(String(args.prompt || ''), 50);
    default:
      return '';
  }
}

// ── 分隔线 ──

function Divider({ label }: { label?: string }) {
  if (label) {
    return (
      <text>
        <span fg={C.dim}>{'─── '}</span>
        <span fg={C.accent}><strong>{label}</strong></span>
        <span fg={C.dim}>{' ' + '─'.repeat(50)}</span>
      </text>
    );
  }
  return <text><span fg={C.dim}>{'─'.repeat(60)}</span></text>;
}

// ── 主组件 ──

export function ToolDetailView({ data, breadcrumb, onNavigateChild, onClose, onAbort }: ToolDetailViewProps) {
  const { invocation, output, children } = data;
  const { toolName, status, args, result, error, createdAt, updatedAt } = invocation;
  const [selectedIdx, setSelectedIdx] = useState(0);

  const isFinal = TERMINAL_STATUSES.has(status);
  const isExecuting = status === 'executing';

  // 自定义详情渲染器
  const DetailRenderer = getToolDetailRenderer(toolName);
  // 结果渲染器（复用现有）
  const ResultRenderer = isFinal && result != null ? getToolRenderer(toolName) : null;

  // 键盘
  useKeyboard(useCallback((key: { name: string; ctrl?: boolean }) => {
    if (key.name === 'escape' || key.name === 'q') { onClose(); return; }
    if (key.name === 'a' && !isFinal && onAbort) { onAbort(invocation.id); return; }
    if (children.length > 0) {
      if (key.name === 'up' || key.name === 'k') {
        setSelectedIdx(p => Math.max(0, p - 1));
      } else if (key.name === 'down' || key.name === 'j') {
        setSelectedIdx(p => Math.min(children.length - 1, p + 1));
      } else if (key.name === 'return') {
        const c = children[selectedIdx];
        if (c) onNavigateChild(c.id);
      }
    }
  }, [onClose, onAbort, isFinal, invocation.id, children, selectedIdx, onNavigateChild]));

  // 如果工具注册了自定义详情渲染器，直接用
  if (DetailRenderer) {
    return (
      <box flexDirection="column" width="100%">
        <BreadcrumbBar breadcrumb={breadcrumb} toolName={toolName} />
        {DetailRenderer({ invocation, output, children, onNavigateChild }) as React.ReactNode}
        <FooterBar isFinal={isFinal} hasAbort={!!onAbort} hasChildren={children.length > 0} />
      </box>
    );
  }

  // ── 默认详情布局 ──
  return (
    <box flexDirection="column" width="100%">
      {/* 面包屑 */}
      <BreadcrumbBar breadcrumb={breadcrumb} toolName={toolName} />

      {/* 标题 */}
      <box>
        <text>
          <span bg={status === 'error' ? C.error : C.accent} fg={C.cursorFg}><strong> {toolName} </strong></span>
          {'  '}
          <span fg={isFinal ? (status === 'error' ? C.error : C.accent) : C.dim}>
            {STATUS_ICON[status] || '⏳'} {STATUS_LABEL[status] || status}
          </span>
          {dur(createdAt, updatedAt) ? <span fg={C.dim}>  {dur(createdAt, updatedAt)}</span> : null}
          {'  '}
        </text>
        {isExecuting && <Spinner />}
      </box>

      {/* 时间线 */}
      <box marginTop={0}>
        <text>
          <span fg={C.dim}>  ⏱ {ts(createdAt)}</span>
          {isFinal ? <span fg={C.dim}> → {ts(updatedAt)}</span> : <span fg={C.dim}> → …</span>}
        </text>
      </box>

      {/* 参数 */}
      <Divider label="参数" />
      <ArgsSection args={args} />

      {/* 输出 */}
      {output.length > 0 && (
        <box flexDirection="column">
          <Divider label={`输出 (${output.length})`} />
          <OutputSection output={output} />
        </box>
      )}

      {/* 子工具 */}
      {children.length > 0 && (
        <box flexDirection="column">
          <Divider label={`子工具 (${children.length})`} />
          <ChildrenSection children={children} selectedIdx={selectedIdx} />
        </box>
      )}

      {/* 结果 */}
      {isFinal && (
        <box flexDirection="column">
          <Divider label="结果" />
          <ResultSection status={status} error={error} result={result} toolName={toolName} args={args} Renderer={ResultRenderer} />
        </box>
      )}

      <Divider />
      <FooterBar isFinal={isFinal} hasAbort={!!onAbort} hasChildren={children.length > 0} />
    </box>
  );
}

// ── 子组件 ──

function BreadcrumbBar({ breadcrumb, toolName }: { breadcrumb: ToolDetailBreadcrumb[]; toolName: string }) {
  return (
    <box marginBottom={0}>
      <text>
        <span fg={C.dim}>{'← [Esc] '}</span>
        {breadcrumb.map((b) => (
          <span key={b.toolId}>
            <span fg={C.dim}>{b.toolName}</span>
            <span fg={C.dim}>{' › '}</span>
          </span>
        ))}
        <span fg={C.accent}><strong>{toolName}</strong></span>
      </text>
    </box>
  );
}

function ArgsSection({ args }: { args: Record<string, unknown> }) {
  const entries = Object.entries(args);
  if (entries.length === 0) {
    return <text fg={C.dim}>  (无参数)</text>;
  }
  return (
    <box flexDirection="column">
      {entries.slice(0, 8).map(([key, val]) => {
        let display: string;
        if (typeof val === 'string') {
          display = truncate(val, 80);
        } else if (Array.isArray(val)) {
          display = `[${val.length} items]`;
        } else if (val && typeof val === 'object') {
          display = truncate(JSON.stringify(val), 80);
        } else {
          display = String(val);
        }
        return (
          <text key={key}>
            <span fg={C.accent}>  {key}</span>
            <span fg={C.dim}>{' = '}</span>
            <span>{display}</span>
          </text>
        );
      })}
      {entries.length > 8 && <text fg={C.dim}>  … +{entries.length - 8} 更多参数</text>}
    </box>
  );
}

function OutputSection({ output }: { output: ToolOutputEntry[] }) {
  // 最多显示最近 20 条
  const visible = output.length > 20 ? output.slice(-20) : output;
  const skipped = output.length - visible.length;
  return (
    <box flexDirection="column">
      {skipped > 0 && <text fg={C.dim}>  … 省略 {skipped} 条</text>}
      {visible.map((entry, i) => (
        <text key={i}>
          <span fg={C.dim}>  {ts(entry.timestamp)} </span>
          <span fg={OUTPUT_COLOR[entry.type] || C.dim}>[{OUTPUT_LABEL[entry.type] || entry.type}]</span>
          <span> {truncate(entry.content, 100)}</span>
        </text>
      ))}
    </box>
  );
}

function ChildrenSection({ children, selectedIdx }: { children: ToolInvocation[]; selectedIdx: number }) {
  return (
    <box flexDirection="column">
      {children.map((child, i) => {
        const sel = i === selectedIdx;
        const icon = STATUS_ICON[child.status] || '⏳';
        const d = dur(child.createdAt, child.updatedAt);
        const summary = childArgsSummary(child.toolName, child.args);
        return (
          <text key={child.id}>
            <span fg={sel ? C.accent : C.dim}>{sel ? ' ▸ ' : '   '}</span>
            <span bg={child.status === 'error' ? C.error : C.accent} fg={C.cursorFg}> {child.toolName} </span>
            {summary ? <span fg={C.dim}> {summary}</span> : null}
            <span> {icon}</span>
            {d ? <span fg={C.dim}> {d}</span> : null}
          </text>
        );
      })}
    </box>
  );
}

function ResultSection({ status, error, result, toolName, args, Renderer }: {
  status: ToolStatus; error?: string; result?: unknown;
  toolName: string; args: Record<string, unknown>;
  Renderer: React.FC<{ toolName: string; args: Record<string, unknown>; result: unknown }> | null;
}) {
  if (status === 'error' && error) {
    return <text fg={C.error}>  {error}</text>;
  }
  if (Renderer && result != null) {
    return (
      <box paddingLeft={2}>
        {Renderer({ toolName, args, result }) as React.ReactNode}
      </box>
    );
  }
  if (result != null) {
    const text_content = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
    const lines = text_content.split('\n');
    const visible = lines.length > 10 ? lines.slice(0, 10) : lines;
    return (
      <box flexDirection="column">
        {visible.map((line, i) => (
          <text key={i} fg={C.dim}>  {line}</text>
        ))}
        {lines.length > 10 && <text fg={C.dim}>  … +{lines.length - 10} 行</text>}
      </box>
    );
  }
  return <text fg={C.dim}>  (无结果)</text>;
}

function FooterBar({ isFinal, hasAbort, hasChildren }: { isFinal: boolean; hasAbort: boolean; hasChildren: boolean }) {
  return (
    <box>
      <text>
        <span fg={C.dim}> [Esc/q] 返回</span>
        {!isFinal && hasAbort ? <span fg={C.dim}>  [a] 终止</span> : null}
        {hasChildren ? <span fg={C.dim}>  [↑↓] 选择子工具  [Enter] 查看详情</span> : null}
      </text>
    </box>
  );
}
