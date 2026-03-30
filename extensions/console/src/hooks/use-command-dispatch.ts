import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { IrisModelInfoLike as LLMModelInfo, IrisSessionMetaLike as SessionMeta } from '@irises/extension-sdk';
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
  onResetConfig: () => Promise<{ success: boolean; message: string }>;
  onExit: () => void;
  onSummarize: () => Promise<{ ok: boolean; message: string }>;
  onSwitchAgent?: () => void;
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
  /** 清空消息队列（/new、/load 时调用） */
  queueClear: () => void;
  /** 当前队列长度 */
  queueSize: number;
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
  onSummarize,
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
  queueClear,
  queueSize,
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
      queueClear();
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
      queueClear();
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
        action: async () => {
          const result = await onResetConfig();
          appendCommandMessage(
            setMessages,
            result.message + (result.success ? '\n重启应用后生效。' : ''),
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

    // ── /queue 命令 ────────────────────────────────────────
    if (text === '/queue') {
      if (queueSize === 0) {
        appendCommandMessage(setMessages, '队列为空，无待发送消息。');
        return;
      }
      setSelectedIndex(0);
      setViewMode('queue-list');
      return;
    }
    if (text === '/queue clear') {
      const count = queueSize;
      queueClear();
      appendCommandMessage(setMessages, count > 0 ? `已清空 ${count} 条排队消息。` : '队列已为空。');
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

    if (text === '/compact') {
      onSummarize().then((result) => {
        if (!result.ok) {
          appendCommandMessage(setMessages, result.message, { isError: true });
        }
      }).catch((err: any) => {
        appendCommandMessage(setMessages, `Context compression failed: ${err.message ?? err}`, { isError: true });
      });
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
    onNewSession,
    onRedo,
    onResetConfig,
    onRunCommand,
    onSubmit,
    onSwitchAgent,
    onSwitchModel,
    onSummarize,
    onUndo,
    queueClear,
    queueSize,
    setConfirmChoice,
    setMessages,
    setModelList,
    setPendingConfirm,
    setSelectedIndex,
    setSessionList,
    setSettingsInitialSection,
    setViewMode,
    undoRedoRef,
  ]);
}
