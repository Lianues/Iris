import type { IPCClientLike } from 'irises-extension-sdk/ipc';
import { Methods } from 'irises-extension-sdk/ipc';
import type { Command } from './input-commands';
import type { ConsolePathDisplayContext, ConsolePathDisplaySnapshot } from './path-display-service';
import type { ConsoleProgressArchiveLike, ConsoleProgressUiStateLike } from './progress-service';
import type { ProgressSnapshotLike } from './progress-types';
import type { ConsoleSettingsTabDefinition } from './settings-tab-service';
import type { ConsoleSlashCommandDispatchContext, ConsoleSlashCommandResult } from './slash-command-service';
import type { ConsoleStatusContext, ConsoleStatusSegmentSnapshot } from './status-segment-service';

export const CONSOLE_GET_SETTINGS_TABS_METHOD = 'console.getSettingsTabs';
export const CONSOLE_LIST_SLASH_COMMANDS_METHOD = 'console.listSlashCommands';
export const CONSOLE_DISPATCH_SLASH_COMMAND_METHOD = 'console.dispatchSlashCommand';
export const CONSOLE_RESOLVE_PATH_DISPLAY_METHOD = 'console.resolvePathDisplay';
export const CONSOLE_LIST_STATUS_SEGMENTS_METHOD = 'console.listStatusSegments';
export const CONSOLE_RENDER_TOOL_DISPLAY_METHOD = 'console.renderToolDisplay';
export const CONSOLE_PROGRESS_LOAD_LATEST_METHOD = 'console.progress.loadLatest';
export const CONSOLE_PROGRESS_LOAD_HISTORY_METHOD = 'console.progress.loadHistory';
export const CONSOLE_PROGRESS_LOAD_UI_STATE_METHOD = 'console.progress.loadUiState';
export const CONSOLE_PROGRESS_SAVE_UI_STATE_METHOD = 'console.progress.saveUiState';

export interface ConsoleRemoteBridgeApi {
  initCaches?(): Promise<void>;
  __consoleGetSettingsTabs?(): unknown[];
  __consoleGetSlashCommands?(): Command[];
  __consoleDispatchSlashCommand?(raw: string, context?: ConsoleSlashCommandDispatchContext): Promise<ConsoleSlashCommandResult | undefined>;
  __consoleResolvePathDisplay?(context?: ConsolePathDisplayContext): Promise<ConsolePathDisplaySnapshot | undefined>;
  __consoleListStatusSegments?(context?: ConsoleStatusContext, align?: 'left' | 'right'): Promise<ConsoleStatusSegmentSnapshot[]>;
  __consoleRenderToolDisplay?(toolName: string, kind: 'args' | 'progress' | 'result', input: Record<string, unknown>): Promise<string | undefined>;
  __consoleLoadLatestProgress?(sessionId: string): Promise<ProgressSnapshotLike | undefined>;
  __consoleLoadProgressHistory?(sessionId: string): Promise<ConsoleProgressArchiveLike[]>;
  __consoleLoadProgressUiState?(sessionId: string): Promise<ConsoleProgressUiStateLike | undefined>;
  __consoleSaveProgressUiState?(sessionId: string, state: { expanded: boolean; snapshotUpdatedAt?: number }): Promise<void>;
}

export function hasConsoleRemoteBridge(api: unknown): api is ConsoleRemoteBridgeApi {
  return typeof (api as ConsoleRemoteBridgeApi | undefined)?.__consoleDispatchSlashCommand === 'function';
}

export function getCachedConsoleRemoteSettingsTabs(api: unknown): ConsoleSettingsTabDefinition[] {
  const tabs = (api as Partial<ConsoleRemoteBridgeApi> | undefined)?.__consoleGetSettingsTabs?.();
  return Array.isArray(tabs) ? tabs as ConsoleSettingsTabDefinition[] : [];
}

export function getCachedConsoleRemoteSlashCommands(api: unknown): Command[] {
  const commands = (api as Partial<ConsoleRemoteBridgeApi> | undefined)?.__consoleGetSlashCommands?.();
  return Array.isArray(commands) ? commands as Command[] : [];
}

export function attachConsoleRemoteBridge<T extends Record<string, any>>(
  api: T,
  client: IPCClientLike,
  options?: { targetAgentName?: string },
): T & ConsoleRemoteBridgeApi {
  const targetAgentName = options?.targetAgentName;
  let cachedSettingsTabs: unknown[] = [];
  let cachedSlashCommands: Command[] = [];
  const originalInitCaches = typeof api.initCaches === 'function'
    ? api.initCaches.bind(api)
    : undefined;

  const callBridge = (method: string, params?: unknown[]): Promise<unknown> => {
    if (!targetAgentName) {
      return client.call(method, params);
    }
    return client.call(Methods.AGENT_API_CALL, [targetAgentName, method, params ?? []]);
  };

  const bridge: ConsoleRemoteBridgeApi = {
    __consoleGetSettingsTabs() {
      return cachedSettingsTabs;
    },
    __consoleGetSlashCommands() {
      return cachedSlashCommands;
    },
    __consoleDispatchSlashCommand(raw: string, context?: ConsoleSlashCommandDispatchContext) {
      return callBridge(CONSOLE_DISPATCH_SLASH_COMMAND_METHOD, [raw, context]) as Promise<ConsoleSlashCommandResult | undefined>;
    },
    __consoleResolvePathDisplay(context?: ConsolePathDisplayContext) {
      return callBridge(CONSOLE_RESOLVE_PATH_DISPLAY_METHOD, [context]) as Promise<ConsolePathDisplaySnapshot | undefined>;
    },
    __consoleListStatusSegments(context?: ConsoleStatusContext, align?: 'left' | 'right') {
      return callBridge(CONSOLE_LIST_STATUS_SEGMENTS_METHOD, [context, align]) as Promise<ConsoleStatusSegmentSnapshot[]>;
    },
    __consoleRenderToolDisplay(toolName: string, kind: 'args' | 'progress' | 'result', input: Record<string, unknown>) {
      return callBridge(CONSOLE_RENDER_TOOL_DISPLAY_METHOD, [toolName, kind, input]) as Promise<string | undefined>;
    },
    __consoleLoadLatestProgress(sessionId: string) {
      return callBridge(CONSOLE_PROGRESS_LOAD_LATEST_METHOD, [sessionId]) as Promise<ProgressSnapshotLike | undefined>;
    },
    __consoleLoadProgressHistory(sessionId: string) {
      return callBridge(CONSOLE_PROGRESS_LOAD_HISTORY_METHOD, [sessionId]) as Promise<ConsoleProgressArchiveLike[]>;
    },
    __consoleLoadProgressUiState(sessionId: string) {
      return callBridge(CONSOLE_PROGRESS_LOAD_UI_STATE_METHOD, [sessionId]) as Promise<ConsoleProgressUiStateLike | undefined>;
    },
    __consoleSaveProgressUiState(sessionId: string, state: { expanded: boolean; snapshotUpdatedAt?: number }) {
      return callBridge(CONSOLE_PROGRESS_SAVE_UI_STATE_METHOD, [sessionId, state]) as Promise<void>;
    },
    async initCaches() {
      await originalInitCaches?.();
      const [tabs, slashCommands] = await Promise.all([
        callBridge(CONSOLE_GET_SETTINGS_TABS_METHOD).catch(() => []),
        callBridge(CONSOLE_LIST_SLASH_COMMANDS_METHOD).catch(() => []),
      ]);
      cachedSettingsTabs = Array.isArray(tabs) ? tabs : [];
      cachedSlashCommands = Array.isArray(slashCommands) ? slashCommands as Command[] : [];
    },
  };

  return Object.assign(api, bridge);
}
