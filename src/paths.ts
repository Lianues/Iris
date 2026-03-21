/**
 * 统一数据目录管理
 *
 * 所有运行时数据（配置、会话、日志、数据库）集中存放在用户数据目录，
 * 不受 process.chdir() 影响。
 *
 * 默认位置：~/.iris/
 * 环境变量 IRIS_DATA_DIR 可覆盖。
 *
 * 目录结构：
 *   ~/.iris/
 *   ├── configs/       配置文件（yaml）
 *   ├── sessions/      JSON 会话存储
 *   ├── logs/          LLM 请求日志
 *   ├── iris.db        SQLite 会话数据库（可选）
 *   └── memory.db      记忆数据库（可选）
 */

import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';

/** 数据根目录（启动时确定的绝对路径） */
export const dataDir = path.resolve(
  process.env.IRIS_DATA_DIR || path.join(os.homedir(), '.iris')
);

/** 配置文件目录 */
export const configDir = path.join(dataDir, 'configs');

/** JSON 会话存储目录 */
export const sessionsDir = path.join(dataDir, 'sessions');

/** LLM 请求日志目录 */
export const logsDir = path.join(dataDir, 'logs');

/** SQLite 会话数据库默认路径 */
export const sessionDbPath = path.join(dataDir, 'iris.db');

/** 记忆数据库默认路径 */
export const memoryDbPath = path.join(dataDir, 'memory.db');

/** 项目根目录（用于定位 data/configs.example/ 等内置资源） */
const __filename = fileURLToPath(import.meta.url);
export const projectRoot = path.resolve(path.dirname(__filename), '..');

// ============ 多 Agent 路径支持 ============

/** Agent 专属路径集 */
export interface AgentPaths {
  /** Agent 数据根目录 */
  dataDir: string;
  /** 配置文件目录 */
  configDir: string;
  /** JSON 会话存储目录 */
  sessionsDir: string;
  /** LLM 请求日志目录 */
  logsDir: string;
  /** SQLite 会话数据库路径 */
  sessionDbPath: string;
  /** 记忆数据库路径 */
  memoryDbPath: string;
}

/** 获取指定 Agent 的路径集 */
export function getAgentPaths(agentName: string, customDataDir?: string): AgentPaths {
  const agentDataDir = customDataDir
    ? path.resolve(customDataDir)
    : path.join(dataDir, 'agents', agentName);
  return {
    dataDir: agentDataDir,
    configDir: path.join(agentDataDir, 'configs'),
    sessionsDir: path.join(agentDataDir, 'sessions'),
    logsDir: path.join(agentDataDir, 'logs'),
    sessionDbPath: path.join(agentDataDir, 'iris.db'),
    memoryDbPath: path.join(agentDataDir, 'memory.db'),
  };
}

/** 获取默认（单 Agent）路径集，等价于现有全局常量 */
export function getDefaultPaths(): AgentPaths {
  return { dataDir, configDir, sessionsDir, logsDir, sessionDbPath, memoryDbPath };
}
