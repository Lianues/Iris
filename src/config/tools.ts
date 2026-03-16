/**
 * 工具配置解析
 */

import { ToolsConfig, ToolPolicyConfig } from './types';

function parsePatternList(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const patterns = raw
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map(s => s.trim());
  return patterns.length > 0 ? patterns : undefined;
}

function normalizeToolPolicy(raw: unknown): ToolPolicyConfig | undefined {
  if (typeof raw === 'boolean') {
    return { autoApprove: raw };
  }

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return undefined;
  }

  const record = raw as Record<string, unknown>;
  const policy: ToolPolicyConfig = {
    autoApprove: record.autoApprove === true,
  };

  const allow = parsePatternList(record.allowPatterns);
  if (allow) policy.allowPatterns = allow;

  const deny = parsePatternList(record.denyPatterns);
  if (deny) policy.denyPatterns = deny;

  return policy;
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
