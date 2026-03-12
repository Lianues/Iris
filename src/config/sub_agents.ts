/**
 * 子代理配置解析
 *
 * 从 sub_agents.yaml 解析子代理类型定义。
 *
 * 配置示例（parallel 为子代理类型自己的并行调度开关，默认 false）：
 *   types:
 *     general-purpose:
 *       description: "执行需要多步工具操作的复杂子任务"
 *       systemPrompt: "你是一个通用子代理..."
 *       excludedTools: [sub_agent]
 *       modelName: gemini_flash
 *       parallel: false
 *       maxToolRounds: 200
 *     explore:
 *       description: "只读搜索和阅读文件"
 *       allowedTools: [read_file, shell]
 *       parallel: false
 *       maxToolRounds: 200
 */

import { SubAgentsConfig, SubAgentTypeDef } from './types';

function normalizeModelName(cfg: Record<string, any>): string | undefined {
  if (typeof cfg.modelName === 'string' && cfg.modelName.trim()) {
    return cfg.modelName.trim();
  }
  return undefined;
}

export function parseSubAgentsConfig(raw: any): SubAgentsConfig | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  if (!raw.types || typeof raw.types !== 'object' || Array.isArray(raw.types)) return undefined;

  const types: SubAgentTypeDef[] = [];

  for (const [name, value] of Object.entries(raw.types)) {
    if (!value || typeof value !== 'object') continue;
    const cfg = value as Record<string, any>;

    types.push({
      name,
      description: typeof cfg.description === 'string' ? cfg.description : '',
      systemPrompt: typeof cfg.systemPrompt === 'string' ? cfg.systemPrompt : '',
      allowedTools: Array.isArray(cfg.allowedTools)
        ? cfg.allowedTools.filter((s: any) => typeof s === 'string')
        : undefined,
      excludedTools: Array.isArray(cfg.excludedTools)
        ? cfg.excludedTools.filter((s: any) => typeof s === 'string')
        : undefined,
      modelName: normalizeModelName(cfg),
      maxToolRounds: typeof cfg.maxToolRounds === 'number' && cfg.maxToolRounds > 0
        ? cfg.maxToolRounds
        : 200,
      parallel: cfg.parallel === true,
    });
  }

  if (types.length === 0) return undefined;
  return { types };
}
