/**
 * 模式配置解析
 *
 * 从 config.yaml 的 modes 字段解析出 ModeDefinition 数组。
 *
 * 配置示例：
 *   modes:
 *     code:
 *       description: "代码开发模式"
 *       systemPrompt: "你是一个代码助手..."
 *       tools:
 *         exclude: [memory_add, memory_delete]
 *     readonly:
 *       description: "只读分析模式"
 *       tools:
 *         include: [read_file, memory_search, get_current_time]
 */

import { ModeDefinition, ToolFilter } from '../modes/types';

export function parseModeConfig(data: any): ModeDefinition[] {
  if (!data || typeof data !== 'object') return[];

  const modes: ModeDefinition[] = [];

  for (const [name, raw] of Object.entries(data)) {
    if (!raw || typeof raw !== 'object') continue;
    const cfg = raw as Record<string, any>;

    let tools: ToolFilter | undefined;
    if (cfg.tools && typeof cfg.tools === 'object') {
      tools = {};
      if (Array.isArray(cfg.tools.include)) {
        tools.include = cfg.tools.include.filter((s: any) => typeof s === 'string');
      }
      if (Array.isArray(cfg.tools.exclude)){
        tools.exclude = cfg.tools.exclude.filter((s: any) => typeof s === 'string');
      }
    }

    modes.push({
      name,
      description: typeof cfg.description === 'string' ? cfg.description : undefined,
      systemPrompt: typeof cfg.systemPrompt === 'string' ? cfg.systemPrompt : undefined,
      tools,
    });
  }

  return modes;
}
