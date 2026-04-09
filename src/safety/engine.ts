/**
 * SafetyEngine — 工具调用安全决策引擎
 *
 * 根据工具的风险等级 + 当前安全模式 + review 强度配置，
 * 计算出两道独立的门：AI Review（几个 reviewer）+ User Confirm（是否需要）。
 *
 * 不执行 review 和 confirm 本身 — 只输出决策，由 scheduler 编排。
 */

import type {
  RiskLevel,
  SafetyConfig,
  SafetyDecision,
  SafetyEngineLike,
  SafetyMode,
  ToolRiskMetadata,
} from '@irises/extension-sdk';
import {
  BUILTIN_SAFETY_MODES,
  DEFAULT_REVIEW_COEFFICIENTS,
} from '@irises/extension-sdk';
import { createLogger } from '@/logger';

const log = createLogger('SafetyEngine');

export class SafetyEngine implements SafetyEngineLike {
  private enabled: boolean;
  private activeModeName: string;
  private multiplier: number;
  private coefficients: Record<RiskLevel, number>;
  private modes: Map<string, SafetyMode>;

  constructor(config?: SafetyConfig) {
    this.enabled = config?.enabled ?? false;
    this.activeModeName = config?.mode ?? 'standard';
    this.multiplier = Math.max(0, config?.reviewIntensity?.multiplier ?? 1);

    // 合并默认系数与自定义系数
    this.coefficients = { ...DEFAULT_REVIEW_COEFFICIENTS };
    if (config?.reviewIntensity?.coefficients) {
      for (const [level, value] of Object.entries(config.reviewIntensity.coefficients)) {
        if (typeof value === 'number') {
          this.coefficients[level as RiskLevel] = value;
        }
      }
    }

    // 合并内置预设与自定义模式（内置名称受保护，不允许被覆盖）
    this.modes = new Map<string, SafetyMode>();
    const builtinNames = new Set<string>();
    for (const mode of BUILTIN_SAFETY_MODES) {
      this.modes.set(mode.name, mode);
      builtinNames.add(mode.name);
    }
    if (config?.customModes) {
      for (const mode of config.customModes) {
        if (builtinNames.has(mode.name)) {
          log.warn(`Custom safety mode "${mode.name}" conflicts with built-in preset, skipped. Use a different name.`);
          continue;
        }
        this.modes.set(mode.name, mode);
        log.debug(`Registered custom safety mode: ${mode.name}`);
      }
    }

    // 验证配置的模式存在
    if (!this.modes.has(this.activeModeName)) {
      log.warn(`Safety mode "${this.activeModeName}" not found, falling back to "standard"`);
      this.activeModeName = 'standard';
    }

    if (this.enabled) {
      log.info(`Safety engine enabled: mode="${this.activeModeName}", multiplier=${this.multiplier}`);
    }
  }

  evaluate(toolName: string, riskMetadata?: ToolRiskMetadata): SafetyDecision {
    const riskLevel: RiskLevel = riskMetadata?.level ?? 'low';

    if (!this.enabled) {
      return {
        reviewerCount: 0,
        confirmRequired: false,
        riskLevel,
        modeName: this.activeModeName,
      };
    }

    const mode = this.modes.get(this.activeModeName)!;

    // 门1: AI Review — ceil(coefficient × multiplier)
    // Fail-closed: 未知 riskLevel 回退到最高系数（critical），不默认跳过审查
    const coefficient = this.coefficients[riskLevel] ?? this.coefficients.critical;
    const rawCount = coefficient * this.multiplier;
    const reviewerCount = rawCount > 0 ? Math.ceil(rawCount) : 0;

    // 门2: User Confirm — 由模式定义
    const confirmRequired = mode.confirm[riskLevel] === true;

    log.debug(
      `evaluate(${toolName}): risk=${riskLevel}, mode=${mode.name}, ` +
      `reviewers=${reviewerCount} (${coefficient}×${this.multiplier}), confirm=${confirmRequired}`,
    );

    return { reviewerCount, confirmRequired, riskLevel, modeName: mode.name };
  }

  getActiveMode(): SafetyMode {
    const mode = this.modes.get(this.activeModeName)!;
    return { ...mode, confirm: { ...mode.confirm } };
  }

  setMode(name: string): boolean {
    if (!this.modes.has(name)) {
      log.warn(`Cannot set safety mode "${name}": not found`);
      return false;
    }
    this.activeModeName = name;
    log.info(`Safety mode changed to "${name}"`);
    return true;
  }

  setMultiplier(multiplier: number): void {
    this.multiplier = Math.max(0, multiplier);
    log.info(`Review multiplier changed to ${this.multiplier}`);
  }

  listModes(): SafetyMode[] {
    return Array.from(this.modes.values(), (m) => ({ ...m, confirm: { ...m.confirm } }));
  }

  isEnabled(): boolean {
    return this.enabled;
  }
}
