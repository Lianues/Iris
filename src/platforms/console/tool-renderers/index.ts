/**
 * 工具渲染器注册表
 *
 * 根据工具名称返回对应的渲染组件。
 * 未注册的工具回退到 DefaultRenderer。
 */

import type { FC } from 'react';
import type { ToolRendererProps } from './default';
import { DefaultRenderer } from './default';
import { ShellRenderer } from './shell';
import { ReadFileRenderer } from './read-file';
import { ApplyDiffRenderer } from './apply-diff';
import { SearchInFilesRenderer } from './search-in-files';

const renderers: Record<string, FC<ToolRendererProps>> = {
  shell: ShellRenderer,
  read_file: ReadFileRenderer,
  apply_diff: ApplyDiffRenderer,
  search_in_files: SearchInFilesRenderer,
};

export function getToolRenderer(toolName: string): FC<ToolRendererProps> {
  return renderers[toolName] ?? DefaultRenderer;
}

export type { ToolRendererProps };
