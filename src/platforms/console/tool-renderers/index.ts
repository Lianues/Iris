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
import { FindFilesRenderer } from './find-files';
import { ListFilesRenderer } from './list-files';
import { WriteFileRenderer } from './write-file';
import { DeleteCodeRenderer } from './delete-code';
import { InsertCodeRenderer } from './insert-code';

const renderers: Record<string, FC<ToolRendererProps>> = {
  shell: ShellRenderer,
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
