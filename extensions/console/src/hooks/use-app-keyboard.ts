import { useKeyboard } from '@opentui/react';
import { usePaste } from './use-paste';
import type { AgentDefinitionLike } from 'irises-extension-sdk';
import type { IrisModelInfoLike as LLMModelInfo, IrisSessionMetaLike as SessionMeta, ToolInvocation } from 'irises-extension-sdk';
import type { TextInputState, TextInputActions } from './use-text-input';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { ApprovalChoice, ConfirmChoice, PendingConfirm, RewindCheckpointLike, RewindOperationResultLike, RewindTargetMode, SwitchModelResult, ViewMode } from '../app-types';
import type { ChatMessage } from '../components/MessageItem';
import { clearRedo, type UndoRedoStack } from '../undo-redo';
import type { UseModelStateReturn } from './use-model-state';
import { appendCommandMessage } from '../message-utils';
import type { QueuedMessage } from './use-message-queue';
import { filterMemories, nextFilter, type MemoryItem, type MemoryFilter } from '../components/MemoryListView';
import { normalizePastedSingleLine, readClipboardText } from '../terminal-compat';
import type { ProgressSnapshotLike } from '../progress-types';
import type { PromptInputController } from '../components/InputBar';

type SetState<T> = Dispatch<SetStateAction<T>>;

const PROGRESS_PANEL_MAX_ITEMS = 8;

interface ApprovalController {
  approvalChoice: ApprovalChoice;
  approvalPage: 'basic' | 'policy';
  setPreviewIndex: SetState<number>;
  resetChoice: () => void;
  toggleChoice: () => void;
  toggleApprovalPage: () => void;
  toggleDiffView: () => void;
  toggleLineNumbers: () => void;
  toggleWrapMode: () => void;
}

interface ExitConfirmController {
  exitConfirmArmed: boolean;
  clearExitConfirm: () => void;
  armExitConfirm: () => void;
}

interface UseAppKeyboardOptions {
  viewMode: ViewMode;
  setViewMode: SetState<ViewMode>;
  setCopyMode: SetState<boolean>;
  /** 当前是否处于 F6 复制模式 */
  copyMode: boolean;
  /** 聊天消息 scrollbox 的 ref，用于复制模式下的键盘滚动 */
  chatScrollBoxRef: MutableRefObject<any>;
  /** 底部正文输入框控制器；用于输入框有内容时 Ctrl+C 只清空输入 */
  promptInputControllerRef?: MutableRefObject<PromptInputController | null>;
  pendingConfirm: PendingConfirm | null;
  confirmChoice: ConfirmChoice;
  setPendingConfirm: SetState<PendingConfirm | null>;
  setConfirmChoice: SetState<ConfirmChoice>;
  exitConfirm: ExitConfirmController;
  isGenerating: boolean;
  /** 当前会话是否有后台任务仍在运行（异步 sub_agent / delegate） */
  hasRunningBackgroundTasks?: boolean;
  /** AskQuestionFirst 交互面板是否正在接管键盘 */
  askQuestionActive?: boolean;
  pendingApplies: ToolInvocation[];
  pendingApprovals: ToolInvocation[];
  /** 打开工具详情 */
  onOpenToolDetail: (toolId: string) => void;
  approval: ApprovalController;
  onExit: () => void;
  onAbort: () => void;
  onToolApply: (toolId: string, applied: boolean) => void;
  onToolApproval: (toolId: string, approved: boolean) => void;
  onAddCommandPattern?: (toolName: string, command: string, type: 'allow' | 'deny') => void;
  onPlanCommand?: (arg: string) => Promise<{ ok: boolean; message: string; followupPrompt?: string }>;
  onAutoEditCommand?: (arg: string) => Promise<{ ok: boolean; message: string }>;
  sessionList: SessionMeta[];
  modelList: LLMModelInfo[];
  defaultModelName: string;
  setModelList: SetState<LLMModelInfo[]>;
  setDefaultModelName: SetState<string>;
  selectedIndex: number;
  setSelectedIndex: SetState<number>;
  undoRedoRef: MutableRefObject<UndoRedoStack>;
  onClearRedoStack: () => void;
  setMessages: SetState<ChatMessage[]>;
  commitTools: () => void;
  onLoadSession: (id: string) => Promise<void>;
  onDeleteSession?: (id: string) => Promise<{ ok: boolean; message: string; deletedCurrent?: boolean }>;
  setSessionList: SetState<SessionMeta[]>;
  rewindCheckpoints: RewindCheckpointLike[];
  rewindConfirmId: string | null;
  setRewindConfirmId: SetState<string | null>;
  setRewindStatusMessage: SetState<string | null>;
  setRewindStatusIsError: SetState<boolean>;
  rewindInProgress: boolean;
  setRewindInProgress: SetState<boolean>;
  rewindMode: RewindTargetMode;
  setRewindMode: SetState<RewindTargetMode>;
  onRewind: (checkpointId: string, mode?: RewindTargetMode) => Promise<RewindOperationResultLike | null>;
  setPendingInputRestore: SetState<string | null>;
  setRewindCheckpoints: SetState<RewindCheckpointLike[]>;
  sessionPendingDeleteId: string | null;
  setSessionPendingDeleteId: SetState<string | null>;
  setSessionStatusMessage: SetState<string | null>;
  setSessionStatusIsError: SetState<boolean>;
  onListModels: () => { models: LLMModelInfo[]; defaultModelName: string };
  onSwitchModel: (modelName: string) => SwitchModelResult;
  onSetDefaultModel?: (modelName: string) => Promise<{ ok: boolean; message: string }>;
  onUpdateModelEntry?: (
    currentModelName: string,
    updates: { modelName?: string; contextWindow?: number | null },
  ) => Promise<{ ok: boolean; message: string; updatedModelName?: string }>;
  modelState: Pick<UseModelStateReturn, 'updateModel'>;
  modelStatusMessage: string | null;
  setModelStatusMessage: SetState<string | null>;
  setModelStatusIsError: SetState<boolean>;
  modelEditingField: 'modelName' | 'contextWindow' | null;
  setModelEditingField: SetState<'modelName' | 'contextWindow' | null>;
  modelEditTargetName: string | null;
  setModelEditTargetName: SetState<string | null>;
  modelEditState: TextInputState;
  modelEditActions: TextInputActions;
  // 队列管理
  queue: QueuedMessage[];
  queueRemove: (id: string) => boolean;
  queueMoveUp: (id: string) => boolean;
  queueMoveDown: (id: string) => boolean;
  queueEdit: (id: string, newText: string) => boolean;
  queueClear: () => void;
  queueEditingId: string | null;
  setQueueEditingId: SetState<string | null>;
  queueEditState: TextInputState;
  queueEditActions: TextInputActions;
  onToggleThoughts: () => void;
  toolListItems: ToolInvocation[];
  /** 当前会话 progress/task 清单快照，用于底部 Iris 进度快捷键 */
  progressSnapshot?: ProgressSnapshotLike | null;
  /** 底部 Iris 进度折叠/滚动控制 */
  setProgressCollapsed: SetState<boolean>;
  setProgressScrollOffset: SetState<number>;
  /** agent-list 视图用 */
  agentList: AgentDefinitionLike[];
  onSelectAgent?: (agentName: string) => void;
  /** memory-list 视图用 */
  memoryList: MemoryItem[];
  memoryFilter: MemoryFilter;
  setMemoryFilter: SetState<MemoryFilter>;
  memoryExpandedId: number | null;
  setMemoryExpandedId: SetState<number | null>;
  memoryPendingDeleteId: number | null;
  setMemoryPendingDeleteId: SetState<number | null>;
  setMemoryList: SetState<MemoryItem[]>;
  onDeleteMemory?: (id: number) => Promise<boolean>;
  /** extension-list 视图用 */
  extensionList: any[];
  setExtensionList: SetState<any[]>;
  onToggleExtension?: (name: string, enabled?: boolean) => Promise<{ ok: boolean; message: string }>;
  onInstallGitExtension?: (target: string, scope?: 'global' | 'agent') => Promise<{ ok: boolean; message: string }>;
  onDeleteExtension?: (name: string) => Promise<{ ok: boolean; message: string }>;
  onPreviewUpdateExtension?: (name: string) => Promise<{ ok: boolean; message: string }>;
  onUpdateExtension?: (name: string) => Promise<{ ok: boolean; message: string }>;
  onListExtensions?: () => Promise<any[]>;
  onRefreshPluginSettingsTabs?: () => Promise<void> | void;
  setExtensionTogglingName: SetState<string | null>;
  setExtensionStatusMessage: SetState<string | null>;
  setExtensionStatusIsError: SetState<boolean>;
  extensionGitInputMode: boolean;
  setExtensionGitInputMode: SetState<boolean>;
  extensionGitInputState: TextInputState;
  extensionGitInputActions: TextInputActions;
  extensionScopePickMode: boolean;
  setExtensionScopePickMode: SetState<boolean>;
  extensionInstallScope: 'global' | 'agent';
  setExtensionInstallScope: SetState<'global' | 'agent'>;
  extensionPendingDeleteName: string | null;
  setExtensionPendingDeleteName: SetState<string | null>;
  extensionPendingUpdateName: string | null;
  setExtensionPendingUpdateName: SetState<string | null>;
  extensionBusy: boolean;
  setExtensionBusy: SetState<boolean>;
  /** file-browser 视图用 */
  fileBrowserPath: string;
  fileBrowserEntries: import('../components/FileBrowserView').FileBrowserEntry[];
  fileBrowserShowHidden: boolean;
  setFileBrowserShowHidden: SetState<boolean>;
  onFileBrowserSelect?: (dirPath: string, entry: any, showHidden: boolean) => void;
  onFileBrowserGoUp?: (dirPath: string, showHidden: boolean) => void;
  onFileBrowserToggleHidden?: (dirPath: string, showHidden: boolean) => void;
}

function closeConfirm(
  setPendingConfirm: SetState<PendingConfirm | null>,
  setConfirmChoice: SetState<ConfirmChoice>,
): void {
  setPendingConfirm(null);
  setConfirmChoice('confirm');
}

function isPlanModeToggleShortcut(key: any): boolean {
  return (key.shift && key.name === 'tab')
    || key.name === 'backtab'
    || key.name === 'shift-tab'
    || key.sequence === '\x1b[Z';
}

function hasAltModifier(key: any): boolean {
  return key.alt === true || key.meta === true;
}

function isAltLetterShortcut(key: any, letter: string): boolean {
  return (hasAltModifier(key) && key.name === letter)
    || key.sequence === `\x1b${letter}`
    || key.sequence === `\x1b${letter.toUpperCase()}`;
}

function altScrollKeyName(key: any): 'up' | 'down' | 'pageup' | 'pagedown' | undefined {
  if (hasAltModifier(key) && (
    key.name === 'up' || key.name === 'down' || key.name === 'pageup' || key.name === 'pagedown'
  )) {
    return key.name;
  }
  switch (key.sequence) {
    case '\x1b[1;3A':
    case '\x1b[1;9A':
      return 'up';
    case '\x1b[1;3B':
    case '\x1b[1;9B':
      return 'down';
    case '\x1b[5;3~':
      return 'pageup';
    case '\x1b[6;3~':
      return 'pagedown';
    default:
      return undefined;
  }
}

function getAvailableRewindModes(checkpoint: RewindCheckpointLike | undefined): RewindTargetMode[] {
  if (!checkpoint?.canRestoreCode) return ['conversation'];
  return ['conversation', 'code', 'both'];
}

function cycleRewindMode(current: RewindTargetMode, checkpoint: RewindCheckpointLike | undefined, direction: 1 | -1): RewindTargetMode {
  const modes = getAvailableRewindModes(checkpoint);
  const index = Math.max(0, modes.indexOf(current));
  return modes[(index + direction + modes.length) % modes.length];
}

export function useAppKeyboard({
  viewMode,
  setViewMode,
  setCopyMode,
  copyMode,
  chatScrollBoxRef,
  promptInputControllerRef,
  pendingConfirm,
  confirmChoice,
  setPendingConfirm,
  setConfirmChoice,
  exitConfirm,
  isGenerating,
  askQuestionActive,
  pendingApplies,
  pendingApprovals,
  onOpenToolDetail,
  approval,
  onExit,
  onAbort,
  hasRunningBackgroundTasks = false,
  onToolApply,
  onToolApproval,
  onAddCommandPattern,
  onPlanCommand,
  onAutoEditCommand,
  sessionList,
  modelList,
  defaultModelName,
  setModelList,
  setDefaultModelName,
  selectedIndex,
  setSelectedIndex,
  undoRedoRef,
  onClearRedoStack,
  setMessages,
  commitTools,
  onLoadSession,
  onDeleteSession,
  setSessionList,
  rewindCheckpoints,
  rewindConfirmId,
  setRewindConfirmId,
  setRewindStatusMessage,
  setRewindStatusIsError,
  rewindInProgress,
  setRewindInProgress,
  rewindMode,
  setRewindMode,
  onRewind,
  setPendingInputRestore,
  setRewindCheckpoints,
  sessionPendingDeleteId,
  setSessionPendingDeleteId,
  setSessionStatusMessage,
  setSessionStatusIsError,
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
  queue,
  queueRemove,
  queueMoveUp,
  queueMoveDown,
  queueEdit,
  queueClear,
  queueEditingId,
  setQueueEditingId,
  queueEditState,
  queueEditActions,
  onToggleThoughts,
  toolListItems,
  progressSnapshot,
  setProgressCollapsed,
  setProgressScrollOffset,
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
  onRefreshPluginSettingsTabs,
  setExtensionTogglingName,
  setExtensionStatusMessage,
  setExtensionStatusIsError,
  extensionGitInputMode,
  setExtensionGitInputMode,
  extensionGitInputState,
  extensionGitInputActions,
  extensionScopePickMode,
  setExtensionScopePickMode,
  extensionInstallScope,
  setExtensionInstallScope,
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
}: UseAppKeyboardOptions) {
  const setModelStatus = (message: string | null, isError = false) => {
    setModelStatusMessage(message);
    setModelStatusIsError(isError);
  };

  const resetModelEditing = () => {
    setModelEditingField(null);
    setModelEditTargetName(null);
    modelEditActions.setValue('');
  };

  const syncModelPanel = (preferredModelName?: string) => {
    const { models, defaultModelName: nextDefaultModelName } = onListModels();
    setModelList(models);
    setDefaultModelName(nextDefaultModelName);

    const preferredIndex = preferredModelName
      ? models.findIndex((model) => model.modelName === preferredModelName)
      : -1;
    const currentIndex = models.findIndex((model) => model.current);
    const nextIndex = preferredIndex >= 0 ? preferredIndex : (currentIndex >= 0 ? currentIndex : 0);


    setSelectedIndex(Math.max(0, nextIndex));

    const currentModel = currentIndex >= 0 ? models[currentIndex] : undefined;
    if (currentModel) {
      modelState.updateModel({
        ok: true,
        message: '',
        modelName: currentModel.modelName,
        modelId: currentModel.modelId,
        contextWindow: currentModel.contextWindow,
      });
    }

    return { models, defaultModelName: nextDefaultModelName };
  };


  usePaste((text) => {
    if (viewMode !== 'extension-list' || !extensionGitInputMode || extensionBusy) return;
    const normalized = normalizePastedSingleLine(text);
    if (!normalized) return;
    extensionGitInputActions.insert(normalized);
  });

  useKeyboard((key) => {
    if (key.ctrl && key.name === 'c') {
      if (viewMode === 'chat'
        && !pendingConfirm
        && !askQuestionActive
        && pendingApprovals.length === 0
        && pendingApplies.length === 0
        && promptInputControllerRef?.current?.hasValue()) {
        promptInputControllerRef.current.clear();
        exitConfirm.clearExitConfirm();
        key.preventDefault?.();
        key.stopPropagation?.();
        return;
      }
      if (exitConfirm.exitConfirmArmed) {
        exitConfirm.clearExitConfirm();
        onExit();
      } else {
        exitConfirm.armExitConfirm();
      }
      return;
    }

    if (key.name === 'f6') {
      setCopyMode((prev) => !prev);
      return;
    }

    if (key.ctrl && key.name === 'o') {
      onToggleThoughts();
      return;
    }

    // Alt+M：折叠/展开底部 Iris 进度；Alt+↑/↓：专门滚动 progress 列表。
    // 仅在聊天主视图且没有审批/确认/问答面板接管键盘时生效，避免干扰其它视图的方向键语义。
    const progressItemCount = progressSnapshot?.items.length ?? 0;
    const progressOpenCount = progressSnapshot?.stats.open ?? 0;
    const canControlProgress = viewMode === 'chat'
      && progressItemCount > 0
      && progressOpenCount > 0
      && !pendingConfirm
      && !askQuestionActive
      && pendingApprovals.length === 0
      && pendingApplies.length === 0;

    if (canControlProgress && isAltLetterShortcut(key, 'm')) {
      key.preventDefault?.();
      setProgressCollapsed((prev) => !prev);
      return;
    }

    const progressScrollKey = canControlProgress ? altScrollKeyName(key) : undefined;
    if (progressScrollKey) {
      key.preventDefault?.();
      const maxOffset = Math.max(0, progressItemCount - PROGRESS_PANEL_MAX_ITEMS);
      if (maxOffset > 0) {
        const pageStep = Math.max(1, Math.floor(PROGRESS_PANEL_MAX_ITEMS / 2));
        const delta = progressScrollKey === 'up' ? -1
          : progressScrollKey === 'down' ? 1
            : progressScrollKey === 'pageup' ? -pageStep
              : pageStep;
        setProgressCollapsed(false);
        setProgressScrollOffset((prev) => Math.min(maxOffset, Math.max(0, prev + delta)));
      }
      return;
    }

    // Shift+Tab：切换当前 Agent/session 的 Plan Mode。
    // 生成/流式输出期间也允许切换；只避开审批、确认与工具应用等需要接管键盘的状态。
    // 工具执行列表/详情页也允许切换，避免工具调用中无法进出 Plan Mode。
    if (
      isPlanModeToggleShortcut(key)
      && (viewMode === 'chat' || viewMode === 'tool-list' || viewMode === 'tool-detail')
      && pendingApprovals.length === 0
      && pendingApplies.length === 0
      && !pendingConfirm
    ) {
      key.preventDefault?.();
      void onPlanCommand?.('').then((result) => {
        appendCommandMessage(setMessages, result.message, result.ok ? { label: 'plan', beforeActiveAssistant: isGenerating } : { label: 'plan', isError: true, beforeActiveAssistant: isGenerating });
      }).catch((err) => appendCommandMessage(setMessages, `Plan Mode 操作失败: ${err instanceof Error ? err.message : String(err)}`, { label: 'plan', isError: true, beforeActiveAssistant: isGenerating }));
      return;
    }

    // Ctrl+T：打开工具执行详情（由 index.ts 从 _activeHandles 中选择目标）
    if (key.name === 't' && key.ctrl) {
      onOpenToolDetail('');
      return;
    }

    if (viewMode === 'settings') return;

    // tool-detail 视图由 ToolDetailView 组件自身处理键盘（useKeyboard），此处不拦截
    if (viewMode === 'tool-detail') return;

    // ── rewind-selector 视图 ──
    if (viewMode === 'rewind-selector') {
      const maxIndex = Math.max(0, rewindCheckpoints.length - 1);
      const selected = rewindCheckpoints[Math.max(0, Math.min(selectedIndex, maxIndex))];

      if (rewindInProgress) {
        // 防止用户快速连按 Enter 触发多次 rewind。等待当前回溯完成。
        return;
      }

      if (key.name === 'escape') {
        if (rewindConfirmId) {
          setRewindConfirmId(null);
          setRewindStatusMessage(null);
          setRewindStatusIsError(false);
        } else {
          setViewMode('chat');
        }
        return;
      }

      if (key.name === 'up') {
        if (rewindConfirmId) {
          setRewindMode((current) => cycleRewindMode(current, selected, -1));
          return;
        }
        setSelectedIndex((prev) => Math.max(0, prev - 1));
        setRewindConfirmId(null);
        setRewindMode('conversation');
        setRewindStatusMessage(null);
        setRewindStatusIsError(false);
        return;
      }
      if (key.name === 'down') {
        if (rewindConfirmId) {
          setRewindMode((current) => cycleRewindMode(current, selected, 1));
          return;
        }
        setSelectedIndex((prev) => Math.min(maxIndex, prev + 1));
        setRewindConfirmId(null);
        setRewindMode('conversation');
        setRewindStatusMessage(null);
        setRewindStatusIsError(false);
        return;
      }

      if ((key.name === 'enter' || key.name === 'return') && selected) {
        if (rewindConfirmId !== selected.id) {
          setRewindConfirmId(selected.id);
          setRewindMode('conversation');
          setRewindStatusMessage(null);
          setRewindStatusIsError(false);
          return;
        }

        setRewindStatusMessage('正在回溯历史...');
        setRewindStatusIsError(false);
        setRewindInProgress(true);
        void (async () => {
          try {
            const requestedMode = getAvailableRewindModes(selected).includes(rewindMode) ? rewindMode : 'conversation';
            const result = await onRewind(selected.id, requestedMode);
            if (!result) {
              setRewindStatusMessage('回溯失败：目标已失效，或当前会话正在生成。');
              setRewindStatusIsError(true);
              setRewindInProgress(false);
              setRewindConfirmId(null);
              return;
            }

            if (result.mode !== 'code') {
              clearRedo(undoRedoRef.current);
              onClearRedoStack();
            }
            setRewindConfirmId(null);
            let reloadError: unknown;
            if (result.mode === 'conversation' || result.mode === 'both') {
              setMessages([]);
              commitTools();
              setPendingInputRestore(result.restoredInputText);
              setRewindStatusMessage('正在重放历史...');
              try {
                await onLoadSession(result.checkpoint.sessionId);
              } catch (err) {
                reloadError = err;
              }
            }
            setRewindCheckpoints([]);
            setRewindInProgress(false);
            setRewindStatusMessage(null);
            setRewindStatusIsError(false);
            setViewMode('chat');
            if (reloadError) {
              appendCommandMessage(
                setMessages,
                `回溯已完成，但重放历史失败：${reloadError instanceof Error ? reloadError.message : String(reloadError)}`,
                { label: 'rewind', isError: true },
              );
            } else {
              const modeLabel = result.mode === 'code'
                ? '仅代码'
                : result.mode === 'both'
                  ? '对话 + 代码'
                  : '仅对话';
              const historyText = result.removedCount > 0
                ? `，移除了 ${result.removedCount} 条历史并恢复输入`
                : '';
              const filesText = result.filesRestored
                ? `，恢复了 ${result.filesRestored.length} 个文件`
                : '';
              appendCommandMessage(setMessages, `已完成 ${modeLabel} 回溯${historyText}${filesText}。`, { label: 'rewind' });
            }
          } catch (err) {
            setRewindStatusMessage(`回溯失败：${err instanceof Error ? err.message : String(err)}`);
            setRewindStatusIsError(true);
            setRewindInProgress(false);
            setRewindConfirmId(null);
          }
        })();
        return;
      }
      return;
    }

    // ── tool-list 视图 ──
    if (viewMode === 'tool-list') {
      if (key.name === 'escape') {
        setViewMode('chat');
      } else if (key.name === 'up') setSelectedIndex((prev) => Math.max(0, prev - 1));
      else if (key.name === 'down') setSelectedIndex((prev) => Math.min(toolListItems.length - 1, prev + 1));
      else if (key.name === 'return') {
        const selected = toolListItems[selectedIndex];
        if (selected) {
          onOpenToolDetail(selected.id);
        }
      }
      return;
    }

    // ── memory-list 视图 ──
    if (viewMode === 'memory-list') {
      const filtered = filterMemories(memoryList, memoryFilter);
      if (key.name === 'escape') {
        if (memoryPendingDeleteId !== null) {
          setMemoryPendingDeleteId(null);
        } else {
          setViewMode('chat');
        }
      } else if (key.name === 'up') {
        setSelectedIndex((prev) => Math.max(0, prev - 1));
        setMemoryPendingDeleteId(null);
      } else if (key.name === 'down') {
        setSelectedIndex((prev) => Math.min(filtered.length - 1, prev + 1));
        setMemoryPendingDeleteId(null);
      } else if (key.name === 'return') {
        const item = filtered[selectedIndex];
        if (item) setMemoryExpandedId(memoryExpandedId === item.id ? null : item.id);
      } else if (key.name === 'tab') {
        const next = nextFilter(memoryFilter);
        setMemoryFilter(next);
        setSelectedIndex(0);
        setMemoryExpandedId(null);
        setMemoryPendingDeleteId(null);
      } else if (key.name === 'd') {
        const item = filtered[selectedIndex];
        if (!item) return;
        if (memoryPendingDeleteId === item.id) {
          // confirm delete
          void onDeleteMemory?.(item.id).then((ok) => {
            if (ok) {
              setMemoryList((prev) => prev.filter((m) => m.id !== item.id));
              setMemoryPendingDeleteId(null);
              setMemoryExpandedId(null);
              // adjust index if needed
              const newFiltered = filterMemories(memoryList.filter((m) => m.id !== item.id), memoryFilter);
              if (selectedIndex >= newFiltered.length) {
                setSelectedIndex(Math.max(0, newFiltered.length - 1));
              }
            }
          });
        } else {
          setMemoryPendingDeleteId(item.id);
        }
      }
      return;
    }

    // ── extension-list 视图 ──
    if (viewMode === 'extension-list') {
      const refreshExtensionList = async () => {
        if (!onListExtensions) return;
        const list = await onListExtensions();
        setExtensionList(list);
        setSelectedIndex((prev) => Math.min(Math.max(0, prev), Math.max(0, list.length - 1)));
      };

      const hasExtensionDraftChanges = () => extensionList.some((item) => (
        item.status !== 'platform' && (item.originalStatus ?? item.status) !== item.status
      ));

      const blockIfDirty = (actionLabel: string) => {
        if (!hasExtensionDraftChanges()) return false;
        setExtensionStatusMessage(`当前有未保存的启用/禁用修改。请先按 S 保存，再执行${actionLabel}；或按 Esc 返回后重新进入以放弃草稿。`);
        setExtensionStatusIsError(true);
        return true;
      };

      if (extensionBusy) {
        return;
      }

      // ── scope-pick 子模式：让用户在按 G 之后选 global / agent ──
      if (extensionScopePickMode) {
        if (key.name === 'escape') {
          setExtensionScopePickMode(false);
          setExtensionStatusMessage(null);
          setExtensionStatusIsError(false);
          return;
        }
        if (key.name === '1' || key.sequence === '1') {
          setExtensionInstallScope('global');
          setExtensionScopePickMode(false);
          setExtensionGitInputMode(true);
          extensionGitInputActions.setValue('');
          setExtensionStatusMessage('安装范围：全局 (~/.iris/extensions/)。输入 Git 地址后按 Enter 拉取安装');
          setExtensionStatusIsError(false);
          return;
        }
        if (key.name === '2' || key.sequence === '2') {
          setExtensionInstallScope('agent');
          setExtensionScopePickMode(false);
          setExtensionGitInputMode(true);
          extensionGitInputActions.setValue('');
          setExtensionStatusMessage('安装范围：此 agent (仅当前 agent 可见)。输入 Git 地址后按 Enter 拉取安装');
          setExtensionStatusIsError(false);
          return;
        }
        return;
      }

      if (extensionGitInputMode) {
        if (key.ctrl && key.name === 'v') {
          const pasted = readClipboardText();
          const normalized = pasted ? normalizePastedSingleLine(pasted) : '';
          if (normalized) {
            extensionGitInputActions.insert(normalized);
          } else {
            setExtensionStatusMessage('无法读取剪贴板。可尝试 Ctrl+Shift+V / Shift+Insert 粘贴。');
            setExtensionStatusIsError(true);
          }
          return;
        }

        if (key.name === 'escape') {
          setExtensionGitInputMode(false);
          extensionGitInputActions.setValue('');
          setExtensionStatusMessage(null);
          setExtensionStatusIsError(false);
          return;
        }

        if (key.name === 'return' || key.name === 'enter') {
          const target = extensionGitInputState.value.trim();
          if (!target) {
            setExtensionStatusMessage('请输入 Git 地址');
            setExtensionStatusIsError(true);
            return;
          }
          if (!onInstallGitExtension) {
            setExtensionStatusMessage('Git 拉取安装不可用');
            setExtensionStatusIsError(true);
            return;
          }
          const scopeLabel = extensionInstallScope === 'global' ? '全局' : '此 agent';
          setExtensionStatusMessage(`拉取 Git 扩展中（→ ${scopeLabel}）：${target}`);
          setExtensionStatusIsError(false);
          setExtensionBusy(true);
          void onInstallGitExtension(target, extensionInstallScope).then(async (result) => {
            if (!result.ok) {
              setExtensionStatusMessage(result.message);
              setExtensionStatusIsError(true);
              return;
            }
            setExtensionGitInputMode(false);
            extensionGitInputActions.setValue('');
            await refreshExtensionList();
            await onRefreshPluginSettingsTabs?.();
            setExtensionStatusMessage(result.message);
            setExtensionStatusIsError(false);
          }).catch((err) => {
            setExtensionStatusMessage(`Git 拉取失败：${err instanceof Error ? err.message : String(err)}`);
            setExtensionStatusIsError(true);
          }).finally(() => {
            setExtensionBusy(false);
          });
          return;
        }

        extensionGitInputActions.handleKey(key);
        return;
      }

      if (key.name === 'escape') {
        setExtensionStatusMessage(null);
        setExtensionPendingDeleteName(null);
        setExtensionPendingUpdateName(null);
        setViewMode('chat');
      } else if (key.name === 'up') {
        setExtensionPendingDeleteName(null);
        setExtensionPendingUpdateName(null);
        setSelectedIndex((prev) => Math.max(0, prev - 1));
      } else if (key.name === 'down') {
        setExtensionPendingDeleteName(null);
        setExtensionPendingUpdateName(null);
        setSelectedIndex((prev) => Math.min(extensionList.length - 1, prev + 1));
      } else if (key.name === 'return' || key.name === 'enter') {
        const item = extensionList[selectedIndex];
        if (!item) return;
        if (item.status === 'platform') {
          setExtensionStatusMessage('Platform 请在 platform.yaml 配置');
          setExtensionStatusIsError(false);
          return;
        }
        const originalStatus = item.originalStatus ?? item.status;
        const nextStatus = item.status === 'active'
          ? (originalStatus === 'available' ? 'available' : 'disabled')
          : 'active';
        setExtensionList((prev) => prev.map((entry, index) => index === selectedIndex
          ? { ...entry, status: nextStatus, originalStatus }
          : entry));
        setExtensionStatusMessage(`草稿：${item.name} -> ${nextStatus === 'active' ? '启用' : '禁用'}，S 保存`);
        setExtensionStatusIsError(false);
        setExtensionPendingDeleteName(null);
        setExtensionPendingUpdateName(null);
      } else if (key.name === 's') {
        if (!onToggleExtension) {
          setExtensionStatusMessage('扩展管理不可用');
          setExtensionStatusIsError(true);
          return;
        }
        const changed = extensionList.filter((item) => item.status !== 'platform' && (item.originalStatus ?? item.status) !== item.status);
        if (changed.length === 0) {
          setExtensionStatusMessage('无未保存修改');
          setExtensionStatusIsError(false);
          return;
        }
        setExtensionStatusMessage(`保存中：${changed.length} 项...`);
        setExtensionStatusIsError(false);
        setExtensionBusy(true);
        void (async () => {
          for (const item of changed) {
            setExtensionTogglingName(item.name);
            const result = await onToggleExtension(item.name, item.status === 'active');
            if (!result.ok) {
              setExtensionTogglingName(null);
              setExtensionStatusMessage(result.message);
              setExtensionStatusIsError(true);
              return;
            }
          }
          setExtensionTogglingName(null);
          if (onListExtensions) {
            try {
              await refreshExtensionList();
            } catch {
              setExtensionList((prev) => prev.map((item) => ({ ...item, originalStatus: item.status })));
            }
          } else {
            setExtensionList((prev) => prev.map((item) => ({ ...item, originalStatus: item.status })));
          }
          await onRefreshPluginSettingsTabs?.();
          setExtensionStatusMessage(`已保存并热重载：${changed.length} 项`);
          setExtensionStatusIsError(false);
        })().catch((err) => {
          setExtensionTogglingName(null);
          setExtensionStatusMessage(`保存失败：${err}`);
          setExtensionStatusIsError(true);
        }).finally(() => {
          setExtensionBusy(false);
        });
      } else if (key.name === 'g') {
        if (blockIfDirty('Git 拉取')) return;
        // 先进 scope-pick，让用户决定装到全局还是当前 agent
        setExtensionScopePickMode(true);
        setExtensionPendingDeleteName(null);
        setExtensionPendingUpdateName(null);
        setExtensionStatusMessage('选择安装范围：[1] 全局  [2] 此 agent  Esc 取消');
        setExtensionStatusIsError(false);
      } else if (key.name === 'd') {
        if (blockIfDirty('删除')) return;
        const item = extensionList[selectedIndex];
        if (!item) return;
        if (!onDeleteExtension) {
          setExtensionStatusMessage('删除扩展不可用');
          setExtensionStatusIsError(true);
          return;
        }
        if (extensionPendingDeleteName !== item.name) {
          setExtensionPendingDeleteName(item.name);
          setExtensionPendingUpdateName(null);
          setExtensionStatusMessage(`危险操作：再次按 D 将永久删除 "${item.name}" 的本地 extension 目录；按 Esc 或切换选择取消。`);
          setExtensionStatusIsError(true);
          return;
        }

        setExtensionTogglingName(item.name);
        setExtensionStatusMessage(`删除中：${item.name}`);
        setExtensionStatusIsError(false);
        setExtensionBusy(true);
        void onDeleteExtension(item.name).then(async (result) => {
          setExtensionTogglingName(null);
          setExtensionPendingDeleteName(null);
          if (!result.ok) {
            setExtensionStatusMessage(result.message);
            setExtensionStatusIsError(true);
            return;
          }
          await refreshExtensionList();
          await onRefreshPluginSettingsTabs?.();
          setExtensionStatusMessage(result.message);
          setExtensionStatusIsError(false);
        }).catch((err) => {
          setExtensionTogglingName(null);
          setExtensionStatusMessage(`删除失败：${err instanceof Error ? err.message : String(err)}`);
          setExtensionStatusIsError(true);
        }).finally(() => {
          setExtensionBusy(false);
        });
      } else if (key.name === 'u') {
        if (blockIfDirty('升级')) return;
        const item = extensionList[selectedIndex];
        if (!item) return;
        if (!(item.installSource === 'git' || item.gitUrl)) {
          setExtensionStatusMessage('只有通过 Git 安装的 extension 才能在此升级');
          setExtensionStatusIsError(true);
          return;
        }
        if (!onUpdateExtension) {
          setExtensionStatusMessage('升级扩展不可用');
          setExtensionStatusIsError(true);
          return;
        }
        if (extensionPendingUpdateName !== item.name) {
          if (!onPreviewUpdateExtension) {
            setExtensionPendingUpdateName(item.name);
            setExtensionPendingDeleteName(null);
            setExtensionStatusMessage(`升级预览不可用。再次按 U 将直接按 Git 来源升级 "${item.name}"。`);
            setExtensionStatusIsError(true);
            return;
          }

          setExtensionTogglingName(item.name);
          setExtensionStatusMessage(`检查 Git 更新中：${item.name}`);
          setExtensionStatusIsError(false);
          setExtensionBusy(true);
          void onPreviewUpdateExtension(item.name).then((result) => {
            setExtensionTogglingName(null);
            if (!result.ok) {
              setExtensionStatusMessage(result.message);
              setExtensionStatusIsError(true);
              return;
            }
            setExtensionPendingUpdateName(item.name);
            setExtensionPendingDeleteName(null);
            setExtensionStatusMessage(`${result.message}；再次按 U 确认升级，按 Esc 或切换选择取消。`);
            setExtensionStatusIsError(false);
          }).catch((err) => {
            setExtensionTogglingName(null);
            setExtensionStatusMessage(`检查更新失败：${err instanceof Error ? err.message : String(err)}`);
            setExtensionStatusIsError(true);
          }).finally(() => {
            setExtensionBusy(false);
          });
          return;
        }

        setExtensionTogglingName(item.name);
        setExtensionStatusMessage(`升级中：${item.name}`);
        setExtensionStatusIsError(false);
        setExtensionBusy(true);
        void onUpdateExtension(item.name).then(async (result) => {
          setExtensionTogglingName(null);
          setExtensionPendingUpdateName(null);
          if (!result.ok) {
            setExtensionStatusMessage(result.message);
            setExtensionStatusIsError(true);
            return;
          }
          await refreshExtensionList();
          await onRefreshPluginSettingsTabs?.();
          setExtensionStatusMessage(result.message);
          setExtensionStatusIsError(false);
        }).catch((err) => {
          setExtensionTogglingName(null);
          setExtensionStatusMessage(`升级失败：${err instanceof Error ? err.message : String(err)}`);
          setExtensionStatusIsError(true);
        }).finally(() => {
          setExtensionBusy(false);
        });
      }
      return;
    }

    // ── agent-list 视图 ──
    // 修改目的：agent 选择现在是 OpenTUI React viewMode，与 model-list 同级处理，
    // 不再用原始 ANSI+stdin 的方式，彻底消除 stdin/stdout 争夺和日志泄漏。
    if (viewMode === 'agent-list') {
      if (key.name === 'escape') {
        setViewMode('chat');
      } else if (key.name === 'up') setSelectedIndex((prev) => Math.max(0, prev - 1));
      else if (key.name === 'down') setSelectedIndex((prev) => Math.min(agentList.length - 1, prev + 1));
      else if (key.name === 'return') {
        const selected = agentList[selectedIndex];
        if (selected) {
          onSelectAgent?.(selected.name);
          setViewMode('chat');
        }
      }
      return;
    }

    if (pendingConfirm && key.name === 'escape') {
      closeConfirm(setPendingConfirm, setConfirmChoice);
      return;
    }

    if (key.name === 'escape') {
      if (viewMode === 'queue-list') {
        // 如果正在编辑，先取消编辑
        if (queueEditingId) {
          setQueueEditingId(null);
          queueEditActions.setValue('');
          return;
        }
        setViewMode('chat');
        return;
      }
      // AskQuestionFirst 面板自己处理 Esc（输入中/确认页返回，选择页取消问答）。
      // 全局层不能把 Esc 当作 abort，否则会直接中断整个 turn。
      if (askQuestionActive) return;

      if (isGenerating || hasRunningBackgroundTasks) {
        onAbort();
        return;
      }
      if (viewMode === 'session-list') {
        setViewMode('chat');
        return;
      }
      if (viewMode === 'model-list') {
        if (modelEditingField) {
          resetModelEditing();
          setModelStatus(null);
          return;
        }
        setViewMode('chat');
        return;
      }
      if (viewMode === 'file-browser') {
        setViewMode('chat');
        return;
      }
      return;
    }

    // ── 队列列表视图键盘处理 ──────────────────────────
    if (viewMode === 'queue-list') {
      // 队列已空，任意键返回
      if (queue.length === 0) {
        setViewMode('chat');
        return;
      }

      // 编辑模式
      if (queueEditingId) {
        // Ctrl+J / Ctrl+Enter → 插入换行
        if (key.ctrl && (key.name === 'j' || key.name === 'return' || key.name === 'enter')) {
          key.preventDefault?.();
          queueEditActions.insert('\n');
          return;
        }
        // Enter → 确认编辑
        if (!key.ctrl && (key.name === 'enter' || key.name === 'return')) {
          key.preventDefault?.();
          const trimmed = queueEditState.value.trim();
          if (trimmed) {
            queueEdit(queueEditingId, trimmed);
          }
          setQueueEditingId(null);
          queueEditActions.setValue('');
          return;
        }
        // 其余按键全部委托给 useTextInput（光标移动、删除、字符输入等）
        queueEditActions.handleKey(key);
        return;
      }

      // 非编辑模式的键盘处理

      // ↑/↓ 导航选择
      if (!key.shift && !key.ctrl && key.name === 'up') {
        setSelectedIndex((prev) => Math.max(0, prev - 1));
        return;
      }
      if (!key.shift && !key.ctrl && key.name === 'down') {
        setSelectedIndex((prev) => Math.min(queue.length - 1, prev + 1));
        return;
      }

      // Ctrl/Shift+↑/↓ 移动消息位置
      if ((key.shift || key.ctrl) && key.name === 'up') {
        const selected = queue[selectedIndex];
        if (selected && queueMoveUp(selected.id)) {
          setSelectedIndex((prev) => Math.max(0, prev - 1));
        }
        return;
      }
      if ((key.shift || key.ctrl) && key.name === 'down') {
        const selected = queue[selectedIndex];
        if (selected && queueMoveDown(selected.id)) {
          setSelectedIndex((prev) => Math.min(queue.length - 1, prev + 1));
        }
        return;
      }

      // e 编辑
      if (key.name === 'e') {
        const selected = queue[selectedIndex];
        if (selected) {
          setQueueEditingId(selected.id);
          // 初始化文本输入，光标置于末尾
          queueEditActions.setValue(selected.text);
        }
        return;
      }

      // d / Delete 删除
      if (key.name === 'd' || key.name === 'delete') {
        const selected = queue[selectedIndex];
        if (selected) {
          queueRemove(selected.id);
          setSelectedIndex((prev) => Math.min(prev, queue.length - 2));
          if (queue.length <= 1) {
            setViewMode('chat');
          }
        }
        return;
      }

      // c 清空全部
      if (key.name === 'c') {
        queueClear();
        setViewMode('chat');
        appendCommandMessage(setMessages, '队列已清空。');
        return;
      }

      return;
    }

    if (pendingApplies.length > 0) {
      const current = pendingApplies[0];
      if (key.name === 'up' || key.name === 'down') {
        approval.setPreviewIndex((prev) => key.name === 'up' ? prev - 1 : prev + 1);
        return;
      }
      if (key.name === 'tab' || key.name === 'left' || key.name === 'right') {
        approval.toggleChoice();
        return;
      }
      if (key.name === 'v') {
        approval.toggleDiffView();
        return;
      }
      if (key.name === 'l') {
        key.preventDefault?.();
        approval.toggleLineNumbers();
        return;
      }
      if (key.name === 'w') {
        approval.toggleWrapMode();
        return;
      }
      if (key.name === 'enter' || key.name === 'return') {
        onToolApply(current.id, approval.approvalChoice === 'approve');
        approval.resetChoice();
        return;
      }
      if (key.name === 'y') {
        onToolApply(current.id, true);
        approval.resetChoice();
        return;
      }
      if (key.name === 'n') {
        onToolApply(current.id, false);
        approval.resetChoice();
        return;
      }
      return;
    }

    if (pendingApprovals.length > 0) {
      const inv = pendingApprovals[0];
      const isCommandTool = inv.toolName === 'shell' || inv.toolName === 'bash';

      // Tab: 切换基础页(Y/N) ↔ 策略页(A/S)，仅命令类工具
      if (key.name === 'tab' && isCommandTool) {
        approval.toggleApprovalPage();
        return;
      }

      // 方向键切换选中项（两页通用）
      if (key.name === 'left' || key.name === 'up' || key.name === 'right' || key.name === 'down') {
        approval.toggleChoice();
        return;
      }

      // Y/N 在任何页面都保持基础功能（批准/拒绝），避免用户在策略页按 Y 无反应
      if (key.name === 'y') {
        onToolApproval(inv.id, true);
        approval.resetChoice();
        return;
      }
      if (key.name === 'n') {
        onToolApproval(inv.id, false);
        approval.resetChoice();
        return;
      }

      if (approval.approvalPage === 'policy' && isCommandTool) {
        // ── 策略页：Enter 按选中项、A/S 快捷键 ──
        const command = typeof inv.args?.command === 'string' ? inv.args.command : '';
        if (key.name === 'enter' || key.name === 'return') {
          onToolApproval(inv.id, true);
          onAddCommandPattern?.(inv.toolName, command, approval.approvalChoice === 'approve' ? 'allow' : 'deny');
          approval.resetChoice();
          return;
        }
        if (key.name === 'a') {
          onToolApproval(inv.id, true);
          onAddCommandPattern?.(inv.toolName, command, 'allow');
          approval.resetChoice();
          return;
        }
        if (key.name === 's') {
          onToolApproval(inv.id, true);
          onAddCommandPattern?.(inv.toolName, command, 'deny');
          approval.resetChoice();
          return;
        }
      } else {
        // ── 基础页：Enter 按选中项 ──
        if (key.name === 'enter' || key.name === 'return') {
          onToolApproval(inv.id, approval.approvalChoice === 'approve');
          approval.resetChoice();
          return;
        }
      }
      return;
    }

    if (pendingConfirm) {
      if (key.name === 'left' || key.name === 'up' || key.name === 'right' || key.name === 'down') {
        setConfirmChoice((prev) => prev === 'confirm' ? 'cancel' : 'confirm');
        return;
      }
      if (key.name === 'enter' || key.name === 'return') {
        if (confirmChoice === 'confirm') pendingConfirm.action();
        closeConfirm(setPendingConfirm, setConfirmChoice);
        return;
      }
      if (key.name === 'y') {
        pendingConfirm.action();
        closeConfirm(setPendingConfirm, setConfirmChoice);
        return;
      }
      if (key.name === 'n') {
        closeConfirm(setPendingConfirm, setConfirmChoice);
        return;
      }
      return;
    }

    if (viewMode === 'session-list') {
      if (key.name === 'escape') {
        if (sessionPendingDeleteId) {
          setSessionPendingDeleteId(null);
          setSessionStatusMessage(null);
          setSessionStatusIsError(false);
        } else {
          setViewMode('chat');
        }
      } else if (key.name === 'up') {
        setSelectedIndex((prev) => Math.max(0, prev - 1));
        setSessionPendingDeleteId(null);
        setSessionStatusMessage(null);
        setSessionStatusIsError(false);
      } else if (key.name === 'down') {
        setSelectedIndex((prev) => Math.min(sessionList.length - 1, prev + 1));
        setSessionPendingDeleteId(null);
        setSessionStatusMessage(null);
        setSessionStatusIsError(false);
      } else if (key.name === 'enter' || key.name === 'return') {
        const selected = sessionList[selectedIndex];
        if (selected) {
          setSessionPendingDeleteId(null);
          setSessionStatusMessage(null);
          setSessionStatusIsError(false);
          clearRedo(undoRedoRef.current);
          onClearRedoStack();
          setMessages([]);
          commitTools();
          setViewMode('chat');
          onLoadSession(selected.id).catch(() => {});
        }
      } else if (key.name === 'd') {
        const selected = sessionList[selectedIndex];
        if (!selected) return;
        if (!onDeleteSession) {
          setSessionStatusMessage('当前平台不支持删除历史对话。');
          setSessionStatusIsError(true);
          return;
        }
        if (sessionPendingDeleteId !== selected.id) {
          setSessionPendingDeleteId(selected.id);
          setSessionStatusMessage(`再次按 D 删除「${selected.title || selected.id}」。`);
          setSessionStatusIsError(true);
          return;
        }

        setSessionStatusMessage(`正在删除「${selected.title || selected.id}」...`);
        setSessionStatusIsError(false);
        void onDeleteSession(selected.id).then((result) => {
          if (!result.ok) {
            setSessionStatusMessage(result.message);
            setSessionStatusIsError(true);
            return;
          }
          const nextList = sessionList.filter((item) => item.id !== selected.id);
          setSessionList(nextList);
          setSelectedIndex((prev) => Math.min(Math.max(0, prev), Math.max(0, nextList.length - 1)));
          setSessionPendingDeleteId(null);
          setSessionStatusMessage(result.message);
          setSessionStatusIsError(false);
          if (result.deletedCurrent) {
            clearRedo(undoRedoRef.current);
            onClearRedoStack();
            setMessages([]);
            commitTools();
          }
        }).catch((err) => {
          setSessionStatusMessage(`删除失败：${err instanceof Error ? err.message : String(err)}`);
          setSessionStatusIsError(true);
        });
      }
      return;
    }

    // ── 文件浏览器视图键盘处理 ──────────────────────────
    if (viewMode === 'file-browser') {
      if (key.name === 'up') {
        setSelectedIndex((prev) => Math.max(0, prev - 1));
      } else if (key.name === 'down') {
        setSelectedIndex((prev) => Math.min(fileBrowserEntries.length - 1, prev + 1));
      } else if (key.name === 'enter' || key.name === 'return') {
        const selected = fileBrowserEntries[selectedIndex];
        if (selected) {
          if (!selected.isDirectory) setViewMode('chat');
          onFileBrowserSelect?.(fileBrowserPath, selected, fileBrowserShowHidden);
        }
      } else if (key.name === 'backspace' || (key.name === 'left' && !key.shift)) {
        onFileBrowserGoUp?.(fileBrowserPath, fileBrowserShowHidden);
      } else if (key.sequence === '.') {
        onFileBrowserToggleHidden?.(fileBrowserPath, fileBrowserShowHidden);
      }
      return;
    }



    if (viewMode === 'model-list') {
      if (modelEditingField) {
        if (key.name === 'escape') {
          resetModelEditing();
          setModelStatus(null);
          return;
        }
        if (key.name === 'enter' || key.name === 'return') {
          const targetModelName = modelEditTargetName;
          if (!targetModelName || !onUpdateModelEntry) {
            resetModelEditing();
            setModelStatus('模型编辑功能不可用', true);
            return;
          }

          if (modelEditingField === 'modelName') {
            const nextName = modelEditState.value.trim();
            if (!nextName) {
              setModelStatus('模型名不能为空', true);
              return;
            }
            void onUpdateModelEntry(targetModelName, { modelName: nextName })
              .then((result) => {
                setModelStatus(result.message, !result.ok);
                if (!result.ok) return;
                syncModelPanel(result.updatedModelName ?? nextName);
                resetModelEditing();
              })
              .catch((err) => setModelStatus(`保存模型名失败：${err instanceof Error ? err.message : String(err)}`, true));
            return;
          }

          const raw = modelEditState.value.trim();
          if (!raw) {
            void onUpdateModelEntry(targetModelName, { contextWindow: null })
              .then((result) => {
                setModelStatus(result.message, !result.ok);
                if (!result.ok) return;
                syncModelPanel(result.updatedModelName ?? targetModelName);
                resetModelEditing();
              })
              .catch((err) => setModelStatus(`保存上下文窗口失败：${err instanceof Error ? err.message : String(err)}`, true));
            return;
          }

          const parsed = Number(raw);
          if (!Number.isInteger(parsed) || parsed <= 0) {
            setModelStatus('上下文窗口必须是正整数，留空可清除', true);
            return;
          }
          void onUpdateModelEntry(targetModelName, { contextWindow: parsed })
            .then((result) => {
              setModelStatus(result.message, !result.ok);
              if (!result.ok) return;
              syncModelPanel(result.updatedModelName ?? targetModelName);
              resetModelEditing();
            })
            .catch((err) => setModelStatus(`保存上下文窗口失败：${err instanceof Error ? err.message : String(err)}`, true));
          return;
        }

        modelEditActions.handleKey(key);
        return;
      }

      if (key.name === 'up') setSelectedIndex((prev) => Math.max(0, prev - 1));
      else if (key.name === 'down') setSelectedIndex((prev) => Math.min(modelList.length - 1, prev + 1));
      else if (key.name === 'enter' || key.name === 'return') {
        const selected = modelList[selectedIndex];
        if (selected) {
          const result = onSwitchModel(selected.modelName);
          setModelStatus(result.message, !result.ok);
          modelState.updateModel(result);
          appendCommandMessage(setMessages, result.message, result.ok ? undefined : { isError: true });
          if (result.ok) {
            const nextCurrentModelName = result.modelName ?? selected.modelName;
            setModelList((prev) => prev.map((model) => ({
              ...model,
              current: model.modelName === nextCurrentModelName,
            })));
          }
        }
      } else if (key.name === 'r') {
        syncModelPanel(modelList[selectedIndex]?.modelName);
        setModelStatus('已刷新模型列表');
      } else if (key.name === 'd') {
        const selected = modelList[selectedIndex];
        if (!selected) return;
        if (selected.modelName === defaultModelName) {
          setModelStatus(`模型 "${selected.modelName}" 已经是默认模型`);
          return;
        }
        if (!onSetDefaultModel) {
          setModelStatus('设默认模型功能不可用', true);
          return;
        }
        void onSetDefaultModel(selected.modelName)
          .then((result) => {
            setModelStatus(result.message, !result.ok);
            if (result.ok) syncModelPanel(selected.modelName);
          })
          .catch((err) => setModelStatus(`设置默认模型失败：${err instanceof Error ? err.message : String(err)}`, true));
      } else if (key.name === 'n') {
        const selected = modelList[selectedIndex];
        if (!selected) return;
        setModelStatus(null);
        setModelEditTargetName(selected.modelName);
        setModelEditingField('modelName');
        modelEditActions.set(selected.modelName, selected.modelName.length);
      } else if (key.name === 'w') {
        const selected = modelList[selectedIndex];
        if (!selected) return;
        setModelStatus(null);
        setModelEditTargetName(selected.modelName);
        setModelEditingField('contextWindow');
        const initialValue = selected.contextWindow != null ? String(selected.contextWindow) : '';
        modelEditActions.set(initialValue, initialValue.length);
      }
      return;
    }

    // ── F6 复制模式：拦截方向键/翻页键，手动滚动聊天消息列表 ──
    // 鼠标拖选由 OpenTUI selection 处理；这里保留键盘滚动能力，
    // 同时 preventDefault 阻止方向键/翻页键传递到输入框。
    if (copyMode) {
      const sb = chatScrollBoxRef?.current;
      if (sb && (key.name === 'up' || key.name === 'down' || key.name === 'pageup' || key.name === 'pagedown')) {
        const viewportH = sb.viewport?.height ?? 20;
        const step = Math.max(1, Math.round(viewportH / 5));
        if (key.name === 'up') sb.scrollTop -= step;
        else if (key.name === 'down') sb.scrollTop += step;
        else if (key.name === 'pageup') sb.scrollTop -= Math.max(1, Math.round(viewportH / 2));
        else if (key.name === 'pagedown') sb.scrollTop += Math.max(1, Math.round(viewportH / 2));
        (sb as any)._hasManualScroll = true;
        key.preventDefault();
        return;
      }
    }
  });
}
