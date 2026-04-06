/**
 * 多 Agent 系统模块入口
 *
 * 多 Agent 配置分层重构：移除 isMultiAgentEnabled / setAgentEnabled / createManifestIfNotExists。
 * 新增 ensureDefaultAgent（首次运行时自动创建 agents.yaml + master agent）。
 */

export type { AgentDefinition, AgentManifest } from './types';
export {
  loadAgentDefinitions,
  resolveAgentPaths,
  getAgentStatus,
  createAgent,
  updateAgent,
  deleteAgent,
  resetCache,
  ensureDefaultAgent,
} from './registry';
