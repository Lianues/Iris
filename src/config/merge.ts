/**
 * 配置分层合并工具
 *
 * 多 Agent 配置分层重构的核心模块。提供两种合并策略：
 *
 * 1. fieldOverride — 字段级覆盖（浅合并顶层字段）
 *    agent 层有的字段覆盖 global，没有的保留 global 值。
 *    用于 system.yaml、tools.yaml、summary.yaml
 *
 * 2. entryMerge — 条目级合并（按 key 合并两个字典）
 *    agent 层同名条目覆盖 global，新增条目追加。
 *    用于 mcp.yaml (servers)、modes.yaml、sub_agents.yaml (types)
 */

/**
 * 字段级覆盖：浅合并顶层字段。
 *
 * agent 层有的字段覆盖 global 同名字段，没有的字段继承 global 值。
 * 设计原因：system.yaml、tools.yaml、summary.yaml 的顶层字段各自独立，
 * agent 只需覆盖想改的部分，其余保留全局默认。
 */
export function fieldOverride<T extends Record<string, unknown>>(
  global: T,
  agent: Partial<T> | undefined,
): T {
  if (!agent || Object.keys(agent).length === 0) return global;
  // 浅合并：agent 的同名字段覆盖 global
  return { ...global, ...agent };
}

/**
 * 条目级合并：按条目 key 合并两个字典集合。
 *
 * agent 层同名条目覆盖 global 定义，新增条目追加。
 * 设计原因：mcp.yaml 的 servers、modes.yaml 的模式定义、sub_agents.yaml 的 types
 * 都是按 key 索引的独立条目集合，合并语义是"同名替换、新增追加"。
 */
export function entryMerge<T>(
  global: Record<string, T> | undefined,
  agent: Record<string, T> | undefined,
): Record<string, T> | undefined {
  if (!global && !agent) return undefined;
  if (!global) return agent;
  if (!agent) return global;
  // agent 同名 key 覆盖 global，新 key 追加
  return { ...global, ...agent };
}
