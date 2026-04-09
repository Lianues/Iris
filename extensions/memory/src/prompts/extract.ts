/**
 * 自动提取提示词
 *
 * 基于 extractMemories/prompts.ts 的逻辑适配 Iris。
 * 用于构建发送给 LLM 的提取请求。
 */

/**
 * 构建提取 prompt。
 * @param recentMessages 最近的对话消息摘要
 * @param existingManifest 现有记忆清单
 * @param messageCount 要分析的消息条数
 */
export function buildExtractionPrompt(
  recentMessages: string,
  existingManifest: string,
  messageCount: number,
): string {
  return `You are the memory extraction agent. Analyze the conversation below and extract durable information worth remembering across future conversations.

## Existing memories

${existingManifest || '(no memories yet)'}

Check this list before saving — update an existing memory (via memory_update) rather than creating a duplicate.

## Instructions

1. Analyze the last ~${messageCount} messages for information worth persisting
2. Save memories using the memory_add or memory_update tools
3. Each memory must have: name, description, type, and content
4. Types: user (profile/preferences), feedback (behavioral guidance), project (context/decisions), reference (external pointers)

## What to extract

- User preferences, role, expertise level
- Behavioral guidance ("do this", "don't do that") — including confirmations of successful approaches
- Project decisions, deadlines, constraints with motivation
- External resource pointers (URLs, project trackers, channels)
- For feedback/project types, include **Why:** and **How to apply:** lines in content

## What NOT to extract

- Code patterns, architecture, file paths — derivable from reading code
- Git history, recent changes — use git log
- Debugging solutions — the fix is in the code
- Ephemeral task details, current conversation state
- Information already captured in existing memories (update instead)

## Recent conversation

${recentMessages}

Now extract any durable memories from this conversation. If nothing is worth saving, respond with "No new memories to extract." and do not call any tools.`;
}
