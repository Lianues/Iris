import type { Disposable } from 'irises-extension-sdk';
import { createListenerSignal } from './service-registry-utils';

export const CONSOLE_INPUT_SERVICE_ID = 'console:input';

export interface ConsoleInputController {
  hasValue(): boolean;
  setValue(text: string): void;
  insertText(text: string): void;
  clear(): void;
}

export interface ConsoleInputService {
  insertText(text: string): boolean;
  setText(text: string): boolean;
  clear(): boolean;
  hasValue(): boolean;
  onDidChange(listener: () => void): Disposable;
}

export interface ConsoleInputServiceBinding extends ConsoleInputService {
  bindControllerGetter(getter: () => ConsoleInputController | null | undefined): Disposable;
}

export function createConsoleInputService(): ConsoleInputServiceBinding {
  let getController: (() => ConsoleInputController | null | undefined) | undefined;
  const changes = createListenerSignal<[]>();

  const current = () => getController?.() ?? null;
  const emit = () => changes.emit();

  return {
    bindControllerGetter(getter) {
      getController = getter;
      emit();
      let disposed = false;
      return {
        dispose() {
          if (disposed) return;
          disposed = true;
          if (getController === getter) {
            getController = undefined;
            emit();
          }
        },
      };
    },
    insertText(text) {
      const controller = current();
      if (!controller || !text) return false;
      controller.insertText(text);
      emit();
      return true;
    },
    setText(text) {
      const controller = current();
      if (!controller) return false;
      controller.setValue(text);
      emit();
      return true;
    },
    clear() {
      const controller = current();
      if (!controller) return false;
      controller.clear();
      emit();
      return true;
    },
    hasValue() {
      return current()?.hasValue() ?? false;
    },
    onDidChange(listener) {
      return changes.on(listener);
    },
  };
}
