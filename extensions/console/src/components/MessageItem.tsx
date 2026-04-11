/** @jsxImportSource @opentui/react */

/**
 * 单条消息渲染
 */

import React, { useEffect, useRef, useState } from 'react';
import { useTerminalDimensions } from '@opentui/react';
import type { ToolInvocation } from 'irises-extension-sdk';
import { MarkdownText } from './MarkdownText';
import { GeneratingTimer } from './GeneratingTimer';
import { ToolCall } from './ToolCall';
import { C } from '../theme';
import { ICONS } from '../terminal-compat';

function truncateRight(line: string, maxChars: number): string {
  if (line.length <= maxChars) return line;
  return `${line.slice(0, maxChars - 1)}${ICONS.ellipsis}`;
}

function getThoughtTailPreview(text: string, maxChars: number, lineCount = 2): string[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n').map(s => s.trim()).filter(Boolean);
  if (lines.length === 0) return [];
  const tail = lines.slice(-lineCount);
  return tail.map((line) => truncateRight(line, maxChars));
}

/** 将总结文本截取为单行预览（去掉 [Context Summary] 前缀） */
function getSummaryPreview(text: string, maxChars: number): string {
  const clean = text.replace(/^\[Context Summary\]\s*\n*/i, '').trim();
  const lines = clean.split('\n').map(s => s.trim()).filter(Boolean);
  if (lines.length === 0) return '';
  const first = lines[0];
  if (first.length <= maxChars) return first;
  return first.slice(0, maxChars - 1) + ICONS.ellipsis;
}


function formatElapsedMs(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatTokenSpeed(tokenOut: number, durationMs: number): string {
  return `${(tokenOut / Math.max(durationMs / 1000, 0.001)).toFixed(1)} t/s`;
}

function formatTime(ms: number): string {
  const d = new Date(ms);
  const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const now = new Date();
  if (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  ) return hhmm;
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  if (d.getFullYear() === now.getFullYear()) return `${mm}/${dd} ${hhmm}`;
  return `${d.getFullYear()}/${mm}/${dd} ${hhmm}`;
}

export type MessagePart =
  | { type: 'text'; text: string }
  | { type: 'thought'; text: string; durationMs?: number }
  | { type: 'tool_use'; tools: ToolInvocation[] };

/** 异步子代理通知的结构化内容 */
export interface NotificationPayload {
  taskId: string;
  status: string;
  description: string;
  result?: string;
  error?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  isSummary?: boolean;
  createdAt?: number;
  isError?: boolean;
  isCommand?: boolean;
  /** 是否由异步子代理 notification turn 触发 */
  isNotification?: boolean;
  /** notification turn 的任务描述（供显示） */
  notificationDescription?: string;
  /** 独立的通知汇总消息（不含 LLM 回复，仅展示各子代理的完成状态） */
  isNotificationSummary?: boolean;
  /** notification turn 的结构化通知内容（供渲染折叠区块） */
  notificationPayloads?: NotificationPayload[];
  parts: MessagePart[];
  tokenIn?: number;
  cachedTokenIn?: number;
  tokenOut?: number;
  durationMs?: number;
  streamOutputDurationMs?: number;
  modelName?: string;
}

interface MessageItemProps {
  msg: ChatMessage;
  liveTools?: ToolInvocation[];
  liveParts?: MessagePart[];
  isStreaming?: boolean;
  modelName?: string;
  /** Ctrl+O 信号：每次递增时切换本条消息的 thinking 展开状态 */
  thoughtsToggleSignal?: number;
}

/**
 * 将 displayParts 中连续的 tool_use 合并为一组，
 * 其余类型保持原样，返回统一的渲染单元数组。
 */
type RenderGroup =
  | { kind: 'text'; part: MessagePart & { type: 'text' }; index: number }
  | { kind: 'thought'; part: MessagePart & { type: 'thought' }; index: number }
  | { kind: 'tools'; tools: ToolInvocation[]; startIndex: number };

function groupParts(parts: MessagePart[]): RenderGroup[] {
  const groups: RenderGroup[] = [];
  let i = 0;
  while (i < parts.length) {
    const part = parts[i];
    if (part.type === 'tool_use') {
      // 同一次 API 调用的连续 tool_use 合并为一组（跳过中间的空 text）
      const allTools: ToolInvocation[] = [];
      const start = i;
      while (i < parts.length) {
        const p = parts[i];
        if (p.type === 'tool_use') { allTools.push(...p.tools); }
        else if (p.type === 'text' && !p.text.trim()) { /* 跳过空文本 */ }
        else { break; }
        i++;
      }
      groups.push({ kind: 'tools', tools: allTools, startIndex: start });
    } else if (part.type === 'text' && part.text.trim()) {
      groups.push({ kind: 'text', part: part as MessagePart & { type: 'text' }, index: i });
      i++;
    } else if (part.type === 'thought') {
      groups.push({ kind: 'thought', part: part as MessagePart & { type: 'thought' }, index: i });
      i++;
    } else {
      i++;
    }
  }
  return groups;
}

/**
 * 单个子代理通知的紧凑展示区块。
 * 显示状态图标、任务描述和结果预览（首行截断）。
 * TODO: 后续可添加键盘交互实现展开/折叠切换，完整展示结果文本。
 */
function NotificationPayloadBlock({ payload }: { payload: NotificationPayload }) {
  const icon = payload.status === 'completed' ? ICONS.checkmark
    : payload.status === 'failed' ? ICONS.crossmark
    : ICONS.cancelled;
  const iconColor = payload.status === 'completed' ? C.accent : C.error;

  // 取结果/错误的首行作为预览文本
  const content = payload.result || payload.error || '';
  const firstLine = content.split('\n').filter(l => l.trim())[0] || '';
  const preview = firstLine.length > 60 ? firstLine.slice(0, 57) + '...' : firstLine;

  return (
    <box>
      <text>
        <span fg={iconColor}>{icon}</span>
        <span fg={C.text}> {payload.description}</span>
        {preview ? <span fg={C.dim}>{` ${ICONS.emDash} `}{preview}</span> : null}
      </text>
    </box>
  );
}

export const MessageItem = React.memo(function MessageItem(
  { msg, liveTools, liveParts, isStreaming, modelName, thoughtsToggleSignal }: MessageItemProps
) {
  const { width: rawTermWidth } = useTerminalDimensions();
  // scrollbox 有 paddingRight={1} 为滚动条预留空间，内容实际可用宽度需减 1
  const termWidth = rawTermWidth - 1;
  const [thoughtsExpanded, setThoughtsExpanded] = useState(false);

  // Ctrl+O 信号变化时切换本条消息的展开状态。
  // 用 ref 记录上次看到的信号值，只在信号真正递增时切换，
  // 避免 undo 导致信号从 undefined 变为已有值时误触发。
  const prevSignalRef = useRef(thoughtsToggleSignal);
  useEffect(() => {
    const prev = prevSignalRef.current;
    prevSignalRef.current = thoughtsToggleSignal;
    if (prev != null && thoughtsToggleSignal != null && thoughtsToggleSignal !== prev) {
      setThoughtsExpanded(p => !p);
    }
  }, [thoughtsToggleSignal]);

  const isUser = msg.role === 'user';
  const isSummary = msg.isSummary === true;

  // 总结消息：缩略单行显示
  if (isSummary) {
    const headerText = `${ICONS.separator} context `;
    const separatorLen = Math.max(2, termWidth - headerText.length - 2);
    const preview = getSummaryPreview(
      msg.parts.filter(p => p.type === 'text').map(p => p.text).join('\n'),
      Math.max(30, termWidth - 20),
    );
    return (
      <box flexDirection="column" width="100%">
        <box marginBottom={1}>
          <text>
            <span fg={C.warn}><strong>{headerText}</strong></span>
            <span fg={C.warn}>{'\u2500'.repeat(separatorLen)}</span>
          </text>
        </box>
        <text fg={C.dim}>{preview}</text>
        <box marginTop={1}>
          <text fg={C.dim}>
            {msg.createdAt != null ? formatTime(msg.createdAt) : ''}
            {msg.tokenIn != null ? `  ${ICONS.upArrow}${msg.tokenIn.toLocaleString()}` : ''}
          </text>
        </box>
      </box>
    );
  }

  // 通知汇总消息：独立展示各子代理完成状态，不含 LLM 回复内容。
  // 在主 LLM 收到 notification 并开始回复之前就已渲染到聊天区。
  if (msg.isNotificationSummary && msg.notificationPayloads && msg.notificationPayloads.length > 0) {
    const headerText = `${ICONS.separator} bg-tasks completed `;
    const separatorLen = Math.max(2, termWidth - headerText.length - 2);
    return (
      <box flexDirection="column" width="100%">
        <box marginBottom={1}>
          <text>
            <span fg={C.warn}><strong>{headerText}</strong></span>
            <span fg={C.warn}>{'\u2500'.repeat(separatorLen)}</span>
          </text>
        </box>
        <box flexDirection="column" backgroundColor={C.toolPendingBg} paddingLeft={1}>
          {msg.notificationPayloads.map((p: NotificationPayload, i: number) => (
            <box key={`notif-${p.taskId || i}`}>
              <NotificationPayloadBlock payload={p} />
            </box>
          ))}
        </box>
        {msg.createdAt != null && (
          <box marginTop={1}>
            <text fg={C.dim}>{formatTime(msg.createdAt)}</text>
          </box>
        )}
      </box>
    );
  }

  const labelName = isSummary ? 'context' : isUser ? 'you' : (msg.isCommand ? 'shell' : (msg.modelName || modelName || 'iris').toLowerCase());
  const labelColor = isSummary ? C.warn : isUser ? C.roleUser : (msg.isError ? C.error : (msg.isCommand ? C.command : C.roleAssistant));
  const headerText = `${ICONS.separator} ${labelName} `;

  const displayParts: MessagePart[] = [...msg.parts];
  if (liveParts && liveParts.length > 0) displayParts.push(...liveParts);
  if (liveTools && liveTools.length > 0) displayParts.push({ type: 'tool_use', tools: liveTools });

  const hasAnyContent = displayParts.length > 0;
  const separatorLen = Math.max(2, termWidth - headerText.length - 2);
  const groups = groupParts(displayParts);

  return (
    <box flexDirection="column" width="100%">
      {/* 楼层头部 */}
      <box marginBottom={1}>
        <text>
          <span fg={labelColor}><strong>{headerText}</strong></span>
          <span fg={labelColor}>{'\u2500'.repeat(separatorLen)}</span>
        </text>
      </box>

      <box flexDirection="column" width="100%">
        {groups.map((group, gi) => {
          if (group.kind === 'text' && group.part.text.length > 0) {
            const isLastGroup = gi === groups.length - 1;
            return (
              <box key={group.index} marginTop={gi > 0 ? 1 : 0}>
                {isUser ? (
                  <text fg={C.text}>{group.part.text}</text>
                ) : msg.isError ? (
                  <text fg={C.error}>{group.part.text}</text>
                ) : msg.isCommand ? (
                  <text fg={C.textSec}>{group.part.text}</text>
                ) : (
                  <MarkdownText text={group.part.text} showCursor={isLastGroup && isStreaming} />
                )}
              </box>
            );
          }

          if (group.kind === 'thought') {
            const maxChars = Math.max(24, termWidth - 20);
            const allLines = group.part.text.replace(/\r\n/g, '\n').split('\n').map(s => s.trim()).filter(Boolean);
            const totalLines = allLines.length;
            const isLastGroup = gi === groups.length - 1;
            const prevGroup = gi > 0 ? groups[gi - 1] : undefined;
            const isAfterTools = prevGroup?.kind === 'tools';
            const prefix = group.part.durationMs != null ? `thinking   ${formatElapsedMs(group.part.durationMs)}` : 'thinking';
            const hiddenLines = Math.max(0, totalLines - 2);
            const showFull = thoughtsExpanded && hiddenLines > 0;

            // 展开时显示全部行（不截断，由终端自然折行），收起时显示尾部 2 行预览
            const displayLines = showFull
              ? allLines
              : getThoughtTailPreview(group.part.text, maxChars);

            return (
              <box key={group.index} marginTop={(isAfterTools) ? 0 : (gi > 0 ? 1 : 0)} flexDirection="column"
                   backgroundColor={C.thinkingBg} paddingLeft={1}>
                <text fg={C.primaryLight}><em>{`${ICONS.separator} ` + prefix}</em></text>
                <box flexDirection="column">
                  {displayLines.length > 0 ? displayLines.map((line, li) => (
                    <text key={li} fg={C.dim}>
                      <em>
                        {'    '}{line}
                        {li === displayLines.length - 1 && isLastGroup && isStreaming ? <span bg={C.accent}> </span> : null}
                      </em>
                    </text>
                  )) : (
                    <text fg={C.dim}><em>{'    '}...</em></text>
                  )}
                </box>
                {hiddenLines > 0 ? (
                  <text fg={C.dim}><em>{`    ${ICONS.ellipsis} +`}{hiddenLines}{' lines (ctrl+o to '}{showFull ? 'collapse' : 'expand'}{')'}</em></text>
                ) : null}
              </box>
            );
          }

          if (group.kind === 'tools') {
            const prevGroup = gi > 0 ? groups[gi - 1] : undefined;
            const isConsecutiveTools = prevGroup?.kind === 'tools';
            const isAfterThought = prevGroup?.kind === 'thought';
            return (
              <box key={`tools-${group.startIndex}`} flexDirection="column" width="100%" marginTop={(isConsecutiveTools || isAfterThought) ? 0 : (gi > 0 ? 1 : 0)}>
                <box flexDirection="column" backgroundColor={C.toolPendingBg} paddingLeft={1}>
                  <text fg={C.accent}><strong>{`${ICONS.separator} tools`}</strong></text>
                  {group.tools.map(inv => <ToolCall key={inv.id} invocation={inv} />)}
                </box>
              </box>
            );
          }

          return null;
        })}

        {/* 用户消息元数据（时间 + token 计数） */}
        {isUser && (msg.createdAt != null || msg.tokenIn != null) && (
          <box marginTop={hasAnyContent ? 1 : 0}>
            <text fg={C.dim}>
              {msg.createdAt != null ? formatTime(msg.createdAt) : ''}
              {msg.tokenIn != null ? `  ${ICONS.upArrow}${msg.tokenIn.toLocaleString()}${msg.cachedTokenIn ? `(${msg.cachedTokenIn.toLocaleString()})` : ''}` : ''}
            </text>
          </box>
        )}

        {/* AI 响应元数据（时间 + 耗时 + token + 速度） */}
        {!isUser && !isStreaming && (msg.createdAt != null || msg.durationMs != null || msg.tokenIn != null) && (
          <box marginTop={hasAnyContent ? 1 : 0}>
            <text fg={C.dim}>
              {msg.createdAt != null ? formatTime(msg.createdAt) : ''}
              {msg.durationMs != null ? `  ${(msg.durationMs / 1000).toFixed(1)}s` : ''}
              {msg.tokenIn != null ? `  ${ICONS.upArrow}${msg.tokenIn.toLocaleString()}${msg.cachedTokenIn ? `(${msg.cachedTokenIn.toLocaleString()})` : ''}` : ''}
              {msg.tokenOut != null ? `  ${ICONS.downArrow}${msg.tokenOut.toLocaleString()}` : ''}
              {msg.tokenOut != null && msg.streamOutputDurationMs != null
                ? `   ${formatTokenSpeed(msg.tokenOut, msg.streamOutputDurationMs)}`
                : ''}
            </text>
          </box>
        )}

        {!hasAnyContent && isStreaming && (
          <box><GeneratingTimer isGenerating={true} /></box>
        )}
        {!hasAnyContent && !isStreaming && (
          <text>{' '}</text>
        )}
      </box>
    </box>
  );
});
