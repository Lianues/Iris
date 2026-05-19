import type { Disposable } from 'irises-extension-sdk';

export const CONSOLE_PATH_DISPLAY_SERVICE_ID = 'console:path-display';

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

export function createConsolePathDisplayService(): ConsolePathDisplayService {
  interface RegisteredProvider {
    provider: ConsolePathDisplayProvider;
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

    resolve(context = {}) {
    const candidates: ConsolePathDisplaySnapshot[] = [];
    for (const entry of providers.values()) {
      try {
        const snapshot = entry.provider.getSnapshot(context);
        if (!snapshot || !snapshot.path) continue;
        candidates.push({
          ...snapshot,
          id: snapshot.id || entry.provider.id,
          priority: snapshot.priority ?? entry.provider.priority ?? 0,
        });
      } catch {
        // 左下角路径显示不应因单个 provider 异常而影响宿主。
      }
    }
    if (candidates.length === 0) return undefined;
    candidates.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || a.id.localeCompare(b.id));
    return candidates[0];
    },

    onDidChange(listener) {
    listeners.add(listener);
    return { dispose: () => { listeners.delete(listener); } };
    },
  };
}
