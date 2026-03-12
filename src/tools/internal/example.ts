/**
 * 示例工具 —— 获取当前时间
 *
 * 这是一个最简单的工具示例，展示如何定义 ToolDefinition。
 * 添加新工具时，参照此文件的结构即可。
 */

import { ToolDefinition } from '../../types';

/** 获取当前时间 */
export const getCurrentTime: ToolDefinition = {
  parallel: true,
  declaration: {
    name: 'get_current_time',
    description: '获取当前的日期和时间',
  },
  handler: async () => {
    const now = new Date();
    return {
      iso: now.toISOString(),
      local: now.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
      timestamp: now.getTime(),
    };
  },
};
