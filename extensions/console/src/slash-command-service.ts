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

export interface ConsoleSlashCommandDefinition extends Command {
  handle(input: ConsoleSlashCommandHandlerInput): ConsoleSlashCommandResult | Promise<ConsoleSlashCommandResult | void> | void;
}

export interface ConsoleSlashCommandService {
  register(command: ConsoleSlashCommandDefinition): Disposable;
  list(): Command[];
  canHandle(raw: string): boolean;
  dispatch(raw: string, context?: ConsoleSlashCommandDispatchContext): Promise<ConsoleSlashCommandResult | undefined>;
  onDidChange(listener: () => void): Disposable;
}

export function createConsoleSlashCommandService(): ConsoleSlashCommandService {
  const commands = createKeyedRegistry<ConsoleSlashCommandDefinition>();
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
    onDidChange(listener) {
      return changes.on(listener);
    },
  };
}
