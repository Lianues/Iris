import type { Disposable } from 'irises-extension-sdk';
import type { Command } from './input-commands';
import { createKeyedRegistry, createListenerSignal } from './service-registry-utils';

export const CONSOLE_SLASH_COMMAND_SERVICE_ID = 'console:slash-command';

export interface ConsoleSlashCommandResult {
  message?: string;
  isError?: boolean;
  label?: string;
}

export interface ConsoleSlashCommandHandlerInput {
  raw: string;
  name: string;
  arg: string;
  /** Console 当前会话 ID。UI slash command 不在 Backend turn 上下文内，不能依赖 agentManager.getActiveSessionId()。 */
  sessionId?: string;
}

export type ConsoleSlashCommandDispatchContext = Pick<ConsoleSlashCommandHandlerInput, 'sessionId'>;

export interface ConsoleInputModeSnapshot {
  id: string;
  label: string;
  description?: string;
  placeholder?: string;
  prompt?: string;
  color?: string;
  priority?: number;
}

export interface ConsoleInputModeContext {
  sessionId?: string;
}

export interface ConsoleInputModeHandlerInput extends ConsoleInputModeContext {
  text: string;
  pendingFileCount?: number;
  isGenerating?: boolean;
}

export interface ConsoleInputModeProvider {
  id: string;
  priority?: number;
  getSnapshot(context: ConsoleInputModeContext): ConsoleInputModeSnapshot | undefined;
  handle(input: ConsoleInputModeHandlerInput): ConsoleSlashCommandResult | Promise<ConsoleSlashCommandResult | void> | void;
  onDidChange?(listener: () => void): Disposable;
}

export interface ConsoleSlashCommandDefinition extends Command {
  handle(input: ConsoleSlashCommandHandlerInput): ConsoleSlashCommandResult | Promise<ConsoleSlashCommandResult | void> | void;
}

export interface ConsoleSlashCommandService {
  register(command: ConsoleSlashCommandDefinition): Disposable;
  registerInputMode(provider: ConsoleInputModeProvider): Disposable;
  list(): Command[];
  canHandle(raw: string): boolean;
  dispatch(raw: string, context?: ConsoleSlashCommandDispatchContext): Promise<ConsoleSlashCommandResult | undefined>;
  resolveInputMode(context?: ConsoleInputModeContext): ConsoleInputModeSnapshot | undefined;
  dispatchInput(input: ConsoleInputModeHandlerInput): Promise<ConsoleSlashCommandResult | undefined>;
  onDidChange(listener: () => void): Disposable;
}

export function createConsoleSlashCommandService(): ConsoleSlashCommandService {
  const commands = createKeyedRegistry<ConsoleSlashCommandDefinition>();
  const inputModes = createKeyedRegistry<ConsoleInputModeProvider>();
  const modeSubscriptions = new Map<string, { provider: ConsoleInputModeProvider; disposable: Disposable }>();
  const changes = createListenerSignal<[]>();

  function matchCommand(rawInput: string): { command: ConsoleSlashCommandDefinition; arg: string } | undefined {
    const raw = rawInput.trim();
    if (!raw.startsWith('/')) return undefined;
    let best: { command: ConsoleSlashCommandDefinition; arg: string } | undefined;
    for (const command of commands.values()) {
      const name = command.name.trim();
      if (raw === name || raw.startsWith(`${name} `)) {
        const arg = raw === name ? '' : raw.slice(name.length).trim();
        if (!best || name.length > best.command.name.length) {
          best = { command, arg };
        }
      }
    }
    return best;
  }

  function resolveInputMode(context: ConsoleInputModeContext = {}): ConsoleInputModeSnapshot | undefined {
    const snapshots: ConsoleInputModeSnapshot[] = [];
    for (const provider of inputModes.values()) {
      const snapshot = provider.getSnapshot(context);
      if (snapshot) snapshots.push({ ...snapshot, priority: snapshot.priority ?? provider.priority });
    }
    return snapshots.sort((left, right) => (right.priority ?? 0) - (left.priority ?? 0))[0];
  }

  return {
    register(command) {
      commands.replace(command.name, command);
      changes.emit();
      let disposed = false;
      return {
        dispose() {
          if (disposed) return;
          disposed = true;
          if (commands.deleteIf(command.name, command)) {
            changes.emit();
          }
        },
      };
    },
    registerInputMode(provider) {
      const previous = modeSubscriptions.get(provider.id);
      previous?.disposable.dispose();
      inputModes.replace(provider.id, provider);
      if (provider.onDidChange) {
        modeSubscriptions.set(provider.id, {
          provider,
          disposable: provider.onDidChange(() => changes.emit()),
        });
      } else {
        modeSubscriptions.delete(provider.id);
      }
      changes.emit();
      let disposed = false;
      return {
        dispose() {
          if (disposed) return;
          disposed = true;
          if (!inputModes.deleteIf(provider.id, provider)) return;
          const subscription = modeSubscriptions.get(provider.id);
          if (subscription?.provider === provider) {
            subscription.disposable.dispose();
            modeSubscriptions.delete(provider.id);
          }
          changes.emit();
        },
      };
    },
    list() {
      return Array.from(commands.values()).map(({ handle: _handle, ...command }) => command);
    },
    canHandle(raw) {
      return !!matchCommand(raw);
    },
    async dispatch(raw, context) {
      const matched = matchCommand(raw);
      if (!matched) return undefined;
      const result = await matched.command.handle({
        raw: raw.trim(),
        name: matched.command.name,
        arg: matched.arg,
        sessionId: context?.sessionId,
      });
      return result ?? {};
    },
    resolveInputMode,
    async dispatchInput(input) {
      const snapshot = resolveInputMode(input);
      if (!snapshot) return undefined;
      const provider = inputModes.get(snapshot.id);
      if (!provider) return undefined;
      const result = await provider.handle(input);
      return result ?? {};
    },
    onDidChange(listener) {
      return changes.on(listener);
    },
  };
}
