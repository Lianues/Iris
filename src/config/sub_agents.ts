/**
 * 子代理配置解析
 *
 * 从 sub_agents.yaml 解析子代理类型定义。
 *
 * 覆盖优先级：全局 > 类型独立设置
 *   - enabled: 全局 false 时一键禁用全部子代理，类型级别 enabled 仅在全局 true 时生效
 *   - stream:  全局设置后覆盖所有类型的 stream；不设置则各类型自行决定
 *
 * 配置示例：
 *   enabled: true
 *   stream: true
 *   types:
 *     general-purpose:
 *       enabled: true
 *       description: "执行需要多步工具操作的复杂子任务"
 *       systemPrompt: "你是一个通用子代理..."
 *       excludedTools: [sub_agent]
 *       modelName: gemini_flash
 *       stream: false
 *       parallel: false
 *       maxToolRounds: 200
 *     explore:
 *       enabled: true
 *       description: "只读搜索和阅读文件"
 *       allowedTools: [read_file, shell, bash]
 *       stream: true
 *       parallel: true
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
      enabled: cfg.enabled !== false,
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
      background: cfg.background === true,
      stream: cfg.stream !== false,
      parallel: cfg.parallel === true,
    });
  }

  if (types.length === 0) return undefined;
  return {
    enabled: raw.enabled !== false,
    stream: typeof raw.stream === 'boolean' ? raw.stream : undefined,
    types,
  };
}
