import type { Disposable } from 'irises-extension-sdk';

export const CONSOLE_TOOL_DISPLAY_SERVICE_ID = 'console:tool-display';

export interface ConsoleToolDisplayProvider {
  getArgsSummary?(input: {
    toolName: string;
    args: Record<string, unknown>;
  }): string | undefined;
  getArgsSummaryAsync?(input: { toolName: string; args: Record<string, unknown> }): Promise<string | undefined>;

  getProgressLine?(input: {
    toolName: string;
    args: Record<string, unknown>;
    progress?: Record<string, unknown>;
  }): string | undefined;
  getProgressLineAsync?(input: { toolName: string; args: Record<string, unknown>; progress?: Record<string, unknown> }): Promise<string | undefined>;

  getResultSummary?(input: {
    toolName: string;
    args: Record<string, unknown>;
    result: unknown;
  }): string | undefined;
  getResultSummaryAsync?(input: { toolName: string; args: Record<string, unknown>; result: unknown }): Promise<string | undefined>;
}

export interface ConsoleToolDisplayService {
  register(toolName: string, provider: ConsoleToolDisplayProvider): Disposable;
  get(toolName: string): ConsoleToolDisplayProvider | undefined;
  list(): string[];
}

export function createConsoleToolDisplayService(): ConsoleToolDisplayService {
  const providers = new Map<string, ConsoleToolDisplayProvider>();

  return {
    register(toolName, provider) {
    providers.set(toolName, provider);
    let disposed = false;
    return {
      dispose() {
        if (disposed) return;
        disposed = true;
        if (providers.get(toolName) === provider) providers.delete(toolName);
      },
    };
    },
    get(toolName) {
    return providers.get(toolName);
    },
    list() {
    return Array.from(providers.keys());
    },
  };
}
