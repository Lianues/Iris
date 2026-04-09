/**
 * Safety classification types for Iris tool risk management.
 *
 * Tools can optionally declare their risk level via ToolRiskMetadata.
 * Default risk level is 'low' (optimistic — non-disruptive by default).
 *
 * Safety system is opt-in. When enabled, it adds two independent gates:
 *   - AI Review: number of concurrent LLM reviewers (per-level coefficient × multiplier)
 *   - User Confirm: whether human confirmation is required (determined by safety mode)
 * These gates are additive (both can be active simultaneously).
 */

// ── Risk Level ──

/** 工具风险等级（4 级） */
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

/** 所有风险等级（有序，从低到高） */
export const RISK_LEVELS: readonly RiskLevel[] = ['low', 'medium', 'high', 'critical'] as const;

// ── Tool Risk Metadata ──

/**
 * 工具风险声明元数据。
 *
 * 工具在注册时可通过 `ToolDefinition.risk` 声明风险信息，
 * 供安全引擎在执行前评估干预策略。
 */
export interface ToolRiskMetadata {
  /** 风险等级，默认 'low' */
  level?: RiskLevel;
  /** 风险描述（供 agent review 参考） */
  description?: string;
  /** 标签（如 'destructive', 'network', 'filesystem'） */
  tags?: string[];
}

// ── Safety Mode ──

/**
 * 安全模式定义 — 决定哪些风险等级需要用户确认。
 *
 * Review（AI 审阅）由 review intensity 独立控制，
 * 与 confirm（用户确认）不冲突，两者可同时生效。
 */
export interface SafetyMode {
  name: string;
  description?: string;
  /** 每个风险等级是否需要用户确认（未列出的等级 = false） */
  confirm: Partial<Record<RiskLevel, boolean>>;
}

// ── Review Intensity ──

/**
 * 审阅强度配置。
 *
 * 最终 reviewer 数 = ceil(coefficients[level] × multiplier)
 */
export interface ReviewIntensityConfig {
  /**
   * 每个风险等级的 review 系数。
   * 默认：low=0, medium=1, high=2, critical=3
   */
  coefficients?: Partial<Record<RiskLevel, number>>;
  /** 全局乘数（默认 1，设 0 可禁用所有 review） */
  multiplier: number;
}

/** 默认 review 系数 */
export const DEFAULT_REVIEW_COEFFICIENTS: Readonly<Record<RiskLevel, number>> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

// ── Safety Config (maps to safety.yaml) ──

/** 安全系统配置（对应 safety.yaml） */
export interface SafetyConfig {
  /** 是否启用安全系统（默认 false，opt-in） */
  enabled?: boolean;
  /** 当前安全模式名称（默认 'standard'） */
  mode?: string;
  /** 审阅强度设置 */
  reviewIntensity?: ReviewIntensityConfig;
  /** 自定义模式定义（与内置预设合并，同名内置模式不可覆盖） */
  customModes?: SafetyMode[];
}

// ── Safety Decision ──

/** 安全引擎对单次工具调用的决策结果 */
export interface SafetyDecision {
  /** AI reviewer 数量（0 = 跳过 review） */
  reviewerCount: number;
  /** 是否需要用户确认 */
  confirmRequired: boolean;
  /** 评估的风险等级 */
  riskLevel: RiskLevel;
  /** 应用的安全模式名称 */
  modeName: string;
}

// ── Safety Engine Interface ──

/** 安全引擎只读接口（通过 ServiceRegistry 暴露给插件，不含 setMode/setMultiplier） */
export interface SafetyEngineReadonly {
  /** 评估工具调用，返回安全决策 */
  evaluate(toolName: string, riskMetadata?: ToolRiskMetadata): SafetyDecision;
  /** 获取当前安全模式 */
  getActiveMode(): SafetyMode;
  /** 列出所有可用模式（内置 + 自定义） */
  listModes(): SafetyMode[];
  /** 是否已启用 */
  isEnabled(): boolean;
}

/** 安全引擎完整接口（仅核心模块内部使用，含可变操作） */
export interface SafetyEngineLike extends SafetyEngineReadonly {
  /** 切换安全模式（仅核心模块可调用） */
  setMode(name: string): boolean;
  /** 设置 review 乘数（仅核心模块可调用） */
  setMultiplier(multiplier: number): void;
}

// ── Built-in Presets ──

export const BUILTIN_SAFETY_MODES: readonly SafetyMode[] = [
  {
    name: 'standard',
    description: '标准模式 — high 和 critical 需确认',
    confirm: { high: true, critical: true },
  },
  {
    name: 'relaxed',
    description: '轻松模式 — 仅 critical 需确认',
    confirm: { critical: true },
  },
  {
    name: 'unrestricted',
    description: '免审模式 — 无需确认',
    confirm: {},
  },
];
