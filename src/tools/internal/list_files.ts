/**
 * 列出文件工具
 *
 * 支持批量列出多个目录，支持递归。
 */

import * as fs from 'fs';
import * as path from 'path';
import { ToolDefinition } from '../../types';
import { resolveProjectPath } from '../utils';
import { getToolLimits } from '../tool-limits';
import { getSkillAccessPreflightRejection, isSkillAccessPreflightBlockedPath } from './skill-access-guard';

const DEFAULT_IGNORED = new Set(['.git', 'node_modules']);

interface Entry {
  name: string;
  type: 'file' | 'directory';
}

interface ListResult {
  path: string;
  entries: Entry[];
  fileCount: number;
  dirCount: number;
  success: boolean;
  error?: string;
}

function listRecursive(dirPath: string, basePath: string, entries: Entry[], maxEntries: number): boolean {
  const items = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const item of items) {
    if (DEFAULT_IGNORED.has(item.name)) continue;
    if (entries.length >= maxEntries) return true;
    const relativePath = basePath ? path.join(basePath, item.name) : item.name;
    const absolutePath = path.join(dirPath, item.name);
    if (isSkillAccessPreflightBlockedPath(absolutePath) || isSkillAccessPreflightBlockedPath(relativePath)) continue;
    if (item.isDirectory()) {
      entries.push({ name: relativePath + '/', type: 'directory' });
      if (listRecursive(absolutePath, relativePath, entries, maxEntries)) return true;
    } else if (item.isFile()) {
      entries.push({ name: relativePath, type: 'file' });
    }
  }
  return false;
}

export const listFiles: ToolDefinition = {
  parallel: true,
  declaration: {
    name: 'list_files',
    description: [
      '列出一个或多个目录中的文件和子目录。',
      '默认忽略 .git 和 node_modules。',
      '支持递归列出。',
      '参数 paths 必须是数组。',
    ].join(''),
    parameters: {
      type: 'object',
      properties: {
        paths: {
          type: 'array',
          description: '目录路径数组（相对于项目根目录），默认为 ["."\]',
          items: { type: 'string' },
        },
        recursive: {
          type: 'boolean',
          description: '是否递归列出子目录，默认 false',
        },
      },
      required: ['paths'],
    },
  },
  handler: async (args) => {
    const maxEntries = getToolLimits().list_files.maxEntries;

    let pathList = args.paths as string[] | undefined;
    if (!pathList || !Array.isArray(pathList) || pathList.length === 0) {
      pathList = ['.'];
    }
    const recursive = (args.recursive as boolean) ?? false;

    const results: ListResult[] = [];
    let totalFiles = 0;
    let totalDirs = 0;
    let truncated = false;

    for (const dirPath of pathList) {
      try {
        const resolved = resolveProjectPath(dirPath);
        const skillAccessRejection = getSkillAccessPreflightRejection(dirPath, resolved);
        if (skillAccessRejection) {
          throw new Error(skillAccessRejection);
        }
        const entries: Entry[] = [];
        let dirTruncated = false;

        if (recursive) {
          dirTruncated = listRecursive(resolved, '', entries, maxEntries);
        } else {
          const items = fs.readdirSync(resolved, { withFileTypes: true });
          for (const item of items) {
            if (DEFAULT_IGNORED.has(item.name)) continue;
            const absolutePath = path.join(resolved, item.name);
            if (isSkillAccessPreflightBlockedPath(absolutePath) || isSkillAccessPreflightBlockedPath(item.name)) continue;
            if (item.isDirectory()) {
              entries.push({ name: item.name + '/', type: 'directory' });
            } else if (item.isFile()) {
              entries.push({ name: item.name, type: 'file' });
            }
          }
        }

        // 排序：目录在前，文件在后
        entries.sort((a, b) => {
          if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
          return a.name.localeCompare(b.name);
        });

        const fileCount = entries.filter(e => e.type === 'file').length;
        const dirCount = entries.filter(e => e.type === 'directory').length;

        const listResult: ListResult = { path: dirPath, entries, fileCount, dirCount, success: true };
        if (dirTruncated) {
          listResult.error = `条目数达到上限 (${maxEntries})，结果已截断`;
          truncated = true;
        }
        results.push(listResult);
        totalFiles += fileCount;
        totalDirs += dirCount;
      } catch (err) {
        results.push({
          path: dirPath,
          entries: [],
          fileCount: 0,
          dirCount: 0,
          success: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const output: Record<string, unknown> = { results, totalFiles, totalDirs, totalPaths: pathList.length };
    if (truncated) output.truncated = true;
    return output;
  },
};
