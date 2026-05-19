import type { Disposable } from 'irises-extension-sdk';

export const CONSOLE_STATUS_SEGMENT_SERVICE_ID = 'console:status-segment';

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

export function createConsoleStatusSegmentService(): ConsoleStatusSegmentService {
  interface RegisteredProvider {
    provider: ConsoleStatusSegmentProvider;
    changeSubscription?: Disposable;
  }

  const providers = new Map<string, RegisteredProvider>();
  const listeners = new Set<() => void>();

  function emitChange(): void {
    for (const listener of [...listeners]) {
      try { listener(); } catch { /* ignore */ }
    }
  }

  function disposeRegistered(entry: RegisteredProvider | undefined): void {
    try { entry?.changeSubscription?.dispose(); } catch { /* ignore */ }
  }

  return {
    register(provider) {
    const existing = providers.get(provider.id);
    disposeRegistered(existing);

    const entry: RegisteredProvider = {
      provider,
      changeSubscription: provider.onDidChange?.(() => emitChange()),
    };
    providers.set(provider.id, entry);
    emitChange();

    let disposed = false;
    return {
      dispose() {
        if (disposed) return;
        disposed = true;
        const current = providers.get(provider.id);
        if (current === entry) {
          disposeRegistered(current);
          providers.delete(provider.id);
          emitChange();
        }
      },
    };
    },

    list(context: ConsoleStatusContext = {}, align: 'left' | 'right' = 'right') {
    const result: ConsoleStatusSegmentSnapshot[] = [];
    for (const entry of providers.values()) {
      const providerAlign = entry.provider.align ?? 'right';
      if (providerAlign !== align) continue;
      try {
        const snapshot = entry.provider.getSnapshot(context);
        if (!snapshot || !snapshot.text) continue;
        result.push({
          ...snapshot,
          id: snapshot.id || entry.provider.id,
          align: snapshot.align ?? providerAlign,
          priority: snapshot.priority ?? entry.provider.priority ?? 0,
        });
      } catch {
        // 状态栏不能因为单个 provider 出错而崩溃。
      }
    }
    return result.sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0) || a.id.localeCompare(b.id));
    },

    onDidChange(listener) {
    listeners.add(listener);
    return { dispose: () => { listeners.delete(listener); } };
    },
  };
}
