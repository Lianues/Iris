import type { Disposable } from 'irises-extension-sdk';
import { comparePriorityThenId, createKeyedRegistry, createListenerSignal, disposeSilently } from './service-registry-utils';

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

interface RegisteredProvider {
  provider: ConsoleStatusSegmentProvider;
  changeSubscription?: Disposable;
}

export function createConsoleStatusSegmentService(): ConsoleStatusSegmentService {
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
      return result.sort(comparePriorityThenId('asc'));
    },
    onDidChange(listener) {
      return changes.on(listener);
    },
  };
}
