/**
 * Per-Session 执行上下文
 *
 * 解决 process.cwd() 全局竞态问题：
 *   不同 session 可以有独立的工作目录（cwd），互不干扰。
 *   进程级的 process.cwd() 不再被任何业务代码修改，
 *   保持为进程启动时的初始目录（不可变基准）。
 *
 * 核心机制：
 *   - AsyncLocalStorage<SessionExecutionContext> 在 turn 执行期间注入 per-session 上下文
 *   - sessionCwdMap 在 session 不活跃时也能保持 cwd 记忆
 *   - getSessionCwd() 作为 process.cwd() 的替代，所有业务代码统一使用
 */

import { AsyncLocalStorage } from 'node:async_hooks';

// ============ 类型 ============

export interface SessionExecutionContext {
  /** 当前 session ID */
  sessionId: string;
  /** per-session 工作目录 */
  cwd: string;
  /** 来源平台类型（e.g., 'telegram', 'discord', 'web', 'console'） */
  platformType?: string;
  /** 平台侧用户标识 */
  platformUserId?: string;
}

// ============ 全局状态 ============

/** session 执行上下文（通过 AsyncLocalStorage 在异步调用链中传播） */
export const sessionContext = new AsyncLocalStorage<SessionExecutionContext>();

/**
 * 全局 cwd 注册表：session 不活跃时也能保持 cwd 记忆。
 * 当 session 的 turn 结束后，下一次 turn 开始时可以恢复上次的 cwd。
 */
const sessionCwdMap = new Map<string, string>();

/** 进程启动时的初始 cwd（不可变基准） */
export const initialCwd = process.cwd();

// ============ 公共 API ============

/**
 * 获取当前 session 的工作目录。
 *
 * 优先级：
 *   1. AsyncLocalStorage 中的 ctx.cwd（turn 执行期间）
 *   2. 进程启动时的 initialCwd（兜底）
 *
 * 所有业务代码应使用此函数替代 process.cwd()。
 */
export function getSessionCwd(): string {
  const ctx = sessionContext.getStore();
  return ctx?.cwd ?? initialCwd;
}

/**
 * 获取当前 session 的 ID。
 *
 * 仅在 turn 执行期间可用（AsyncLocalStorage 上下文内），
 * 否则返回 undefined。
 */
export function getActiveSessionId(): string | undefined {
  return sessionContext.getStore()?.sessionId;
}

/**
 * 获取当前 turn 的来源平台类型。
 *
 * 仅在 turn 执行期间可用（AsyncLocalStorage 上下文内），
 * 否则返回 undefined。
 */
export function getActivePlatformType(): string | undefined {
  return sessionContext.getStore()?.platformType;
}

/**
 * 获取当前 turn 的平台用户标识。
 *
 * 仅在 turn 执行期间可用（AsyncLocalStorage 上下文内），
 * 否则返回 undefined。
 */
export function getActivePlatformUserId(): string | undefined {
  return sessionContext.getStore()?.platformUserId;
}

/**
 * 设置指定 session 的工作目录。
 *
 * 同时更新：
 *   - sessionCwdMap（持久记忆，跨 turn 保留）
 *   - 当前 AsyncLocalStorage 上下文中的 cwd（如果正处于该 session 的 turn 中）
 *
 * 不再调用 process.chdir()——进程级 cwd 保持不可变。
 */
export function setSessionCwd(sessionId: string, newCwd: string): void {
  sessionCwdMap.set(sessionId, newCwd);
  // 如果当前正在该 session 的执行上下文中，同步更新
  const ctx = sessionContext.getStore();
  if (ctx && ctx.sessionId === sessionId) {
    ctx.cwd = newCwd;
  }
}

/**
 * 获取指定 session 记忆的 cwd。
 *
 * 用于在 turn 开始时恢复上次的工作目录。
 * 如果 session 从未设置过 cwd，返回 initialCwd。
 */
export function getRememberedCwd(sessionId: string): string {
  return sessionCwdMap.get(sessionId) ?? initialCwd;
}

/**
 * 清理 session 的 cwd 记录。
 *
 * 在 session 被删除/清理时调用，避免内存泄漏。
 */
export function clearSessionCwd(sessionId: string): void {
  sessionCwdMap.delete(sessionId);
}

/**
 * 使用指定的初始 cwd 记忆一个 session。
 *
 * 用于 IPC attach 场景：客户端连入时可以传入 --cwd 参数，
 * 在该 session 的首次 turn 开始前就设定好工作目录。
 */
export function initSessionCwd(sessionId: string, cwd: string): void {
  if (!sessionCwdMap.has(sessionId)) {
    sessionCwdMap.set(sessionId, cwd);
  }
}
