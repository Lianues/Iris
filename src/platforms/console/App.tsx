/** @jsxImportSource @opentui/react */

/**
 * TUI 根组件 (OpenTUI React)
 *
 * 全屏布局：Logo + scrollbox 消息区 + 状态栏 + 输入栏。
 */

import React, { useEffect, useRef, useState } from 'react';
import { useRenderer } from '@opentui/react';
import type { LLMModelInfo } from '../../llm/router';
import type { SessionMeta } from '../../storage/base';
import type { WindowInfo } from '../../computer-use/types';
import { BottomPanel } from './components/BottomPanel';
import { ChatMessageList } from './components/ChatMessageList';
import { DiffApprovalView } from './components/DiffApprovalView';
import { InitWarnings } from './components/InitWarnings';
import { LogoScreen } from './components/LogoScreen';
import { ModelListView } from './components/ModelListView';
import { SessionListView } from './components/SessionListView';
import { SettingsView } from './components/SettingsView';
import { WindowListView } from './components/WindowListView';
import { type ConfirmChoice, type PendingConfirm, type SettingsInitialSection, type ViewMode } from './app-types';
import type { AppProps } from './app-props';
import { useAppHandle, type AppHandle } from './hooks/use-app-handle';
import { useAppKeyboard } from './hooks/use-app-keyboard';
import { useApproval } from './hooks/use-approval';
import { useCommandDispatch } from './hooks/use-command-dispatch';
import { useExitConfirm } from './hooks/use-exit-confirm';
import { useModelState } from './hooks/use-model-state';
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
  onListWindows,
  onSwitchWindow,
  onSwitchAgent,
  hasComputerUse,
  initWarnings,
  agentName,
  modeName,
  modelId,
  modelName,
  contextWindow,
}: AppProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('chat');
  const [sessionList, setSessionList] = useState<SessionMeta[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [settingsInitialSection, setSettingsInitialSection] = useState<SettingsInitialSection>('general');
  const [modelList, setModelList] = useState<LLMModelInfo[]>([]);
  const [copyMode, setCopyMode] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);
  const [confirmChoice, setConfirmChoice] = useState<ConfirmChoice>('confirm');
  const [windowList, setWindowList] = useState<WindowInfo[]>([]);
  const [windowSearchText, setWindowSearchText] = useState('');

  const renderer = useRenderer();
  const undoRedoRef = useRef<UndoRedoStack>(createUndoRedoStack());
  const appState = useAppHandle({ onReady, undoRedoRef });
  const approval = useApproval(appState.pendingApprovals, appState.pendingApplies);
  const exitConfirm = useExitConfirm();
  const modelState = useModelState({ modelId, modelName, contextWindow });

  const handleSubmit = useCommandDispatch({
    onSubmit,
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
    onListWindows,
    onSwitchWindow,
    setWindowList,
    setWindowSearchText,
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
  });

  useEffect(() => {
    if (!renderer) return;
    renderer.useMouse = !copyMode;
  }, [renderer, copyMode]);

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
    windowList,
    windowSearchText,
    setWindowSearchText,
    onSwitchWindow,
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
      />
    );
  }

  if (viewMode === 'session-list') {
    return <SessionListView sessions={sessionList} selectedIndex={selectedIndex} />;
  }

  if (viewMode === 'model-list') {
    return <ModelListView models={modelList} selectedIndex={selectedIndex} />;
  }

  if (viewMode === 'window-list') {
    return <WindowListView windows={windowList} selectedIndex={selectedIndex} searchText={windowSearchText} />;
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
        onSubmit={handleSubmit}
        agentName={agentName}
        modeName={modeName}
        modelName={modelState.currentModelName}
        contextTokens={appState.contextTokens}
        contextWindow={modelState.currentContextWindow}
        copyMode={copyMode}
        exitConfirmArmed={exitConfirm.exitConfirmArmed}
        hasComputerUse={hasComputerUse}
      />
    </box>
  );
}
