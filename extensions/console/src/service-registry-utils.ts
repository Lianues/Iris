import type { Disposable } from 'irises-extension-sdk';

export function disposeSilently(disposable?: Disposable): void {
  try { disposable?.dispose(); } catch { /* ignore */ }
}

export interface ListenerSignal<TArgs extends unknown[]> {
  on(listener: (...args: TArgs) => void): Disposable;
  emit(...args: TArgs): void;
  clear(): void;
}

export function createListenerSignal<TArgs extends unknown[] = []>(): ListenerSignal<TArgs> {
  const listeners = new Set<(...args: TArgs) => void>();
  return {
    on(listener) {
      listeners.add(listener);
      return { dispose: () => { listeners.delete(listener); } };
    },
    emit(...args: TArgs) {
      for (const listener of [...listeners]) {
        try { listener(...args); } catch { /* ignore */ }
      }
    },
    clear() {
      listeners.clear();
    },
  };
}

export interface KeyedRegistry<T> {
  get(key: string): T | undefined;
  keys(): IterableIterator<string>;
  values(): IterableIterator<T>;
  replace(key: string, value: T): void;
  deleteIf(key: string, value: T): boolean;
  delete(key: string): boolean;
  clear(): void;
}

export function createKeyedRegistry<T>(): KeyedRegistry<T> {
  const map = new Map<string, T>();
  return {
    get(key) {
      return map.get(key);
    },
    keys() {
      return map.keys();
    },
    values() {
      return map.values();
    },
    replace(key, value) {
      map.set(key, value);
    },
    deleteIf(key, value) {
      if (map.get(key) !== value) return false;
      return map.delete(key);
    },
    delete(key) {
      return map.delete(key);
    },
    clear() {
      map.clear();
    },
  };
}

export function comparePriorityThenId<T extends { id: string; priority?: number }>(direction: 'asc' | 'desc' = 'asc') {
  return (a: T, b: T): number => {
    const delta = (a.priority ?? 0) - (b.priority ?? 0);
    const ordered = direction === 'asc' ? delta : -delta;
    return ordered || a.id.localeCompare(b.id);
  };
}
