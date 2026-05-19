import type { Command } from './input-commands';
import type {
  ConsolePathDisplayContext,
  ConsolePathDisplayService,
  ConsolePathDisplaySnapshot,
} from './path-display-service';
import type {
  ConsoleProgressArchiveLike,
  ConsoleProgressService,
  ConsoleProgressUiStateLike,
} from './progress-service';
import type {
  ConsoleSlashCommandDispatchContext,
  ConsoleSlashCommandResult,
  ConsoleSlashCommandService,
} from './slash-command-service';
import type {
  ConsoleStatusContext,
  ConsoleStatusSegmentService,
  ConsoleStatusSegmentSnapshot,
} from './status-segment-service';
import type { ConsoleToolDisplayProvider, ConsoleToolDisplayService } from './tool-display-service';
import type { ProgressSnapshotLike } from './progress-types';
import {
  getCachedConsoleRemoteSlashCommands,
  type ConsoleRemoteBridgeApi,
} from './ipc-bridge';
import { createListenerSignal } from './service-registry-utils';

export interface RemoteConsoleServicesBundle {
  slashCommand: ConsoleSlashCommandService;
  pathDisplay: ConsolePathDisplayService;
  statusSegment: ConsoleStatusSegmentService;
  toolDisplay: ConsoleToolDisplayService;
  progress: ConsoleProgressService;
  refreshSession?(sessionId?: string): Promise<void>;
}

function createMatchCommand(commandsSource: () => Command[]) {
  return function matchCommand(rawInput: string): { command: Command; arg: string } | undefined {
    const raw = rawInput.trim();
    if (!raw.startsWith('/')) return undefined;
    let best: { command: Command; arg: string } | undefined;
    for (const command of commandsSource()) {
      const name = command.name.trim();
      if (raw === name || raw.startsWith(`${name} `)) {
        const arg = raw === name ? '' : raw.slice(name.length).trim();
        if (!best || name.length > best.command.name.length) best = { command, arg };
      }
    }
    return best;
  };
}

function contextKey(value: unknown): string {
  try {
    return JSON.stringify(value ?? {});
  } catch {
    return String(value);
  }
}

export function createRemoteConsoleServicesBundle(api: ConsoleRemoteBridgeApi): RemoteConsoleServicesBundle {
  const slashChanged = createListenerSignal<[]>();
  const pathChanged = createListenerSignal<[]>();
  const statusChanged = createListenerSignal<[]>();
  const progressChanged = createListenerSignal<[]>();
  const progressUpdated = createListenerSignal<[string, string, ProgressSnapshotLike]>();

  const pathCache = new Map<string, ConsolePathDisplaySnapshot | undefined>();
  const pathPending = new Set<string>();
  const statusCache = new Map<string, ConsoleStatusSegmentSnapshot[]>();
  const statusPending = new Set<string>();

  const getSlashCommands = () => getCachedConsoleRemoteSlashCommands(api);
  const matchSlashCommand = createMatchCommand(getSlashCommands);

  const refreshSlashCommands = async () => {
    await api.initCaches?.();
    slashChanged.emit();
  };

  const fetchPathDisplay = async (context?: ConsolePathDisplayContext) => {
    const key = contextKey(context);
    if (pathPending.has(key) || !api.__consoleResolvePathDisplay) return;
    pathPending.add(key);
    try {
      pathCache.set(key, await api.__consoleResolvePathDisplay(context));
    } catch {
      pathCache.set(key, undefined);
    } finally {
      pathPending.delete(key);
      pathChanged.emit();
    }
  };

  const fetchStatusSegments = async (context?: ConsoleStatusContext, align: 'left' | 'right' = 'right') => {
    const key = contextKey({ context, align });
    if (statusPending.has(key) || !api.__consoleListStatusSegments) return;
    statusPending.add(key);
    try {
      statusCache.set(key, await api.__consoleListStatusSegments(context, align));
    } catch {
      statusCache.set(key, []);
    } finally {
      statusPending.delete(key);
      statusChanged.emit();
    }
  };

  const progressProvider = {
    id: 'remote-console.progress',
    async loadLatest(sessionId: string) {
      const snapshot = await api.__consoleLoadLatestProgress?.(sessionId);
      if (snapshot) progressUpdated.emit(progressProvider.id, sessionId, snapshot);
      return snapshot;
    },
    loadHistory(sessionId: string) {
      return api.__consoleLoadProgressHistory?.(sessionId) ?? [];
    },
    loadUiState(sessionId: string) {
      return api.__consoleLoadProgressUiState?.(sessionId);
    },
    async saveUiState(sessionId: string, state: { expanded: boolean; snapshotUpdatedAt?: number }) {
      await api.__consoleSaveProgressUiState?.(sessionId, state);
      progressChanged.emit();
    },
  };

  const progressService: ConsoleProgressService = {
    register() {
      return { dispose() {} };
    },
    getProvider(id) {
      return id === progressProvider.id ? progressProvider : undefined;
    },
    getActiveProvider() {
      return progressProvider;
    },
    listProviders() {
      return [progressProvider];
    },
    onDidChange(listener) {
      return progressChanged.on(listener);
    },
    onDidUpdate(listener) {
      return progressUpdated.on(listener);
    },
  };

  const toolDisplayProviders = new Map<string, ConsoleToolDisplayProvider>();
  const toolDisplayService: ConsoleToolDisplayService = {
    register() {
      return { dispose() {} };
    },
    get(toolName) {
      let provider = toolDisplayProviders.get(toolName);
      if (!provider) {
        provider = {
          async getArgsSummaryAsync(input) {
            return await api.__consoleRenderToolDisplay?.(toolName, 'args', input as Record<string, unknown>) ?? undefined;
          },
          async getProgressLineAsync(input) {
            return await api.__consoleRenderToolDisplay?.(toolName, 'progress', input as Record<string, unknown>) ?? undefined;
          },
          async getResultSummaryAsync(input) {
            return await api.__consoleRenderToolDisplay?.(toolName, 'result', input as Record<string, unknown>) ?? undefined;
          },
        };
        toolDisplayProviders.set(toolName, provider);
      }
      if (!provider) {
        return undefined;
      }
      return provider;
    },
    list() {
      return [];
    },
  };

  return {
    slashCommand: {
      register() {
        return { dispose() {} };
      },
      list() {
        return getSlashCommands();
      },
      canHandle(raw) {
        return !!matchSlashCommand(raw);
      },
      async dispatch(raw, context) {
        const result = await api.__consoleDispatchSlashCommand?.(raw, context);
        await refreshSlashCommands().catch(() => {});
        pathCache.delete(contextKey({ sessionId: context?.sessionId }));
        void fetchPathDisplay({ sessionId: context?.sessionId });
        void fetchStatusSegments({ sessionId: context?.sessionId }, 'right');
        return result ?? {};
      },
      onDidChange(listener) {
        return slashChanged.on(listener);
      },
    },
    pathDisplay: {
      register() {
        return { dispose() {} };
      },
      resolve(context = {}) {
        const key = contextKey(context);
        if (!pathCache.has(key) && !pathPending.has(key)) void fetchPathDisplay(context);
        return pathCache.get(key);
      },
      onDidChange(listener) {
        return pathChanged.on(listener);
      },
    },
    statusSegment: {
      register() {
        return { dispose() {} };
      },
      list(context = {}, align: 'left' | 'right' = 'right') {
        const key = contextKey({ context, align });
        const cached = statusCache.get(key);
        if (!cached && !statusPending.has(key)) void fetchStatusSegments(context, align);
        return cached ?? [];
      },
      onDidChange(listener) {
        return statusChanged.on(listener);
      },
    },
    toolDisplay: toolDisplayService,
    progress: progressService,
    async refreshSession(sessionId) {
      await refreshSlashCommands().catch(() => {});
      await fetchPathDisplay({ sessionId });
      await fetchStatusSegments({ sessionId }, 'right');
    },
  };
}
