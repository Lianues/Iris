/**
 * 删除代码工具
 *
 * 删除文件中指定行范围的代码。
 */

import * as fs from 'fs';
import { ToolDefinition } from '../../types';
import { resolveProjectPath } from '../utils';

export { normalizeDeleteCodeArgs } from '@irises/extension-sdk/tool-utils';
export type { DeleteCodeEntry } from '@irises/extension-sdk/tool-utils';

export const deleteCode: ToolDefinition = {
  declaration: {
    name: 'delete_code',
    description: '删除一个文件中指定行范围的代码（起止行均包含）。',
    parameters: {
      type: 'object',
      properties: {
        path:       { type: 'string', description: '文件路径（相对于项目根目录）' },
        start_line: { type: 'number', description: '起始行号（1-based，含）' },
        end_line:   { type: 'number', description: '结束行号（1-based，含）' },
      },
      required: ['path', 'start_line', 'end_line'],
    },
  },
  handler: async (args) => {
    const filePath = args.path as string;
    const startLine = args.start_line as number;
    const endLine = args.end_line as number;

    if (!filePath) {
      throw new Error('path 参数不能为空');
    }

    const resolved = resolveProjectPath(filePath);
    const content = fs.readFileSync(resolved, 'utf-8');
    const lines = content.split('\n');
    const totalLines = lines.length;

    if (startLine < 1 || startLine > totalLines) {
      throw new Error(`start_line ${startLine} 超出范围（1~${totalLines}）`);
    }
    if (endLine < startLine || endLine > totalLines) {
      throw new Error(`end_line ${endLine} 超出范围（${startLine}~${totalLines}）`);
    }

    const newLines = [...lines.slice(0, startLine - 1), ...lines.slice(endLine)];
    fs.writeFileSync(resolved, newLines.join('\n'), 'utf-8');

    return { path: filePath, success: true, start_line: startLine, end_line: endLine, deletedLines: endLine - startLine + 1 };
  },
};
