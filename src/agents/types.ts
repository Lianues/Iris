/**
 * 多 Agent 系统类型定义
 *
 * 多 Agent 配置分层重构：移除 AgentManifest.enabled 字段。
 * agents.yaml 存在即生效，不再需要 enabled 开关。
 * 系统永远以 agent 为单位运行，至少有一个 master agent。
 */

/** 单个 Agent 定义 */
export interface AgentDefinition {
  /** Agent 名称（唯一标识，来自 agents.yaml 的键名） */
  name: string;
  /** 描述（可选，用于 TUI 选择界面和日志） */
  description?: string;
  /** 自定义数据根目录（可选，默认 ~/.iris/agents/<name>/） */
  dataDir?: string;
}

/**
 * agents.yaml 文件结构
 *
 * 多 Agent 配置分层重构：移除 enabled 字段。
 * agents.yaml 存在即表示多 Agent 模式已配置，不需要额外开关。
 */
export interface AgentManifest {
  /** Agent 定义列表 */
  agents: Record<string, Omit<AgentDefinition, 'name'>>;
}
