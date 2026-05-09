/**
 * 日志模块
 *
 * 各模块通过 createLogger('模块名') 创建带前缀的 logger 实例。
 * 全局统一控制日志级别，避免散落的 console.log。
 *
 * Agent Context 支持（AsyncLocalStorage 驱动）：
 *   当代码运行在 agentContext.run(label, fn) 内时，所有 logger 实例
 *   自动在前缀中追加 agent 标识，格式变为 [Module|agentLabel]。
 *   这样无需修改任何函数签名，就能在日志中区分
 *   主 LLM turn 与各子代理的工具执行。
 *   Iris 通过 AsyncLocalStorage 在日志层传播 agent 标识，便于排查多 Agent 调用链。
 *
 * 用法：
 *   import { createLogger } from '../logger';
 *   const logger = createLogger('MyModule');
 *   logger.info('已启动');          // → [MyModule] 已启动
 *
 *   import { agentContext } from '../logger';
 *   agentContext.run('task_123', () => {
 *     logger.info('执行中');        // → [MyModule|task_123] 执行中
 *   });
 */

import { AsyncLocalStorage } from 'node:async_hooks';

export enum LogLevel {
 DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  SILENT = 4,
}

/** 全局日志级别，所有 logger 实例共享 */
let globalLevel: LogLevel = LogLevel.INFO;

export function setGlobalLogLevel(level: LogLevel): void {
  globalLevel = level;
}

export function getGlobalLogLevel(): LogLevel {
  return globalLevel;
}

// ============ Agent Context（AsyncLocalStorage 驱动） ============

/**
 * Agent 上下文标识。
 *
 * 通过 AsyncLocalStorage 在异步调用链中自动传播，
 * Logger 输出时从中读取当前 agent 标识追加到前缀。
 *
 * 使用方式：
 *   - 主 LLM turn：agentContext.run('main', fn)
 *   - 异步子代理：agentContext.run(taskId, fn)
 *   - 同步子代理：agentContext.run(`sync_${typeName}`, fn)
 *
 * 不在任何 run() 内时，getStore() 返回 undefined，
 * Logger 前缀保持原样 [Module]，向后兼容。
 */
export const agentContext = new AsyncLocalStorage<string>();

/**
 * 便捷辅助函数：在指定 agent context 内执行回调。
 *
 * 等价于 agentContext.run(label, fn)，提供更语义化的调用方式。
 * 支持异步回调，返回值透传。
 */
export function runWithAgentContext<T>(label: string, fn: () => T): T {
  return agentContext.run(label, fn);
}

// ============ Logger 类 ============

export class Logger {
  constructor(private prefix: string) {}

  /**
   * 获取当前有效的日志前缀。
   *
   * 如果当前异步上下文中有 agentContext，则追加到前缀中，
   * 格式为 [Module|agentLabel]；否则保持 [Module]。
   *
   * 每次日志调用时动态计算，因为同一个 Logger 实例
   * 可能在不同的 agent context 中被调用（模块级单例）。
   */
  private getEffectivePrefix(): string {
    const ctx = agentContext.getStore();
    if (ctx) {
      return `[${this.prefix}|${ctx}]`;
    }
    return `[${this.prefix}]`;
  }

  debug(...args: unknown[]): void {
    if (globalLevel <= LogLevel.DEBUG) {
      console.debug(this.getEffectivePrefix(), ...args);
    }
  }

  info(...args: unknown[]): void {
    if (globalLevel <= LogLevel.INFO) {
      console.log(this.getEffectivePrefix(), ...args);
    }
  }

  warn(...args: unknown[]): void {
    if (globalLevel <= LogLevel.WARN) {
      console.warn(this.getEffectivePrefix(), ...args);
    }
  }

  error(...args: unknown[]): void {
    if (globalLevel <= LogLevel.ERROR) {
      console.error(this.getEffectivePrefix(), ...args);
    }
  }
}

/** 创建一个带模块前缀的 logger */
export function createLogger(prefix: string): Logger {
  return new Logger(prefix);
}
