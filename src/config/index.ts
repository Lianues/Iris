/**
 * 配置模块统一入口
 *
 * 从 data/configs/ 目录加载分文件配置。
 *
 * data/configs/ 目录结构：
 *   llm.yaml      - LLM 配置
 *   ocr.yaml      - OCR 配置（可选）
 *   platform.yaml - 平台配置
 *   storage.yaml  - 存储配置
 *   tools.yaml    - 工具执行配置
 *   system.yaml   - 系统配置
 *   memory.yaml   - 记忆配置（可选）
 *   mcp.yaml      - MCP 配置（可选）
 *   modes.yaml    - 模式配置（可选）
 *   sub_agents.yaml - 子代理配置（可选）
 */

import * as fs from 'fs';
import * as path from 'path';
import { AppConfig } from './types';
import { parseLLMConfig } from './llm';
import { parseOCRConfig } from './ocr';
import { parsePlatformConfig } from './platform';
import { parseStorageConfig } from './storage';
import { parseToolsConfig } from './tools';
import { parseSystemConfig } from './system';
import { parseMemoryConfig } from './memory';
import { parseMCPConfig } from './mcp';
import { parseModeConfig } from './mode';
import { parseSubAgentsConfig } from './sub_agents';
import { loadRawConfigDir } from './raw';

export type {
  AppConfig,
  LLMConfig,
  LLMModelDef,
  LLMRegistryConfig,
  PlatformConfig,
  StorageConfig,
  ToolPolicyConfig,
  ToolsConfig,
  SystemConfig,
  MemoryConfig,
  MCPConfig,
  MCPServerConfig,
  SubAgentsConfig,
  SubAgentTypeDef,
} from './types';
export type { OCRConfig } from './ocr';

/** 配置目录 */
const CONFIGS_DIR = 'data/configs';

/**
 * 返回配置目录的绝对路径。
 */
export function findConfigFile(): string {
  const configsDir = path.resolve(process.cwd(), CONFIGS_DIR);
  if (fs.existsSync(configsDir) && fs.statSync(configsDir).isDirectory()) {
    return configsDir;
  }

  throw new Error(
    `未找到配置目录 ${CONFIGS_DIR}/。`
    + '请复制 data/configs.example/ 为 data/configs/ 并填入实际值。',
  );
}

/** 加载配置 */
export function loadConfig(): AppConfig {
  const configsDir = findConfigFile();
  const data = loadRawConfigDir(configsDir);

  return {
    llm: parseLLMConfig(data.llm),
    ocr: parseOCRConfig(data.ocr),
    platform: parsePlatformConfig(data.platform),
    storage: parseStorageConfig(data.storage),
    tools: parseToolsConfig(data.tools),
    system: parseSystemConfig(data.system),
    memory: parseMemoryConfig(data.memory),
    mcp: parseMCPConfig(data.mcp),
    modes: parseModeConfig(data.modes),
    subAgents: parseSubAgentsConfig(data.sub_agents),
  };
}
