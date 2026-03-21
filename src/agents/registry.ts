/**
 * Agent 注册表
 *
 * 从 ~/.iris/agents.yaml 加载多 Agent 配置。
 *
 * 判断规则：
 *   - agents.yaml 不存在 → 单 Agent 模式
 *   - agents.yaml 存在但 enabled: false → 单 Agent 模式
 *   - agents.yaml 存在且 enabled: true → 多 Agent 模式
 */

import * as fs from 'fs';
import * as path from 'path';
import { parse as parseYAML } from 'yaml';
import { dataDir, getAgentPaths, getDefaultPaths } from '../paths';
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
  } catch {
    _cachedManifest = null;
    return null;
  }
}

/** 是否启用多 Agent 模式 */
export function isMultiAgentEnabled(): boolean {
  const manifest = loadManifest();
  return !!manifest?.enabled;
}

/**
 * 加载 Agent 定义列表。
 *
 * - 多 Agent 模式：返回 agents.yaml 中定义的所有 agent
 * - 单 Agent 模式：不应调用此函数（调用前先检查 isMultiAgentEnabled）
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

/** 清除缓存（测试用） */
export function _resetCache(): void {
  _cachedManifest = undefined;
}
