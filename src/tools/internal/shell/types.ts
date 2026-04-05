/**
 * Shell 命令安全分类器 —— 类型定义
 */

import type { LLMRouter } from '@/llm/router';
import type { ToolRegistry } from '../../registry';
import type { ToolPolicyConfig } from '@/config';

// ============ 白名单类型 ============

/** 单条命令的安全配置 */
export interface CommandSafetyConfig {
  /** 无条件安全（所有参数都安全） */
  safe?: boolean;
  /** 仅当使用这些 flag 时安全（如 sed -n） */
  safeFlags?: string[];
  /** 仅当子命令匹配时安全（如 git status, npm list） */
  safeSubcommands?: string[];
  /**
   * 自定义安全检查回调。
   * 返回 true 表示危险，false 表示安全。
   * 用于 find -exec、hostname -S 等需要参数级判断的场景。
   */
  isDangerous?: (args: string[]) => boolean;
}

/** 静态分类结果 */
export type StaticClassification = 'allow' | 'deny' | 'unknown';

// ============ 分类器类型 ============

/** AI 分类器返回结果 */
export interface ClassifierResult {
  /** 是否安全 */
  safe: boolean;
  /** 置信度 0.0 ~ 1.0 */
  confidence: number;
  /** 判定理由 */
  reason: string;
}

/** 分类器配置（从 ToolPolicyConfig.classifier 读取） */
export interface ShellClassifierConfig {
  /** 是否启用 AI 分类器（false 时非白名单一律走 fallbackPolicy） */
  enabled: boolean;
  /** 分类器使用的模型名称（null/undefined = 跟随当前活跃模型） */
  model?: string;
  /** 置信度阈值，低于此值视为"不确定" */
  confidenceThreshold?: number;
  /** 分类器不确定时的兜底策略 */
  fallbackPolicy?: 'deny' | 'allow';
  /** 分类器调用超时（ms） */
  timeout?: number;
  /** 安装命令后是否自动评估新工具的安全子命令（默认跟随 enabled） */
  autoLearn?: boolean;
}

/** shell 工具创建时需要的依赖 */
export interface ShellToolDeps {
  /** 获取 LLM 路由器（用于分类器调用） */
  getRouter: () => LLMRouter;
  /** 分类器配置（可选，不提供则不启用分类器） */
  classifierConfig?: ShellClassifierConfig;

  // ---- 动态学习（autoLearn）所需的额外依赖 ----

  /** 工具注册表（学习 sub-agent 需要 shell 工具来执行 --help） */
  tools?: ToolRegistry;
  /** 获取工具策略（学习 sub-agent 的 ToolLoop 需要） */
  getToolPolicies?: () => Record<string, ToolPolicyConfig>;
  retryOnError?: boolean;
}
