/**
 * 工具渲染器注册表
 *
 * 根据工具名称返回对应的渲染组件。
 * 未注册的工具回退到 DefaultRenderer。
 */

import type { FC } from 'react';
import type { ToolInvocation, ToolOutputEntry } from '@irises/extension-sdk';
import type { ToolRendererProps } from './default';
import { DefaultRenderer } from './default';
import { ShellRenderer } from './shell';
import { ReadFileRenderer } from './read-file';
import { ApplyDiffRenderer } from './apply-diff';
import { SearchInFilesRenderer } from './search-in-files';
import { FindFilesRenderer } from './find-files';
import { ListFilesRenderer } from './list-files';
import { WriteFileRenderer } from './write-file';
import { DeleteCodeRenderer } from './delete-code';
import { InsertCodeRenderer } from './insert-code';

const renderers: Record<string, FC<ToolRendererProps>> = {
  shell: ShellRenderer,
  bash: ShellRenderer,
  read_file: ReadFileRenderer,
  apply_diff: ApplyDiffRenderer,
  search_in_files: SearchInFilesRenderer,
  find_files: FindFilesRenderer,
  list_files: ListFilesRenderer,
  write_file: WriteFileRenderer,
  delete_code: DeleteCodeRenderer,
  insert_code: InsertCodeRenderer,
};

export function getToolRenderer(toolName: string): FC<ToolRendererProps> {
  return renderers[toolName] ?? DefaultRenderer;
}

export type { ToolRendererProps };

// ============ 详情渲染器 ============

/**
 * 工具详情渲染器 Props。
 * 用于 ToolDetailView 中展示工具执行过程的自定义视图。
 * 比 ToolRendererProps（仅终态结果）更丰富，包含执行过程数据。
 */
export interface ToolDetailRendererProps {
  invocation: ToolInvocation;
  output: ToolOutputEntry[];
  children: ToolInvocation[];
  /** 请求打开子工具详情 */
  onNavigateChild?: (toolId: string) => void;
}

const detailRenderers: Record<string, FC<ToolDetailRendererProps>> = {};

/**
 * 注册工具的自定义详情渲染器。
 * 未注册的工具使用默认详情布局。
 */
export function registerToolDetailRenderer(toolName: string, renderer: FC<ToolDetailRendererProps>): void {
  detailRenderers[toolName] = renderer;
}

/**
 * 获取工具的详情渲染器，未注册返回 null（使用默认布局）。
 */
export function getToolDetailRenderer(toolName: string): FC<ToolDetailRendererProps> | null {
  return detailRenderers[toolName] ?? null;
}
