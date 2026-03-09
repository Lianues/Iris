/**
 * 单条消息渲染 - 基于有序 parts 模型
 */

import React from 'react';
import { Box, Text } from 'ink';
import { ToolInvocation } from '../../../types';
import { Spinner } from './Spinner';
import { ToolCall } from './ToolCall';

/** 极简 Markdown 渲染 */
function renderMarkdown(text: string, baseColor: string) {
  const parts = text.split(/(\*\*.*?\*\*|`.*?`)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <Text key={i} bold color="white">{part.slice(2, -2)}</Text>;
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return <Text key={i} backgroundColor="gray" color="black">{part.slice(1,-1)}</Text>;
    }
    return <Text key={i} color={baseColor}>{part}</Text>;
  });
}

// ====== 数据结构 ======

export type MessagePart =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; tools: ToolInvocation[] };

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  parts: MessagePart[];
}

// ====== 组件 ======

interface MessageItemProps {
  msg: ChatMessage;
  liveTools?: ToolInvocation[];
  streamingAppend?: string;
  isStreaming?: boolean;
}

const PIPE = '│';
const CIRCLE_OPEN = '○';
const CIRCLE_FILL = '●';

export const MessageItem = React.memo(function MessageItem(
  { msg, liveTools, streamingAppend, isStreaming }: MessageItemProps
) {
  const isUser = msg.role === 'user';
  const themeColor = isUser ? 'cyan' : 'green';
  const labelText = isUser ? 'USER' : 'IRIS';
  const textColor = isUser ? 'white' : 'green';

  const displayParts: MessagePart[] = [...msg.parts];
  if (liveTools && liveTools.length > 0) {
    displayParts.push({ type: 'tool_use', tools: liveTools });
  }
  if (streamingAppend && streamingAppend.length > 0) {
    displayParts.push({ type: 'text', text: streamingAppend });
  }

  const hasAnyContent = displayParts.length > 0;

  return (
    <Box flexDirection="column" width="100%">
      {/* 标签 */}
      <Box marginBottom={0}>
        <Text bold color={themeColor}>{isUser ? CIRCLE_OPEN : CIRCLE_FILL}</Text>
        <Text bold color="black" backgroundColor={themeColor}>{` ${labelText} `}</Text>
      </Box>

      {/* 按顺序渲染每个 part */}
      {displayParts.map((part, i) => {
        if (part.type === 'text' && part.text.length > 0) {
          const isLastPart = i === displayParts.length - 1;
          return (
            <Box key={i} paddingLeft={0}>
              <Text dimColor color={themeColor}>{PIPE} </Text>
              <Box flexGrow={1}>
                <Text wrap="wrap">
                  {renderMarkdown(part.text, textColor)}
                  {isLastPart && isStreaming && <Text backgroundColor="green"> </Text>}
                </Text>
              </Box>
            </Box>
          );
        }
        if (part.type === 'tool_use') {
          return (
            <Box key={i} flexDirection="column">
              <Text>
                <Text dimColor color={themeColor}>{PIPE} </Text>
                <Text bold color="gray">[TOOL_USE]</Text>
              </Text>
              <Box flexDirection="column">
                {part.tools.map(inv => <ToolCall key={inv.id} invocation={inv} lineColor={themeColor} />)}
              </Box>
            </Box>
          );
        }
        return null;
      })}

      {/* 没有内容但正在流式生成 */}
      {!hasAnyContent && isStreaming && (
        <Box paddingLeft={0}>
          <Text><Text dimColor color={themeColor}>{PIPE} </Text><Spinner /><Text dimColor italic> generating...</Text></Text>
        </Box>
      )}

      {/* 没有内容也不在流式 */}
      {!hasAnyContent && !isStreaming && !isUser && (
        <Box paddingLeft={0}>
          <Text dimColor color={themeColor}>{PIPE}</Text>
        </Box>
      )}
    </Box>
  );
});
