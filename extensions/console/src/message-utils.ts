import type { Dispatch, SetStateAction } from 'react';
import type { ToolInvocation } from '@irises/extension-sdk';
import type { ChatMessage, MessagePart } from './components/MessageItem';
import type { MessageMeta } from './app-types';

let msgIdCounter = 0;

export function nextMsgId(): string {
  return `msg-${++msgIdCounter}`;
}

export function appendMergedMessagePart(parts: MessagePart[], nextPart: MessagePart): void {
  const lastPart = parts.length > 0 ? parts[parts.length - 1] : undefined;
  if (lastPart && lastPart.type === 'text' && nextPart.type === 'text') {
    lastPart.text += nextPart.text;
    return;
  }
  if (lastPart && lastPart.type === 'thought' && nextPart.type === 'thought') {
    lastPart.text += nextPart.text;
    if (nextPart.durationMs != null) lastPart.durationMs = nextPart.durationMs;
    return;
  }
  if (lastPart && lastPart.type === 'tool_use' && nextPart.type === 'tool_use') {
    lastPart.tools.push(...nextPart.tools);
    return;
  }
  parts.push(nextPart);
}

export function mergeMessageParts(parts: MessagePart[]): MessagePart[] {
  const merged: MessagePart[] = [];
  for (const part of parts) appendMergedMessagePart(merged, { ...part } as MessagePart);
  return merged;
}

/**
 * 将 tool invocations 映射到 parts 中已有的 tool_use 槽位。
 * appendLeftover=true（默认）时，多余的 invocations 追加为新 tool_use part；
 * appendLeftover=false 时，多余的 invocations 被忽略（避免在流式阶段插入尚未定位的工具）。
 */
export function applyToolInvocationsToParts(parts: MessagePart[], invocations: ToolInvocation[], appendLeftover = true): MessagePart[] {
  const nextParts: MessagePart[] = [];
  let cursor = 0;
  for (const part of parts) {
    if (part.type !== 'tool_use') {
      nextParts.push(part);
      continue;
    }
    const expectedCount = Math.max(1, part.tools.length);
    const assigned = invocations.slice(cursor, cursor + expectedCount);
    cursor += assigned.length;
    nextParts.push({ type: 'tool_use', tools: assigned.length > 0 ? assigned : part.tools });
  }
  if (appendLeftover && cursor < invocations.length) nextParts.push({ type: 'tool_use', tools: invocations.slice(cursor) });
  return nextParts;
}

export function appendAssistantParts(prev: ChatMessage[], partsToAppend: MessagePart[], meta?: MessageMeta): ChatMessage[] {
  const normalizedParts = mergeMessageParts(partsToAppend);
  if (normalizedParts.length === 0) return prev;
  if (prev.length > 0 && prev[prev.length - 1].role === 'assistant') {
    const copy = [...prev];
    const last = copy[copy.length - 1];
    copy[copy.length - 1] = { ...last, parts: mergeMessageParts([...last.parts, ...normalizedParts]), ...meta };
    return copy;
  }
  return [...prev, { id: nextMsgId(), role: 'assistant', parts: normalizedParts, ...meta }];
}

/**
 * 向消息列表追加一条系统指令输出消息。
 *
 * 会替换掉之前的指令输出消息（同一时刻只保留最新的一条）。
 * 从 use-command-dispatch.ts 中提取，供 use-app-keyboard.ts 复用。
 */
export function appendCommandMessage(
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>,
  text: string,
  options?: { isError?: boolean },
): void {
  setMessages((prev) => [
    ...prev.filter((message) => !message.isCommand),
    {
      id: nextMsgId(),
      role: 'assistant',
      parts: [{ type: 'text', text }],
      isCommand: true,
      isError: options?.isError,
    },
  ]);
}
