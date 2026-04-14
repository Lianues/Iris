/**
 * 配置管理辅助工具
 *
 * 提供脱敏、深合并，以及基于 ~/.iris/configs 目录的可编辑配置读写能力。
 */

import { loadRawConfigDir, writeRawConfigDir } from './raw';

const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function maskSensitive(value: string): string {
  if (!value || value.length <= 4) return '****';
  return `****${value.slice(-4)}`;
}

export function isMasked(value: string): boolean {
  return typeof value === 'string' && value.startsWith('****');
}

function sanitizeLLMConfig(result: any): void {
  if (result.llm?.models && typeof result.llm.models === 'object') {
    for (const model of Object.values(result.llm.models) as any[]) {
      if (model?.apiKey) {
        model.apiKey = maskSensitive(String(model.apiKey));
      }
    }
  }
}

/**
 * @param extensionPasswordFields 可选，扩展平台中 type: "password" 的字段映射。
 *   key = 平台名，value = 该平台的 password 字段名集合。
 *   不传时回退到通用正则匹配（key/secret/token/password）。
 */
export function sanitizeConfig(data: any, extensionPasswordFields?: Map<string, Set<string>>): any {
  const result = JSON.parse(JSON.stringify(data ?? {}));

  sanitizeLLMConfig(result);

  if (result.ocr?.apiKey) {
    result.ocr.apiKey = maskSensitive(String(result.ocr.apiKey));
  }

  // 内置 Web 平台固定脱敏
  if (result.platform?.web?.authToken) {
    result.platform.web.authToken = maskSensitive(String(result.platform.web.authToken));
  }
  if (result.platform?.web?.managementToken) {
    result.platform.web.managementToken = maskSensitive(String(result.platform.web.managementToken));
  }

  // 扩展平台动态脱敏：根据 manifest 中 type: "password" 的字段
  if (result.platform && typeof result.platform === 'object') {
    const RESERVED = new Set(['type', 'pairing', 'web']);
    for (const [platformName, platformConfig] of Object.entries(result.platform)) {
      if (RESERVED.has(platformName) || !platformConfig || typeof platformConfig !== 'object') continue;
      const section = platformConfig as Record<string, unknown>;
      const passwordKeys = extensionPasswordFields?.get(platformName);
      if (passwordKeys) {
        // 精确脱敏：根据 manifest 声明
        for (const key of passwordKeys) {
          if (section[key] && typeof section[key] === 'string') {
            section[key] = maskSensitive(String(section[key]));
          }
        }
      } else {
        // 通用回退：正则匹配 key/secret/token/password
        for (const key of Object.keys(section)) {
          if (/key|secret|token|password/i.test(key) && typeof section[key] === 'string') {
            section[key] = maskSensitive(String(section[key]));
          }
        }
      }
    }
  }

  if (result.cloudflare?.apiToken) {
    result.cloudflare.apiToken = maskSensitive(String(result.cloudflare.apiToken));
  }

  if (Array.isArray(result.plugins)) {
    for (const p of result.plugins) {
      if (p?.config && typeof p.config === 'object') {
        for (const key of Object.keys(p.config)) {
          if (/key|secret|token|password/i.test(key)) {
            p.config[key] = maskSensitive(String(p.config[key] ?? ''));
          }
        }
      }
    }
  }

  return result;
}

export function deepMerge(target: any, source: any): any {
  if (!source || typeof source !== 'object') return target;

  const result = Array.isArray(target)
    ? [...target]
    : target && typeof target === 'object'
      ? { ...target }
      : {};

  for (const key of Object.keys(source)) {
    if (UNSAFE_KEYS.has(key)) continue;

    const value = source[key];

    if (value === null) {
      delete result[key];
      continue;
    }

    if (Array.isArray(value)) {
      result[key] = [...value];
      continue;
    }

    if (value && typeof value === 'object') {
      result[key] = deepMerge(result[key] ?? {}, value);
      continue;
    }

    result[key] = value;
  }

  return result;
}

function normalizeMergedConfig(data: any): any {
  const merged = JSON.parse(JSON.stringify(data ?? {}));

  if (merged.llm?.models && typeof merged.llm.models === 'object' && !Array.isArray(merged.llm.models)) {
    delete merged.llm.provider;
    delete merged.llm.apiKey;
    delete merged.llm.model;
    delete merged.llm.baseUrl;

    const modelNames = Object.keys(merged.llm.models).filter(modelName => {
      const model = merged.llm.models[modelName];
      return model && typeof model === 'object' && !Array.isArray(model);
    });

    if (modelNames.length === 0) {
      delete merged.llm;
    } else if (!merged.llm.defaultModel || !merged.llm.models[merged.llm.defaultModel]) {
      merged.llm.defaultModel = modelNames[0];
    }
  }

  return merged;
}

export function readEditableConfig(configDir: string): any {
  return JSON.parse(JSON.stringify(loadRawConfigDir(configDir) ?? {}));
}

export function updateEditableConfig(configDir: string, updates: any): { mergedRaw: any; sanitized: any } {
  const current = loadRawConfigDir(configDir);
  const mergedRaw = normalizeMergedConfig(deepMerge(current, updates));
  writeRawConfigDir(configDir, mergedRaw);
  return {
    mergedRaw,
    sanitized: sanitizeConfig(mergedRaw),
  };
}


/**
 * 可编辑配置的原始结构（实现侧类型）。
 *
 * 结构与 irises-extension-sdk 中 RawEditableConfig 一致，
 * 通过 TypeScript 结构化类型自动兼容，无需跨包 import。
 */
interface EditableConfigShape {
  llm?: Record<string, unknown>;
  system?: Record<string, unknown>;
  tools?: Record<string, unknown>;
  mcp?: Record<string, unknown>;
  platform?: Record<string, unknown>;
  storage?: Record<string, unknown>;
  ocr?: Record<string, unknown>;
  modes?: Record<string, unknown>;
  sub_agents?: Record<string, unknown>;
  plugins?: unknown[];
  summary?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * 分层配置管理器
 *
 * 借鉴 VS Code ConfigurationService / Amplifier ConfigManager 的设计：
 *   - 读时合并（read merged）：返回 global + agent 深合并后的完整配置
 *   - 写时定向（write to overlay）：只写 agent 覆盖层，不动全局配置
 *
 * 多 Agent 配置分层重构：解决 Settings UI / 热重载 / Agent 切换的三个数据断裂问题。
 *   问题一：Settings UI 只读 agent 目录，看不到全局 LLM/MCP/system 配置 → 读时合并
 *   问题二：热重载拿到不完整的 mergedRaw → 返回合并后完整配置
 *   问题三：Agent 切换后 configManager 未更新 → 每个 IrisCore 持有独立实例
 *
 * 当 globalDir == agentDir（CLI 直接启动，无 Agent 分层）时，
 * 退化为原先的单目录读写行为，零回归风险。
 */
export class LayeredConfigManager {
  constructor(
    /** 全局配置目录（~/.iris/configs/），所有 Agent 共享的基底 */
    private readonly globalDir: string,
    /** Agent 配置目录（~/.iris/agents/<name>/configs/），覆盖层 */
    private readonly agentDir: string,
  ) {}

  /**
   * 读取合并后的可编辑配置。
   * global 层作为基底，agent 层的同名字段覆盖全局值。
   */
  readEditableConfig(): Record<string, unknown> {
    const global = loadRawConfigDir(this.globalDir) ?? {};
    // 相同目录时跳过二次加载，避免无意义的 deepMerge
    if (this.globalDir === this.agentDir) {
      return JSON.parse(JSON.stringify(global));
    }
    const agent = loadRawConfigDir(this.agentDir) ?? {};
    return JSON.parse(JSON.stringify(deepMerge(global, agent)));
  }

  /**
   * 写入配置更新。
   *   - 只修改 agent 覆盖层（保持全局配置不变）
   *   - 返回的 mergedRaw = global + agent 合并后的完整配置（供热重载使用）
   */
  updateEditableConfig(
    updates: Record<string, unknown>,
  ): { mergedRaw: Record<string, unknown>; sanitized: Record<string, unknown> } {
    // 1. 读取 agent 当前覆盖 → deepMerge → normalize → 写回 agent 目录
    const agentCurrent = loadRawConfigDir(this.agentDir);
    const agentNext = normalizeMergedConfig(deepMerge(agentCurrent, updates));
    writeRawConfigDir(this.agentDir, agentNext);

    // 2. 合并 global + agent → 生成完整的 mergedRaw
    let mergedRaw: any;
    if (this.globalDir === this.agentDir) {
      // 单目录模式：agentNext 即为完整配置
      mergedRaw = agentNext;
    } else {
      const global = loadRawConfigDir(this.globalDir) ?? {};
      mergedRaw = normalizeMergedConfig(deepMerge(global, agentNext));
    }

    return {
      mergedRaw,
      sanitized: sanitizeConfig(mergedRaw),
    };
  }

  /** 返回 agent 配置目录路径（兼容 ConfigManagerLike.getConfigDir） */
  getConfigDir(): string {
    return this.agentDir;
  }
}
