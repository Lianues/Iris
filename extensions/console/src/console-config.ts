/**
 * Console 平台配置
 *
 * 用户通过 ~/.iris/configs/platform.yaml 的 console: 段配置：
 *
 * ```yaml
 * console:
 *   expandSubAgentTools: true
 * ```
 */

export interface ConsoleConfig {
  /** 是否在对话页面展开显示 sub_agent 执行过程中的子工具调用（默认关闭） */
  expandSubAgentTools: boolean;
}

export const DEFAULT_CONSOLE_CONFIG: ConsoleConfig = {
  expandSubAgentTools: false,
};

/**
 * 将 platform.yaml 中的原始配置合并为类型安全的 ConsoleConfig。
 */
export function resolveConsoleConfig(raw: Record<string, unknown> | undefined): ConsoleConfig {
  const source = raw ?? {};
  return {
    expandSubAgentTools: typeof source.expandSubAgentTools === 'boolean'
      ? source.expandSubAgentTools
      : DEFAULT_CONSOLE_CONFIG.expandSubAgentTools,
  };
}
