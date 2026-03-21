/**
 * 记忆配置解析
 */

import { MemoryConfig } from './types';
import { memoryDbPath } from '../paths';
import type { AgentPaths } from '../paths';

export function parseMemoryConfig(raw: any, agentPaths?: AgentPaths): MemoryConfig {
  if (!raw) return { enabled: false };
  return {
    enabled: raw.enabled ?? false,
    dbPath: raw.dbPath ?? agentPaths?.memoryDbPath ?? memoryDbPath,
  };
}
