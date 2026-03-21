/**
 * 多 Agent 系统模块入口
 */

export type { AgentDefinition, AgentManifest } from './types';
export {
  isMultiAgentEnabled,
  loadAgentDefinitions,
  resolveAgentPaths,
  getAgentStatus,
  setAgentEnabled,
} from './registry';
