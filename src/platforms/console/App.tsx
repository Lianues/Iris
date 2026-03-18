/** @jsxImportSource @opentui/react */

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
import { DiffApprovalView } from './components/DiffApprovalView';
import { SettingsView } from './components/SettingsView';
import { ConsoleSettingsSaveResult, ConsoleSettingsSnapshot } from './settings';
import { C } from './theme';
import { createUndoRedoStack, performUndo, performRedo, clearRedo, UndoRedoStack } from './undo-redo';

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
  addErrorMessage(text: string): void;
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
  onUndo: () => Promise<boolean>;
  onRedo: () => Promise<boolean>;
  onClearRedoStack: () => void;
  onToolApproval: (toolId: string, approved: boolean) => void;
  onToolApply: (toolId: string, applied: boolean) => void;
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
export function App({ onReady, onSubmit, onUndo, onRedo, onClearRedoStack, onToolApproval, onToolApply, onAbort, onNewSession, onLoadSession, onListSessions, onRunCommand, onListModels, onSwitchModel, onLoadSettings, onSaveSettings, onExit, modeName, modelId, modelName, contextWindow }: AppProps) {
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
  const [exitConfirmArmed, setExitConfirmArmed] = useState(false);
  const [copyMode, setCopyMode] = useState(false);

  const { width: termWidth } = useTerminalDimensions();
  const renderer = useRenderer();

  const [pendingApprovals, setPendingApprovals] = useState<ToolInvocation[]>([]);
  const [pendingApplies, setPendingApplies] = useState<ToolInvocation[]>([]);
  const [approvalChoice, setApprovalChoice] = useState<'approve' | 'reject'>('approve');
  const [approvalDiffView, setApprovalDiffView] = useState<'unified' | 'split'>('unified');
  const [approvalDiffShowLineNumbers, setApprovalDiffShowLineNumbers] = useState(true);
  const [approvalDiffWrapMode, setApprovalDiffWrapMode] = useState<'none' | 'word'>('word');
  const [approvalPreviewIndex, setApprovalPreviewIndex] = useState(0);
  const streamPartsRef = useRef<MessagePart[]>([]);
  const toolInvocationsRef = useRef<ToolInvocation[]>([]);
  const throttleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exitConfirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** endStream 后暂存的流式 parts，等待 finalizeAssistantParts 消费或 setGenerating(false) 兜底提交 */
  const uncommittedStreamPartsRef = useRef<MessagePart[]>([]);
  const lastUsageRef = useRef<UsageMetadata | null>(null);

  const clearExitConfirm = useCallback(() => {
    if (exitConfirmTimerRef.current) {
      clearTimeout(exitConfirmTimerRef.current);
      exitConfirmTimerRef.current = null;
    }
    setExitConfirmArmed(false);
  }, []);

  const armExitConfirm = useCallback(() => {
    if (exitConfirmTimerRef.current) clearTimeout(exitConfirmTimerRef.current);
    setExitConfirmArmed(true);
    exitConfirmTimerRef.current = setTimeout(() => {
      exitConfirmTimerRef.current = null;
      setExitConfirmArmed(false);
    }, 1500);
  }, []);

  useEffect(() => () => {
    if (exitConfirmTimerRef.current) clearTimeout(exitConfirmTimerRef.current);
  }, []);

  useEffect(() => {
    if (!renderer) return;
    renderer.useMouse = !copyMode;
  }, [renderer, copyMode]);

  // 一类审批切换时重置选择
  useEffect(() => {
    setApprovalChoice('approve');
  }, [pendingApprovals[0]?.id]);

  // 二类审批切换时重置 diff 视图状态
  useEffect(() => {
    setApprovalChoice('approve');
    setApprovalDiffView('unified');
    setApprovalDiffShowLineNumbers(true);
    setApprovalDiffWrapMode('word');
    setApprovalPreviewIndex(0);
  }, [pendingApplies[0]?.id]);

  // ============ Undo/Redo ============
  const undoRedoRef = useRef<UndoRedoStack>(createUndoRedoStack());

  // ============ AppHandle ============
  useEffect(() => {
    const handle: AppHandle = {
      addMessage(role, content, meta?) {
        clearRedo(undoRedoRef.current);
        const textPart: MessagePart = { type: 'text', text: content };
        if (role === 'assistant') { setMessages((prev) => appendAssistantParts(prev, [textPart], meta)); return; }
        setMessages((prev) => [...prev.filter(m => !m.isError), { id: nextMsgId(), role, parts: [textPart], ...meta }]);
      },
      addErrorMessage(text) {
        setMessages((prev) => [
          ...prev, { id: nextMsgId(), role: 'assistant', parts: [{ type: 'text', text }], isError: true },
        ]);
      },
      addStructuredMessage(role, parts, meta?) {
        clearRedo(undoRedoRef.current);
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
          if (normalizedParts.length === 0 && !meta) return prev;
          const last = prev[prev.length - 1];
          // parts 为空且有 meta：仅更新最后一条 assistant 消息的 meta
          if (normalizedParts.length === 0) {
            if (!last || last.role !== 'assistant') return prev;
            const copy = [...prev];
            copy[copy.length - 1] = { ...last, ...meta };
            return copy;
          }
          if (prev.length === 0) return [{ id: nextMsgId(), role: 'assistant', parts: normalizedParts, ...meta }];
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
        setPendingApplies(copy.filter(inv => inv.status === 'awaiting_apply'));
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
      commitTools() { toolInvocationsRef.current = []; setPendingApprovals([]); setPendingApplies([]); },
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
    if (text === '/new') { clearRedo(undoRedoRef.current); onClearRedoStack(); setMessages([]); toolInvocationsRef.current = []; onNewSession(); return; }
    if (text === '/undo') {
      void onUndo().then((ok) => {
        if (!ok) return;
        setMessages((prev) => {
          const result = performUndo(prev, undoRedoRef.current);
          if (!result) return prev;
          return result.messages;
        });
      }).catch(() => {});
      return;
    }
    if (text === '/redo') {
      void onRedo().then((ok) => {
        if (!ok) return;
        setMessages((prev) => {
          const result = performRedo(prev, undoRedoRef.current);
          if (!result) return prev;
          return result.messages;
        });
      }).catch(() => {});
      return;
    }
    if (text === '/load') { onListSessions().then(metas => { setSessionList(metas); setSelectedIndex(0); setViewMode('session-list'); }); return; }
    if (text === '/settings' || text === '/mcp') { setSettingsInitialSection(text === '/mcp' ? 'mcp' : 'general'); setViewMode('settings'); return; }
    if (text.startsWith('/model')) {
      clearRedo(undoRedoRef.current); onClearRedoStack();
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
      clearRedo(undoRedoRef.current); onClearRedoStack();
      try {
        const result = onRunCommand(cmd);
        setMessages((prev) => [...prev, { id: nextMsgId(), role: 'assistant' as const, parts: [{ type: 'text' as const, text: result.output || '(无输出)' }] }]);
      } catch (err: any) {
        setMessages((prev) => [...prev, { id: nextMsgId(), role: 'assistant' as const, parts: [{ type: 'text' as const, text: `执行失败: ${err.message}` }] }]);
      }
      return;
    }
    clearRedo(undoRedoRef.current);
    onClearRedoStack();
    onSubmit(text);
  }, [onSubmit, onUndo, onRedo, onClearRedoStack, onNewSession, onListSessions, onRunCommand, onListModels, onSwitchModel, onExit]);

  // ============ 键盘输入 ============
  useKeyboard((key) => {
    // Ctrl+C：连续两次退出，第一次仅确认
    if (key.ctrl && key.name === 'c') {
      if (exitConfirmArmed) {
        clearExitConfirm();
        onExit();
      } else {
        armExitConfirm();
      }
      return;
    }
    if (key.name === 'f6') {
      setCopyMode(prev => !prev);
      return;
    }
    if (viewMode === 'settings') return;
    // ESC：生成中中断 / 子视图返回
    if (key.name === 'escape') {
      if (isGenerating) { onAbort(); return; }
      if (viewMode === 'session-list' || viewMode === 'model-list') { setViewMode('chat'); return; }
      return;
    }

    // 二类审批拦截：awaiting_apply → diff 预览视图
    if (isGenerating && pendingApplies.length > 0) {
      const current = pendingApplies[0];
      if (key.name === 'up' || key.name === 'down') {
        setApprovalPreviewIndex((prev) => key.name === 'up' ? prev - 1 : prev + 1);
        return;
      }
      if (key.name === 'tab' || key.name === 'left' || key.name === 'right') {
        setApprovalChoice((prev) => prev === 'approve' ? 'reject' : 'approve');
        return;
      }
      if (key.name === 'v') { setApprovalDiffView((prev) => prev === 'unified' ? 'split' : 'unified'); return; }
      if (key.name === 'l') { setApprovalDiffShowLineNumbers((prev) => !prev); return; }
      if (key.name === 'w') { setApprovalDiffWrapMode((prev) => prev === 'none' ? 'word' : 'none'); return; }
      if (key.name === 'enter' || key.name === 'return') {
        onToolApply(current.id, approvalChoice === 'approve');
        setApprovalChoice('approve');
        return;
      }
      if (key.name === 'y') { onToolApply(current.id, true); setApprovalChoice('approve'); return; }
      if (key.name === 'n') { onToolApply(current.id, false); setApprovalChoice('approve'); return; }
      return;
    }

    // 一类审批拦截：awaiting_approval → 底部 Y/N
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
        if (selected) { clearRedo(undoRedoRef.current); onClearRedoStack(); setMessages([]); toolInvocationsRef.current = []; setViewMode('chat'); onLoadSession(selected.id).catch(() => {}); }
      }
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
      }
      return;
    }
  });

  // ============ 消息逻辑 ============
  const lastMsg = messages.length > 0 ? messages[messages.length - 1] : null;
  const lastIsActiveAssistant = isGenerating && lastMsg?.role === 'assistant';
  const activeMessage = lastIsActiveAssistant ? lastMsg : null;
  const displayMessages = useMemo(() => lastIsActiveAssistant ? messages.slice(0, -1) : messages, [messages, lastIsActiveAssistant]);

  // ============ 状态栏 ============
  const modeNameCapitalized = (modeName ?? 'normal').charAt(0).toUpperCase() + (modeName ?? 'normal').slice(1);
  const contextStr = contextTokens > 0 ? contextTokens.toLocaleString() : '-';
  const contextLimitStr = currentContextWindow ? `/${currentContextWindow.toLocaleString()}` : '';
  const contextPercent = contextTokens > 0 && currentContextWindow ? ` (${Math.round(contextTokens / currentContextWindow * 100)}%)` : '';

  const currentApply = isGenerating ? pendingApplies[0] : undefined;

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

  if (currentApply) {
    return (
      <DiffApprovalView
        invocation={currentApply}
        pendingCount={pendingApplies.length}
        choice={approvalChoice}
        view={approvalDiffView}
        showLineNumbers={approvalDiffShowLineNumbers}
        wrapMode={approvalDiffWrapMode}
        previewIndex={approvalPreviewIndex}
      />
    );
  }

  // ============ 对话视图 ============

  const hasMessages = displayMessages.length > 0 || activeMessage || isGenerating;

  return (
    <box flexDirection="column" width="100%" height="100%">
      {/* Logo — 无消息时居中大 Logo */}
      {!hasMessages && (
        <box flexDirection="column" flexGrow={1} padding={1} alignItems="center" justifyContent="center">
          <box flexDirection="column" border={false} padding={2} alignItems="center">
            <text fg={C.primary}>
              <strong>{'▀█▀ █▀█ ▀█▀ █▀▀'}</strong>
            </text>
            <text fg={C.primary}>
              <strong>{' █  █▀▄  █  ▀▀█'}</strong>
            </text>
            <text fg={C.primary}>
              <strong>{'▀▀▀ ▀ ▀ ▀▀▀ ▀▀▀'}</strong>
            </text>
            <text> </text>
            <text fg={C.dim}>模块化 AI 智能代理框架</text>
          </box>
        </box>
      )}

      {/* 消息区域 — 有消息时显示 */}
      {hasMessages && <scrollbox flexGrow={1} stickyScroll stickyStart="bottom">
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

      {/* 底部输入区 */}
      <box flexDirection="column" flexShrink={0} paddingX={1} paddingBottom={1} paddingTop={hasMessages ? 1 : 0}>
        {pendingApprovals.length > 0 ? (
          <box flexDirection="column" borderStyle="single" borderColor={approvalChoice === 'approve' ? C.accent : C.error} paddingLeft={1} paddingRight={1} paddingY={0}>
            <text>
              <span fg={C.warn}><strong>? </strong></span>
              <span fg={C.text}>确认执行 </span>
              <span fg={C.warn}><strong>{pendingApprovals[0].toolName}</strong></span>
              <span fg={C.dim}>  </span>
              <span fg={approvalChoice === 'approve' ? C.accent : C.textSec}>{approvalChoice === 'approve' ? '[(Y)批准]' : ' (Y)批准 '}</span>
              <span fg={C.dim}> </span>
              <span fg={approvalChoice === 'reject' ? C.error : C.textSec}>{approvalChoice === 'reject' ? '[(N)拒绝]' : ' (N)拒绝 '}</span>
              {pendingApprovals.length > 1 ? <span fg={C.dim}>{`  (剩余 ${pendingApprovals.length - 1} 个)`}</span> : null}
            </text>
          </box>
        ) : (
          <box flexDirection="column" borderStyle="single" borderColor={isGenerating ? C.dim : C.border} padding={1} paddingBottom={0}>
            <InputBar disabled={isGenerating} onSubmit={handleSubmit} />
            <box flexDirection="row" marginTop={1}>
              <box flexGrow={1}>
                <text>
                  <span fg={C.primaryLight}><strong>{modeNameCapitalized}</strong></span>
                  <span fg={C.dim}> · </span>
                  <span fg={C.textSec}>{currentModelName}</span>
                </text>
              </box>
              <box>
                <text fg={C.dim}>ctx {contextStr}{contextLimitStr}{contextPercent}</text>
              </box>
            </box>
          </box>
        )}
        <box flexDirection="row" justifyContent="flex-end" paddingTop={0} paddingRight={1}>
          <text fg={exitConfirmArmed ? C.warn : C.dim}>
            {isGenerating ? 'esc 中断生成' : 'tab 补全'}
            {'  ·  '}
            {copyMode ? 'f6 返回滚动模式' : 'f6 复制模式'}
            {'  ·  '}
            {exitConfirmArmed ? '再次按 ctrl+c 退出' : 'ctrl+c 连按两次退出'}
          </text>
        </box>
      </box>
    </box>
  );
}
