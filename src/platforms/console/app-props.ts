import type { LLMModelInfo } from '../../llm/router';
import type { SessionMeta } from '../../storage/base';
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
  onResetConfig: () => { success: boolean; message: string };
  onExit: () => void;
  onSwitchAgent?: () => void;
  agentName?: string;
  modeName?: string;
  modelId: string;
  modelName: string;
  contextWindow?: number;
}
