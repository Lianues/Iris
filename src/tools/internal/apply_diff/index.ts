/**
 * Diff 补丁工具
 *
 * 将 unified diff 格式的补丁应用到指定文件。
 * 支持多个 hunk，每个 hunk 先按行号定位，失败时全局搜索上下文。
 * 裸 @@ （无行号）自动兜底为全局精确搜索替换。
 */

import * as fs from 'fs/promises';
import { ToolDefinition } from '@/types';
import { resolveProjectPath } from '../../utils';
import {
  parseUnifiedDiff,
  applyUnifiedDiffBestEffort,
  convertHunksToSearchReplace,
  parseLoosePatchToSearchReplace,
  applySearchReplaceBestEffort,
} from './unified_diff';

export const applyDiff: ToolDefinition = {
  declaration: {
    name: 'apply_diff',
    description: [
      '将 unified diff 补丁应用到指定文件。',
      '补丁格式：每个 hunk 以 @@ -oldStart,oldCount +newStart,newCount @@ 开头，',
      '后跟以空格开头的上下文行、以 - 开头的删除行、以 + 开头的添加行。',
      '可包含多个 hunk。不需要 ---/+++ 文件头。',
      '每个 hunk 先按行号定位，失败时全局搜索上下文。',
      '裸 @@ （无行号）也支持，将兜底为全局精确搜索替换。',
    ].join(''),
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: '文件路径（相对于项目根目录）',
        },
        patch: {
          type: 'string',
          description: [
            'Unified diff 补丁内容。',
            '每个 hunk 以 @@ -oldStart,oldCount +newStart,newCount @@ 开头。',
            '行前缀：空格=上下文，-=删除，+=添加。',
            '不需要 ---/+++ 文件头。',
          ].join(''),
        },
      },
      required: ['path', 'patch'],
    },
  },
  handler: async (args) => {
    const filePath = args.path as string;
    const patch = args.patch as string;

    const resolved = resolveProjectPath(filePath);
    const content = await fs.readFile(resolved, 'utf-8');

    let newContent: string;
    let appliedCount: number;
    let failedCount: number;
    let totalHunks: number;
    let results: Array<{ index: number; success: boolean; error?: string }>;
    let fallbackMode: string = 'none';

    try {
      // 标准 unified diff 解析
      const parsed = parseUnifiedDiff(patch);
      const applied = applyUnifiedDiffBestEffort(content, parsed);

      totalHunks = parsed.hunks.length;
      appliedCount = applied.results.filter(r => r.ok).length;
      failedCount = totalHunks - appliedCount;
      newContent = applied.newContent;
      results = applied.results.map(r => ({
        index: r.index,
        success: r.ok,
        error: r.error,
  }));

      // 如果有 hunk 失败，尝试用 search/replace 兜底
      if (appliedCount < totalHunks) {
        const srBlocks = convertHunksToSearchReplace(parsed.hunks);
        const srResult = applySearchReplaceBestEffort(content, srBlocks);

        if (srResult.appliedCount > appliedCount) {
          appliedCount = srResult.appliedCount;
          failedCount = srResult.failedCount;
          newContent = srResult.newContent;
          results = srResult.results.map(r => ({
            index: r.index,
            success: r.success,
            error: r.error,
          }));
          fallbackMode = 'unified_hunks_search_replace';
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);

      // 裸 @@ 兜底
      if (msg.startsWith('Invalid hunk header')) {
        const looseBlocks = parseLoosePatchToSearchReplace(patch);
        const looseResult = applySearchReplaceBestEffort(content, looseBlocks);

        totalHunks = looseBlocks.length;
        appliedCount = looseResult.appliedCount;
        failedCount = looseResult.failedCount;
        newContent = looseResult.newContent;
        results = looseResult.results.map(r => ({
          index: r.index,
          success: r.success,
          error: r.error,
        }));
        fallbackMode = 'loose_hunk_search_replace';
      } else {
        throw e;
      }
    }

    // 全部失败不写入
    if (appliedCount === 0) {
      const firstError = results.find(r => !r.success)?.error || 'All hunks failed';
      throw new Error(`所有 hunk 均失败: ${firstError}`);
    }

    await fs.writeFile(resolved, newContent, 'utf-8');

    return {
      path: filePath,
      totalHunks,
      applied: appliedCount,
      failed: failedCount,
      results,
      fallbackMode,
    };
  },
};
