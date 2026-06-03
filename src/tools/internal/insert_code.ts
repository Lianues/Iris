/**
 * 插入代码工具
 *
 * 在文件的指定行前插入代码。
 * line = totalLines + 1 表示追加到末尾。
 */

import * as fs from 'fs';
import { ToolDefinition } from '../../types';
import { resolveProjectPath } from '../utils';
import { applyInsertCodeTransform } from '../edit-transforms';
import { getSkillAccessPreflightRejection } from './skill-access-guard';

export { normalizeInsertArgs } from 'irises-extension-sdk/tool-utils';
export type { InsertEntry } from 'irises-extension-sdk/tool-utils';

export const insertCode: ToolDefinition = {
  declaration: {
    name: 'insert_code',
    description: '在一个文件的指定行前插入代码。使用 line = 文件总行数 + 1 可追加到末尾。',
    parameters: {
      type: 'object',
      properties: {
        path:    { type: 'string', description: '文件路径（相对于项目根目录）' },
        line:    { type: 'number', description: '在此行前插入（1-based），使用 总行数+1 追加到末尾' },
        content: { type: 'string', description: '要插入的内容' },
      },
      required: ['path', 'line', 'content'],
    },
  },
  handler: async (args) => {
    const filePath = args.path as string;
    const line = args.line as number;
    const contentToInsert = args.content as string;

    if (!filePath) {
      throw new Error('path 参数不能为空');
    }

    const resolved = resolveProjectPath(filePath);
    const skillAccessRejection = getSkillAccessPreflightRejection(filePath, resolved);
    if (skillAccessRejection) {
      throw new Error(skillAccessRejection);
    }
    const content = fs.readFileSync(resolved, 'utf-8');
    const transformed = applyInsertCodeTransform(content, line, contentToInsert);

    fs.writeFileSync(resolved, transformed.newContent, 'utf-8');

    return { path: filePath, success: true, line, insertedLines: transformed.insertedLines };
  },
};
