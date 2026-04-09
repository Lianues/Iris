import type { ToolInvocation, ToolOutputEntry } from '@irises/extension-sdk';

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

export type ViewMode = 'chat' | 'session-list' | 'model-list' | 'agent-list' | 'settings' | 'queue-list' | 'tool-detail' | 'tool-list' | 'memory-list';
// 放宽为 string：插件可通过 registerConsoleSettingsTab 注册自定义 tab id
export type SettingsInitialSection = 'general' | 'mcp' | (string & {});
export type ConfirmChoice = 'confirm' | 'cancel';
export type ApprovalChoice = 'approve' | 'reject';
export type ApprovalDiffView = 'unified' | 'split';
export type ApprovalDiffWrapMode = 'none' | 'word';

export interface PendingConfirm {
  message: string;
  action: () => void;
}

export type ThinkingEffortLevel = 'none' | 'low' | 'medium' | 'high' | 'max';

/** 工具执行细节页面数据 */
export interface ToolDetailData {
  /** 当前查看的工具快照 */
  invocation: ToolInvocation;
  /** 输出历史 */
  output: ToolOutputEntry[];
  /** 子工具快照列表 */
  children: ToolInvocation[];
}

/** 工具详情导航栈条目 */
export interface ToolDetailBreadcrumb {
  toolId: string;
  toolName: string;
}
