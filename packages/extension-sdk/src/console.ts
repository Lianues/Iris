import type { Disposable } from './plugin.js';

// --------------------------- Console extension service contracts ---------------------------
//
// These contracts are intentionally kept in the public SDK so other extensions can integrate
// with the Console UI without importing files from extensions/console/src/**. The Console
// extension provides the concrete service implementations; third-party extensions should only
// depend on these stable service IDs and structural interfaces.

export const CONSOLE_SETTINGS_TAB_SERVICE_ID = 'console:settings-tab';
export const CONSOLE_SLASH_COMMAND_SERVICE_ID = 'console:slash-command';
export const CONSOLE_PATH_DISPLAY_SERVICE_ID = 'console:path-display';
export const CONSOLE_STATUS_SEGMENT_SERVICE_ID = 'console:status-segment';
export const CONSOLE_TOOL_DISPLAY_SERVICE_ID = 'console:tool-display';
export const CONSOLE_PROGRESS_SERVICE_ID = 'console:progress';
export const CONSOLE_INPUT_SERVICE_ID = 'console:input';

// --------------------------- Settings tabs ---------------------------

export interface ConsoleSettingsField {
  key: string;
  label: string;
  type: 'toggle' | 'number' | 'text' | 'select' | 'readonly' | 'action';
  options?: { label: string; value: string }[];
  defaultValue?: unknown;
  description?: string;
  group?: string;
}

export interface ConsoleSettingsActionResult {
  success: boolean;
  message?: string;
  error?: string;
  data?: unknown;
  /** Optional value patch to merge back into the current settings draft after an action. */
  patch?: Record<string, unknown>;
}

export interface ConsoleSettingsTabDefinition {
  id: string;
  label: string;
  icon?: string;
  fields: ConsoleSettingsField[];
  onLoad: () => Promise<Record<string, unknown>>;
  onSave: (values: Record<string, unknown>) => Promise<{ success: boolean; error?: string }>;
  onAction?: (actionKey: string, values: Record<string, unknown>) => Promise<ConsoleSettingsActionResult> | ConsoleSettingsActionResult;
}

export interface ConsoleSettingsTabService {
  register(tab: ConsoleSettingsTabDefinition): Disposable;
  list(): ConsoleSettingsTabDefinition[];
  onDidChange(listener: () => void): Disposable;
}

// --------------------------- Slash commands ---------------------------

export interface ConsoleCommandArgSuggestion {
  value: string;
  description?: string;
  color?: string;
}

export interface ConsoleSlashCommandListItem {
  name: string;
  description: string;
  acceptsArgs?: boolean;
  getArgSuggestions?: (input: { arg: string; raw: string }) => ConsoleCommandArgSuggestion[];
  remoteOnly?: boolean;
  requiresHeadlessSupport?: boolean;
  color?: string;
}

export interface ConsoleSlashCommandResult {
  message?: string;
  isError?: boolean;
  label?: string;
}

export interface ConsoleSlashCommandHandlerInput {
  raw: string;
  name: string;
  arg: string;
  /** Console current session id. UI slash commands are outside Backend turn context. */
  sessionId?: string;
}

export type ConsoleSlashCommandDispatchContext = Pick<ConsoleSlashCommandHandlerInput, 'sessionId'>;

export interface ConsoleSlashCommandDefinition extends ConsoleSlashCommandListItem {
  handle(input: ConsoleSlashCommandHandlerInput): ConsoleSlashCommandResult | Promise<ConsoleSlashCommandResult | void> | void;
}

export interface ConsoleSlashCommandService {
  register(command: ConsoleSlashCommandDefinition): Disposable;
  list(): ConsoleSlashCommandListItem[];
  canHandle(raw: string): boolean;
  dispatch(raw: string, context?: ConsoleSlashCommandDispatchContext): Promise<ConsoleSlashCommandResult | undefined>;
  onDidChange(listener: () => void): Disposable;
}

// --------------------------- Input bridge ---------------------------

export interface ConsoleInputService {
  insertText(text: string): boolean;
  setText(text: string): boolean;
  clear(): boolean;
  hasValue(): boolean;
  onDidChange(listener: () => void): Disposable;
}

// --------------------------- Path/status display ---------------------------

export interface ConsolePathDisplayContext {
  sessionId?: string;
}

export type ConsolePathDisplayColor = 'dim' | 'accent' | 'warn' | 'error' | string;

export interface ConsolePathDisplaySnapshot {
  id: string;
  path: string;
  color?: ConsolePathDisplayColor;
  priority?: number;
}

export interface ConsolePathDisplayProvider {
  id: string;
  priority?: number;
  getSnapshot(context: ConsolePathDisplayContext): ConsolePathDisplaySnapshot | undefined;
  onDidChange?(listener: () => void): Disposable;
}

export interface ConsolePathDisplayService {
  register(provider: ConsolePathDisplayProvider): Disposable;
  resolve(context?: ConsolePathDisplayContext): ConsolePathDisplaySnapshot | undefined;
  onDidChange(listener: () => void): Disposable;
}

export interface ConsoleStatusContext {
  sessionId?: string;
}

export type ConsoleStatusSegmentColor = 'dim' | 'accent' | 'warn' | 'error' | string;

export interface ConsoleStatusSegmentSnapshot {
  id: string;
  text: string;
  color?: ConsoleStatusSegmentColor;
  priority?: number;
  align?: 'left' | 'right';
}

export interface ConsoleStatusSegmentProvider {
  id: string;
  align?: 'left' | 'right';
  priority?: number;
  getSnapshot(context: ConsoleStatusContext): ConsoleStatusSegmentSnapshot | undefined;
  onDidChange?(listener: () => void): Disposable;
}

export interface ConsoleStatusSegmentService {
  register(provider: ConsoleStatusSegmentProvider): Disposable;
  list(context?: ConsoleStatusContext, align?: 'left' | 'right'): ConsoleStatusSegmentSnapshot[];
  onDidChange(listener: () => void): Disposable;
}

// --------------------------- Tool display ---------------------------

export interface ConsoleToolDisplayProvider {
  getArgsSummary?(input: {
    toolName: string;
    args: Record<string, unknown>;
  }): string | undefined;
  getArgsSummaryAsync?(input: { toolName: string; args: Record<string, unknown> }): Promise<string | undefined>;

  getProgressLine?(input: {
    toolName: string;
    args: Record<string, unknown>;
    progress?: Record<string, unknown>;
  }): string | undefined;
  getProgressLineAsync?(input: { toolName: string; args: Record<string, unknown>; progress?: Record<string, unknown> }): Promise<string | undefined>;

  getResultSummary?(input: {
    toolName: string;
    args: Record<string, unknown>;
    result: unknown;
  }): string | undefined;
  getResultSummaryAsync?(input: { toolName: string; args: Record<string, unknown>; result: unknown }): Promise<string | undefined>;
}

export interface ConsoleToolDisplayService {
  register(toolName: string, provider: ConsoleToolDisplayProvider): Disposable;
  get(toolName: string): ConsoleToolDisplayProvider | undefined;
  list(): string[];
}

// --------------------------- Progress panel ---------------------------

export type ConsoleProgressStatusLike = 'pending' | 'in_progress' | 'completed' | 'blocked' | 'cancelled';

export interface ConsoleProgressItemLike {
  title: string;
  description?: string;
  activeForm?: string;
  status: ConsoleProgressStatusLike;
  metadata?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface ConsoleProgressSnapshotLike {
  sessionId: string;
  items: ConsoleProgressItemLike[];
  stats: {
    total: number;
    pending: number;
    inProgress: number;
    completed: number;
    blocked: number;
    cancelled: number;
    open: number;
  };
  updatedAt: number;
}

export interface ConsoleProgressArchiveLike {
  id: string;
  snapshot: ConsoleProgressSnapshotLike;
  archivedAt: number;
  afterHistoryIndex: number;
}

export interface ConsoleProgressUiStateLike {
  expanded: boolean;
  updatedAt?: number;
  snapshotUpdatedAt?: number;
}

export interface ConsoleProgressProvider {
  id: string;
  priority?: number;
  loadLatest(sessionId: string): Promise<ConsoleProgressSnapshotLike | undefined> | ConsoleProgressSnapshotLike | undefined;
  loadHistory?(sessionId: string): Promise<ConsoleProgressArchiveLike[]> | ConsoleProgressArchiveLike[];
  loadUiState?(sessionId: string): Promise<ConsoleProgressUiStateLike | undefined> | ConsoleProgressUiStateLike | undefined;
  saveUiState?(sessionId: string, state: { expanded: boolean; snapshotUpdatedAt?: number }): Promise<void> | void;
  onDidUpdate?(listener: (sessionId: string, snapshot: ConsoleProgressSnapshotLike) => void): Disposable;
}

export interface ConsoleProgressService {
  register(provider: ConsoleProgressProvider): Disposable;
  getProvider(id: string): ConsoleProgressProvider | undefined;
  getActiveProvider(): ConsoleProgressProvider | undefined;
  listProviders(): ConsoleProgressProvider[];
  onDidChange(listener: () => void): Disposable;
  onDidUpdate(listener: (providerId: string, sessionId: string, snapshot: ConsoleProgressSnapshotLike) => void): Disposable;
}
