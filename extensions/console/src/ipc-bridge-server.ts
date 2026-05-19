import type {
  ConsolePathDisplayService,
  ConsoleProgressService,
  ConsoleSettingsTabService,
  ConsoleSlashCommandService,
  ConsoleStatusSegmentService,
  ConsoleToolDisplayService,
} from './service-contracts.js';
import {
  CONSOLE_PATH_DISPLAY_SERVICE_ID,
  CONSOLE_PROGRESS_SERVICE_ID,
  CONSOLE_SETTINGS_TAB_SERVICE_ID,
  CONSOLE_SLASH_COMMAND_SERVICE_ID,
  CONSOLE_STATUS_SEGMENT_SERVICE_ID,
  CONSOLE_TOOL_DISPLAY_SERVICE_ID,
} from './service-contracts.js';
import {
  CONSOLE_DISPATCH_SLASH_COMMAND_METHOD,
  CONSOLE_GET_SETTINGS_TABS_METHOD,
  CONSOLE_LIST_SLASH_COMMANDS_METHOD,
  CONSOLE_LIST_STATUS_SEGMENTS_METHOD,
  CONSOLE_PROGRESS_LOAD_HISTORY_METHOD,
  CONSOLE_PROGRESS_LOAD_LATEST_METHOD,
  CONSOLE_PROGRESS_LOAD_UI_STATE_METHOD,
  CONSOLE_PROGRESS_SAVE_UI_STATE_METHOD,
  CONSOLE_RENDER_TOOL_DISPLAY_METHOD,
  CONSOLE_RESOLVE_PATH_DISPLAY_METHOD,
} from './ipc-bridge.js';

export type ConsoleServiceApiLike = { services?: { get?<T>(id: string): T | undefined } } | undefined;

export function getConsoleService<T>(apiLike: ConsoleServiceApiLike, id: string): T | undefined {
  return apiLike?.services?.get?.<T>(id);
}

export function getConsoleSettingsTabService(apiLike: ConsoleServiceApiLike): ConsoleSettingsTabService | undefined {
  return getConsoleService<ConsoleSettingsTabService>(apiLike, CONSOLE_SETTINGS_TAB_SERVICE_ID);
}

export function getConsoleSlashCommandService(apiLike: ConsoleServiceApiLike): ConsoleSlashCommandService | undefined {
  return getConsoleService<ConsoleSlashCommandService>(apiLike, CONSOLE_SLASH_COMMAND_SERVICE_ID);
}

export function getConsolePathDisplayService(apiLike: ConsoleServiceApiLike): ConsolePathDisplayService | undefined {
  return getConsoleService<ConsolePathDisplayService>(apiLike, CONSOLE_PATH_DISPLAY_SERVICE_ID);
}

export function getConsoleStatusSegmentService(apiLike: ConsoleServiceApiLike): ConsoleStatusSegmentService | undefined {
  return getConsoleService<ConsoleStatusSegmentService>(apiLike, CONSOLE_STATUS_SEGMENT_SERVICE_ID);
}

export function getConsoleToolDisplayService(apiLike: ConsoleServiceApiLike): ConsoleToolDisplayService | undefined {
  return getConsoleService<ConsoleToolDisplayService>(apiLike, CONSOLE_TOOL_DISPLAY_SERVICE_ID);
}

export function getConsoleProgressProvider(apiLike: ConsoleServiceApiLike) {
  return getConsoleService<ConsoleProgressService>(apiLike, CONSOLE_PROGRESS_SERVICE_ID)?.getActiveProvider?.();
}

export function renderConsoleToolDisplay(apiLike: ConsoleServiceApiLike, toolName: string, mode: unknown, input: unknown): string | undefined {
  const toolDisplay = getConsoleToolDisplayService(apiLike);
  const provider = toolDisplay?.get?.(toolName);
  return mode === 'args' ? provider?.getArgsSummary?.(input as { toolName: string; args: Record<string, unknown> })
    : mode === 'progress' ? provider?.getProgressLine?.(input as { toolName: string; args: Record<string, unknown>; progress?: Record<string, unknown> })
    : mode === 'result' ? provider?.getResultSummary?.(input as { toolName: string; args: Record<string, unknown>; result: unknown })
    : undefined;
}

const CONSOLE_BRIDGE_METHOD_SET = new Set<string>([
  CONSOLE_GET_SETTINGS_TABS_METHOD,
  CONSOLE_LIST_SLASH_COMMANDS_METHOD,
  CONSOLE_DISPATCH_SLASH_COMMAND_METHOD,
  CONSOLE_RESOLVE_PATH_DISPLAY_METHOD,
  CONSOLE_LIST_STATUS_SEGMENTS_METHOD,
  CONSOLE_RENDER_TOOL_DISPLAY_METHOD,
  CONSOLE_PROGRESS_LOAD_LATEST_METHOD,
  CONSOLE_PROGRESS_LOAD_HISTORY_METHOD,
  CONSOLE_PROGRESS_LOAD_UI_STATE_METHOD,
  CONSOLE_PROGRESS_SAVE_UI_STATE_METHOD,
]);

export function isConsoleBridgeMethod(method: string): boolean {
  return CONSOLE_BRIDGE_METHOD_SET.has(method);
}

export async function dispatchConsoleBridgeMethod(apiLike: ConsoleServiceApiLike, method: string, params: unknown[]): Promise<unknown> {
  switch (method) {
    case CONSOLE_GET_SETTINGS_TABS_METHOD:
      return getConsoleSettingsTabService(apiLike)?.list?.() ?? [];
    case CONSOLE_LIST_SLASH_COMMANDS_METHOD:
      return getConsoleSlashCommandService(apiLike)?.list?.() ?? [];
    case CONSOLE_DISPATCH_SLASH_COMMAND_METHOD:
      return await getConsoleSlashCommandService(apiLike)?.dispatch?.(String(params[0] ?? ''), (params[1] ?? {}) as { sessionId?: string });
    case CONSOLE_RESOLVE_PATH_DISPLAY_METHOD:
      return getConsolePathDisplayService(apiLike)?.resolve?.(params[0] ?? {});
    case CONSOLE_LIST_STATUS_SEGMENTS_METHOD:
      return getConsoleStatusSegmentService(apiLike)?.list?.(params[0] ?? {}, (params[1] as 'left' | 'right' | undefined) ?? 'right') ?? [];
    case CONSOLE_RENDER_TOOL_DISPLAY_METHOD:
      return renderConsoleToolDisplay(apiLike, String(params[0] ?? ''), params[1], params[2]);
    case CONSOLE_PROGRESS_LOAD_LATEST_METHOD:
      return await getConsoleProgressProvider(apiLike)?.loadLatest?.(String(params[0] ?? ''));
    case CONSOLE_PROGRESS_LOAD_HISTORY_METHOD:
      return await getConsoleProgressProvider(apiLike)?.loadHistory?.(String(params[0] ?? '')) ?? [];
    case CONSOLE_PROGRESS_LOAD_UI_STATE_METHOD:
      return await getConsoleProgressProvider(apiLike)?.loadUiState?.(String(params[0] ?? ''));
    case CONSOLE_PROGRESS_SAVE_UI_STATE_METHOD:
      return await getConsoleProgressProvider(apiLike)?.saveUiState?.(String(params[0] ?? ''), params[1] as { expanded: boolean; snapshotUpdatedAt?: number });
    default:
      throw new Error(`未知 Console bridge 方法: ${method}`);
  }
}
