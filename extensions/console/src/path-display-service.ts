import type { Disposable } from 'irises-extension-sdk';
import { comparePriorityThenId, createKeyedRegistry, createListenerSignal, disposeSilently } from './service-registry-utils';

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

interface RegisteredProvider {
  provider: ConsolePathDisplayProvider;
  changeSubscription?: Disposable;
}

export function createConsolePathDisplayService(): ConsolePathDisplayService {
  const providers = createKeyedRegistry<RegisteredProvider>();
  const changes = createListenerSignal<[]>();

  return {
    register(provider) {
      disposeSilently(providers.get(provider.id)?.changeSubscription);
      const entry: RegisteredProvider = {
        provider,
        changeSubscription: provider.onDidChange?.(() => changes.emit()),
      };
      providers.replace(provider.id, entry);
      changes.emit();

      let disposed = false;
      return {
        dispose() {
          if (disposed) return;
          disposed = true;
          if (providers.deleteIf(provider.id, entry)) {
            disposeSilently(entry.changeSubscription);
            changes.emit();
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
      candidates.sort(comparePriorityThenId('desc'));
      return candidates[0];
    },
    onDidChange(listener) {
      return changes.on(listener);
    },
  };
}
