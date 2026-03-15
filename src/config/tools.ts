/**
 * 工具配置解析
 */

import { ToolsConfig, ToolPolicyConfig } from './types';

function normalizeToolPolicy(raw: unknown): ToolPolicyConfig | undefined {
  if (typeof raw === 'boolean') {
    return { autoApprove: raw };
  }

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return undefined;
  }

  const record = raw as Record<string, unknown>;
  return {
    autoApprove: record.autoApprove === true,
  };
}

export function parseToolsConfig(raw: any): ToolsConfig {
  const permissions: Record<string, ToolPolicyConfig> = {};

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { permissions };
  }

  for (const [toolName, value] of Object.entries(raw as Record<string, unknown>)) {
    const policy = normalizeToolPolicy(value);
    if (!policy) continue;
    permissions[toolName] = policy;
  }

  return { permissions };
}
