export interface MessageMeta {
  tokenIn?: number;
  tokenOut?: number;
  isSummary?: boolean;
  createdAt?: number;
  durationMs?: number;
  streamOutputDurationMs?: number;
  modelName?: string;
}

export interface SwitchModelResult {
  ok: boolean;
  message: string;
  modelId?: string;
  modelName?: string;
  contextWindow?: number;
}

export type ViewMode = 'chat' | 'session-list' | 'model-list' | 'settings' | 'queue-list';
export type SettingsInitialSection = 'general' | 'mcp';
export type ConfirmChoice = 'confirm' | 'cancel';
export type ApprovalChoice = 'approve' | 'reject';
export type ApprovalDiffView = 'unified' | 'split';
export type ApprovalDiffWrapMode = 'none' | 'word';

export interface PendingConfirm {
  message: string;
  action: () => void;
}
