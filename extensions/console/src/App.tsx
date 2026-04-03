/** @jsxImportSource @opentui/react */

/**
 * TUI 根组件 (OpenTUI React)
 *
 * 全屏布局：Logo + scrollbox 消息区 + 状态栏 + 输入栏。
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useRenderer } from '@opentui/react';
import type { IrisModelInfoLike as LLMModelInfo, IrisSessionMetaLike as SessionMeta } from '@irises/extension-sdk';
import { BottomPanel } from './components/BottomPanel';
import { ChatMessageList } from './components/ChatMessageList';
import { DiffApprovalView } from './components/DiffApprovalView';
import { InitWarnings } from './components/InitWarnings';
import { LogoScreen } from './components/LogoScreen';
import { ModelListView } from './components/ModelListView';
import { QueueListView } from './components/QueueListView';
import { SessionListView } from './components/SessionListView';
import { SettingsView } from './components/SettingsView';
import { type ConfirmChoice, type PendingConfirm, type SettingsInitialSection, type ViewMode } from './app-types';
import type { AppProps } from './app-props';
import { useAppHandle, type AppHandle } from './hooks/use-app-handle';
import { useAppKeyboard } from './hooks/use-app-keyboard';
import { useApproval } from './hooks/use-approval';
import { useCommandDispatch } from './hooks/use-command-dispatch';
import { useExitConfirm } from './hooks/use-exit-confirm';
import { useMessageQueue } from './hooks/use-message-queue';
import { useModelState } from './hooks/use-model-state';
import { useTextInput } from './hooks/use-text-input';
import { createUndoRedoStack, type UndoRedoStack } from './undo-redo';

export type { AppHandle } from './hooks/use-app-handle';
export type { MessageMeta } from './app-types';
export type { AppProps } from './app-props';

export function App({
  onReady,
  onSubmit,
  onUndo,
  onRedo,
  onClearRedoStack,
  onToolApproval,
  onToolApply,
  onAbort,
  onNewSession,
  onLoadSession,
  onListSessions,
  onRunCommand,
  onListModels,
  onSwitchModel,
  onLoadSettings,
  onSaveSettings,
  onResetConfig,
  onExit,
  onSummarize,
  onSwitchAgent,
  initWarnings,
  agentName,
  modeName,
  modelId,
  modelName,
  contextWindow,
  pluginSettingsTabs,
}: AppProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('chat');
  const [sessionList, setSessionList] = useState<SessionMeta[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [settingsInitialSection, setSettingsInitialSection] = useState<SettingsInitialSection>('general');
  const [modelList, setModelList] = useState<LLMModelInfo[]>([]);
  const [copyMode, setCopyMode] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);
  const [confirmChoice, setConfirmChoice] = useState<ConfirmChoice>('confirm');

  // 队列编辑状态（复用 useTextInput 获得完整光标和编辑能力）
  const [queueEditingId, setQueueEditingId] = useState<string | null>(null);
  const [queueEditState, queueEditActions] = useTextInput('');

  const renderer = useRenderer();
  const undoRedoRef = useRef<UndoRedoStack>(createUndoRedoStack());

  // ── 消息队列 ────────────────────────────────────────────
  const messageQueue = useMessageQueue();

  // drainCallbackRef: 供 AppHandle.drainQueue() 调用，从队列出队下一条消息。
  // 当用户正在 queue-list 视图中管理队列时，暂停自动出队，避免打断编辑。
  const drainCallbackRef = useRef<(() => string | undefined) | null>(null);
  drainCallbackRef.current = () => {
    if (viewMode === 'queue-list') return undefined;
    const msg = messageQueue.dequeue();
    return msg?.text;
  };

  const appState = useAppHandle({ onReady, undoRedoRef, drainCallbackRef });
  const approval = useApproval(appState.pendingApprovals, appState.pendingApplies);
  const exitConfirm = useExitConfirm();
  const modelState = useModelState({ modelId, modelName, contextWindow });

  // ── 队列感知的提交处理器 ──────────────────────────────
  // 生成中提交的消息入队，空闲时直接发送
  const queueAwareSubmit = useCallback((text: string) => {
    if (appState.isGenerating) {
      messageQueue.enqueue(text);
    } else {
      onSubmit(text);
    }
  }, [appState.isGenerating, messageQueue, onSubmit]);

  // ── 强制优先发送：中断当前生成，将消息插到队列最前面立即发送 ──
  const handlePrioritySubmit = useCallback((text: string) => {
    messageQueue.prepend(text);
    onAbort();
  }, [messageQueue, onAbort]);

  const handleSubmit = useCommandDispatch({
    onSubmit: queueAwareSubmit,
    onUndo,
    onRedo,
    onClearRedoStack,
    onNewSession,
    onListSessions,
    onRunCommand,
    onListModels,
    onSwitchModel,
    onResetConfig,
    onExit,
    onSwitchAgent,
    onSummarize,
    undoRedoRef,
    setMessages: appState.setMessages,
    commitTools: appState.commitTools,
    setViewMode,
    setSessionList,
    setModelList,
    setSelectedIndex,
    setPendingConfirm,
    setConfirmChoice,
    setSettingsInitialSection,
    modelState,
    queueClear: messageQueue.clear,
    queueSize: messageQueue.size,
  });

  useEffect(() => {
    if (!renderer) return;
    renderer.useMouse = !copyMode;
  }, [renderer, copyMode]);

  // 离开 queue-list 视图时：如果当前空闲且队列非空，自动发送队首消息恢复排流。
  const prevViewModeRef = useRef(viewMode);
  useEffect(() => {
    const prev = prevViewModeRef.current;
    prevViewModeRef.current = viewMode;
    if (prev === 'queue-list' && viewMode === 'chat' && !appState.isGenerating && messageQueue.size > 0) {
      const next = messageQueue.dequeue();
      if (next) {
        onSubmit(next.text);
      }
    }
  }, [viewMode, appState.isGenerating, messageQueue, onSubmit]);

  useAppKeyboard({
    viewMode,
    setViewMode,
    setCopyMode,
    pendingConfirm,
    confirmChoice,
    setPendingConfirm,
    setConfirmChoice,
    exitConfirm,
    isGenerating: appState.isGenerating,
    pendingApplies: appState.pendingApplies,
    pendingApprovals: appState.pendingApprovals,
    approval,
    onExit,
    onAbort,
    onToolApply,
    onToolApproval,
    sessionList,
    modelList,
    selectedIndex,
    setSelectedIndex,
    undoRedoRef,
    onClearRedoStack,
    setMessages: appState.setMessages,
    commitTools: appState.commitTools,
    onLoadSession,
    onSwitchModel,
    modelState,
    queue: messageQueue.queue,
    queueRemove: messageQueue.remove,
    queueMoveUp: messageQueue.moveUp,
    queueMoveDown: messageQueue.moveDown,
    queueEdit: messageQueue.edit,
    queueClear: messageQueue.clear,
    queueEditingId,
    setQueueEditingId,
    queueEditState,
    queueEditActions,
  });

  const currentApply = appState.isGenerating ? appState.pendingApplies[0] : undefined;
  const hasMessages = appState.messages.length > 0 || appState.isGenerating;

  if (viewMode === 'settings') {
    return (
      <SettingsView
        initialSection={settingsInitialSection}
        onBack={() => setViewMode('chat')}
        onLoad={onLoadSettings}
        onSave={onSaveSettings}
        pluginTabs={pluginSettingsTabs}
      />
    );
  }

  if (viewMode === 'session-list') {
    return <SessionListView sessions={sessionList} selectedIndex={selectedIndex} />;
  }

  if (viewMode === 'model-list') {
    return <ModelListView models={modelList} selectedIndex={selectedIndex} />;
  }

  if (viewMode === 'queue-list') {
    return (
      <QueueListView
        queue={messageQueue.queue}
        selectedIndex={selectedIndex}
        editingId={queueEditingId}
        editingValue={queueEditState.value}
        editingCursor={queueEditState.cursor}
      />
    );
  }

  if (currentApply) {
    return (
      <DiffApprovalView
        invocation={currentApply}
        pendingCount={appState.pendingApplies.length}
        choice={approval.approvalChoice}
        view={approval.diffView}
        showLineNumbers={approval.showLineNumbers}
        wrapMode={approval.wrapMode}
        previewIndex={approval.previewIndex}
      />
    );
  }

  return (
    <box flexDirection="column" width="100%" height="100%">
      {!hasMessages ? <LogoScreen /> : null}
      {!hasMessages && initWarnings && initWarnings.length > 0 ? <InitWarnings warnings={initWarnings} /> : null}

      {hasMessages ? (
        <ChatMessageList
          messages={appState.messages}
          streamingParts={appState.streamingParts}
          isStreaming={appState.isStreaming}
          isGenerating={appState.isGenerating}
          retryInfo={appState.retryInfo}
          modelName={modelState.currentModelName}
        />
      ) : null}

      <BottomPanel
        hasMessages={hasMessages}
        pendingConfirm={pendingConfirm}
        confirmChoice={confirmChoice}
        pendingApprovals={appState.pendingApprovals}
        approvalChoice={approval.approvalChoice}
        isGenerating={appState.isGenerating}
        queueSize={messageQueue.size}
        onSubmit={handleSubmit}
        onPrioritySubmit={handlePrioritySubmit}
        agentName={agentName}
        modeName={modeName}
        modelName={modelState.currentModelName}
        contextTokens={appState.contextTokens}
        contextWindow={modelState.currentContextWindow}
        copyMode={copyMode}
        exitConfirmArmed={exitConfirm.exitConfirmArmed}
        backgroundTaskCount={appState.backgroundTaskCount}
        delegateTaskCount={appState.delegateTaskCount}
        backgroundTaskTokens={appState.backgroundTaskTokens}
        backgroundTaskSpinnerFrame={appState.backgroundTaskSpinnerFrame}
      />
    </box>
  );
}
