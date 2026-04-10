/**
 * 记忆插件配置解析
 */

export interface MemoryPluginConfig {
  enabled: boolean;
  dbPath?: string;

  // Phase 2: 自动提取
  autoExtract: boolean;
  /** 每 N 轮提取一次 */
  extractInterval: number;

  // Phase 3: 智能检索
  autoRecall: boolean;
  /** 每轮注入记忆的最大字节数 */
  maxContextBytes: number;
  /** 会话级记忆注入总字节上限 */
  sessionBudgetBytes: number;
  /** 非 user 类型未注入记忆 <= 此数时，跳过 LLM 选择器直接注入全部 */
  smallSetThreshold: number;

  // Phase 4: 跨会话归纳
  consolidation: {
    enabled: boolean;
    /** 两次归纳之间的最小间隔（小时） */
    minHours: number;
    /** 触发归纳的最少新会话数 */
    minSessions: number;
  };
}

/** 默认配置 */
export const DEFAULT_CONFIG: MemoryPluginConfig = {
  enabled: false,
  autoExtract: true,
  extractInterval: 1,
  autoRecall: true,
  maxContextBytes: 20480,       // 20KB per turn
  sessionBudgetBytes: 61440,    // 60KB per session
  smallSetThreshold: 15,
  consolidation: {
    enabled: true,
    minHours: 24,
    minSessions: 3,
  },
};

/**
 * 从原始 YAML 解析配置，与默认值合并。
 */
export function resolveConfig(
  rawSection: Record<string, unknown> | undefined,
  pluginConfig: Partial<MemoryPluginConfig> | undefined,
): MemoryPluginConfig {
  const source = (rawSection ?? pluginConfig ?? {}) as Record<string, unknown>;
  const consolidationRaw = (source.consolidation ?? {}) as Record<string, unknown>;

  return {
    enabled: toBool(source.enabled, DEFAULT_CONFIG.enabled),
    dbPath: source.dbPath as string | undefined,
    autoExtract: toBool(source.autoExtract, DEFAULT_CONFIG.autoExtract),
    extractInterval: toNum(source.extractInterval, DEFAULT_CONFIG.extractInterval),
    autoRecall: toBool(source.autoRecall, DEFAULT_CONFIG.autoRecall),
    maxContextBytes: toNum(source.maxContextBytes, DEFAULT_CONFIG.maxContextBytes),
    sessionBudgetBytes: toNum(source.sessionBudgetBytes, DEFAULT_CONFIG.sessionBudgetBytes),
    smallSetThreshold: toNum(source.smallSetThreshold, DEFAULT_CONFIG.smallSetThreshold),
    consolidation: {
      enabled: toBool(consolidationRaw.enabled, DEFAULT_CONFIG.consolidation.enabled),
      minHours: toNum(consolidationRaw.minHours, DEFAULT_CONFIG.consolidation.minHours),
      minSessions: toNum(consolidationRaw.minSessions, DEFAULT_CONFIG.consolidation.minSessions),
    },
  };
}

function toBool(val: unknown, def: boolean): boolean {
  if (typeof val === 'boolean') return val;
  return def;
}

function toNum(val: unknown, def: number): number {
  if (typeof val === 'number' && !isNaN(val)) return val;
  return def;
}
