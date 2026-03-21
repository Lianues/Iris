/**
 * 存储配置解析
 */

import { StorageConfig } from './types';
import { sessionsDir, sessionDbPath } from '../paths';
import type { AgentPaths } from '../paths';

export function parseStorageConfig(raw: any = {}, agentPaths?: AgentPaths): StorageConfig {
  return {
    type: (raw.type ?? 'json-file') as StorageConfig['type'],
    dir: raw.dir ?? agentPaths?.sessionsDir ?? sessionsDir,
    dbPath: raw.dbPath ?? agentPaths?.sessionDbPath ?? sessionDbPath,
  };
}
