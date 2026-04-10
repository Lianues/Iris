/**
 * 写入文件工具
 *
 * 写入单个文件。新文件自动创建父目录。
 */

import * as fs from 'fs';
import * as path from 'path';
import { ToolDefinition } from '../../types';
import { resolveProjectPath } from '../utils';

export { normalizeWriteArgs } from '@irises/extension-sdk/tool-utils';
export type { WriteEntry } from '@irises/extension-sdk/tool-utils';

export const writeFile: ToolDefinition = {
  declaration: {
    name: 'write_file',
    description: [
      '写入一个文件。',
      '文件不存在时自动创建（含父目录）。',
      '内容与现有内容相同时返回 unchanged。',
    ].join(''),
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '文件路径（相对于项目根目录）' },
        content: { type: 'string', description: '要写入的内容' },
      },
      required: ['path', 'content'],
    },
  },
  handler: async (args) => {
    const filePath = args.path as string;
    const content = args.content as string;

    if (!filePath) {
      throw new Error('path 参数不能为空');
    }

    const resolved = resolveProjectPath(filePath);
    const dir = path.dirname(resolved);

    // 检查是否已存在
    let fileExists = false;
    let originalContent = '';
    try {
      originalContent = fs.readFileSync(resolved, 'utf-8');
      fileExists = true;
    } catch {
      fileExists = false;
    }

    // 内容相同
    if (fileExists && originalContent === content) {
      return { path: filePath, success: true, action: 'unchanged' };
    }

    // 创建目录
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // 写入
    fs.writeFileSync(resolved, content, 'utf-8');
    return {
      path: filePath,
      success: true,
      action: fileExists ? 'modified' : 'created',
    };
  },
};
