import { useKeyboard } from '@opentui/react';
import type { AgentDefinitionLike } from '@irises/extension-sdk';
import type { IrisModelInfoLike as LLMModelInfo, IrisSessionMetaLike as SessionMeta, ToolInvocation } from '@irises/extension-sdk';
import type { TextInputState, TextInputActions } from './use-text-input';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { ApprovalChoice, ConfirmChoice, PendingConfirm, SwitchModelResult, ViewMode } from '../app-types';
import type { ChatMessage } from '../components/MessageItem';
import { clearRedo, type UndoRedoStack } from '../undo-redo';
import type { UseModelStateReturn } from './use-model-state';
import { appendCommandMessage } from '../message-utils';
import type { QueuedMessage } from './use-message-queue';

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
  selectedIndex: number;
  setSelectedIndex: SetState<number>;
  undoRedoRef: MutableRefObject<UndoRedoStack>;
  onClearRedoStack: () => void;
  setMessages: SetState<ChatMessage[]>;
  commitTools: () => void;
  onLoadSession: (id: string) => Promise<void>;
  onSwitchModel: (modelName: string) => SwitchModelResult;
  modelState: Pick<UseModelStateReturn, 'updateModel'>;
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
  selectedIndex,
  setSelectedIndex,
  undoRedoRef,
  onClearRedoStack,
  setMessages,
  commitTools,
  onLoadSession,
  onSwitchModel,
  modelState,
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
}: UseAppKeyboardOptions) {
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
      if (viewMode === 'session-list' || viewMode === 'model-list') {
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
      if (key.name === 'up') setSelectedIndex((prev) => Math.max(0, prev - 1));
      else if (key.name === 'down') setSelectedIndex((prev) => Math.min(modelList.length - 1, prev + 1));
      else if (key.name === 'enter' || key.name === 'return') {
        const selected = modelList[selectedIndex];
        if (selected) {
          const result = onSwitchModel(selected.modelName);
          modelState.updateModel(result);
          setViewMode('chat');
        }
      }
      return;
    }
  });
}
