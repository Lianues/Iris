import type { Disposable } from 'irises-extension-sdk';
import type { ProgressSnapshotLike } from './progress-types';

export const CONSOLE_PROGRESS_SERVICE_ID = 'console:progress';

export interface ConsoleProgressArchiveLike {
  id: string;
  snapshot: ProgressSnapshotLike;
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
  loadLatest(sessionId: string): Promise<ProgressSnapshotLike | undefined> | ProgressSnapshotLike | undefined;
  loadHistory?(sessionId: string): Promise<ConsoleProgressArchiveLike[]> | ConsoleProgressArchiveLike[];
  loadUiState?(sessionId: string): Promise<ConsoleProgressUiStateLike | undefined> | ConsoleProgressUiStateLike | undefined;
  saveUiState?(sessionId: string, state: { expanded: boolean; snapshotUpdatedAt?: number }): Promise<void> | void;
  onDidUpdate?(listener: (sessionId: string, snapshot: ProgressSnapshotLike) => void): Disposable;
}

export interface ConsoleProgressService {
  register(provider: ConsoleProgressProvider): Disposable;
  getProvider(id: string): ConsoleProgressProvider | undefined;
  getActiveProvider(): ConsoleProgressProvider | undefined;
  listProviders(): ConsoleProgressProvider[];
  onDidChange(listener: () => void): Disposable;
  onDidUpdate(listener: (providerId: string, sessionId: string, snapshot: ProgressSnapshotLike) => void): Disposable;
}

export function createConsoleProgressService(): ConsoleProgressService {
  const providers = new Map<string, ConsoleProgressProvider>();
  const providerDisposers = new Map<string, Disposable | undefined>();
  const changeListeners = new Set<() => void>();
  const updateListeners = new Set<(providerId: string, sessionId: string, snapshot: ProgressSnapshotLike) => void>();

  function emitChange(): void {
    for (const listener of changeListeners) listener();
  }

  function emitUpdate(providerId: string, sessionId: string, snapshot: ProgressSnapshotLike): void {
    for (const listener of updateListeners) listener(providerId, sessionId, snapshot);
  }

  function orderedProviders(): ConsoleProgressProvider[] {
    return Array.from(providers.values()).sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || a.id.localeCompare(b.id));
  }

  return {
    register(provider) {
    providers.set(provider.id, provider);
    providerDisposers.get(provider.id)?.dispose();
    providerDisposers.set(provider.id, provider.onDidUpdate?.((sessionId, snapshot) => emitUpdate(provider.id, sessionId, snapshot)));
    emitChange();
    let disposed = false;
    return {
      dispose() {
        if (disposed) return;
        disposed = true;
        const current = providers.get(provider.id);
        if (current === provider) {
          providers.delete(provider.id);
          providerDisposers.get(provider.id)?.dispose();
          providerDisposers.delete(provider.id);
          emitChange();
        }
      },
    };
    },
    getProvider(id) {
    return providers.get(id);
    },
    getActiveProvider() {
    return orderedProviders()[0];
    },
    listProviders() {
    return orderedProviders();
    },
    onDidChange(listener) {
    changeListeners.add(listener);
    return { dispose: () => changeListeners.delete(listener) };
    },
    onDidUpdate(listener) {
    updateListeners.add(listener);
    return { dispose: () => updateListeners.delete(listener) };
    },
  };
}
