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
    // 如果上一个 tool_use 的所有工具都已终态，不合并 — 保持分离
    // 以便 applyToolInvocationsToParts 能正确区分已完成轮次和新轮次的工具，
    // 避免连续串行调用工具时后面的工具覆盖前面已完成的工具。
    const isTerminal = (s: string) => s === 'success' || s === 'warning' || s === 'error';
    if (lastPart.tools.length > 0 && lastPart.tools.every(t => isTerminal(t.status))) {
      parts.push(nextPart);
      return;
    }
    lastPart.tools.push(...nextPart.tools);
    return;
  }
  parts.push(nextPart);
}

export function mergeMessageParts(parts: MessagePart[]): MessagePart[] {
  const merged: MessagePart[] = [];
  for (const part of parts) {
    // 对 tool_use part 需要深拷贝 tools 数组，避免 appendMergedMessagePart
    // 中的 push 操作变异原始 part 的 tools 引用（React state 不可变性）
    const copy = part.type === 'tool_use'
      ? { type: 'tool_use' as const, tools: [...part.tools] }
      : { ...part };
    appendMergedMessagePart(merged, copy as MessagePart);
  }
  return merged;
}

/**
 * 将 tool invocations 映射到 parts 中已有的 tool_use 槽位。
 * appendLeftover=true（默认）时，多余的 invocations 追加为新 tool_use part；
 * appendLeftover=false 时，多余的 invocations 被忽略（避免在流式阶段插入尚未定位的工具）。
 */
export function applyToolInvocationsToParts(parts: MessagePart[], invocations: ToolInvocation[], appendLeftover = true): MessagePart[] {
  // 终态状态集合 — 与 src/types/tool.ts 中的 TERMINAL_TOOL_STATUSES 保持一致
  const isTerminal = (s: string) => s === 'success' || s === 'warning' || s === 'error';

  const nextParts: MessagePart[] = [];
  let cursor = 0;
  for (const part of parts) {
    if (part.type !== 'tool_use') {
      nextParts.push(part);
      continue;
    }
    // 跳过所有工具都已处于终态的 tool_use part（来自前一轮 tool loop）。
    // 防止游标式按位置映射将当前轮的 invocations 错误地填入前一轮已完成的槽位，
    // 避免连续 sub_agent 调用时第二个被拼接显示到第一个里面。
    if (part.tools.length > 0 && part.tools.every(t => isTerminal(t.status))) {
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
  if (prev.length > 0 && prev[prev.length - 1].role === 'assistant' && !prev[prev.length - 1].isError) {
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
