import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { AgentDefinitionLike } from 'irises-extension-sdk';
import type { IrisModelInfoLike as LLMModelInfo, IrisSessionMetaLike as SessionMeta } from 'irises-extension-sdk';
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
import type { MemoryItem, MemoryFilter } from '../components/MemoryListView';
import { canHandleSlashCommand, dispatchSlashCommand } from '../slash-command-service';

type SetMessages = Dispatch<SetStateAction<ChatMessage[]>>;
type SetMemoryList = Dispatch<SetStateAction<MemoryItem[]>>;

type SetViewMode = Dispatch<SetStateAction<ViewMode>>;
type SetSessionList = Dispatch<SetStateAction<SessionMeta[]>>;
type SetModelList = Dispatch<SetStateAction<LLMModelInfo[]>>;
type SetAgentList = Dispatch<SetStateAction<AgentDefinitionLike[]>>;
type SetSelectedIndex = Dispatch<SetStateAction<number>>;
type SetPendingConfirm = Dispatch<SetStateAction<PendingConfirm | null>>;
type SetConfirmChoice = Dispatch<SetStateAction<ConfirmChoice>>;
type SetSettingsInitialSection = Dispatch<SetStateAction<SettingsInitialSection>>;

interface UseCommandDispatchOptions {
  onSubmit: (text: string) => void;
  /** 当前是否正在生成；用于把命令反馈插到活跃 assistant 回复之前，避免破坏流式挂载目标 */
  isGenerating?: boolean;
  /** 附加文件（图片/文档/音频/视频）到下一条消息 */
  onFileAttach: (filePath: string) => void;
  /** 打开文件浏览器视图 */
  onOpenFileBrowser: () => void;
  onUndo: () => Promise<boolean>;
  onRedo: () => Promise<boolean>;
  onClearRedoStack: () => void;
  onNewSession: () => void;
  onListSessions: () => Promise<SessionMeta[]>;
  onRunCommand: (cmd: string) => { output: string; cwd: string };
  onListModels: () => { models: LLMModelInfo[]; defaultModelName: string };
  onSwitchModel: (modelName: string) => SwitchModelResult;
  onResetConfig: () => Promise<{ success: boolean; message: string }>;
  onExit: () => void;
  onEnterHeadless?: () => void;
  onSummarize: () => Promise<{ ok: boolean; message: string }>;
  /** 获取可切换的 Agent 列表，返回后由 /agent 命令切换到 agent-list 视图 */
  onListAgents?: () => AgentDefinitionLike[];
  onPlanCommand?: (arg: string) => Promise<{ ok: boolean; message: string; followupPrompt?: string }>;
  onAutoEditCommand?: (arg: string) => Promise<{ ok: boolean; message: string }>;
  onCallmeCommand?: (arg: string) => Promise<{ ok: boolean; message: string }>;
  setAgentList: SetAgentList;
  onDream?: () => Promise<{ ok: boolean; message: string }>;
  onListMemories?: () => Promise<MemoryItem[]>;
  setMemoryList: SetMemoryList;
  setMemoryFilter: Dispatch<SetStateAction<MemoryFilter>>;
  setMemoryExpandedId: Dispatch<SetStateAction<number | null>>;
  setMemoryPendingDeleteId: Dispatch<SetStateAction<number | null>>;
  onListExtensions?: () => Promise<any[]>;
  setExtensionList: Dispatch<SetStateAction<any[]>>;
  canOpenLoverSettings?: boolean;
  onRemoteConnect?: (name?: string) => void;
  onRemoteDisconnect?: () => void;
  isRemote?: boolean;
  remoteHost?: string;
  undoRedoRef: MutableRefObject<UndoRedoStack>;
  setMessages: SetMessages;
  commitTools: () => void;
  setViewMode: SetViewMode;
  setSessionList: SetSessionList;
  setModelList: SetModelList;
  setDefaultModelName: Dispatch<SetStateAction<string>>;
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
  isGenerating,
  onFileAttach,
  onOpenFileBrowser,
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
  onEnterHeadless,
  onListAgents,
  onPlanCommand,
  onAutoEditCommand,
  onCallmeCommand,
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
  isRemote,
  remoteHost,
  onSummarize,
  undoRedoRef,
  setMessages,
  commitTools,
  setViewMode,
  setSessionList,
  setModelList,
  setDefaultModelName,
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

    if (text === '/headless' || text === '/detach') {
      if (onEnterHeadless) {
        onEnterHeadless();
      } else {
        appendCommandMessage(setMessages, '当前运行环境不支持切换到无头后台模式。');
      }
      return;
    }

    if (text === '/agent') {
      // 修改方式：/agent 不再直接触发 suspend/destroy，改为在 TUI 内部切换 viewMode。
      // 与 /model、/load 同样的模式：拿列表 → 设置状态 → 切换视图。
      if (onListAgents) {
        const agents = onListAgents();
        if (agents.length > 0) {
          setAgentList(agents);
          setSelectedIndex(0);
          setViewMode('agent-list');
          return;
        }
      }
      appendCommandMessage(
        setMessages,
        '当前只有一个 Agent，无需切换。',
      );
      return;
    }

    if (text === '/disconnect' || text === '/remote disconnect') {
      if (!isRemote) {
        appendCommandMessage(setMessages, '当前未连接远程实例。');
        return;
      }
      if (onRemoteDisconnect) {
        onRemoteDisconnect();
        return;
      }
      return;
    }
    if (text === '/remote' || text === '/remote ') {
      if (isRemote) {
        appendCommandMessage(setMessages,
          `当前已连接远程实例: ${remoteHost}\n输入 /disconnect 断开连接。`);
        return;
      }
      if (onRemoteConnect) {
        onRemoteConnect();
        return;
      }
      appendCommandMessage(setMessages, '远程连接功能不可用。');
      return;
    }
    if (text.startsWith('/remote ') && text !== '/remote disconnect') {
      const name = text.slice(8).trim();
      if (name) {
        if (onRemoteConnect) { onRemoteConnect(name); }
        return;
      }
      // /remote + 多余空格 → 同 /remote
      if (onRemoteConnect && !isRemote) { onRemoteConnect(); }
      return;
    }

    if (text === '/net') {
      setSettingsInitialSection('net');
      setViewMode('settings');
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

    if (text === '/lover') {
      if (!canOpenLoverSettings) {
        appendCommandMessage(setMessages, 'Virtual Lover 扩展未启用。', { isError: true });
        return;
      }
      setSettingsInitialSection('virtual-lover');
      setViewMode('settings');
      return;
    }

    if (text === '/settings' || text === '/mcp') {
      setSettingsInitialSection(text === '/mcp' ? 'mcp' : 'general');
      setViewMode('settings');
      return;
    }

    // ── /memory 命令 — 显示记忆列表 ──
    if (text === '/memory') {
      if (!onListMemories) {
        appendCommandMessage(setMessages, 'Memory system not enabled.');
        return;
      }
      void onListMemories().then((list) => {
        setMemoryList(list);
        setMemoryFilter('all');
        setMemoryExpandedId(null);
        setMemoryPendingDeleteId(null);
        setSelectedIndex(0);
        setViewMode('memory-list');
      }).catch((err) => {
        appendCommandMessage(setMessages, `Failed to load memories: ${err}`, { isError: true });
      });
      return;
    }

    // ── /extension 命令 — 显示扩展列表 ──
    if (text === '/extension') {
      if (!onListExtensions) {
        appendCommandMessage(setMessages, 'Extension management not available.');
        return;
      }
      void onListExtensions().then((list) => {
        setExtensionList(list);
        setSelectedIndex(0);
        setViewMode('extension-list');
      }).catch((err) => {
        appendCommandMessage(setMessages, `Failed to load extensions: ${err}`, { isError: true });
      });
      return;
    }

    // ── /dream 命令 — 手动触发记忆归纳整理 ──
    if (text === '/dream') {
      if (!onDream) {
        appendCommandMessage(setMessages, '记忆系统未启用。请先在 /memory 中开启。');
        return;
      }
      appendCommandMessage(setMessages, 'Iris 做梦中...');
      void onDream().then(async ({ ok, message }) => {
        appendCommandMessage(setMessages, message, ok ? undefined : { isError: true });
        // 归纳完成后自动打开记忆列表
        if (ok && onListMemories) {
          try {
            const list = await onListMemories();
            setMemoryList(list);
            setMemoryFilter('all');
            setMemoryExpandedId(null);
            setMemoryPendingDeleteId(null);
            setSelectedIndex(0);
            setViewMode('memory-list');
          } catch { /* ignore */ }
        }
      }).catch((err) => {
        appendCommandMessage(setMessages, `归纳失败: ${err}`, { isError: true });
      });
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
        const { models, defaultModelName } = onListModels();
        setModelList(models);
        setDefaultModelName(defaultModelName);
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

    if (text === '/callme' || text.startsWith('/callme ')) {
      const arg = text.slice('/callme'.length).trim();
      if (!onCallmeCommand) {
        appendCommandMessage(setMessages, '/callme 服务不可用。', { isError: true, label: 'callme' });
        return;
      }
      void onCallmeCommand(arg).then((result) => {
        appendCommandMessage(
          setMessages,
          result.message,
          result.ok ? { label: 'callme' } : { isError: true, label: 'callme' },
        );
      }).catch((err) => {
        appendCommandMessage(
          setMessages,
          `/callme 操作失败: ${err instanceof Error ? err.message : String(err)}`,
          { isError: true, label: 'callme' },
        );
      });
      return;
    }

    if (text === '/auto-edit' || text.startsWith('/auto-edit ')) {
      const arg = text.slice('/auto-edit'.length).trim();
      const messageOptions = { label: '自动编辑' as const, beforeActiveAssistant: isGenerating };
      if (!onAutoEditCommand) {
        appendCommandMessage(setMessages, '自动编辑服务不可用。', { ...messageOptions, isError: true });
        return;
      }
      void onAutoEditCommand(arg).then((result) => {
        appendCommandMessage(setMessages, result.message, result.ok ? messageOptions : { ...messageOptions, isError: true });
      }).catch((err) => {
        appendCommandMessage(
          setMessages,
          `自动编辑操作失败: ${err instanceof Error ? err.message : String(err)}`,
          { ...messageOptions, isError: true },
        );
      });
      return;
    }

    if (text === '/plan' || text.startsWith('/plan ')) {
      const arg = text.slice('/plan'.length).trim();
      const planMessageOptions = { label: 'plan' as const, beforeActiveAssistant: isGenerating };
      if (!onPlanCommand) {
        appendCommandMessage(setMessages, 'Plan Mode 服务不可用。', { ...planMessageOptions, isError: true });
        return;
      }
      void onPlanCommand(arg).then((result) => {
        appendCommandMessage(setMessages, result.message, result.ok ? planMessageOptions : { ...planMessageOptions, isError: true });
        if (result.ok && result.followupPrompt) {
          onSubmit(result.followupPrompt);
        }
      }).catch((err) => {
        appendCommandMessage(
          setMessages,
          `Plan Mode 操作失败: ${err instanceof Error ? err.message : String(err)}`,
          { ...planMessageOptions, isError: true },
        );
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

    // ── /file 命令 — 附加文件到下一条消息 ──
    if (text.startsWith('/file ') || text === '/file') {
      const filePath = text.slice(6).trim();
      if (!filePath) {
        // 无参数 → 打开文件浏览器
        onOpenFileBrowser();
        return;
      }
      if (filePath === 'clear') {
        // /file clear → 清空所有待发送附件
        onFileAttach('__clear__');
        return;
      }
      // 有参数 → 直接附加指定路径
      onFileAttach(filePath);
      return;
    }

    if (text.startsWith('/') && canHandleSlashCommand(text)) {
      void dispatchSlashCommand(text).then((result) => {
        if (!result?.message) return;
        appendCommandMessage(setMessages, result.message, {
          isError: result.isError,
          label: result.label ?? 'cmd',
        });
      }).catch((err) => {
        appendCommandMessage(
          setMessages,
          `指令执行失败: ${err instanceof Error ? err.message : String(err)}`,
          { isError: true, label: 'cmd' },
        );
      });
      return;
    }

    resetRedo(undoRedoRef, onClearRedoStack);
    onSubmit(text);
  }, [
    commitTools,
    onFileAttach,
    onOpenFileBrowser,
    modelState,
    onClearRedoStack,
    onExit,
    onEnterHeadless,
    onListModels,
    onListSessions,
    onNewSession,
    onRedo,
    onRemoteConnect,
    onRemoteDisconnect,
    isRemote,
    remoteHost,
    onResetConfig,
    isGenerating,
    onRunCommand,
    onSubmit,
    onListAgents,
    setAgentList,
    onDream,
    onSwitchModel,
    onSummarize,
    onPlanCommand,
    onAutoEditCommand,
    onCallmeCommand,
    onUndo,
    queueClear,
    queueSize,
    setConfirmChoice,
    setMessages,
    setModelList,
    setDefaultModelName,
    setPendingConfirm,
    setSelectedIndex,
    setSessionList,
    setSettingsInitialSection,
    setViewMode,
    undoRedoRef,
  ]);
}
