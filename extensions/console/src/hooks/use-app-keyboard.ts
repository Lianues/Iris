import { useKeyboard } from '@opentui/react';
import type { AgentDefinitionLike } from 'irises-extension-sdk';
import type { IrisModelInfoLike as LLMModelInfo, IrisSessionMetaLike as SessionMeta, ToolInvocation } from 'irises-extension-sdk';
import type { TextInputState, TextInputActions } from './use-text-input';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { ApprovalChoice, ConfirmChoice, PendingConfirm, SwitchModelResult, ViewMode } from '../app-types';
import type { ChatMessage } from '../components/MessageItem';
import { clearRedo, type UndoRedoStack } from '../undo-redo';
import type { UseModelStateReturn } from './use-model-state';
import { appendCommandMessage } from '../message-utils';
import type { QueuedMessage } from './use-message-queue';
import { filterMemories, nextFilter, type MemoryItem, type MemoryFilter } from '../components/MemoryListView';

type SetState<T> = Dispatch<SetStateAction<T>>;

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
  pendingConfirm: PendingConfirm | null;
  confirmChoice: ConfirmChoice;
  setPendingConfirm: SetState<PendingConfirm | null>;
  setConfirmChoice: SetState<ConfirmChoice>;
  exitConfirm: ExitConfirmController;
  isGenerating: boolean;
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
  onToggleExtension?: (name: string) => Promise<{ ok: boolean; message: string }>;
  onListExtensions?: () => Promise<any[]>;
  setExtensionTogglingName: SetState<string | null>;
  setExtensionStatusMessage: SetState<string | null>;
  setExtensionStatusIsError: SetState<boolean>;
}

function closeConfirm(
  setPendingConfirm: SetState<PendingConfirm | null>,
  setConfirmChoice: SetState<ConfirmChoice>,
): void {
  setPendingConfirm(null);
  setConfirmChoice('confirm');
}

export function useAppKeyboard({
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
  isGenerating,
  pendingApplies,
  pendingApprovals,
  onOpenToolDetail,
  approval,
  onExit,
  onAbort,
  onToolApply,
  onToolApproval,
  onAddCommandPattern,
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
  onListExtensions,
  setExtensionTogglingName,
  setExtensionStatusMessage,
  setExtensionStatusIsError,
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

  useKeyboard((key) => {
    if (key.ctrl && key.name === 'c') {
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

    // Ctrl+T：打开工具执行详情（由 index.ts 从 _activeHandles 中选择目标）
    if (key.name === 't' && key.ctrl) {
      onOpenToolDetail('');
      return;
    }

    if (viewMode === 'settings') return;

    // tool-detail 视图由 ToolDetailView 组件自身处理键盘（useKeyboard），此处不拦截
    if (viewMode === 'tool-detail') return;

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
      if (key.name === 'escape') {
        setExtensionStatusMessage(null);
        setViewMode('chat');
      } else if (key.name === 'up') {
        setSelectedIndex((prev) => Math.max(0, prev - 1));
      } else if (key.name === 'down') {
        setSelectedIndex((prev) => Math.min(extensionList.length - 1, prev + 1));
      } else if (key.name === 'return') {
        const item = extensionList[selectedIndex];
        if (!item || item.status === 'platform' || !onToggleExtension) return;
        setExtensionTogglingName(item.name);
        setExtensionStatusMessage(null);
        void onToggleExtension(item.name).then(async ({ ok, message }) => {
          setExtensionTogglingName(null);
          setExtensionStatusMessage(message);
          setExtensionStatusIsError(!ok);
          // 刷新列表
          if (ok && onListExtensions) {
            try {
              const list = await onListExtensions();
              setExtensionList(list);
            } catch { /* ignore */ }
          }
        }).catch((err) => {
          setExtensionTogglingName(null);
          setExtensionStatusMessage(`操作失败: ${err}`);
          setExtensionStatusIsError(true);
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
      if (isGenerating) {
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
          queueEditActions.insert('\n');
          return;
        }
        // Enter → 确认编辑
        if (!key.ctrl && (key.name === 'enter' || key.name === 'return')) {
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

    if (isGenerating && pendingApplies.length > 0) {
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

    if (isGenerating && pendingApprovals.length > 0) {
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
      if (key.name === 'up') setSelectedIndex((prev) => Math.max(0, prev - 1));
      else if (key.name === 'down') setSelectedIndex((prev) => Math.min(sessionList.length - 1, prev + 1));
      else if (key.name === 'enter' || key.name === 'return') {
        const selected = sessionList[selectedIndex];
        if (selected) {
          clearRedo(undoRedoRef.current);
          onClearRedoStack();
          setMessages([]);
          commitTools();
          setViewMode('chat');
          onLoadSession(selected.id).catch(() => {});
        }
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
    // useMouse=false 时终端可能将鼠标滚轮转为方向键序列，
    // 这些键会被输入框消费。此处在全局层拦截并手动滚动 scrollbox，
    // 同时 preventDefault 阻止事件传递到输入框。
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
