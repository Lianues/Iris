/**
 * 配置模块统一入口
 *
 * 从 ~/.iris/configs/ 目录加载分文件配置。
 *
 * 配置文件：
 *   llm.yaml        - LLM 配置
 *   ocr.yaml      - OCR 配置（可选）
 *   platform.yaml - 平台配置
 *   storage.yaml  - 存储配置
 *   tools.yaml    - 工具执行配置
 *   system.yaml   - 系统配置
 *   memory.yaml   - 记忆配置（可选）
 *   mcp.yaml      - MCP 配置（可选）
 *   modes.yaml    - 模式配置（可选）
 *   sub_agents.yaml - 子代理配置（可选）
 *   plugins.yaml  - 插件配置（可选）
 */

import * as fs from 'fs';
import * as path from 'path';
import { configDir as globalConfigDir, dataDir, projectRoot } from '../paths';
import { EMBEDDED_CONFIG_DEFAULTS } from './embedded-defaults';
import type { AgentPaths } from '../paths';
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
import { parseComputerUseConfig } from './computer-use';
import { loadRawConfigDir } from './raw';
import { parsePluginsConfig } from './plugins';
import { parseSummaryConfig } from './summary';

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
  SummaryConfig,
  SubAgentsConfig,
  SubAgentTypeDef,
} from './types';
export type { OCRConfig } from './ocr';
export type { ComputerUseConfig } from './types';

/**
 * 返回配置目录的绝对路径。
 *
 * @param customConfigDir  指定配置目录（多 Agent 模式使用）
 *
 * 查找顺序：
 *   1. customConfigDir（若提供）或 ~/.iris/configs/
 *   2. 自动从项目的 data/configs.example/ 初始化到目标目录
 */
export function findConfigFile(customConfigDir?: string): string {
  const targetDir = customConfigDir || globalConfigDir;
  if (fs.existsSync(targetDir) && fs.statSync(targetDir).isDirectory()) {
    return targetDir;
  }

  // 2. 首次运行：从项目模板自动初始化
  const exampleDir = path.join(projectRoot, 'data/configs.example');
  if (fs.existsSync(exampleDir) && fs.statSync(exampleDir).isDirectory()) {
    fs.mkdirSync(path.dirname(targetDir), { recursive: true });
    fs.cpSync(exampleDir, targetDir, { recursive: true });
    console.log(`[Iris] 已初始化配置目录: ${targetDir}`);

    // 初始化全局配置时，同时拷贝 agents.yaml 和示例 agent 配置
    if (!customConfigDir) {
      initAgentsData(projectRoot, dataDir);
    }

    console.log('[Iris] 请编辑配置文件（至少填写 LLM API Key）后重新启动。');
    process.exit(0);
    return targetDir;
  }

  // 3. 兜底：使用内嵌默认配置初始化（编译后二进制且 data/ 不可用时）
  console.log('[Iris] 未找到配置模板目录，使用内嵌默认配置初始化...');
  fs.mkdirSync(targetDir, { recursive: true });
  for (const [filename, content] of Object.entries(EMBEDDED_CONFIG_DEFAULTS)) {
    fs.writeFileSync(path.join(targetDir, filename), content, 'utf-8');
  }

  // 初始化全局配置时，同时尝试拷贝 agents 数据（若源文件可用）
  if (!customConfigDir) {
    initAgentsData(projectRoot, dataDir);
  }

  console.log(`[Iris] 已初始化配置目录: ${targetDir}`);
  console.log('[Iris] 请编辑配置文件（至少填写 LLM API Key）后重新启动。');
  process.exit(0);
  return targetDir;
}

/**
 * 加载配置。
 * @param customConfigDir  指定配置目录（多 Agent 模式使用）
 * @param agentPaths       Agent 专属路径集，用于填充存储/记忆的默认路径
 */
export function loadConfig(customConfigDir?: string, agentPaths?: AgentPaths): AppConfig {
  const configsDir = findConfigFile(customConfigDir);
  const data = loadRawConfigDir(configsDir);

  return {
    llm: parseLLMConfig(data.llm),
    ocr: parseOCRConfig(data.ocr),
    platform: parsePlatformConfig(data.platform),
    storage: parseStorageConfig(data.storage, agentPaths),
    tools: parseToolsConfig(data.tools),
    system: parseSystemConfig(data.system),
    memory: parseMemoryConfig(data.memory, agentPaths),
    mcp: parseMCPConfig(data.mcp),
    modes: parseModeConfig(data.modes),
    subAgents: parseSubAgentsConfig(data.sub_agents),
    computerUse: parseComputerUseConfig(data.computer_use),
    plugins: parsePluginsConfig(data.plugins),
    summary: parseSummaryConfig(data.summary),
  };
}


/**
 * 将配置目录重置为默认值。
 * 优先从 data/configs.example/ 复制，不可用时使用内嵌默认配置。
 */
export function resetConfigToDefaults(): { success: boolean; message: string } {
  // 确保目标目录存在
  if (!fs.existsSync(globalConfigDir)) {
    fs.mkdirSync(globalConfigDir, { recursive: true });
  }

  const exampleDir = path.join(projectRoot, 'data/configs.example');
  if (fs.existsSync(exampleDir) && fs.statSync(exampleDir).isDirectory()) {
    fs.cpSync(exampleDir, globalConfigDir, { recursive: true });
    return { success: true, message: `配置已重置为默认值: ${globalConfigDir}` };
  }

  // 兜底：使用内嵌默认配置
  for (const [filename, content] of Object.entries(EMBEDDED_CONFIG_DEFAULTS)) {
    fs.writeFileSync(path.join(globalConfigDir, filename), content, 'utf-8');
  }
  return { success: true, message: `配置已重置为默认值: ${globalConfigDir}` };
}


/**
 * 首次初始化时拷贝 agents.yaml 和示例 agent 配置到数据目录。
 * 仅在全局 configs 首次初始化时调用（不影响已有数据）。
 */
function initAgentsData(projRoot: string, dataDirPath: string): void {
  // 拷贝 agents.yaml.example → ~/.iris/agents.yaml
  const agentsYamlExample = path.join(projRoot, 'data/agents.yaml.example');
  const agentsYamlTarget = path.join(dataDirPath, 'agents.yaml');
  if (fs.existsSync(agentsYamlExample) && !fs.existsSync(agentsYamlTarget)) {
    fs.copyFileSync(agentsYamlExample, agentsYamlTarget);
    console.log(`[Iris] 已初始化多 Agent 配置: ${agentsYamlTarget}`);
  }

  // 拷贝 agents.example/ → ~/.iris/agents/
  const agentsExampleDir = path.join(projRoot, 'data/agents.example');
  const agentsTargetDir = path.join(dataDirPath, 'agents');
  if (fs.existsSync(agentsExampleDir) && !fs.existsSync(agentsTargetDir)) {
    fs.cpSync(agentsExampleDir, agentsTargetDir, { recursive: true });
    console.log(`[Iris] 已初始化示例 Agent 配置: ${agentsTargetDir}`);
  }
}
