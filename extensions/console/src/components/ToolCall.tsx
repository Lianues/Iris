/** @jsxImportSource @opentui/react */

/**
 * 工具调用卡片
 */

import React, { useEffect, useState } from 'react';
import { Spinner } from './Spinner';
import type { ToolInvocation, ToolStatus } from 'irises-extension-sdk';
import { getToolRenderer } from '../tool-renderers';
import { useResultWithResolvedDiffPreview } from '../tool-renderers/use-diff-preview-result.js';
import { formatToolError } from '../tool-errors';
import type { ConsoleToolDisplayService } from '../tool-display-service';
import { C } from '../theme';
import { SPINNER_FRAMES, ICONS } from '../terminal-compat';

interface ToolCallProps {
  invocation: ToolInvocation;
  /** 当前 Console 工具显示服务实例 */
  toolDisplayService?: ConsoleToolDisplayService;
}

const TERMINAL_STATUSES = new Set<ToolStatus>(['success', 'warning', 'error']);

function getArgsSummary(toolName: string, args: Record<string, unknown>): string {
  switch (toolName) {
    case 'bash':
    case 'shell': {
      const cmd = String(args.command || '');
      return cmd.length > 60 ? `"${cmd.slice(0, 60)}${ICONS.ellipsis}"` : `"${cmd}"`;
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
      const include = Array.isArray(args.include) ? (args.include as unknown[]).map(String).join(', ') : '';
      const head = q.length > 20 ? `"${q.slice(0, 20)}${ICONS.ellipsis}"` : `"${q}"`;
      return include ? `${head} in ${include}` : head;
    }
    case 'find_files': {
      const patterns = Array.isArray(args.patterns) ? (args.patterns as unknown[]).map(String) : [];
      const first = patterns[0] ?? '';
      return first ? `"${first}"` : '';
    }
    case 'read_skill': {
      return String(args.name || args.path || '');
    }
    case 'read_skill_resource':
    case 'execute_skill_script': {
      const name = String(args.name || '');
      const relativePath = String(args.relativePath || '');
      return [name, relativePath].filter(Boolean).join(' · ');
    }
    case 'invoke_skill': {
      const skill = String(args.skill || '');
      const skillArgs = String(args.args || '');
      const preview = skillArgs.length > 40 ? `${skillArgs.slice(0, 40)}${ICONS.ellipsis}` : skillArgs;
      return preview ? `${skill} ${preview}` : skill;
    }
    case 'sub_agent': {
      const type = String(args.type || 'general-purpose');
      const prompt = String(args.prompt || '');
      const preview = prompt.length > 40 ? `${prompt.slice(0, 40)}${ICONS.ellipsis}` : prompt;
      return type !== 'general-purpose' ? type : preview;
    }
    default:
      return '';
  }
}

export function ToolCall({ invocation, toolDisplayService }: ToolCallProps) {
  const { toolName, status, args, result, error, createdAt, updatedAt } = invocation;
  const displayError = formatToolError(error);
  const [asyncArgsSummary, setAsyncArgsSummary] = useState<string | undefined>();
  const [asyncProgressLine, setAsyncProgressLine] = useState<string | undefined>();
  const [asyncResultSummary, setAsyncResultSummary] = useState<string | undefined>();

  const displayResult = useResultWithResolvedDiffPreview(result);

  // 通用进度字段（由 handler yield 的中间值填充，scheduler 推送到 ToolStateManager.progress）
  // 各工具自行定义结构，如 sub_agent: { tokens: number, frame: number, streamingText: string }
  const progress = invocation.progress as Record<string, unknown> | undefined;
  const progressTokens = typeof progress?.tokens === 'number' ? progress.tokens : undefined;
  const progressFrame = typeof progress?.frame === 'number' ? progress.frame : undefined;
  const displayProvider = toolDisplayService?.get(toolName);
  useEffect(() => {
    let cancelled = false;
    if (!displayProvider?.getArgsSummaryAsync) { setAsyncArgsSummary(undefined); return; }
    void displayProvider.getArgsSummaryAsync({ toolName, args }).then((value) => {
      if (!cancelled) setAsyncArgsSummary(value);
    }).catch(() => { if (!cancelled) setAsyncArgsSummary(undefined); });
    return () => { cancelled = true; };
  }, [displayProvider, toolName, args]);
  useEffect(() => {
    let cancelled = false;
    if (!displayProvider?.getProgressLineAsync) { setAsyncProgressLine(undefined); return; }
    void displayProvider.getProgressLineAsync({ toolName, args, progress }).then((value) => {
      if (!cancelled) setAsyncProgressLine(value);
    }).catch(() => { if (!cancelled) setAsyncProgressLine(undefined); });
    return () => { cancelled = true; };
  }, [displayProvider, toolName, args, progress]);
  useEffect(() => {
    let cancelled = false;
    if (!displayProvider?.getResultSummaryAsync || !(TERMINAL_STATUSES.has(status) && displayResult != null)) { setAsyncResultSummary(undefined); return; }
    void displayProvider.getResultSummaryAsync({ toolName, args, result: displayResult }).then((value) => {
      if (!cancelled) setAsyncResultSummary(value);
    }).catch(() => { if (!cancelled) setAsyncResultSummary(undefined); });
    return () => { cancelled = true; };
  }, [displayProvider, toolName, args, displayResult, status]);
  const customProgressLine = displayProvider?.getProgressLine?.({ toolName, args, progress }) ?? '';
  const hasProgress = progress != null;
  // sub_agent 专用：实时状态行
  //   childStatus  — 子代理内部正在执行的工具摘要（工具执行期间）
  //   streamingText — 子代理 LLM 流式输出的最后一行（LLM 生成期间）
  // childStatus 优先：工具正在跑时显示工具名，LLM 生成时显示文本预览
  const childStatus = typeof progress?.childStatus === 'string' ? progress.childStatus : '';
  const streamingText = typeof progress?.streamingText === 'string' ? progress.streamingText : '';
  const subAgentStatusLine = childStatus || streamingText;

  const isFinal = TERMINAL_STATUSES.has(status);
  const isExecuting = status === 'executing';
  const isAwaitingApproval = status === 'awaiting_approval';

  const argsSummary = displayProvider?.getArgsSummary?.({ toolName, args }) ?? asyncArgsSummary ?? getArgsSummary(toolName, args);
  const Renderer = isFinal && displayResult != null ? getToolRenderer(toolName) : null;
  const durationSec = (updatedAt - createdAt) / 1000;
  const duration = isFinal && durationSec > 0 ? durationSec.toFixed(1) + 's' : '';
  const customResultSummary = isFinal && displayResult != null
    ? displayProvider?.getResultSummary?.({ toolName, args, result: displayResult }) ?? asyncResultSummary ?? ''
    : '';

  const nameBg = status === 'error' ? C.error : isAwaitingApproval ? C.warn : C.accent;
  const progressLineText = customProgressLine || asyncProgressLine || '';

  return (
    <box flexDirection="column">
      <box flexDirection="row" gap={1}>
        <text>
          <span bg={nameBg} fg={C.cursorFg}> {toolName} </span>
          {argsSummary.length > 0 && <span fg={C.dim}> {argsSummary}</span>}
          {status === 'success' ? <span fg={C.accent}> {ICONS.checkmark}</span> : null}
          {status === 'warning' ? <span fg={C.warn}> !</span> : null}
          {status === 'error' ? <span fg={C.error}> {ICONS.crossmark}</span> : null}
          {isAwaitingApproval ? <span fg={C.warn}> [待确认]</span> : null}
          {!isFinal && !isExecuting && !isAwaitingApproval ? <span fg={C.dim}> [{status}]</span> : null}
          {duration ? <span fg={C.dim}> {duration}</span> : null}
          {customResultSummary ? <span fg={C.dim}> {customResultSummary}</span> : null}
          {/* 工具执行中进度：实时 token 计数 */}
          {isExecuting && progressTokens != null && progressTokens > 0 ? (
            <span fg={C.dim}> {ICONS.upArrow}{progressTokens.toLocaleString()}tk</span>
          ) : null}
        </text>
        {/* executing 状态的 spinner：有进度数据时用数据驱动帧，否则用定时器驱动 */}
        {isExecuting && hasProgress ? (
          <text><span fg={C.accent}>{SPINNER_FRAMES[(progressFrame ?? 0) % SPINNER_FRAMES.length]}</span></text>
        ) : isExecuting ? (
          <text><Spinner /></text>
        ) : null}
      </box>
      {status === 'error' && displayError && (
        <text fg={C.error}><em>  {displayError}</em></text>
      )}
      {isExecuting && progressLineText.length > 0 && (
        <text><span fg={C.accent}>  {progressLineText}</span></text>
      )}
      {/* sub_agent 执行中：显示当前子工具 或 LLM 文本预览 */}
      {isExecuting && toolName === 'sub_agent' && subAgentStatusLine.length > 0 && (
        <text><span fg={C.dim}><em>  {subAgentStatusLine}</em></span></text>
      )}
      {invocation.children && invocation.children.length > 0 && (
        <box flexDirection="column" paddingLeft={2}>
          {invocation.children.map(child => (
            <ToolCall key={child.id} invocation={child} toolDisplayService={toolDisplayService} />
          ))}
        </box>
      )}
      {Renderer && displayResult != null && (
        <box paddingLeft={2}>
          {Renderer({ toolName, args, result: displayResult }) as React.ReactNode}
        </box>
      )}
    </box>
  );
}
