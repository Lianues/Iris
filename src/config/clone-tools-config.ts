import type { ToolPolicyConfig, ToolsConfig } from './types';

/**
 * Create an execution-local copy of the tool policy configuration.
 *
 * Skill activation may temporarily extend individual policies.  A shallow
 * copy is not sufficient because permissions, pattern arrays and classifier
 * objects would still be shared between concurrent turns.
 */
export function cloneToolsConfig(config: ToolsConfig): ToolsConfig {
  const permissions: Record<string, ToolPolicyConfig> = {};

  for (const [toolName, policy] of Object.entries(config.permissions)) {
    permissions[toolName] = {
      ...policy,
      allowPatterns: policy.allowPatterns ? [...policy.allowPatterns] : undefined,
      denyPatterns: policy.denyPatterns ? [...policy.denyPatterns] : undefined,
      classifier: policy.classifier ? { ...policy.classifier } : undefined,
    };
  }

  return {
    ...config,
    permissions,
    disabledTools: config.disabledTools ? [...config.disabledTools] : undefined,
  };
}
