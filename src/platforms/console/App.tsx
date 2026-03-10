/**
 * TUI 根组件
 *
 * 已完成的消息用 <Static> 固化输出，只有当前活动区域动态刷新。
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Box, Text, Static, useInput, useStdout } from 'ink';
import { UsageMetadata } from '../../types';
import Gradient from 'ink-gradient';
import { ToolInvocation } from '../../types';
import { SessionMeta } from '../../storage/base';
import { MessageItem, ChatMessage, MessagePart } from './components/MessageItem';
import { InputBar } from './components/InputBar';

let _msgIdCounter =0;
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
  setUsage(usage: UsageMetadata): void;
  finalizeResponse(durationMs: number): void;
}

interface AppProps {
  onReady: (handle: AppHandle) => void;
  onSubmit: (text: string) => void;
  onNewSession: () => void;
  onLoadSession: (id: string) => Promise<void>;
  onListSessions: () => Promise<SessionMeta[]>;
  onRunCommand: (cmd: string) => { output: string; cwd: string };
  onExit: () => void;
  modeName?: string;
}

/** 视图模式 */
type ViewMode = 'chat' | 'session-list';

export function App({ onReady, onSubmit, onNewSession, onLoadSession, onListSessions, onRunCommand, onExit, modeName }: AppProps) {
  const [messages, setMessages] =useState<ChatMessage[]>([]);
  const [streamingText, setStreamingText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [toolInvocations, setToolInvocations] = useState<ToolInvocation[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [contextTokens, setContextTokens] = useState(0);
  const [viewMode, setViewMode] = useState<ViewMode>('chat');
  const [sessionList, setSessionList] = useState<SessionMeta[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const { stdout } = useStdout();

  const streamRef = useRef('');
  const toolInvocationsRef = useRef<ToolInvocation[]>([]);
  const throttleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastUsageRef = useRef<UsageMetadata | null>(null);

  useEffect(() => {
    const handle: AppHandle = {
      addMessage(role, content) {
        setMessages(prev => {
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
        if (toolInvocationsRef.current.length > 0) {
          handle.commitTools();
        }
        setIsStreaming(true);
        streamRef.current = '';
        setStreamingText('');
      },

      pushStreamChunk(chunk) {
        streamRef.current += chunk;
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

      setUsage(usage: UsageMetadata) {
        setContextTokens(usage.totalTokenCount ?? 0);
        lastUsageRef.current = usage;
      },

      finalizeResponse(durationMs: number) {
        const usage = lastUsageRef.current;
        setMessages(prev => {
          if (prev.length === 0) return prev;
          const last = prev[prev.length - 1];
          if (last.role !== 'assistant') return prev;
          const copy = [...prev];
          copy[copy.length - 1] = {
            ...last,
            tokenIn: usage?.promptTokenCount,
            tokenOut: usage?.candidatesTokenCount,
            durationMs,
          };
          return copy;
        });
        lastUsageRef.current = null;
      },
    };
    onReady(handle);
  }, [onReady]);

  // ============ 命令处理 ============

  const handleSubmit = useCallback((text: string) => {
    if (text === '/exit') {
      onExit();
      return;
    }
    if (text === '/new') {
      setMessages([]);
      setToolInvocations([]);
      onNewSession();
      return;
    }
    if (text === '/load') {
      onListSessions().then(metas => {
        setSessionList(metas);
        setSelectedIndex(0);
        setViewMode('session-list');
      });
      return;
    }
    if (text.startsWith('/sh ') || text === '/sh') {
      const cmd = text.slice(4).trim();
      if (!cmd) return;
      try {
        const result = onRunCommand(cmd);
        const display = result.output || '(无输出)';
        setMessages(prev => [...prev, { id: nextMsgId(), role: 'assistant' as const, parts: [{ type: 'text' as const, text: display }] }]);
      } catch (err: any) {
        setMessages(prev => [...prev, { id: nextMsgId(), role: 'assistant' as const, parts: [{ type: 'text' as const, text: `执行失败: ${err.message}` }] }]);
      }
      return;
    }
    onSubmit(text);
  }, [onSubmit, onNewSession, onListSessions, onRunCommand, onExit]);

  // ============ 键盘输入 ============

  useInput((input, key) => {
    if (viewMode === 'session-list') {
      if (key.upArrow) {
        setSelectedIndex(prev => Math.max(0, prev - 1));
      } else if (key.downArrow) {
        setSelectedIndex(prev => Math.min(sessionList.length - 1, prev + 1));
      } else if (key.return) {
        const selected =sessionList[selectedIndex];
        if (selected) {
          setMessages([]);
          setToolInvocations([]);
          setViewMode('chat');
          onLoadSession(selected.id);
        }
      } else if (key.escape) {
        setViewMode('chat');
      }
      return;
    }
    if (key.escape) {
      onExit();
    }
  });

  const termWidth = stdout?.columns ?? 80;

  // ============ 会话列表视图 ============

  if (viewMode === 'session-list') {
    return (
      <Box flexDirection="column" width="100%">
        <Box marginBottom={1}>
          <Gradient name="atlas">
            <Text bold italic>IRIS</Text>
          </Gradient>
        </Box>
        <Box marginBottom={1}>
          <Text bold>历史对话</Text>
          <Text dimColor>  (↑↓ 选择, Enter 加载, Esc 返回)</Text>
        </Box>
        {sessionList.length === 0 && (
          <Text dimColor>  暂无历史对话</Text>
        )}
        {sessionList.map((meta, i) => {
          const isSelected = i === selectedIndex;
          const time = new Date(meta.updatedAt).toLocaleString('zh-CN');
          return (
            <Box key={meta.id} paddingLeft={1}>
              <Text color={isSelected ? 'cyan' : undefined} bold={isSelected}>
                {isSelected ? '❯ ' : '  '}
              </Text>
              <Text color={isSelected ? 'cyan' : 'white'} bold={isSelected}>
                {meta.title.slice(0, 40)}
              </Text>
              <Text dimColor>  {meta.cwd}</Text>
              <Text dimColor>  {time}</Text>
            </Box>
          );
        })}
        <Box marginTop={1}>
   <Text wrap="truncate-end">
            <Text dimColor>{'\u2500'.repeat(Math.max(3, termWidth - 6))}</Text>
          </Text>
        </Box>
      </Box>
    );
  }

  // ============ 对话视图 ============

  const lastMsg = messages.length > 0 ? messages[messages.length - 1] : null;
  const lastIsActiveAssistant = isGenerating && lastMsg?.role === 'assistant';
  const staticMessages = lastIsActiveAssistant ? messages.slice(0,-1) : messages;
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
                  <Text bold italic>IRIS</Text>
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
        <Text dimColor>
          MODE: {(modeName ?? 'normal').toUpperCase()}  CTX: {contextTokens > 0 ? contextTokens.toLocaleString() : '-'}
        </Text>
        <Text dimColor>{process.cwd()}</Text>
        <InputBar disabled={isGenerating} onSubmit={handleSubmit} />
      </Box>
    </Box>
  );
}
