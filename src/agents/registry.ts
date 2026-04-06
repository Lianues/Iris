/**
 * Agent 注册表
 *
 * 从 ~/.iris/agents.yaml 加载 Agent 配置。
 *
 * 多 Agent 配置分层重构：
 *   - 移除 enabled 开关和单/多 Agent 模式分叉。
 *   - agents.yaml 存在即生效，系统永远以 agent 为单位运行。
 *   - 创建新 agent 只创建空 configs/ 目录，不再复制模板配置。
 *   - 移除 isMultiAgentEnabled / setAgentEnabled / createManifestIfNotExists。
 */

import * as fs from 'fs';
import * as path from 'path';
import { parse as parseYAML, stringify as stringifyYAML } from 'yaml';
import { dataDir, getAgentPaths } from '../paths';
import type { AgentPaths } from '../paths';
import type { AgentDefinition, AgentManifest } from './types';

/** agents.yaml 路径 */
const AGENTS_MANIFEST_PATH = path.join(dataDir, 'agents.yaml');

/** 缓存解析结果，避免重复读取文件 */
let _cachedManifest: AgentManifest | null | undefined;

function loadManifest(): AgentManifest | null {
  if (_cachedManifest !== undefined) return _cachedManifest;

  if (!fs.existsSync(AGENTS_MANIFEST_PATH)) {
    _cachedManifest = null;
    return null;
  }

  try {
    const raw = fs.readFileSync(AGENTS_MANIFEST_PATH, 'utf-8');
    const parsed = parseYAML(raw);
    if (!parsed || typeof parsed !== 'object') {
      _cachedManifest = null;
      return null;
    }
    _cachedManifest = parsed as AgentManifest;
    return _cachedManifest;
  } catch (err) {
    // 修复：YAML 解析异常（如重复键 DUPLICATE_KEY）不应被静默吞掉，
    // 否则会导致所有 agent 定义丢失、平台无法创建等级联故障。
    console.error(`[Iris] agents.yaml 解析失败，请检查文件格式:`, (err as Error).message ?? err);
    _cachedManifest = null;
    return null;
  }
}

/**
 * 加载 Agent 定义列表。
 *
 * 多 Agent 配置分层重构：不再需要 isMultiAgentEnabled 判断。
 * agents.yaml 存在即返回其中定义的所有 agent。
 * 不存在时返回空数组（IrisHost 会自动创建 master）。
 */
export function loadAgentDefinitions(): AgentDefinition[] {
  const manifest = loadManifest();
  if (!manifest?.agents || typeof manifest.agents !== 'object') {
    return [];
  }

  return Object.entries(manifest.agents).map(([name, def]) => ({
    name,
    description: typeof def?.description === 'string' ? def.description : undefined,
    dataDir: typeof def?.dataDir === 'string' ? def.dataDir : undefined,
  }));
}

/** 解析 Agent 的路径集 */
export function resolveAgentPaths(agent: AgentDefinition): AgentPaths {
  return getAgentPaths(agent.name, agent.dataDir);
}

/**
 * 获取 Agent 系统的完整状态。
 *
 * 多 Agent 配置分层重构：移除 exists 和 enabled 字段。
 * agents.yaml 存在即生效，不再需要开关。
 */
export function getAgentStatus(): {
  agents: AgentDefinition[];
  manifestPath: string;
} {
  const manifest = loadManifest();
  const agents = manifest?.agents && typeof manifest.agents === 'object'
    ? Object.entries(manifest.agents).map(([name, def]) => ({
        name,
        description: typeof def?.description === 'string' ? def.description : undefined,
        dataDir: typeof def?.dataDir === 'string' ? def.dataDir : undefined,
      }))
    : [];

  return {
    agents,
    manifestPath: AGENTS_MANIFEST_PATH,
  };
}

/**
 * 创建 Agent：写入 agents.yaml + 初始化空 configs/ 目录。
 *
 * 多 Agent 配置分层重构：不再从模板复制 YAML 文件。
 * 空的 configs/ 目录意味着"完全继承全局配置"。
 * 用户按需创建覆盖文件。
 */
export function createAgent(name: string, description?: string): { success: boolean; message: string } {
  if (!name || !/^[a-zA-Z0-9_-]+$/.test(name)) {
    return { success: false, message: 'Agent 名称只能包含字母、数字、下划线和连字符。' };
  }
  try {
    // 确保 agents.yaml 存在
    if (!fs.existsSync(AGENTS_MANIFEST_PATH)) {
      // 多 Agent 配置分层重构：创建 agents.yaml 时不写 enabled 字段
      fs.writeFileSync(AGENTS_MANIFEST_PATH, stringifyYAML({ agents: {} }), 'utf-8');
      _cachedManifest = undefined;
    }
    const raw = fs.readFileSync(AGENTS_MANIFEST_PATH, 'utf-8');
    const manifest = parseYAML(raw) as AgentManifest ?? { agents: {} };
    if (!manifest.agents) manifest.agents = {};

    if (manifest.agents[name]) {
      return { success: false, message: `Agent「${name}」已存在。` };
    }

    manifest.agents[name] = { description: description || undefined };
    fs.writeFileSync(AGENTS_MANIFEST_PATH, stringifyYAML(manifest), 'utf-8');
    _cachedManifest = undefined;

    // 多 Agent 配置分层重构：只创建空的 configs/ 目录，不复制模板文件。
    // 空 configs/ = 完全继承全局配置。
    const agentPaths = getAgentPaths(name);
    if (!fs.existsSync(agentPaths.configDir)) {
      fs.mkdirSync(agentPaths.configDir, { recursive: true });
    }

    return { success: true, message: `Agent「${name}」已创建。` };
  } catch (err) {
    return { success: false, message: err instanceof Error ? err.message : '创建失败' };
  }
}

/** 更新 Agent 元信息 */
export function updateAgent(name: string, fields: { description?: string; dataDir?: string }): { success: boolean; message: string } {
  try {
    if (!fs.existsSync(AGENTS_MANIFEST_PATH)) {
      return { success: false, message: 'agents.yaml 不存在。' };
    }
    const raw = fs.readFileSync(AGENTS_MANIFEST_PATH, 'utf-8');
    const manifest = parseYAML(raw) as AgentManifest;
    if (!manifest?.agents?.[name]) {
      return { success: false, message: `Agent「${name}」不存在。` };
    }

    if (fields.description !== undefined) manifest.agents[name].description = fields.description || undefined;
    if (fields.dataDir !== undefined) manifest.agents[name].dataDir = fields.dataDir || undefined;
    fs.writeFileSync(AGENTS_MANIFEST_PATH, stringifyYAML(manifest), 'utf-8');
    _cachedManifest = undefined;
    return { success: true, message: `Agent「${name}」已更新。` };
  } catch (err) {
    return { success: false, message: err instanceof Error ? err.message : '更新失败' };
  }
}

/** 删除 Agent（仅从 agents.yaml 移除条目，不删除数据目录） */
export function deleteAgent(name: string): { success: boolean; message: string } {
  try {
    if (!fs.existsSync(AGENTS_MANIFEST_PATH)) {
      return { success: false, message: 'agents.yaml 不存在。' };
    }
    const raw = fs.readFileSync(AGENTS_MANIFEST_PATH, 'utf-8');
    const manifest = parseYAML(raw) as AgentManifest;
    if (!manifest?.agents?.[name]) {
      return { success: false, message: `Agent「${name}」不存在。` };
    }
    delete manifest.agents[name];
    fs.writeFileSync(AGENTS_MANIFEST_PATH, stringifyYAML(manifest), 'utf-8');
    _cachedManifest = undefined;
    return { success: true, message: `Agent「${name}」已从配置中移除。数据目录已保留。` };
  } catch (err) {
    return { success: false, message: err instanceof Error ? err.message : '删除失败' };
  }
}

/** 清除 manifest 缓存，强制下次调用重新读取文件 */
export function resetCache(): void {
  _cachedManifest = undefined;
}

/**
 * 确保 agents.yaml 存在且包含 master agent。
 *
 * 多 Agent 配置分层重构：首次运行时自动创建 agents.yaml + master agent。
 * 替代原有的 createManifestIfNotExists，不再有 enabled 字段。
 */
export function ensureDefaultAgent(): void {
  if (!fs.existsSync(AGENTS_MANIFEST_PATH)) {
    const defaultManifest: AgentManifest = {
      agents: {
        master: { description: '主 AI 助手' },
      },
    };
    fs.mkdirSync(path.dirname(AGENTS_MANIFEST_PATH), { recursive: true });
    fs.writeFileSync(AGENTS_MANIFEST_PATH, stringifyYAML(defaultManifest), 'utf-8');
    console.log(`[Iris] 已创建默认 agents.yaml: ${AGENTS_MANIFEST_PATH}`);
  }

  // 确保至少有一个 agent（不应该发生，但做防御性检查）
  _cachedManifest = undefined;
  const defs = loadAgentDefinitions();
  if (defs.length === 0) {
    console.log('[Iris] agents.yaml 中无 agent 定义，自动添加 master agent。');
    const result = createAgent('master', '主 AI 助手');
    if (!result.success) {
      // 修复：如果 agents.yaml 存在但格式错误（如重复键），createAgent 的
      // readFile + parse 也会失败。此时明确提示用户修复文件，而不是静默继续
      // 导致"未配置任何有效平台"的误导性错误。
      console.error(`[Iris] 无法自动创建 master agent: ${result.message}。请手动检查 ${AGENTS_MANIFEST_PATH}`);
    }
  }

  // 确保每个 agent 的 configs/ 目录存在
  const finalDefs = loadAgentDefinitions();
  for (const def of finalDefs) {
    const agentPaths = getAgentPaths(def.name, def.dataDir);
    if (!fs.existsSync(agentPaths.configDir)) {
      fs.mkdirSync(agentPaths.configDir, { recursive: true });
    }
  }
}
