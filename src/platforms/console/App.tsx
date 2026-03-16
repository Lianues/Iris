/**
 * TUI 根组件 (OpenTUI React)
 *
 * 全屏布局：Logo + scrollbox 消息区 + 状态栏 + 输入栏。
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useKeyboard, useRenderer, useTerminalDimensions } from '@opentui/react';
import { UsageMetadata } from '../../types';
import type { LLMModelInfo } from '../../llm/router';
import { ToolInvocation } from '../../types';
import { SessionMeta } from '../../storage/base';
import { MessageItem, ChatMessage, MessagePart } from './components/MessageItem';
import { GeneratingTimer } from './components/GeneratingTimer';
import { InputBar } from './components/InputBar';
import { SettingsView } from './components/SettingsView';
import { ConsoleSettingsSaveResult, ConsoleSettingsSnapshot } from './settings';
import { C } from './theme';

let _msgIdCounter = 0;
function nextMsgId() {
  return `msg-${++_msgIdCounter}`;
}

function appendMergedMessagePart(parts: MessagePart[], nextPart: MessagePart): void {
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

function mergeMessageParts(parts: MessagePart[]): MessagePart[] {
  const merged: MessagePart[] = [];
  for (const part of parts) appendMergedMessagePart(merged, { ...part } as MessagePart);
  return merged;
}

function applyToolInvocationsToParts(parts: MessagePart[], invocations: ToolInvocation[]): MessagePart[] {
  const nextParts: MessagePart[] = [];
  let cursor = 0;
  for (const part of parts) {
    if (part.type !== 'tool_use') { nextParts.push(part); continue; }
    const expectedCount = Math.max(1, part.tools.length);
    const assigned = invocations.slice(cursor, cursor + expectedCount);
    cursor += assigned.length;
    nextParts.push({ type: 'tool_use', tools: assigned.length > 0 ? assigned : part.tools });
  }
  if (cursor < invocations.length) nextParts.push({ type: 'tool_use', tools: invocations.slice(cursor) });
  return nextParts;
}

function appendAssistantParts(prev: ChatMessage[], partsToAppend: MessagePart[], meta?: MessageMeta): ChatMessage[] {
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

export interface MessageMeta {
  tokenIn?: number;
  tokenOut?: number;
  durationMs?: number;
  streamOutputDurationMs?: number;
  modelName?: string;
}

export interface AppHandle {
  addMessage(role: 'user' | 'assistant', content: string, meta?: MessageMeta): void;
  addStructuredMessage(role: 'user' | 'assistant', parts: MessagePart[], meta?: MessageMeta): void;
  startStream(): void;
  pushStreamParts(parts: MessagePart[]): void;
  endStream(): void;
  finalizeAssistantParts(parts: MessagePart[], meta?: MessageMeta): void;
  setToolInvocations(invocations: ToolInvocation[]): void;
  setGenerating(generating: boolean): void;
  clearMessages(): void;
  commitTools(): void;
  setUsage(usage: UsageMetadata): void;
  finalizeResponse(durationMs: number): void;
}

interface SwitchModelResult { ok: boolean; message: string; modelId?: string; modelName?: string; contextWindow?: number; }
interface AppProps {
  onReady: (handle: AppHandle) => void;
  onSubmit: (text: string) => void;
  onToolApproval: (toolId: string, approved: boolean) => void;
  onAbort: () => void;
  onNewSession: () => void;
  onLoadSession: (id: string) => Promise<void>;
  onListSessions: () => Promise<SessionMeta[]>;
  onRunCommand: (cmd: string) => { output: string; cwd: string };
  onListModels: () => LLMModelInfo[];
  onSwitchModel: (modelName: string) => SwitchModelResult;
  onLoadSettings: () => Promise<ConsoleSettingsSnapshot>;
  onSaveSettings: (snapshot: ConsoleSettingsSnapshot) => Promise<ConsoleSettingsSaveResult>;
  onExit: () => void;
  modeName?: string;
  modelId: string;
  modelName: string;
  contextWindow?: number;
}

type ViewMode = 'chat' | 'session-list' | 'model-list' | 'settings';
export function App({ onReady, onSubmit, onToolApproval, onAbort, onNewSession, onLoadSession, onListSessions, onRunCommand, onListModels, onSwitchModel, onLoadSettings, onSaveSettings, onExit, modeName, modelId, modelName, contextWindow }: AppProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streamingParts, setStreamingParts] = useState<MessagePart[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [contextTokens, setContextTokens] = useState(0);
  const [currentModelId, setCurrentModelId] = useState(modelId);
  const [currentModelName, setCurrentModelName] = useState(modelName);
  const [currentContextWindow, setCurrentContextWindow] = useState(contextWindow);
  const [viewMode, setViewMode] = useState<ViewMode>('chat');
  const [sessionList, setSessionList] = useState<SessionMeta[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [settingsInitialSection, setSettingsInitialSection] = useState<'general' | 'mcp'>('general');
  const [modelList, setModelList] = useState<LLMModelInfo[]>([]);

  const { width: termWidth } = useTerminalDimensions();
  const renderer = useRenderer();

  const [pendingApprovals, setPendingApprovals] = useState<ToolInvocation[]>([]);
  const [approvalChoice, setApprovalChoice] = useState<'approve' | 'reject'>('approve');
  const streamPartsRef = useRef<MessagePart[]>([]);
  const toolInvocationsRef = useRef<ToolInvocation[]>([]);
  const throttleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** endStream 后暂存的流式 parts，等待 finalizeAssistantParts 消费或 setGenerating(false) 兜底提交 */
  const uncommittedStreamPartsRef = useRef<MessagePart[]>([]);
  const lastUsageRef = useRef<UsageMetadata | null>(null);

  // ============ AppHandle ============
  useEffect(() => {
    const handle: AppHandle = {
      addMessage(role, content, meta?) {
        const textPart: MessagePart = { type: 'text', text: content };
        if (role === 'assistant') { setMessages((prev) => appendAssistantParts(prev, [textPart], meta)); return; }
        setMessages((prev) => [...prev, { id: nextMsgId(), role, parts: [textPart], ...meta }]);
      },
      addStructuredMessage(role, parts, meta?) {
        const normalizedParts = mergeMessageParts(parts);
        if (normalizedParts.length === 0) return;
        if (role === 'assistant') { setMessages((prev) => appendAssistantParts(prev, normalizedParts, meta)); return; }
        setMessages((prev) => [...prev, { id: nextMsgId(), role, parts: normalizedParts, ...meta }]);
      },
      startStream() {
        if (toolInvocationsRef.current.length > 0) handle.commitTools();
        setIsStreaming(true);
        uncommittedStreamPartsRef.current = [];
        streamPartsRef.current = [];
        setStreamingParts([]);
      },
      pushStreamParts(parts) {
        for (const part of parts) appendMergedMessagePart(streamPartsRef.current, { ...part } as MessagePart);
        if (!throttleTimerRef.current) {
          throttleTimerRef.current = setTimeout(() => {
            throttleTimerRef.current = null;
            setStreamingParts([...streamPartsRef.current]);
          }, 60);
        }
      },
      endStream() {
        if (throttleTimerRef.current) { clearTimeout(throttleTimerRef.current); throttleTimerRef.current = null; }
        setIsStreaming(false);
        // 不立即提交到 messages，暂存等待 finalizeAssistantParts 用最终内容提交
        uncommittedStreamPartsRef.current = [...streamPartsRef.current];
        streamPartsRef.current = [];
        // 保持 streamingParts 可见，避免内容闪烁消失
        setStreamingParts([...uncommittedStreamPartsRef.current]);
      },
      finalizeAssistantParts(parts, meta?) {
        const normalizedParts = mergeMessageParts(parts);
        // 丢弃流式暂存，使用最终完整内容
        uncommittedStreamPartsRef.current = [];
        setStreamingParts([]);
        setMessages((prev) => {
          if (normalizedParts.length === 0) return prev;
          if (prev.length === 0) return [{ id: nextMsgId(), role: 'assistant', parts: normalizedParts, ...meta }];
          const last = prev[prev.length - 1];
          if (last.role !== 'assistant') return [...prev, { id: nextMsgId(), role: 'assistant', parts: normalizedParts, ...meta }];
          const copy = [...prev];
          copy[copy.length - 1] = { ...last, parts: mergeMessageParts([...last.parts, ...normalizedParts]), ...meta };
          return copy;
        });
      },
      setToolInvocations(invocations) {
        const copy = [...invocations];
        toolInvocationsRef.current = copy;
        setPendingApprovals(copy.filter(inv => inv.status === 'awaiting_approval'));
        setMessages((prev) => {
          if (prev.length === 0) return prev;
          const last = prev[prev.length - 1];
          if (last.role !== 'assistant') return prev;
          const nextParts = applyToolInvocationsToParts(last.parts, copy);
          const copyMessages = [...prev];
          copyMessages[copyMessages.length - 1] = { ...last, parts: mergeMessageParts(nextParts) };
          return copyMessages;
        });
      },
      setGenerating(generating) {
        if (!generating) {
          // 兜底：若 finalizeAssistantParts 未触发（如异常中断），将暂存的流式内容提交到 messages
          const uncommitted = uncommittedStreamPartsRef.current;
          if (uncommitted.length > 0) {
            setMessages((prev) => appendAssistantParts(prev, uncommitted));
            uncommittedStreamPartsRef.current = [];
          }
          setStreamingParts([]);
          streamPartsRef.current = [];
        }
        setIsGenerating(generating);
      },
      clearMessages() { setMessages([]); setStreamingParts([]); streamPartsRef.current = []; uncommittedStreamPartsRef.current = []; },
      commitTools() { toolInvocationsRef.current = []; setPendingApprovals([]); },
      setUsage(usage) { setContextTokens(usage.totalTokenCount ?? 0); lastUsageRef.current = usage; },
      finalizeResponse(durationMs) {
        const usage = lastUsageRef.current;
        setMessages((prev) => {
          if (prev.length === 0) return prev;
          const last = prev[prev.length - 1];
          if (last.role !== 'assistant') return prev;
          const copy = [...prev];
          copy[copy.length - 1] = { ...last, tokenIn: usage?.promptTokenCount, tokenOut: usage?.candidatesTokenCount, durationMs };
          return copy;
        });
        lastUsageRef.current = null;
      },
    };
    onReady(handle);
  }, [onReady]);

  // ============ 命令处理 ============
  const handleSubmit = useCallback((text: string) => {
    if (text === '/exit') { onExit(); return; }
    if (text === '/new') { setMessages([]); toolInvocationsRef.current = []; onNewSession(); return; }
    if (text === '/load') { onListSessions().then(metas => { setSessionList(metas); setSelectedIndex(0); setViewMode('session-list'); }); return; }
    if (text === '/settings' || text === '/mcp') { setSettingsInitialSection(text === '/mcp' ? 'mcp' : 'general'); setViewMode('settings'); return; }
    if (text.startsWith('/model')) {
      const arg = text.slice('/model'.length).trim();
      if (!arg) {
        const models = onListModels();
        setModelList(models);
        const currentIdx = models.findIndex(m => m.current);
        setSelectedIndex(currentIdx >= 0 ? currentIdx : 0);
        setViewMode('model-list');
      } else {
        const result = onSwitchModel(arg);
        if (result.modelId) setCurrentModelId(result.modelId);
        if (result.modelName) setCurrentModelName(result.modelName);
        if ('contextWindow' in result) setCurrentContextWindow(result.contextWindow);
        setMessages((prev) => [...prev, { id: nextMsgId(), role: 'assistant' as const, parts: [{ type: 'text' as const, text: result.message }] }]);
      }
      return;
    }
    if (text.startsWith('/sh ') || text === '/sh') {
      const cmd = text.slice(4).trim();
      if (!cmd) return;
      try {
        const result = onRunCommand(cmd);
        setMessages((prev) => [...prev, { id: nextMsgId(), role: 'assistant' as const, parts: [{ type: 'text' as const, text: result.output || '(无输出)' }] }]);
      } catch (err: any) {
        setMessages((prev) => [...prev, { id: nextMsgId(), role: 'assistant' as const, parts: [{ type: 'text' as const, text: `执行失败: ${err.message}` }] }]);
      }
      return;
    }
    onSubmit(text);
  }, [onSubmit, onNewSession, onListSessions, onRunCommand, onListModels, onSwitchModel, onExit]);

  // ============ 键盘输入 ============
  useKeyboard((key) => {
    if (viewMode === 'settings') return;
    // Ctrl+C：生成中中断
    if (key.ctrl && key.name === 'c') {
      if (isGenerating) {
        onAbort();
      }
      return;
    }
    // 工具审批拦截：左右/上下箭头切换选项，回车确认
    if (isGenerating && pendingApprovals.length > 0) {
      if (key.name === 'left' || key.name === 'up' || key.name === 'right' || key.name === 'down') {
        setApprovalChoice((prev) => prev === 'approve' ? 'reject' : 'approve');
        return;
      }
      if (key.name === 'enter' || key.name === 'return') {
        const approved = approvalChoice === 'approve';
        onToolApproval(pendingApprovals[0].id, approved);
        setApprovalChoice('approve'); // 重置为默认选择
        return;
      }
      // y / n 快捷键保留兼容
      if (key.name === 'y') { onToolApproval(pendingApprovals[0].id, true); setApprovalChoice('approve'); return; }
      if (key.name === 'n') { onToolApproval(pendingApprovals[0].id, false); setApprovalChoice('approve'); return; }
      return;
    }
    if (viewMode === 'session-list') {
      if (key.name === 'up') setSelectedIndex((prev) => Math.max(0, prev - 1));
      else if (key.name === 'down') setSelectedIndex((prev) => Math.min(sessionList.length - 1, prev + 1));
      else if (key.name === 'enter' || key.name === 'return') {
        const selected = sessionList[selectedIndex];
        if (selected) { setMessages([]); toolInvocationsRef.current = []; setViewMode('chat'); onLoadSession(selected.id).catch(() => {}); }
      } else if (key.name === 'escape') setViewMode('chat');
      return;
    }
    if (viewMode === 'model-list') {
      if (key.name === 'up') setSelectedIndex((prev) => Math.max(0, prev - 1));
      else if (key.name === 'down') setSelectedIndex((prev) => Math.min(modelList.length - 1, prev + 1));
      else if (key.name === 'enter' || key.name === 'return') {
        const selected = modelList[selectedIndex];
        if (selected) {
          const result = onSwitchModel(selected.modelName);
          if (result.modelId) setCurrentModelId(result.modelId);
          if (result.modelName) setCurrentModelName(result.modelName);
          if ('contextWindow' in result) setCurrentContextWindow(result.contextWindow);
          setViewMode('chat');
        }
      } else if (key.name === 'escape') setViewMode('chat');
      return;
    }
    if (key.name === 'escape') onExit();
  });

  // ============ 消息逻辑 ============
  const lastMsg = messages.length > 0 ? messages[messages.length - 1] : null;
  const lastIsActiveAssistant = isGenerating && lastMsg?.role === 'assistant';
  const activeMessage = lastIsActiveAssistant ? lastMsg : null;
  const displayMessages = useMemo(() => lastIsActiveAssistant ? messages.slice(0, -1) : messages, [messages, lastIsActiveAssistant]);

  // ============ 状态栏 ============
  const statusText = useMemo(() => {
    let s = currentModelName;
    if (currentModelId) s += ` (${currentModelId})`;
    s += `  \u00b7  ${(modeName ?? 'normal').toUpperCase()}`;
    s += '  \u00b7  ctx: ';
    s += contextTokens > 0 ? contextTokens.toLocaleString() : '-';
    if (currentContextWindow) s += `/${currentContextWindow.toLocaleString()}`;
    if (contextTokens > 0 && currentContextWindow) s += ` (${Math.round(contextTokens / currentContextWindow * 100)}%)`;
    return s;
  }, [currentModelName, currentModelId, modeName, contextTokens, currentContextWindow]);

  // ============ 设置视图 ============
  if (viewMode === 'settings') {
    return <SettingsView initialSection={settingsInitialSection} onBack={() => setViewMode('chat')} onLoad={onLoadSettings} onSave={onSaveSettings} />;
  }

  // ============ 会话列表 ============
  if (viewMode === 'session-list') {
    return (
      <box flexDirection="column" width="100%" height="100%">
        <box padding={1}>
          <text fg={C.primary}>历史对话</text>
          <text fg={C.dim}>  ↑↓ 选择  Enter 加载  Esc 返回</text>
        </box>
        <scrollbox flexGrow={1}>
          {sessionList.length === 0 && <text fg={C.dim} paddingLeft={2}>暂无历史对话</text>}
          {sessionList.map((meta, i) => {
            const isSelected = i === selectedIndex;
            const time = new Date(meta.updatedAt).toLocaleString('zh-CN');
            return (
              <box key={meta.id} paddingLeft={1}>
                <text>
                  <span fg={isSelected ? C.accent : C.dim}>{isSelected ? '\u276F ' : '  '}</span>
                  {isSelected ? <strong><span fg={C.text}>{meta.title}</span></strong> : <span fg={C.textSec}>{meta.title}</span>}
                  <span fg={C.dim}>  {meta.cwd}  {time}</span>
                </text>
              </box>
            );
          })}
        </scrollbox>
      </box>
    );
  }

  // ============ 模型列表 ============
  if (viewMode === 'model-list') {
    return (
      <box flexDirection="column" width="100%" height="100%">
        <box padding={1}>
          <text fg={C.primary}>切换模型</text>
          <text fg={C.dim}>  ↑↓ 选择  Enter 切换  Esc 返回</text>
        </box>
        <scrollbox flexGrow={1}>
          {modelList.map((info, i) => {
            const isSelected = i === selectedIndex;
            const currentMarker = info.current ? '\u2022' : ' ';
            return (
              <box key={info.modelName} paddingLeft={1}>
                <text>
                  <span fg={isSelected ? C.accent : C.dim}>{isSelected ? '\u276F ' : '  '}</span>
                  <span fg={info.current ? C.accent : C.dim}>{currentMarker} </span>
                  {isSelected ? <strong><span fg={C.text}>{info.modelName}</span></strong> : <span fg={C.textSec}>{info.modelName}</span>}
                  <span fg={C.dim}>  {info.modelId}  {info.provider}</span>
                </text>
              </box>
            );
          })}
        </scrollbox>
      </box>
    );
  }

  // ============ 对话视图 ============

  const hasMessages = displayMessages.length > 0 || activeMessage || isGenerating;

  return (
    <box flexDirection="column" width="100%" height="100%">
      {/* Logo — 无消息时居中大 Logo，有消息时紧凑头部 */}
      {!hasMessages ? (
        <box flexDirection="column" flexGrow={1} padding={1}>
          <box flexDirection="column" borderStyle="rounded" padding={2} borderColor={C.primary}>
            <text fg={C.primary}>
              <strong>{'  ╦╦═╗╦╔═╗'}</strong>
            </text>
            <text fg={C.primary}>
              <strong>{'  ║╠╦╝║╚═╗'}</strong>
            </text>
            <text fg={C.primary}>
              <strong>{'  ╩╩╚═╩╚═╝'}</strong>
            </text>
            <text> </text>
            <text fg={C.primaryLight}>模块化 AI 智能代理框架</text>
          </box>
          <text> </text>
          <text fg={C.dim}>输入消息开始对话  ·  输入 / 查看可用指令</text>
        </box>
      ) : (
        <box paddingLeft={1} flexShrink={0}>
          <text fg={C.primary}><strong>IRIS</strong></text>
          <text fg={C.dim}>  ·  {currentModelName}</text>
        </box>
      )}

      {/* 消息区域 — 有消息时显示 */}
      {hasMessages && <scrollbox flexGrow={1} stickyScroll>
        {displayMessages.map((msg) => (
          <box key={msg.id} flexDirection="column" paddingBottom={1}>
            <MessageItem msg={msg} modelName={currentModelName} />
          </box>
        ))}
        {activeMessage && (
          <box flexDirection="column" paddingBottom={1}>
            <MessageItem msg={activeMessage} liveParts={streamingParts.length > 0 ? streamingParts : undefined} isStreaming={isStreaming} modelName={currentModelName} />
            {isStreaming && streamingParts.length === 0 && <GeneratingTimer isGenerating={isGenerating} />}
          </box>
        )}
        {isGenerating && !activeMessage && (
          <box flexDirection="column" paddingBottom={1}>
            {streamingParts.length > 0 ? (
              <MessageItem msg={{ id: 'tmp', role: 'assistant', parts: [] }} liveParts={streamingParts} isStreaming={isStreaming} modelName={currentModelName} />
            ) : (
              <GeneratingTimer isGenerating={isGenerating} />
            )}
          </box>
        )}
      </scrollbox>}

      {/* 状态栏 */}
      <box paddingLeft={1} paddingRight={1} flexShrink={0}>
        <text fg={C.dim}><em>{statusText}</em></text>
      </box>

      {/* 工具审批 / 输入栏 */}
      {pendingApprovals.length > 0 ? (
        <box paddingLeft={1} paddingRight={1} flexShrink={0} flexDirection="column">
          <text>
            <span fg={C.warn}><strong>? </strong></span>
            <span fg={C.text}>确认执行 </span>
            <span fg={C.warn}><strong>{pendingApprovals[0].toolName}</strong></span>
            {pendingApprovals.length > 1 ? <span fg={C.dim}>{`  (剩余 ${pendingApprovals.length - 1} 个)`}</span> : null}
          </text>
          <text>
            <span fg={C.dim}>{'  ←→ 切换  Enter 确认  '}</span>
            {approvalChoice === 'approve'
              ? <span><span fg={C.accent} bg="#1e3a2f"><strong> ✔ 批准(Y) </strong></span><span fg={C.dim}>   ✘ 拒绝(N) </span></span>
              : <span><span fg={C.dim}>   ✔ 批准(Y) </span><span fg={C.error} bg="#3a1e1e"><strong> ✘ 拒绝(N) </strong></span></span>
            }
          </text>
        </box>
      ) : (
        <box paddingLeft={1} paddingRight={1} flexShrink={0}>
          <InputBar disabled={isGenerating} onSubmit={handleSubmit} />
        </box>
      )}
    </box>
  );
}
