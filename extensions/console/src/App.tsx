/** @jsxImportSource @opentui/react */

/**
 * TUI 根组件 (OpenTUI React)
 *
 * 全屏布局：Logo + scrollbox 消息区 + 状态栏 + 输入栏。
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRenderer } from '@opentui/react';
import type { IrisModelInfoLike as LLMModelInfo, IrisSessionMetaLike as SessionMeta } from 'irises-extension-sdk';
import type { AgentDefinitionLike } from 'irises-extension-sdk';
import { BottomPanel } from './components/BottomPanel';
import { AgentListView } from './components/AgentListView';
import { ChatMessageList } from './components/ChatMessageList';
import { DiffApprovalView } from './components/DiffApprovalView';
import { InitWarnings } from './components/InitWarnings';
import { FileBrowserView } from './components/FileBrowserView';
import { LogoScreen } from './components/LogoScreen';
import { ToolDetailView } from './components/ToolDetailView';
import { ModelListView } from './components/ModelListView';
import { QueueListView } from './components/QueueListView';
import { ToolListView } from './components/ToolListView';
import { SessionListView } from './components/SessionListView';
import { MemoryListView, type MemoryItem, type MemoryFilter } from './components/MemoryListView';
import { ExtensionListView, type ExtensionItem } from './components/ExtensionListView';
import { SettingsView } from './components/SettingsView';
import { type ConfirmChoice, type PendingConfirm, type SettingsInitialSection, type ThinkingEffortLevel, type ViewMode } from './app-types';
import type { AppProps } from './app-props';
import type { Command } from './input-commands';
import { useAppHandle, type AppHandle } from './hooks/use-app-handle';
import { useAppKeyboard } from './hooks/use-app-keyboard';
import { useApproval } from './hooks/use-approval';
import { useCommandDispatch } from './hooks/use-command-dispatch';
import { useExitConfirm } from './hooks/use-exit-confirm';
import { useMessageQueue } from './hooks/use-message-queue';
import { useModelState } from './hooks/use-model-state';
import { useTextInput } from './hooks/use-text-input';
import { createUndoRedoStack, type UndoRedoStack } from './undo-redo';
import { getSlashCommands, onSlashCommandsChanged } from './slash-command-service';

// ── Provider 级别映射 ──────────────────────────────────────
const PROVIDER_LEVELS: Record<string, ThinkingEffortLevel[]> = {
  'claude':             ['not-set', 'none', 'low', 'medium', 'high', 'xhigh', 'max'],
  'gemini':             ['not-set', 'minimal', 'low', 'medium', 'high'],
  'openai-compatible':  ['not-set', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh'],
  'openai-responses':   ['not-set', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh'],
};
const DEFAULT_LEVELS: ThinkingEffortLevel[] = ['not-set', 'low', 'medium', 'high'];

function getProviderThinkingLevels(provider?: string): ThinkingEffortLevel[] {
  if (!provider) return DEFAULT_LEVELS;
  return PROVIDER_LEVELS[provider] ?? DEFAULT_LEVELS;
}

export type { AppHandle } from './hooks/use-app-handle';
export type { MessageMeta } from './app-types';
export type { AppProps } from './app-props';

export function App({
  onReady,
  onSubmit,
  onFileAttach,
  onRemoveFile: onRemoveFileProp,
  onFileBrowserSelect,
  onFileBrowserGoUp,
  onFileBrowserToggleHidden,
  onOpenToolDetail,
  onNavigateToolDetail,
  onCloseToolDetail,
  onUndo,
  onRedo,
  onClearRedoStack,
  onToolApproval,
  onToolApply,
  onToolMessage,
  onAddCommandPattern,
  onAbort,
  onToolAbort,
  onNewSession,
  onLoadSession,
  onDeleteSession,
  onListSessions,
  onRunCommand,
  onListModels,
  onSwitchModel,
  onSetDefaultModel,
  onUpdateModelEntry,
  onLoadSettings,
  onSaveSettings,
  onResetConfig,
  onExit,
  onEnterHeadless,
  supportsHeadlessTransition,
  onSummarize,
  onPlanCommand,
  onListAgents,
  onSelectAgent,
  onThinkingEffortChange,
  initWarnings,
  agentName,
  modeName,
  modelId,
  modelName,
  contextWindow,
  pluginSettingsTabs,
  onDream,
  onListMemories,
  onDeleteMemory,
  onListExtensions,
  onToggleExtension,
  onInstallGitExtension,
  onDeleteExtension,
  onPreviewUpdateExtension,
  onUpdateExtension,
  onListPluginSettingsTabs,
  onRemoteConnect,
  onRemoteDisconnect,
  remoteHost,
  modelProvider,
  thinkingControlEnabled,
  initWarningsColor,
  initWarningsIcon,
}: AppProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('chat');
  const [sessionList, setSessionList] = useState<SessionMeta[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [settingsInitialSection, setSettingsInitialSection] = useState<SettingsInitialSection>('general');
  const [modelList, setModelList] = useState<LLMModelInfo[]>([]);
  const [defaultModelName, setDefaultModelName] = useState('');
  const [sessionPendingDeleteId, setSessionPendingDeleteId] = useState<string | null>(null);
  const [sessionStatusMessage, setSessionStatusMessage] = useState<string | null>(null);
  const [sessionStatusIsError, setSessionStatusIsError] = useState(false);
  const [agentList, setAgentList] = useState<AgentDefinitionLike[]>([]);
  const [copyMode, setCopyMode] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);
  const [confirmChoice, setConfirmChoice] = useState<ConfirmChoice>('confirm');
  const initialLevels = getProviderThinkingLevels(modelProvider);
  const initialMaxLevel = initialLevels[initialLevels.length - 1];
  const [thinkingEffort, setThinkingEffort] = useState<ThinkingEffortLevel>(thinkingControlEnabled === false ? 'not-set' : initialMaxLevel);
  const [thoughtsToggleSignal, setThoughtsToggleSignal] = useState(0);

  // /model 视图状态
  const [modelStatusMessage, setModelStatusMessage] = useState<string | null>(null);
  const [modelStatusIsError, setModelStatusIsError] = useState(false);
  const [modelEditingField, setModelEditingField] = useState<'modelName' | 'contextWindow' | null>(null);
  const [modelEditTargetName, setModelEditTargetName] = useState<string | null>(null);

  // 记忆列表状态
  const [memoryList, setMemoryList] = useState<MemoryItem[]>([]);
  const [memoryFilter, setMemoryFilter] = useState<MemoryFilter>('all');
  const [memoryExpandedId, setMemoryExpandedId] = useState<number | null>(null);
  const [memoryPendingDeleteId, setMemoryPendingDeleteId] = useState<number | null>(null);

  // 扩展列表状态
  const [extensionList, setExtensionList] = useState<ExtensionItem[]>([]);
  const [extensionTogglingName, setExtensionTogglingName] = useState<string | null>(null);
  const [extensionStatusMessage, setExtensionStatusMessage] = useState<string | null>(null);
  const [extensionStatusIsError, setExtensionStatusIsError] = useState(false);
  const [extensionGitInputMode, setExtensionGitInputMode] = useState(false);
  /** scope-pick 子模式：在按 G 之后、进入 git-input 之前，让用户先选 global / agent */
  const [extensionScopePickMode, setExtensionScopePickMode] = useState(false);
  /** 选定后用于本次安装的 scope */
  const [extensionInstallScope, setExtensionInstallScope] = useState<'global' | 'agent'>('agent');
  const [extensionPendingDeleteName, setExtensionPendingDeleteName] = useState<string | null>(null);
  const [extensionPendingUpdateName, setExtensionPendingUpdateName] = useState<string | null>(null);
  const [extensionBusy, setExtensionBusy] = useState(false);

  // 待发送文件附件状态
  const [pendingFiles, setPendingFiles] = useState<import('./components/InputBar').PendingFile[]>([]);

  const [runtimePluginSettingsTabs, setRuntimePluginSettingsTabs] = useState(pluginSettingsTabs ?? []);
  const [runtimeSlashCommands, setRuntimeSlashCommands] = useState<Command[]>(() => getSlashCommands());
  useEffect(() => {
    setRuntimePluginSettingsTabs(pluginSettingsTabs ?? []);
  }, [pluginSettingsTabs]);
  useEffect(() => {
    const disposable = onSlashCommandsChanged(() => setRuntimeSlashCommands(getSlashCommands()));
    setRuntimeSlashCommands(getSlashCommands());
    return () => disposable.dispose();
  }, []);

  // 文件浏览器状态
  const [fileBrowserPath, setFileBrowserPath] = useState('');
  const [fileBrowserEntries, setFileBrowserEntries] = useState<import('./components/FileBrowserView').FileBrowserEntry[]>([]);

  const disabledExtensionNames = useMemo(() => new Set(
    extensionList
      .filter((item) => (item.originalStatus ?? item.status) === 'disabled')
      .map((item) => item.name),
  ), [extensionList]);

  const activePluginSettingsTabs = useMemo(
    () => runtimePluginSettingsTabs.filter((tab) => !disabledExtensionNames.has(tab.id)),
    [runtimePluginSettingsTabs, disabledExtensionNames],
  );

  const dynamicCommands = useMemo<Command[]>(() => {
    const pluginCommands = activePluginSettingsTabs.some((tab) => tab.id === 'virtual-lover')
      ? [{ name: '/lover', description: '打开 Virtual Lover 配置' }]
      : [];
    return [...pluginCommands, ...runtimeSlashCommands];
  }, [activePluginSettingsTabs, runtimeSlashCommands]);

  const canOpenLoverSettings = dynamicCommands.some((command) => command.name === '/lover');

  const refreshPluginSettingsTabs = useCallback(() => {
    setRuntimePluginSettingsTabs(onListPluginSettingsTabs?.() ?? pluginSettingsTabs ?? []);
  }, [onListPluginSettingsTabs, pluginSettingsTabs]);

  const [fileBrowserShowHidden, setFileBrowserShowHidden] = useState(false);

  // 队列编辑状态（复用 useTextInput 获得完整光标和编辑能力）
  const [queueEditingId, setQueueEditingId] = useState<string | null>(null);
  const [queueEditState, queueEditActions] = useTextInput('');
  const [modelEditState, modelEditActions] = useTextInput('');
  const [extensionGitInputState, extensionGitInputActions] = useTextInput('');

  const renderer = useRenderer();
  const undoRedoRef = useRef<UndoRedoStack>(createUndoRedoStack());

  // ── 聊天滚动区域 ref（供 F6 复制模式键盘滚动使用）──
  const chatScrollBoxRef = useRef<any>(null);

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

  // setPendingFilesRef: 供 AppHandle.setPendingFiles() 调用，更新待发送文件的 UI 状态
  const setPendingFilesRef = useRef<((files: import('./components/InputBar').PendingFile[]) => void) | null>(null);
  setPendingFilesRef.current = setPendingFiles;

  // openFileBrowserRef: 供 AppHandle.openFileBrowser() 调用
  const openFileBrowserRef = useRef<((path: string, entries: import('./components/FileBrowserView').FileBrowserEntry[]) => void) | null>(null);
  openFileBrowserRef.current = (path, entries) => {
    setFileBrowserPath(path);
    setFileBrowserEntries(entries);
    setSelectedIndex(0);
    setViewMode('file-browser');
  };

  // fileBrowserCallbackRef: 文件浏览器操作回调
  const fileBrowserCallbackRef = useRef<{
    select: (dirPath: string, entry: any, showHidden: boolean) => void;
    goUp: (dirPath: string, showHidden: boolean) => void;
    toggleHidden: (dirPath: string, showHidden: boolean) => void;
  } | null>(null);
  fileBrowserCallbackRef.current = {
    select: (dirPath, entry, showHidden) => onFileBrowserSelect?.(dirPath, entry, showHidden),
    goUp: (dirPath, showHidden) => onFileBrowserGoUp?.(dirPath, showHidden),
    toggleHidden: (dirPath, showHidden) => {
      setFileBrowserShowHidden(prev => !prev);
      onFileBrowserToggleHidden?.(dirPath, showHidden);
    },
  };

  const appState = useAppHandle({ onReady, undoRedoRef, drainCallbackRef, setPendingFilesRef, openFileBrowserRef, fileBrowserCallbackRef });
  const approval = useApproval(appState.pendingApprovals, appState.pendingApplies);
  const exitConfirm = useExitConfirm();
  const modelState = useModelState({ modelId, modelName, contextWindow, modelProvider, thinkingControlEnabled });

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

  const cycleThinkingEffort = useCallback((direction: 1 | -1) => {
    if (modelState.currentThinkingControlEnabled === false) return;
    const levels = getProviderThinkingLevels(modelState.currentModelProvider);
    setThinkingEffort(prev => {
      const idx = levels.indexOf(prev);
      // 如果当前 level 不在列表中（provider 切换后），从 'not-set' 开始
      const safeIdx = idx >= 0 ? idx : 0;
      const next = safeIdx + direction;
      if (next < 0 || next >= levels.length) return prev;
      const newLevel = levels[next];
      onThinkingEffortChange?.(newLevel);
      return newLevel;
    });
  }, [onThinkingEffortChange, modelState.currentModelProvider, modelState.currentThinkingControlEnabled]);

  // provider 变化时，如果当前 level 不在新 provider 支持的列表中，clamp 到新 provider 最大级别
  useEffect(() => {
    if (modelState.currentThinkingControlEnabled === false) return;
    const levels = getProviderThinkingLevels(modelState.currentModelProvider);
    setThinkingEffort(prev => {
      if (levels.includes(prev)) return prev;
      // clamp 到新 provider 的最大级别
      const maxLevel = levels[levels.length - 1];
      onThinkingEffortChange?.(maxLevel);
      return maxLevel;
    });
  }, [modelState.currentModelProvider, modelState.currentThinkingControlEnabled]);

  // 启动时将初始级别（最大值）apply 到后端
  useEffect(() => {
    if (thinkingControlEnabled !== false && initialMaxLevel !== 'not-set') {
      onThinkingEffortChange?.(initialMaxLevel);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅启动时执行一次
  }, []);

  const handleFileAttach = useCallback((filePath: string) => {
    onFileAttach?.(filePath);
  }, [onFileAttach]);

  const handleRemoveFile = useCallback((index: number) => {
    onRemoveFileProp?.(index);
  }, [onRemoveFileProp]);

  const handleOpenFileBrowser = useCallback(() => {
    onFileAttach?.('__open_browser__');
  }, [onFileAttach]);

  const handleSubmit = useCommandDispatch({
    onSubmit: queueAwareSubmit,
    onFileAttach: handleFileAttach,
    onOpenFileBrowser: handleOpenFileBrowser,
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
    onEnterHeadless: supportsHeadlessTransition ? onEnterHeadless : undefined,
    onListAgents,
    setAgentList,
    onDream,
    onListMemories,
    setMemoryList,
    setMemoryFilter,
    setMemoryExpandedId,
    setMemoryPendingDeleteId,
    onListExtensions,
    setExtensionList,
    canOpenLoverSettings,
    onRemoteConnect,
    onRemoteDisconnect,
    isRemote: !!remoteHost,
    remoteHost,
    onSummarize,
    onPlanCommand,
    undoRedoRef,
    setMessages: appState.setMessages,
    commitTools: appState.commitTools,
    setViewMode,
    setSessionList,
    setModelList,
    setDefaultModelName,
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

  useEffect(() => {
    if (viewMode === 'model-list') return;
    setModelStatusMessage(null);
    setModelStatusIsError(false);
    setModelEditingField(null);
    setModelEditTargetName(null);
    modelEditActions.setValue('');
  }, [viewMode]);

  useEffect(() => {
    if (viewMode === 'session-list') return;
    setSessionPendingDeleteId(null);
    setSessionStatusMessage(null);
    setSessionStatusIsError(false);
  }, [viewMode]);

  // 工具详情数据变化时自动切换视图
  useEffect(() => {
    if (appState.toolDetailData && viewMode !== 'tool-detail') {
      setViewMode('tool-detail');
    } else if (!appState.toolDetailData && viewMode === 'tool-detail') {
      setViewMode('chat');
    }
  }, [appState.toolDetailData, viewMode]);

  // 工具列表数据变化时自动切换视图
  useEffect(() => {
    if (appState.toolListItems.length > 0 && viewMode !== 'tool-list' && viewMode !== 'tool-detail') {
      setSelectedIndex(0);
      setViewMode('tool-list');
    }
  }, [appState.toolListItems]);

  const askQuestionInvocation = appState.toolInvocations.find((tool) => (
    tool.toolName === 'AskQuestionFirst'
    && tool.status === 'executing'
    && (tool.progress as Record<string, unknown> | undefined)?.kind === 'ask_question_first'
  ));

  useAppKeyboard({
    viewMode,
    setViewMode,
    setCopyMode,
    copyMode,
    chatScrollBoxRef,
    pendingConfirm,
    confirmChoice,
    setPendingConfirm,
    setConfirmChoice,
    exitConfirm,
    isGenerating: appState.isGenerating,
    askQuestionActive: !!askQuestionInvocation,
    pendingApplies: appState.pendingApplies,
    pendingApprovals: appState.pendingApprovals,
    onOpenToolDetail,
    approval,
    onExit,
    onAbort,
    onToolApply,
    onToolApproval,
    onAddCommandPattern,
    onPlanCommand,
    sessionList,
    modelList,
    setModelList,
    defaultModelName,
    setDefaultModelName,
    selectedIndex,
    setSelectedIndex,
    undoRedoRef,
    onClearRedoStack,
    setMessages: appState.setMessages,
    commitTools: appState.commitTools,
    onLoadSession,
    onDeleteSession,
    onListModels,
    onSwitchModel,
    onSetDefaultModel,
    onUpdateModelEntry,
    modelState,
    modelStatusMessage,
    setModelStatusMessage,
    setModelStatusIsError,
    modelEditingField,
    setModelEditingField,
    modelEditTargetName,
    setModelEditTargetName,
    modelEditState,
    modelEditActions,
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
    onToggleThoughts: () => setThoughtsToggleSignal((prev) => prev + 1),
    toolListItems: appState.toolListItems,
    setSessionList,
    sessionPendingDeleteId,
    setSessionPendingDeleteId,
    setSessionStatusMessage,
    setSessionStatusIsError,
    agentList,
    onSelectAgent,
    memoryList,
    memoryFilter,
    setMemoryFilter,
    memoryExpandedId,
    setMemoryExpandedId,
    memoryPendingDeleteId,
    setMemoryPendingDeleteId,
    setMemoryList,
    onDeleteMemory,
    extensionList,
    setExtensionList,
    onToggleExtension,
    onInstallGitExtension,
    onDeleteExtension,
    onPreviewUpdateExtension,
    onUpdateExtension,
    onListExtensions,
    onRefreshPluginSettingsTabs: refreshPluginSettingsTabs,
    setExtensionTogglingName,
    setExtensionStatusMessage,
    setExtensionStatusIsError,
    extensionGitInputMode,
    setExtensionGitInputMode,
    extensionScopePickMode,
    setExtensionScopePickMode,
    extensionInstallScope,
    setExtensionInstallScope,
    extensionGitInputState,
    extensionGitInputActions,
    extensionPendingDeleteName,
    setExtensionPendingDeleteName,
    extensionPendingUpdateName,
    setExtensionPendingUpdateName,
    extensionBusy,
    setExtensionBusy,
    fileBrowserPath,
    fileBrowserEntries,
    fileBrowserShowHidden,
    setFileBrowserShowHidden,
    onFileBrowserSelect,
    onFileBrowserGoUp,
    onFileBrowserToggleHidden,
  });

  const currentApply = appState.isGenerating ? appState.pendingApplies[0] : undefined;
  const hasMessages = appState.messages.length > 0 || appState.isGenerating;
  const activeMilestone = appState.milestoneSnapshot?.items.find((item) => item.status === 'in_progress');
  const milestoneGeneratingLabel = activeMilestone ? `${activeMilestone.activeForm ?? activeMilestone.title}...` : undefined;
  const effectiveGeneratingLabel = appState.generatingLabel ?? milestoneGeneratingLabel;

  if (viewMode === 'settings') {
    return (
      <SettingsView
        initialSection={settingsInitialSection}
        onBack={() => setViewMode('chat')}
        onLoad={onLoadSettings}
        onSave={onSaveSettings}
        pluginTabs={activePluginSettingsTabs}
      />
    );
  }

  if (viewMode === 'session-list') {
    return (
      <SessionListView
        sessions={sessionList}
        selectedIndex={selectedIndex}
        pendingDeleteId={sessionPendingDeleteId}
        statusMessage={sessionStatusMessage}
        statusIsError={sessionStatusIsError}
      />
    );
  }

  if (viewMode === 'model-list') {
    return <ModelListView
      models={modelList}
      selectedIndex={selectedIndex}
      defaultModelName={defaultModelName}
      statusMessage={modelStatusMessage}
      statusIsError={modelStatusIsError}
      editingField={modelEditingField}
      editingValue={modelEditState.value}
      editingCursor={modelEditState.cursor}
    />;
  }

  if (viewMode === 'agent-list') {
    return <AgentListView agents={agentList} selectedIndex={selectedIndex} currentAgentName={agentName} />;
  }

  if (viewMode === 'memory-list') {
    return (
      <MemoryListView
        memories={memoryList}
        selectedIndex={selectedIndex}
        expandedId={memoryExpandedId}
        filter={memoryFilter}
        pendingDeleteId={memoryPendingDeleteId}
      />
    );
  }

  if (viewMode === 'extension-list') {
    return (
      <ExtensionListView
        extensions={extensionList}
        selectedIndex={selectedIndex}
        togglingName={extensionTogglingName}
        statusMessage={extensionStatusMessage}
        statusIsError={extensionStatusIsError}
        busy={extensionBusy}
        gitInputMode={extensionGitInputMode}
        gitInputValue={extensionGitInputState.value}
        gitInputCursor={extensionGitInputState.cursor}
        gitInputCursorVisible={true}
        scopePickMode={extensionScopePickMode}
        installScope={extensionInstallScope}
        pendingDeleteName={extensionPendingDeleteName}
        pendingUpdateName={extensionPendingUpdateName}
      />
    );
  }

  if (viewMode === 'file-browser') {
    return (
      <FileBrowserView
        currentPath={fileBrowserPath}
        entries={fileBrowserEntries}
        selectedIndex={selectedIndex}
        showHidden={fileBrowserShowHidden}
      />
    );
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

  // 工具列表视图
  if (viewMode === 'tool-list') {
    return <ToolListView tools={appState.toolListItems} selectedIndex={selectedIndex} />;
  }

  // 工具详情视图
  if (viewMode === 'tool-detail' && appState.toolDetailData) {
    return (
      <box flexDirection="column" width="100%" height="100%">
        <ToolDetailView
          data={appState.toolDetailData}
          breadcrumb={appState.toolDetailStack}
          onNavigateChild={onNavigateToolDetail}
          onClose={onCloseToolDetail}
          onAbort={onToolAbort}
        />
      </box>
    );
  }

  return (
    <box flexDirection="column" width="100%" height="100%">
      {!hasMessages ? <LogoScreen /> : null}
      {!hasMessages && initWarnings && initWarnings.length > 0 ? <InitWarnings warnings={initWarnings} color={initWarningsColor} icon={initWarningsIcon} /> : null}

      {hasMessages ? (
        <ChatMessageList
          messages={appState.messages}
          streamingParts={appState.streamingParts}
          isStreaming={appState.isStreaming}
          isGenerating={appState.isGenerating}
          retryInfo={appState.retryInfo}
          modelName={modelState.currentModelName}
          generatingLabel={effectiveGeneratingLabel}
          timerPaused={appState.pendingApprovals.length > 0 || appState.pendingApplies.length > 0 || !!askQuestionInvocation}
          thoughtsToggleSignal={thoughtsToggleSignal}
          hasActiveTools={appState.toolInvocations.some(t => t.status === 'executing' || t.status === 'queued')}
          scrollBoxRef={chatScrollBoxRef}
          milestoneSnapshot={appState.milestoneSnapshot}
        />
      ) : null}

      <BottomPanel
        hasMessages={hasMessages}
        pendingConfirm={pendingConfirm}
        confirmChoice={confirmChoice}
        askQuestionInvocation={askQuestionInvocation}
        askQuestionKey={askQuestionInvocation?.id}
        pendingApprovals={appState.pendingApprovals}
        approvalChoice={approval.approvalChoice}
        approvalPage={approval.approvalPage}
        isGenerating={appState.isGenerating}
        queueSize={messageQueue.size}
        onSubmit={handleSubmit}
        onPrioritySubmit={handlePrioritySubmit}
        onToolMessage={onToolMessage}
        agentName={agentName}
        modeName={modeName}
        modelName={modelState.currentModelName}
        contextTokens={appState.contextTokens}
        contextWindow={modelState.currentContextWindow}
        copyMode={copyMode}
        exitConfirmArmed={exitConfirm.exitConfirmArmed}
        backgroundTaskCount={appState.backgroundTaskCount}
        planModeActive={appState.planModeActive}
        delegateTaskCount={appState.delegateTaskCount}
        backgroundTaskTokens={appState.backgroundTaskTokens}
        backgroundTaskSpinnerFrame={appState.backgroundTaskSpinnerFrame}
        thinkingEffort={thinkingEffort}
        onCycleThinkingEffort={cycleThinkingEffort}
        thinkingControlEnabled={modelState.currentThinkingControlEnabled}
        providerLevels={getProviderThinkingLevels(modelState.currentModelProvider)}
        remoteHost={remoteHost}
        isRemote={!!remoteHost}
        pendingFiles={pendingFiles}
        onRemoveFile={handleRemoveFile}
        dynamicCommands={dynamicCommands}
        supportsHeadlessTransition={supportsHeadlessTransition}
      />
    </box>
  );
}
