/**
 * 工具层公共工具函数
 */

import { getSessionCwd } from '../core/backend/session-context';
import { resolveProjectPath as resolveProjectPathRaw } from '@irises/extension-sdk/tool-utils';

// Re-export from SDK for shared use
export { normalizeObjectArrayArg, normalizeStringArrayArg } from '@irises/extension-sdk/tool-utils';
export type { NormalizeObjectArrayArgOptions, NormalizeStringArrayArgOptions } from '@irises/extension-sdk/tool-utils';

/**
 * 解析路径并校验是否在项目目录内，防止路径穿越。
 *
 * 自动使用 per-session cwd 作为基准（通过 AsyncLocalStorage），
 * 在 turn 上下文外会退化为进程启动目录。
 */
export function resolveProjectPath(inputPath: string, baseCwd?: string): string {
  return resolveProjectPathRaw(inputPath, baseCwd ?? getSessionCwd());
}

/**
 * 获取当前 session 的工作目录（项目根目录）。
 *
 * 工具层统一通过此函数获取 cwd，不应直接 import session-context。
 * 在 turn 上下文外退化为进程启动目录。
 */
export function getProjectRoot(): string {
  return getSessionCwd();
}
