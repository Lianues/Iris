/**
 * TUI 根组件
 *
 * 已完成的消息用 <Static> 固化���出，只有当前活动区域动态刷新。
 * ChatMessage.parts 对应 Gemini 的 parts 顺序：text → tool_use → text → ...
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Box, Text, Static, useInput, useStdout } from 'ink';
import Gradient from 'ink-gradient';
import { ToolInvocation } from '../../types';
import { MessageItem, ChatMessage, MessagePart } from './components/MessageItem';
import { InputBar } from './components/InputBar';

let _msgIdCounter = 0;
function nextMsgId() {
  return `msg-${++_msgIdCounter}`;
}

export interface AppHandle {
  addMessage(role: 'user' | 'assistant', content: string): void;
  startStream(): void;
  pushStreamChunk(chunk: string): void;
  endStream(): void;
  setToolInvocations(invocations: ToolInvocation[]): void;
  setGenerating(generating: boolean): void;
  clearMessages(): void;
  commitTools(): void;
}

interface AppProps {
  onReady: (handle: AppHandle) => void;
  onSubmit: (text: string) => void;
  onExit: () => void;
}

export function App({ onReady, onSubmit, onExit }: AppProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streamingText, setStreamingText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [toolInvocations, setToolInvocations] = useState<ToolInvocation[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const { stdout } = useStdout();

 const streamRef = useRef('');
  const toolInvocationsRef = useRef<ToolInvocation[]>([]);
  const throttleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const handle: AppHandle = {
      addMessage(role, content) {
        setMessages(prev => {
          // 同一���连续的 assistant 消息合并
          if (role === 'assistant' && prev.length > 0 && prev[prev.length - 1].role === 'assistant') {
            const copy = [...prev];
            const last = copy[copy.length - 1];
            const parts = [...last.parts];
            const lastPart = parts.length > 0 ? parts[parts.length - 1] : null;
            if (lastPart && lastPart.type === 'text') {
              parts[parts.length - 1] = { type: 'text', text: lastPart.text + content };
            } else {
              parts.push({ type: 'text', text: content });
            }
            copy[copy.length - 1] = { ...last, parts };
            return copy;
          }
          return [...prev, { id: nextMsgId(), role, parts: [{ type: 'text', text: content }] }];
        });
      },

      startStream() {
        // 未提交的工具先 commit，确保 tool_use part 在新 text 之前
        if (toolInvocationsRef.current.length > 0) {
          handle.commitTools();
        }
        setIsStreaming(true);
        streamRef.current = '';
        setStreamingText('');
      },

      pushStreamChunk(chunk) {
        streamRef.current += chunk;
        // 节流 60ms
        if (!throttleTimerRef.current) {
          throttleTimerRef.current = setTimeout(() => {
            throttleTimerRef.current = null;
            setStreamingText(streamRef.current);
          }, 60);
        }
      },

      endStream() {
        if (throttleTimerRef.current) {
          clearTimeout(throttleTimerRef.current);
          throttleTimerRef.current = null;
        }
        setIsStreaming(false);
        const text = streamRef.current;
        streamRef.current = '';
        setStreamingText('');
        if (!text) return;

        setMessages(prev => {
          if (prev.length > 0 && prev[prev.length - 1].role === 'assistant') {
            const copy = [...prev];
            const last = copy[copy.length - 1];
            const parts = [...last.parts];
            const lastPart = parts.length > 0 ? parts[parts.length - 1] : null;
            if (lastPart && lastPart.type === 'text') {
              parts[parts.length - 1] = { type: 'text', text: lastPart.text + text };
            } else {
              parts.push({ type: 'text', text });
            }
            copy[copy.length - 1] = { ...last, parts };
            return copy;
          }
          return [...prev, { id: nextMsgId(), role: 'assistant', parts: [{ type: 'text', text }] }];
        });
      },

      setToolInvocations(invocations) {
        const copy = [...invocations];
        toolInvocationsRef.current = copy;
        setToolInvocations(copy);
      },

      setGenerating(generating) {
        setIsGenerating(generating);
      },

      clearMessages() {
        setMessages([]);
        setToolInvocations([]);
        setStreamingText('');
        streamRef.current = '';
      },

      commitTools() {
        const currentTools = toolInvocationsRef.current;
        if (currentTools.length === 0) return;
        const toolPart: MessagePart = { type: 'tool_use', tools: [...currentTools] };
        setMessages(prev => {
          const last = prev.length > 0 ? prev[prev.length - 1] : null;
          if (last && last.role === 'assistant') {
            const copy = [...prev];
            const parts = [...last.parts];
            parts.push(toolPart);
            copy[copy.length - 1] = { ...last, parts };
            return copy;
          }
          return [...prev, { id: nextMsgId(), role: 'assistant' as const, parts: [toolPart] }];
        });
        toolInvocationsRef.current = [];
        setToolInvocations([]);
      },
    };
    onReady(handle);
  }, [onReady]);

  const handleSubmit = useCallback((text: string) => {
    if (text === '/quit' || text === '/exit') {
      onExit();
      return;
    }
    if (text === '/clear') {
      setMessages([]);
      setToolInvocations([]);
      return;
    }
    onSubmit(text);
  }, [onSubmit, onExit]);

  useInput((input, key) => {
    if (key.escape) {
      onExit();
    }
  });

  const termWidth = stdout?.columns ?? 80;

  // 分离消息：已完成 → Static，活动的 → 动态渲染
  const lastMsg = messages.length > 0 ? messages[messages.length - 1] : null;
  const lastIsActiveAssistant = isGenerating && lastMsg?.role === 'assistant';
  const staticMessages = lastIsActiveAssistant ? messages.slice(0, -1) : messages;
  const activeMessage = lastIsActiveAssistant ? lastMsg : null;

  type StaticItem =
    | { id: string; kind: 'header' }
    | { id: string; kind: 'message'; msg: ChatMessage };

  const staticItems: StaticItem[] = [
    { id: '__header__', kind: 'header' },
    ...staticMessages.map(msg => ({ id: msg.id, kind: 'message' as const, msg })),
  ];

  return (
    <Box flexDirection="column" width="100%">
      {/* 已完成内容 - 固化输出 */}
      <Static items={staticItems}>
        {(item) => {
          if (item.kind === 'header') {
            return (
              <Box key={item.id} marginBottom={1}>
                <Gradient name="atlas">
                  <Text bold italic>IRIS AI SYSTEM v2.0 // CONTROL_UNIT_01</Text>
                </Gradient>
              </Box>
            );
          }
          return (<Box key={item.id} marginBottom={1}>
            <MessageItem msg={item.msg} />
          </Box>);
        }}
      </Static>

      {/* 动态区域 */}
      <Box flexDirection="column">
        {activeMessage && (
          <MessageItem
            msg={activeMessage}
            liveTools={toolInvocations.length > 0 ? toolInvocations : undefined}
            streamingAppend={isStreaming ? streamingText : undefined}
            isStreaming={isStreaming}
          />
        )}
        {isGenerating && !lastIsActiveAssistant && !activeMessage && (
          <MessageItem
            msg={{ id: 'tmp', role: 'assistant', parts: [] }}
            liveTools={toolInvocations.length > 0 ? toolInvocations : undefined}
            streamingAppend={isStreaming ? streamingText : undefined}
            isStreaming={isStreaming}
          />
        )}
      </Box>

      {/* 底部交互区 */}
      <Box flexDirection="column" marginTop={1}>
        <Text wrap="truncate-end">
          <Text dimColor>{'\u2500'.repeat(Math.max(3, termWidth - 6))}</Text>
        </Text>
        <InputBar disabled={isGenerating} onSubmit={handleSubmit} />
        <Box justifyContent="space-between" width="100%">
          <Text dimColor>MODE: RUNTIME_SECURE</Text>
          <Text color={isGenerating ? 'yellow' : 'green'} bold>
            {isGenerating ? '[BUSY]' : '[IDLE]'}
          </Text>
        </Box>
        <Text dimColor>{process.cwd()}</Text>
      </Box>
    </Box>
  );
}
