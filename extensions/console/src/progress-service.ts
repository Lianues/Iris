import type { Disposable } from 'irises-extension-sdk';
import type { ProgressSnapshotLike } from './progress-types';
import { comparePriorityThenId, createKeyedRegistry, createListenerSignal, disposeSilently } from './service-registry-utils';

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
  const providers = createKeyedRegistry<ConsoleProgressProvider>();
  const providerSubscriptions = new Map<string, Disposable | undefined>();
  const changes = createListenerSignal<[]>();
  const updates = createListenerSignal<[string, string, ProgressSnapshotLike]>();

  function orderedProviders(): ConsoleProgressProvider[] {
    return Array.from(providers.values()).sort(comparePriorityThenId('desc'));
  }

  return {
    register(provider) {
      disposeSilently(providerSubscriptions.get(provider.id));
      providers.replace(provider.id, provider);
      providerSubscriptions.set(
        provider.id,
        provider.onDidUpdate?.((sessionId, snapshot) => updates.emit(provider.id, sessionId, snapshot)),
      );
      changes.emit();

      let disposed = false;
      return {
        dispose() {
          if (disposed) return;
          disposed = true;
          if (providers.deleteIf(provider.id, provider)) {
            disposeSilently(providerSubscriptions.get(provider.id));
            providerSubscriptions.delete(provider.id);
            changes.emit();
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
      return changes.on(listener);
    },
    onDidUpdate(listener) {
      return updates.on(listener);
    },
  };
}
