/**
 * 单条消息渲染
 */

import React from 'react';
import { useTerminalDimensions } from '@opentui/react';
import { ToolInvocation } from '../../../types';
import { MarkdownText } from './MarkdownText';
import { GeneratingTimer } from './GeneratingTimer';
import { ToolCall } from './ToolCall';
import { C } from '../theme';

function getThoughtTailPreview(text: string, maxChars: number): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n').map(s => s.trim()).filter(Boolean);
  if (lines.length === 0) return '';
  const latestLine = lines[lines.length - 1];
  if (latestLine.length <= maxChars) return latestLine;
  return `\u2026${latestLine.slice(-(maxChars - 1))}`;
}

function formatElapsedMs(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatTokenSpeed(tokenOut: number, durationMs: number): string {
  return `${(tokenOut / Math.max(durationMs / 1000, 0.001)).toFixed(1)} t/s`;
}

export type MessagePart =
  | { type: 'text'; text: string }
  | { type: 'thought'; text: string; durationMs?: number }
  | { type: 'tool_use'; tools: ToolInvocation[] };

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  parts: MessagePart[];
  tokenIn?: number;
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
}

export const MessageItem = React.memo(function MessageItem(
  { msg, liveTools, liveParts, isStreaming, modelName }: MessageItemProps
) {
  const { width: termWidth } = useTerminalDimensions();
  const isUser = msg.role === 'user';
  const labelName = isUser ? 'you' : (msg.modelName || modelName || 'iris').toLowerCase();
  const labelColor = isUser ? C.roleUser : C.roleAssistant;
  const headerText = `\u00b7 ${labelName} `;

  const displayParts: MessagePart[] = [...msg.parts];
  if (liveParts && liveParts.length > 0) displayParts.push(...liveParts);
  if (liveTools && liveTools.length > 0) displayParts.push({ type: 'tool_use', tools: liveTools });

  const hasAnyContent = displayParts.length > 0;
  const separatorLen = Math.max(2, termWidth - headerText.length - 2);

  return (
    <box flexDirection="column" width="100%">
      {/* 楼层头部 */}
      <box marginBottom={1}>
        <text>
          <span fg={labelColor}><strong>{headerText}</strong></span>
          <span fg={C.dim}>{'\u2500'.repeat(separatorLen)}</span>
        </text>
      </box>

      <box flexDirection="column" width="100%">
        {displayParts.map((part, i) => {
          if (part.type === 'text' && part.text.length > 0) {
            const isLastPart = i === displayParts.length - 1;
            return (
              <box key={i} marginTop={i > 0 ? 1 : 0}>
                {isUser ? (
                  <text fg={C.text}>{part.text}</text>
                ) : (
                  <MarkdownText text={part.text} showCursor={isLastPart && isStreaming} />
                )}
              </box>
            );
          }

          if (part.type === 'thought') {
            const previewText = getThoughtTailPreview(part.text, Math.max(24, termWidth - 20));
            const isLastPart = i === displayParts.length - 1;
            const prefix = part.durationMs != null ? `thinking   ${formatElapsedMs(part.durationMs)}` : 'thinking';
            return (
              <box key={i} marginTop={i > 0 ? 1 : 0} flexDirection="column">
                <text fg={C.primaryLight}><em>{'  \u00b7 ' + prefix}</em></text>
                <box flexDirection="column">
                  <text fg={C.dim}>
                    <em>
                      {'    '}{previewText ? previewText : '...'}
                      {isLastPart && isStreaming ? <span bg={C.accent}> </span> : null}
                    </em>
                  </text>
                </box>
              </box>
            );
          }

          if (part.type === 'tool_use') {
            return (
              <box key={i} flexDirection="column" width="100%" marginTop={i > 0 ? 1 : 0}>
                <text fg={C.dim}><strong>{'  \u00b7 tools'}</strong></text>
                <box flexDirection="column" paddingLeft={4}>
                  {part.tools.map(inv => <ToolCall key={inv.id} invocation={inv} lineColor={C.dim} />)}
                </box>
              </box>
            );
          }
          return null;
        })}

        {/* token / 耗时信息 */}
        {!isUser && !isStreaming && (msg.tokenIn != null || msg.durationMs != null) && (
          <box marginTop={hasAnyContent ? 1 : 0}>
            <text fg={C.dim}>
              {'\u00b7 '}
              {msg.tokenIn != null ? `in: ${msg.tokenIn.toLocaleString()}` : ''}
              {msg.tokenIn != null && msg.tokenOut != null ? '  ' : ''}
              {msg.tokenOut != null ? `out: ${msg.tokenOut.toLocaleString()}` : ''}
              {msg.durationMs != null ? (msg.tokenIn != null || msg.tokenOut != null ? '    ' : '') : ''}
              {msg.durationMs != null ? `${(msg.durationMs / 1000).toFixed(1)}s` : ''}
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
