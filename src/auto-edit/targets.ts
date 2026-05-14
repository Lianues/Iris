import type { AutoEditOperation, AutoEditTarget } from './types';

export const AUTO_EDIT_SUPPORTED_TOOLS = new Set([
  'write_file',
  'apply_diff',
  'insert_code',
  'delete_code',
]);

function getStringPath(args: Record<string, unknown>, key: string = 'path'): string | undefined {
  const value = args[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function singlePathTarget(args: Record<string, unknown>, operation: AutoEditOperation): AutoEditTarget[] | null {
  const path = getStringPath(args);
  return path ? [{ path, operation }] : null;
}

/**
 * 从工具调用参数中提取 Auto Edit 需要校验的目标路径。
 *
 * V1 只覆盖 Iris 内置的结构化文件编辑工具，不覆盖 shell/bash、delete_file、
 * create_directory 或 search_in_files.replace。
 */
export function getAutoEditTargets(
  toolName: string,
  args: Record<string, unknown>,
): AutoEditTarget[] | null {
  switch (toolName) {
    case 'write_file':
      return singlePathTarget(args, 'write');
    case 'apply_diff':
      return singlePathTarget(args, 'patch');
    case 'insert_code':
      return singlePathTarget(args, 'insert');
    case 'delete_code':
      return singlePathTarget(args, 'delete_lines');
    default:
      return null;
  }
}
