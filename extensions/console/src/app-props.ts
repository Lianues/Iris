import type { IrisModelInfoLike as LLMModelInfo, IrisSessionMetaLike as SessionMeta } from 'irises-extension-sdk';
import type { MemoryItem } from './components/MemoryListView';
import type { ExtensionItem } from './components/ExtensionListView';
import type { AgentDefinitionLike } from 'irises-extension-sdk';
import type { ConsoleSettingsTabDefinition } from 'irises-extension-sdk/plugin';
import type { SwitchModelResult, ThinkingEffortLevel } from './app-types';
import type { AppHandle } from './hooks/use-app-handle';
import type { ConsoleSettingsSaveResult, ConsoleSettingsSnapshot } from './settings';

export interface AppProps {
  onReady: (handle: AppHandle) => void;
  onSubmit: (text: string) => void;
  onUndo: () => Promise<boolean>;
  onRedo: () => Promise<boolean>;
  onClearRedoStack: () => void;
  onToolApproval: (toolId: string, approved: boolean) => void;
  onToolApply: (toolId: string, applied: boolean) => void;
  /** shell/bash 审批中用户选择"始终允许"或"始终询问"时，持久化命令模式 */
  onAddCommandPattern?: (toolName: string, command: string, type: 'allow' | 'deny') => void;
  onAbort: () => void;
  /** 用户请求打开工具详情 */
  onOpenToolDetail: (toolId: string) => void;
  /** 用户在详情页请求查看子工具 */
  onNavigateToolDetail: (toolId: string) => void;
  /** 用户关闭工具详情（返回上一层或退出） */
  onCloseToolDetail: () => void;
  onNewSession: () => void;
  onLoadSession: (id: string) => Promise<void>;
  onListSessions: () => Promise<SessionMeta[]>;
  onRunCommand: (cmd: string) => { output: string; cwd: string };
  onListModels: () => { models: LLMModelInfo[]; defaultModelName: string };
  onSwitchModel: (modelName: string) => SwitchModelResult;
  onSetDefaultModel?: (modelName: string) => Promise<{ ok: boolean; message: string }>;
  onUpdateModelEntry?: (
    currentModelName: string,
    updates: { modelName?: string; contextWindow?: number | null },
  ) => Promise<{ ok: boolean; message: string; updatedModelName?: string }>;
  onLoadSettings: () => Promise<ConsoleSettingsSnapshot>;
  onSaveSettings: (snapshot: ConsoleSettingsSnapshot) => Promise<ConsoleSettingsSaveResult>;
  onResetConfig: () => Promise<{ success: boolean; message: string }>;
  onExit: () => void;
  onSummarize: () => Promise<{ ok: boolean; message: string }>;
  /** 获取可切换的 Agent 列表（/agent 命令触发） */
  onListAgents?: () => AgentDefinitionLike[];
  /** 用户在 agent-list 视图中确认选择后，执行实际的 Agent 切换 */
  onSelectAgent?: (agentName: string) => void;
  onDream?: () => Promise<{ ok: boolean; message: string }>;
  onListMemories?: () => Promise<MemoryItem[]>;
  onDeleteMemory?: (id: number) => Promise<boolean>;
  onListExtensions?: () => Promise<ExtensionItem[]>;
  onToggleExtension?: (name: string) => Promise<{ ok: boolean; message: string }>;
  onRemoteConnect?: (name?: string) => void;
  onRemoteDisconnect?: () => void;
  /** 远程连接的主机地址（非空时 StatusBar 显示远程标识） */
  remoteHost?: string;
  onThinkingEffortChange?: (level: ThinkingEffortLevel) => void;
  agentName?: string;
  /** 初始化过程中的提示信息（首屏展示） */
  initWarnings?: string[];
  /** initWarnings 的颜色（默认黄色警告） */
  initWarningsColor?: string;
  /** initWarnings 的图标（默认 ⚠） */
  initWarningsIcon?: string;
  modeName?: string;
  modelId: string;
  modelName: string;
  contextWindow?: number;
  /** 插件注册的 Console Settings Tab 列表（由 ConsolePlatform 从 IrisAPI 获取后注入） */
  pluginSettingsTabs?: ConsoleSettingsTabDefinition[];
}
