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

export interface RemoteConsoleBridgeApi {
  initCaches?(): Promise<void>;
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

export interface RemoteConsoleServicesBundle {
  slashCommand: ConsoleSlashCommandService;
  pathDisplay: ConsolePathDisplayService;
  statusSegment: ConsoleStatusSegmentService;
  toolDisplay: ConsoleToolDisplayService;
  progress: ConsoleProgressService;
  refreshSession?(sessionId?: string): Promise<void>;
}

function createListeners<T extends (...args: any[]) => void>() {
  const listeners = new Set<T>();
  return {
    add(listener: T) {
      listeners.add(listener);
      return { dispose: () => { listeners.delete(listener); } };
    },
    emit(...args: Parameters<T>) {
      for (const listener of [...listeners]) {
        try { listener(...args); } catch { /* ignore */ }
      }
    },
  };
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

export function createRemoteConsoleServicesBundle(api: RemoteConsoleBridgeApi): RemoteConsoleServicesBundle {
  const slashChanged = createListeners<() => void>();
  const pathChanged = createListeners<() => void>();
  const statusChanged = createListeners<() => void>();
  const progressChanged = createListeners<() => void>();
  const progressUpdated = createListeners<(providerId: string, sessionId: string, snapshot: ProgressSnapshotLike) => void>();

  const pathCache = new Map<string, ConsolePathDisplaySnapshot | undefined>();
  const pathPending = new Set<string>();
  const statusCache = new Map<string, ConsoleStatusSegmentSnapshot[]>();
  const statusPending = new Set<string>();

  const getSlashCommands = () => Array.isArray(api.__consoleGetSlashCommands?.()) ? [...api.__consoleGetSlashCommands()] : [];
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
      return progressChanged.add(listener);
    },
    onDidUpdate(listener) {
      return progressUpdated.add(listener);
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
        return slashChanged.add(listener);
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
        return pathChanged.add(listener);
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
        return statusChanged.add(listener);
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
