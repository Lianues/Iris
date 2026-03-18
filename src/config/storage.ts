/**
 * 存储配置解析
 */

import { StorageConfig } from './types';
import { sessionsDir, sessionDbPath } from '../paths';

export function parseStorageConfig(raw: any = {}): StorageConfig {
  return {
    type: (raw.type ?? 'json-file') as StorageConfig['type'],
    dir: raw.dir ?? sessionsDir,
    dbPath: raw.dbPath ?? sessionDbPath,
  };
}
