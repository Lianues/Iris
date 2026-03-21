import type { LLMModelInfo } from '../../llm/router';
import type { SessionMeta } from '../../storage/base';
import type { WindowInfo } from '../../computer-use/types';
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
  /** Computer Use 窗口列表（仅 CU screen 模式下提供） */
  onListWindows?: () => Promise<WindowInfo[]>;
  /** Computer Use 切换窗口（仅 CU screen 模式下提供） */
  onSwitchWindow?: (hwnd: string) => Promise<{ ok: boolean; message: string }>;
  onSwitchAgent?: () => void;
  agentName?: string;
  /** Computer Use 是否启用（控制 /window 指令在自动补全中的可见性） */
  hasComputerUse?: boolean;
  /** 初始化过程中的警告信息（首屏展示） */
  initWarnings?: string[];
  modeName?: string;
  modelId: string;
  modelName: string;
  contextWindow?: number;
}
