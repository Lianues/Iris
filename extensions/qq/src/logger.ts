export interface ExtensionLogger {
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  debug(...args: unknown[]): void;
}

function print(level: 'log' | 'warn' | 'error' | 'debug', tag: string, args: unknown[]): void {
  const consoleMethod = console[level] ?? console.log;
  consoleMethod(`[QQExtension:${tag}]`, ...args);
}

export function createLogger(tag: string): ExtensionLogger {
  return {
    info: (...args) => print('log', tag, args),
    warn: (...args) => print('warn', tag, args),
    error: (...args) => print('error', tag, args),
    debug: (...args) => print('debug', tag, args),
  };
}
