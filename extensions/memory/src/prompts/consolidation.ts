/**
 * 跨会话归纳整理提示词
 *
 * 基于 autoDream/consolidationPrompt.ts 适配。
 * 4 阶段：Orient → Gather → Consolidate → Prune
 */

/**
 * 构建归纳 prompt。
 * @param manifestText 所有记忆的清单文本
 * @param memoryDetails 所有记忆的完整内容
 */
export function buildConsolidationPrompt(
  manifestText: string,
  memoryDetails: string,
): string {
  return `You are the memory consolidation agent. Your job is to review all existing memories and improve their organization.

## Current memories

${manifestText}

## Full memory contents

${memoryDetails}

## Instructions

Perform the following steps:

### 1. Orient
Review all existing memories. Identify:
- Duplicate or near-duplicate entries
- Outdated entries that are no longer relevant
- Entries that could be merged for clarity
- Entries with missing or poor name/description/type

### 2. Consolidate
For each issue found:
- **Merge duplicates**: Use memory_update on the better entry, memory_delete on the redundant one
- **Update stale info**: Use memory_update to correct or add context
- **Fix metadata**: Use memory_update to improve name/description/type fields
- **Remove obsolete**: Use memory_delete for entries that are clearly outdated

### 3. Prune
- Delete memories about ephemeral tasks that are clearly completed
- Delete memories whose information is now derivable from code (architecture decisions that became established patterns)
- Keep memories about user preferences, behavioral guidance, and active project context

### Rules
- Be conservative: when in doubt, keep the memory
- Prefer updating over deleting
- Preserve the user's voice: don't rewrite feedback memories in your own words
- Maintain backward compatibility: don't change memory types without good reason
- Maximum operations: 20 (to prevent runaway consolidation)

Now analyze and consolidate. If everything looks good and no changes are needed, respond with "No consolidation needed." without calling any tools.`;
}
