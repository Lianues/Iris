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
import { configDir as globalConfigDir, dataDir as globalDataDir, projectRoot } from '../paths';
import { EMBEDDED_CONFIG_DEFAULTS } from './embedded-defaults';
import type { AgentPaths } from '../paths';
import { AppConfig, GlobalConfig } from './types';
import { parseLLMConfig } from './llm';
import { parseOCRConfig } from './ocr';
import { fieldOverride, entryMerge } from './merge';
import type { ConfigSectionKey } from './raw';
import { parsePlatformConfig } from './platform';
import { parseStorageConfig } from './storage';
import { parseToolsConfig } from './tools';
import { parseSystemConfig } from './system';
import { parseMCPConfig } from './mcp';
import { parseModeConfig } from './mode';
import { parseSubAgentsConfig } from './sub_agents';
import { loadRawConfigDir } from './raw';
import { parsePluginsConfig } from './plugins';
import { parseSummaryConfig } from './summary';
import { parseNetConfig } from './net';

export type {
  AppConfig,
  GlobalConfig,
  LLMConfig,
  LLMModelDef,
  LLMRegistryConfig,
  PlatformConfig,
  StorageConfig,
  ToolPolicyConfig,
  ToolsConfig,
  SystemConfig,
  MCPConfig,
  MCPServerConfig,
  SummaryConfig,
  SubAgentsConfig,
  SubAgentTypeDef,
} from './types';
export type { OCRConfig } from './ocr';

/**
 * 返回配置目录的绝对路径。
 *
 * @param customConfigDir  指定配置目录（Agent 模式使用）
 * @param isAgentDir       是否为 Agent 的 configDir（true 时不阻断启动）
 *
 * 查找顺序：
 *   1. customConfigDir（若提供）或 ~/.iris/configs/
 *   2. 自动从项目的 data/configs.example/ 初始化到目标目录
 *
 * 多 Agent 配置分层重构：Agent 的 configDir 不存在时仅创建空目录，
 * 不再 process.exit(0) 要求填写 API Key——因为 LLM 等全局配置来自全局层。
 * 只有全局 configDir 首次初始化时才阻断启动。
 */
export function findConfigFile(customConfigDir?: string, isAgentDir?: boolean): string {
  const targetDir = customConfigDir || globalConfigDir;
  if (fs.existsSync(targetDir) && fs.statSync(targetDir).isDirectory()) {
    return targetDir;
  }

  // 多 Agent 分层重构：Agent 的 configDir 不存在时只创建空目录，不阻断启动。
  // Agent 的配置通过 loadAgentConfig 从全局配置继承，空 configs/ = 完全继承全局。
  if (isAgentDir) {
    fs.mkdirSync(targetDir, { recursive: true });
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
      initAgentsData(projectRoot, globalDataDir);
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
    initAgentsData(projectRoot, globalDataDir);
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
  // Skill 文件系统扫描需要数据目录：Agent 模式用 agentPaths.dataDir，否则用全局 dataDir
  const effectiveDataDir = agentPaths?.dataDir || globalDataDir;

  return {
    llm: parseLLMConfig(data.llm),
    ocr: parseOCRConfig(data.ocr),
    platform: parsePlatformConfig(data.platform),
    storage: parseStorageConfig(data.storage, agentPaths),
    tools: parseToolsConfig(data.tools),
    system: parseSystemConfig(data.system, effectiveDataDir),
    mcp: parseMCPConfig(data.mcp),
    modes: parseModeConfig(data.modes),
    subAgents: parseSubAgentsConfig(data.sub_agents),
    plugins: parsePluginsConfig(data.plugins),
    summary: parseSummaryConfig(data.summary),
    net: parseNetConfig(data.net),
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

// ============ 分层配置加载（多 Agent 配置分层重构） ============

/** loadGlobalConfig 的返回值类型 */
export interface GlobalConfigResult {
  config: GlobalConfig;
  /** 全部原始数据，用于第二类配置与 Agent 层合并 */
  raw: Partial<Record<ConfigSectionKey, any>>;
}

/**
 * 加载全局配置（从 ~/.iris/configs/ 读取所有文件）。
 *
 * 多 Agent 配置分层重构：全局配置只加载一次，由 IrisHost 持有。
 * 返回 GlobalConfig（第一类：全局独占）和 raw 原始数据（用于第二类合并）。
 */
export function loadGlobalConfig(): GlobalConfigResult {
  const configsDir = findConfigFile();
  const raw = loadRawConfigDir(configsDir);

  const config: GlobalConfig = {
    llm: parseLLMConfig(raw.llm),
    ocr: parseOCRConfig(raw.ocr),
    storage: parseStorageConfig(raw.storage),
  };

  return { config, raw };
}

/**
 * 加载 Agent 的最终配置：分层合并全局配置与 Agent 覆盖。
 *
 * 多 Agent 配置分层重构：
 *   - 第一类（llm/ocr/storage）：直接使用全局 config
 *   - 第二类（system/tools/summary/mcp/modes/sub_agents）：读取 Agent 同名文件，与全局 raw 合并
 *   - Agent 目录不存在或为空时：完全继承全局配置
 *
 * @param globalResult  loadGlobalConfig 的返回值
 * @param agentPaths    Agent 专属路径集（不提供时使用全局配置目录）
 */
export function loadAgentConfig(
  globalResult: GlobalConfigResult,
  agentPaths?: AgentPaths,
): AppConfig {
  const { config: globalCfg, raw: globalRaw } = globalResult;

  // 读取 Agent 层的 raw 配置（可能为空对象，表示完全继承）
  let agentRaw: Partial<Record<ConfigSectionKey, any>> = {};
  if (agentPaths?.configDir) {
    // isAgentDir=true：不存在时仅创建空目录，不阻断
    findConfigFile(agentPaths.configDir, true);
    agentRaw = loadRawConfigDir(agentPaths.configDir);
  }

  const effectiveDataDir = agentPaths?.dataDir || globalDataDir;

  // --- 第一类：全局独占，直接使用 ---
  // llm / ocr 来自全局；storage 合并 agentPaths 的路径信息
  const llm = globalCfg.llm;
  const ocr = globalCfg.ocr;
  const storage = parseStorageConfig(globalRaw.storage, agentPaths);

  // --- 第二类字段级覆盖：system / tools / summary ---
  const mergedSystemRaw = fieldOverride(globalRaw.system ?? {}, agentRaw.system);
  const mergedToolsRaw = fieldOverride(globalRaw.tools ?? {}, agentRaw.tools);
  const mergedSummaryRaw = fieldOverride(globalRaw.summary ?? {}, agentRaw.summary);

  // --- 第二类条目级合并：mcp / modes / sub_agents ---
  // mcp: 按 servers key 合并
  const mergedMcpRaw = (globalRaw.mcp || agentRaw.mcp) ? {
    ...fieldOverride(globalRaw.mcp ?? {}, agentRaw.mcp ?? {}),
    servers: entryMerge(globalRaw.mcp?.servers, agentRaw.mcp?.servers),
  } : undefined;

  // modes: 按模式名合并（原始数据是对象形式，key = 模式名）
  const mergedModesRaw = (globalRaw.modes || agentRaw.modes)
    ? entryMerge(globalRaw.modes, agentRaw.modes)
    : undefined;

  // sub_agents: 按 types key 合并，全局 enabled/stream 开关作为基底
  const mergedSubAgentsRaw = (globalRaw.sub_agents || agentRaw.sub_agents) ? {
    ...fieldOverride(globalRaw.sub_agents ?? {}, agentRaw.sub_agents ?? {}),
    types: entryMerge(globalRaw.sub_agents?.types, agentRaw.sub_agents?.types),
  } : undefined;

  // platform: 从全局 raw 读取（不进入 Agent 分层体系）
  const platform = parsePlatformConfig(globalRaw.platform);

  return {
    llm,
    ocr,
    platform,
    storage,
    tools: parseToolsConfig(mergedToolsRaw),
    system: parseSystemConfig(mergedSystemRaw, effectiveDataDir),
    mcp: parseMCPConfig(mergedMcpRaw),
    modes: parseModeConfig(mergedModesRaw),
    subAgents: parseSubAgentsConfig(mergedSubAgentsRaw),
    // plugins 是全局独占配置，只从全局 raw 读取，agent 层不覆盖。
    // 原因：PluginManager 在进程级运行，所有 agent 共享同一组已激活插件（cron、memory 等）。
    // 注意 plugin 是 extension 的一种贡献角色，不是独立系统——详见 src/config/plugins.ts。
    plugins: parsePluginsConfig(globalRaw.plugins),
    summary: parseSummaryConfig(mergedSummaryRaw),
  };
}

