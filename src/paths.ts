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
 *   ├── attachments/   消息附件（截图等二进制文件）
 *   ├── iris.db        SQLite 会话数据库（可选）
 *   └── memory.db      记忆数据库（可选）
 */

import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
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

/** 消息附件存储目录（截图等大型二进制文件） */
export const attachmentsDir = path.join(dataDir, 'attachments');

/** SQLite 会话数据库默认路径 */
export const sessionDbPath = path.join(dataDir, 'iris.db');

/** 记忆数据库默认路径 */
export const memoryDbPath = path.join(dataDir, 'memory.db');

/** 已安装 extension 目录 */
export const extensionsDir = path.join(dataDir, 'extensions');

/** 项目根目录（用于定位 data/configs.example/ 等内置资源） */
const __filename_paths = fileURLToPath(import.meta.url);

function resolveProjectRoot(): string {
  // 1. 源码 / bun run 开发模式：import.meta.url 直接定位
  const srcRoot = path.resolve(path.dirname(__filename_paths), '..');
  if (fs.existsSync(path.join(srcRoot, 'data'))) {
    return srcRoot;
  }

  // 2. 编译后二进制：import.meta.url 指向虚拟路径 (/$bunfs/)，
  //    实际二进制位于 <dist>/bin/iris，data/ 在 <dist>/data/
  try {
    const realBinary = fs.realpathSync(process.execPath);
    const binParent = path.resolve(path.dirname(realBinary), '..');

    // 独立二进制发行包：binParent 直接包含 data/ + extensions/，直接返回
    if (fs.existsSync(path.join(binParent, 'data')) && fs.existsSync(path.join(binParent, 'extensions'))) {
      return binParent;
    }

    // npm 包装器场景：binParent 是包装器目录（可能没有 data/），
    // 实际平台包在 node_modules/irises-* 下，搜索平台包作为 projectRoot
    const nodeModulesDir = path.join(binParent, 'node_modules');
    if (fs.existsSync(nodeModulesDir)) {
      for (const entry of fs.readdirSync(nodeModulesDir)) {
        if (!entry.startsWith('irises-')) continue;
        const candidate = path.join(nodeModulesDir, entry);
        if (fs.existsSync(path.join(candidate, 'data')) && fs.existsSync(path.join(candidate, 'extensions'))) {
          return candidate;
        }
      }
    }
  } catch {
    // ignore — realpathSync 可能在某些环境下失败
  }

  return srcRoot;
}

export const projectRoot = resolveProjectRoot();

/** 源码仓库中的 extension 收录目录 */
export const workspaceExtensionsDir = path.join(projectRoot, 'extensions');

/** 是否运行在编译后的独立二进制中（import.meta.url 对应的 data/ 不存在） */
export const isCompiledBinary = !fs.existsSync(
  path.join(path.resolve(path.dirname(__filename_paths), '..'), 'data')
);

// ============ 多 Agent 路径支持 ============

/** Agent 专属路径集 */
export interface AgentPaths {
  /** Agent 数据根目录 */
  dataDir: string;
  /** 消息附件存储目录 */
  attachmentsDir: string;
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
    attachmentsDir: path.join(agentDataDir, 'attachments'),
    sessionsDir: path.join(agentDataDir, 'sessions'),
    logsDir: path.join(agentDataDir, 'logs'),
    sessionDbPath: path.join(agentDataDir, 'iris.db'),
    memoryDbPath: path.join(agentDataDir, 'memory.db'),
  };
}

/** 获取默认（单 Agent）路径集，等价于现有全局常量 */
export function getDefaultPaths(): AgentPaths {
  return { dataDir, configDir, attachmentsDir, sessionsDir, logsDir, sessionDbPath, memoryDbPath };
}
