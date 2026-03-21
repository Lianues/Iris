import { useKeyboard } from '@opentui/react';
import type { LLMModelInfo } from '../../../llm/router';
import type { WindowInfo } from '../../../computer-use/types';
import type { SessionMeta } from '../../../storage/base';
import type { ToolInvocation } from '../../../types';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { ApprovalChoice, ConfirmChoice, PendingConfirm, SwitchModelResult, ViewMode } from '../app-types';
import type { ChatMessage } from '../components/MessageItem';
import { clearRedo, type UndoRedoStack } from '../undo-redo';
import type { UseModelStateReturn } from './use-model-state';
import { appendCommandMessage } from '../message-utils';
import { filterWindows } from '../components/WindowListView';

type SetState<T> = Dispatch<SetStateAction<T>>;

interface ApprovalController {
  approvalChoice: ApprovalChoice;
  setPreviewIndex: SetState<number>;
  resetChoice: () => void;
  toggleChoice: () => void;
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
  approval: ApprovalController;
  onExit: () => void;
  onAbort: () => void;
  onToolApply: (toolId: string, applied: boolean) => void;
  onToolApproval: (toolId: string, approved: boolean) => void;
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
  windowList: WindowInfo[];
  windowSearchText: string;
  setWindowSearchText: SetState<string>;
  onSwitchWindow?: (hwnd: string) => Promise<{ ok: boolean; message: string }>;
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
  setMessages,
  commitTools,
  onLoadSession,
  onSwitchModel,
  modelState,
  windowList,
  windowSearchText,
  setWindowSearchText,
  onSwitchWindow,
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

    if (viewMode === 'settings') return;

    if (pendingConfirm && key.name === 'escape') {
      closeConfirm(setPendingConfirm, setConfirmChoice);
      return;
    }

    if (key.name === 'escape') {
      if (isGenerating) {
        onAbort();
        return;
      }
      if (viewMode === 'session-list' || viewMode === 'model-list' || viewMode === 'window-list') {
        setViewMode('chat');
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
      if (key.name === 'left' || key.name === 'up' || key.name === 'right' || key.name === 'down') {
        approval.toggleChoice();
        return;
      }
      if (key.name === 'enter' || key.name === 'return') {
        onToolApproval(pendingApprovals[0].id, approval.approvalChoice === 'approve');
        approval.resetChoice();
        return;
      }
      if (key.name === 'y') {
        onToolApproval(pendingApprovals[0].id, true);
        approval.resetChoice();
        return;
      }
      if (key.name === 'n') {
        onToolApproval(pendingApprovals[0].id, false);
        approval.resetChoice();
        return;
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

    if (viewMode === 'window-list') {
      const filtered = filterWindows(windowList, windowSearchText);

      if (key.name === 'up') {
        setSelectedIndex((prev) => Math.max(0, prev - 1));
        return;
      }
      if (key.name === 'down') {
        setSelectedIndex((prev) => Math.min(filtered.length - 1, prev + 1));
        return;
      }
      if (key.name === 'enter' || key.name === 'return') {
        const selected = filtered[selectedIndex];
        if (selected && onSwitchWindow) {
          setViewMode('chat');
          onSwitchWindow(selected.hwnd).then((result) => {
            appendCommandMessage(setMessages, result.message, { isError: !result.ok });
          });
        }
        return;
      }
      if (key.name === 'backspace') {
        setWindowSearchText((prev) => prev.slice(0, -1));
        setSelectedIndex(0);
        return;
      }
      // 可打印字符：追加到搜索文本
      if (!key.ctrl && key.name && key.name.length === 1) {
        setWindowSearchText((prev) => prev + key.name);
        setSelectedIndex(0);
        return;
      }
    }
  });
}
