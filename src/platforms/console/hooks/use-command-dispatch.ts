import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { LLMModelInfo } from '../../../llm/router';
import type { WindowInfo } from '../../../computer-use/types';
import type { SessionMeta } from '../../../storage/base';
import type { ChatMessage } from '../components/MessageItem';
import type {
  ConfirmChoice,
  PendingConfirm,
  SettingsInitialSection,
  SwitchModelResult,
  ViewMode,
} from '../app-types';
import { appendCommandMessage } from '../message-utils';
import { clearRedo, performRedo, performUndo, type UndoRedoStack } from '../undo-redo';
import type { UseModelStateReturn } from './use-model-state';

type SetMessages = Dispatch<SetStateAction<ChatMessage[]>>;

type SetViewMode = Dispatch<SetStateAction<ViewMode>>;
type SetWindowList = Dispatch<SetStateAction<WindowInfo[]>>;
type SetWindowSearchText = Dispatch<SetStateAction<string>>;
type SetSessionList = Dispatch<SetStateAction<SessionMeta[]>>;
type SetModelList = Dispatch<SetStateAction<LLMModelInfo[]>>;
type SetSelectedIndex = Dispatch<SetStateAction<number>>;
type SetPendingConfirm = Dispatch<SetStateAction<PendingConfirm | null>>;
type SetConfirmChoice = Dispatch<SetStateAction<ConfirmChoice>>;
type SetSettingsInitialSection = Dispatch<SetStateAction<SettingsInitialSection>>;

interface UseCommandDispatchOptions {
  onSubmit: (text: string) => void;
  onUndo: () => Promise<boolean>;
  onRedo: () => Promise<boolean>;
  onClearRedoStack: () => void;
  onNewSession: () => void;
  onListSessions: () => Promise<SessionMeta[]>;
  onRunCommand: (cmd: string) => { output: string; cwd: string };
  onListModels: () => LLMModelInfo[];
  onSwitchModel: (modelName: string) => SwitchModelResult;
  onResetConfig: () => { success: boolean; message: string };
  onExit: () => void;
  onSwitchAgent?: () => void;
  onListWindows?: () => Promise<WindowInfo[]>;
  onSwitchWindow?: (hwnd: string) => Promise<{ ok: boolean; message: string }>;
  setWindowList: SetWindowList;
  setWindowSearchText: SetWindowSearchText;
  undoRedoRef: MutableRefObject<UndoRedoStack>;
  setMessages: SetMessages;
  commitTools: () => void;
  setViewMode: SetViewMode;
  setSessionList: SetSessionList;
  setModelList: SetModelList;
  setSelectedIndex: SetSelectedIndex;
  setPendingConfirm: SetPendingConfirm;
  setConfirmChoice: SetConfirmChoice;
  setSettingsInitialSection: SetSettingsInitialSection;
  modelState: Pick<UseModelStateReturn, 'updateModel'>;
}

function resetRedo(undoRedoRef: MutableRefObject<UndoRedoStack>, onClearRedoStack: () => void) {
  clearRedo(undoRedoRef.current);
  onClearRedoStack();
}

export function useCommandDispatch({
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
  onListWindows,
  onSwitchWindow,
  setWindowList,
  setWindowSearchText,
  undoRedoRef,
  setMessages,
  commitTools,
  setViewMode,
  setSessionList,
  setModelList,
  setSelectedIndex,
  setPendingConfirm,
  setConfirmChoice,
  setSettingsInitialSection,
  modelState,
}: UseCommandDispatchOptions) {
  return useCallback((text: string) => {
    if (text === '/exit') {
      onExit();
      return;
    }

    if (text === '/agent') {
      if (onSwitchAgent) {
        onSwitchAgent();
        return;
      }
      appendCommandMessage(
        setMessages,
        '当前未启用多 Agent 模式。请在 ~/.iris/agents.yaml 中设置 enabled: true。',
      );
      return;
    }

    if (text === '/new') {
      resetRedo(undoRedoRef, onClearRedoStack);
      setMessages([]);
      commitTools();
      onNewSession();
      return;
    }

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

    if (text === '/load') {
      onListSessions().then((metas) => {
        setSessionList(metas);
        setSelectedIndex(0);
        setViewMode('session-list');
      });
      return;
    }

    if (text === '/reset-config') {
      setPendingConfirm({
        message: '确认重置所有配置为默认值？当前配置将被覆盖。',
        action: () => {
          const result = onResetConfig();
          appendCommandMessage(
            setMessages,
            result.message + (result.success ? '\n重启应用后生效。' : ''),
            { isError: !result.success },
          );
        },
      });
      setConfirmChoice('confirm');
      return;
    }

    if (text === '/settings' || text === '/mcp') {
      setSettingsInitialSection(text === '/mcp' ? 'mcp' : 'general');
      setViewMode('settings');
      return;
    }

    if (text === '/window' || text.startsWith('/window ')) {
      if (!onListWindows) {
        appendCommandMessage(
          setMessages,
          'Computer Use 未启用。请在 computer_use.yaml 中设置 enabled: true 并使用 screen 环境。',
        );
        return;
      }
      const keyword = text.slice('/window'.length).trim();
      onListWindows().then((windows) => {
        setWindowList(windows);
        setWindowSearchText(keyword);
        setSelectedIndex(0);
        setViewMode('window-list');
      }).catch(() => {
        appendCommandMessage(
          setMessages,
          '获取窗口列表失败。',
          { isError: true },
        );
      });
      return;
    }

    if (text.startsWith('/model')) {
      resetRedo(undoRedoRef, onClearRedoStack);
      const arg = text.slice('/model'.length).trim();
      if (!arg) {
        const models = onListModels();
        setModelList(models);
        const currentIndex = models.findIndex((model) => model.current);
        setSelectedIndex(currentIndex >= 0 ? currentIndex : 0);
        setViewMode('model-list');
      } else {
        const result = onSwitchModel(arg);
        modelState.updateModel(result);
        appendCommandMessage(setMessages, result.message);
      }
      return;
    }

    if (text.startsWith('/sh ') || text === '/sh') {
      const cmd = text.slice(4).trim();
      if (!cmd) return;
      resetRedo(undoRedoRef, onClearRedoStack);
      try {
        const result = onRunCommand(cmd);
        appendCommandMessage(setMessages, result.output || '(无输出)');
      } catch (error: any) {
        appendCommandMessage(setMessages, `执行失败: ${error.message}`, { isError: true });
      }
      return;
    }

    resetRedo(undoRedoRef, onClearRedoStack);
    onSubmit(text);
  }, [
    commitTools,
    modelState,
    onClearRedoStack,
    onExit,
    onListModels,
    onListSessions,
    onListWindows,
    onSwitchWindow,
    onNewSession,
    onRedo,
    onResetConfig,
    onRunCommand,
    onSubmit,
    onSwitchAgent,
    onSwitchModel,
    onUndo,
    setConfirmChoice,
    setMessages,
    setModelList,
    setPendingConfirm,
    setSelectedIndex,
    setSessionList,
    setSettingsInitialSection,
    setWindowList,
    setWindowSearchText,
    setViewMode,
    undoRedoRef,
  ]);
}
