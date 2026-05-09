export interface VariablesPluginConfig {
  /** 是否启用 manage_variables 工具 */
  enabled: boolean;
}

export const DEFAULT_CONFIG: VariablesPluginConfig = {
  enabled: false,
};

export function resolveConfig(
  rawSection: Record<string, unknown> | undefined,
  pluginConfig: Partial<VariablesPluginConfig> | undefined,
): VariablesPluginConfig {
  const source = (rawSection ?? pluginConfig ?? {}) as Record<string, unknown>;
  return {
    enabled: typeof source.enabled === 'boolean' ? source.enabled : DEFAULT_CONFIG.enabled,
  };
}

export function toConfigContributionValues(config: VariablesPluginConfig): Record<string, unknown> {
  return {
    enabled: config.enabled,
  };
}

export function fromConfigContributionValues(values: Record<string, unknown>): Record<string, unknown> {
  return {
    enabled: values.enabled === true,
  };
}
