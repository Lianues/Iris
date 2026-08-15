import type { SkillContextModifier, ToolPolicyConfig, ToolsConfig } from './types';

function mergeUnique(left?: string[], right?: string[]): string[] | undefined {
  if (!left?.length && !right?.length) return undefined;
  return Array.from(new Set([...(left ?? []), ...(right ?? [])]));
}

/** Apply a Skill's temporary grants to an execution-local ToolsConfig. */
export function applySkillContextModifierToToolsConfig(
  toolsConfig: ToolsConfig,
  modifier: SkillContextModifier,
): void {
  for (const toolName of modifier.autoApproveTools ?? []) {
    toolsConfig.permissions[toolName] = {
      ...(toolsConfig.permissions[toolName] ?? { autoApprove: false }),
      autoApprove: true,
    };
  }

  for (const [toolName, override] of Object.entries(modifier.permissionOverrides ?? {})) {
    const current = toolsConfig.permissions[toolName] ?? { autoApprove: false };
    const merged: ToolPolicyConfig = {
      ...current,
      ...override,
      autoApprove: override.autoApprove ?? current.autoApprove,
      allowPatterns: mergeUnique(current.allowPatterns, override.allowPatterns),
      // A temporary grant must never erase a permanent deny rule.
      denyPatterns: mergeUnique(current.denyPatterns, override.denyPatterns),
      classifier: override.classifier
        ? { ...(current.classifier ?? { enabled: false }), ...override.classifier }
        : current.classifier,
    };
    toolsConfig.permissions[toolName] = merged;
  }
}
