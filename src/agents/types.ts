/**
 * 多 Agent 系统类型定义
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

/** agents.yaml 文件结构 */
export interface AgentManifest {
  /** 全局开关：是否启用多 Agent 模式 */
  enabled: boolean;
  /** Agent 定义列表 */
  agents: Record<string, Omit<AgentDefinition, 'name'>>;
}
