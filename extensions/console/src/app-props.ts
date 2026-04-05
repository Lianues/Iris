import type { IrisModelInfoLike as LLMModelInfo, IrisSessionMetaLike as SessionMeta } from '@irises/extension-sdk';
import type { ConsoleSettingsTabDefinition } from '@irises/extension-sdk/plugin';
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
  onListModels: () => LLMModelInfo[];
  onSwitchModel: (modelName: string) => SwitchModelResult;
  onLoadSettings: () => Promise<ConsoleSettingsSnapshot>;
  onSaveSettings: (snapshot: ConsoleSettingsSnapshot) => Promise<ConsoleSettingsSaveResult>;
  onResetConfig: () => Promise<{ success: boolean; message: string }>;
  onExit: () => void;
  onSummarize: () => Promise<{ ok: boolean; message: string }>;
  onSwitchAgent?: () => void;
  onThinkingEffortChange?: (level: ThinkingEffortLevel) => void;
  agentName?: string;
  /** 初始化过程中的警告信息（首屏展示） */
  initWarnings?: string[];
  modeName?: string;
  modelId: string;
  modelName: string;
  contextWindow?: number;
  /** 插件注册的 Console Settings Tab 列表（由 ConsolePlatform 从 IrisAPI 获取后注入） */
  pluginSettingsTabs?: ConsoleSettingsTabDefinition[];
}
