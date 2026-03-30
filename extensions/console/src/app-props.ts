import type { IrisModelInfoLike as LLMModelInfo, IrisSessionMetaLike as SessionMeta, ToolPreviewUtilsLike } from '@irises/extension-sdk';
import type { SwitchModelResult } from './app-types';
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
  agentName?: string;
  /** 初始化过程中的警告信息（首屏展示） */
  initWarnings?: string[];
  modeName?: string;
  modelId: string;
  modelName: string;
  contextWindow?: number;
  toolPreviewUtils?: ToolPreviewUtilsLike;
}
