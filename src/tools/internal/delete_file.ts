/**
 * 删除文件/目录工具
 *
 * 支持批量删除，支持非空目录递归删除。
 */

import * as fs from 'fs';
import { ToolDefinition } from '../../types';
import { normalizeStringArrayArg, resolveProjectPath } from '../utils';
import { getSkillAccessPreflightRejection, isProtectedSkillPathOrAncestor } from './skill-access-guard';

interface DeleteResult {
  path: string;
  success: boolean;
  error?: string;
}

export const deleteFile: ToolDefinition = {
  declaration: {
    name: 'delete_file',
    description: [
      '删除一个或多个文件或目录。',
      '支持删除非空目录（递归删除）。',
      '参数 paths 必须是数组。',
    ].join(''),
    parameters: {
      type: 'object',
      properties: {
        paths: {
          type: 'array',
          description: '要删除的文件或目录路径数组（相对于项目根目录）',
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

    const results: DeleteResult[] = [];
    let successCount = 0;
    let failCount = 0;

    for (const filePath of pathList) {
      try {
        const resolved = resolveProjectPath(filePath);
        const skillAccessRejection = getSkillAccessPreflightRejection(filePath, resolved);
        if (skillAccessRejection || isProtectedSkillPathOrAncestor(resolved)) {
          throw new Error(skillAccessRejection || 'Direct access to Skill directories is blocked. Use read_skill_resource or execute_skill_script instead.');
        }
        fs.rmSync(resolved, { recursive: true, force: true });
        results.push({ path: filePath, success: true });
        successCount++;
      } catch (err) {
        results.push({
          path: filePath,
          success: false,
          error: err instanceof Error ? err.message : String(err),
        });
        failCount++;
      }
    }

    return { results, successCount, failCount, totalCount: pathList.length };
  },
};
