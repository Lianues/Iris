/**
 * 创建目录工具
 *
 * 支持批量创建，自动创建父目录。
 */

import * as fs from 'fs';
import { ToolDefinition } from '../../types';
import { normalizeStringArrayArg, resolveProjectPath } from '../utils';
import { getSkillAccessPreflightRejection } from './skill-access-guard';

interface CreateResult {
  path: string;
  success: boolean;
  error?: string;
}

export const createDirectory: ToolDefinition = {
  declaration: {
    name: 'create_directory',
    description: [
      '创建一个或多个目录（自动创建父目录）。',
      '参数 paths 必须是数组。',
    ].join(''),
  parameters: {
      type: 'object',
      properties: {
        paths: {
          type: 'array',
          description: '要创建的目录路径数组（相对于项目根目录）',
          items: { type: 'string' },
        },
      },
      required: ['paths'],
    },
  },
  handler: async (args) => {
    const pathList = normalizeStringArrayArg(args, {
      arrayKey: 'paths',
      singularKeys: ['path'],
    });

    if (!pathList || pathList.length === 0) {
      throw new Error('paths 参数必须是非空数组');
    }

    const results: CreateResult[] = [];
    let successCount = 0;
    let failCount = 0;

    for (const dirPath of pathList) {
      try {
        const resolved = resolveProjectPath(dirPath);
        const skillAccessRejection = getSkillAccessPreflightRejection(dirPath, resolved);
        if (skillAccessRejection) {
          throw new Error(skillAccessRejection);
        }
        fs.mkdirSync(resolved, { recursive: true });
        results.push({ path: dirPath, success: true });
        successCount++;
      } catch (err) {
        results.push({
          path: dirPath,
          success: false,
          error: err instanceof Error ? err.message : String(err),
        });
        failCount++;
      }
    }

    return { results, successCount, failCount, totalCount: pathList.length };
  },
};
