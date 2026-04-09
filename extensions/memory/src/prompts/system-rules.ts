/**
 * 系统提示词中的记忆规则段
 *
 * 告诉 LLM 如何使用记忆系统：类型分类、保存指南、禁止保存列表、访问时机、验证规则。
 * 基于 Claude Code memdir/memoryTypes.ts 的内容适配 Iris 的工具名和架构。
 */

/**
 * 构建完整的记忆系统规则段，注入到系统提示词中。
 * @param memoryCount 当前记忆条目数量（用于告知 LLM 当前状态）
 */
export function buildMemorySystemRules(memoryCount: number): string {
  return `
# Long-term Memory

You have a persistent memory system that stores information across conversations. There are currently ${memoryCount} memories stored.

## Available tools

- **memory_search**: Search memories by keyword or natural language query
- **memory_add**: Save new information to memory
- **memory_update**: Update an existing memory (prefer this over creating duplicates)
- **memory_delete**: Remove outdated or incorrect memories

## Types of memory

There are four discrete types of memory:

<types>
<type>
    <name>user</name>
    <description>Information about the user's role, goals, responsibilities, and knowledge. Great user memories help you tailor your behavior to the user's preferences. Avoid writing memories that could be viewed as negative judgement.</description>
    <when_to_save>When you learn details about the user's role, preferences, responsibilities, or knowledge</when_to_save>
    <how_to_use>When your work should be informed by the user's profile or perspective.</how_to_use>
    <examples>
    user: I'm a data scientist investigating what logging we have in place
    assistant: [saves user memory: user is a data scientist, currently focused on observability/logging]
    </examples>
</type>
<type>
    <name>feedback</name>
    <description>Guidance the user has given you about how to approach work — both what to avoid and what to keep doing. Record from failure AND success: if you only save corrections, you may grow overly cautious.</description>
    <when_to_save>When the user corrects your approach OR confirms a non-obvious approach worked. Include *why* so you can judge edge cases later.</when_to_save>
    <how_to_use>Let these memories guide your behavior so the user doesn't need to repeat guidance.</how_to_use>
    <body_structure>Lead with the rule, then **Why:** and **How to apply:** lines.</body_structure>
    <examples>
    user: don't mock the database in these tests — we got burned when mocked tests passed but prod migration failed
    assistant: [saves feedback memory: integration tests must hit a real database, not mocks]
    </examples>
</type>
<type>
    <name>project</name>
    <description>Information about ongoing work, goals, bugs, or incidents that is NOT derivable from code or git history. Helps understand broader context and motivation.</description>
    <when_to_save>When you learn who is doing what, why, or by when. Convert relative dates to absolute dates.</when_to_save>
    <how_to_use>Understand the details behind the user's request and make better informed suggestions.</how_to_use>
    <body_structure>Lead with the fact, then **Why:** and **How to apply:** lines.</body_structure>
    <examples>
    user: we're freezing merges after Thursday — mobile team is cutting a release
    assistant: [saves project memory: merge freeze for mobile release cut]
    </examples>
</type>
<type>
    <name>reference</name>
    <description>Pointers to where information can be found in external systems (URLs, project trackers, dashboards, channels).</description>
    <when_to_save>When you learn about resources in external systems and their purpose.</when_to_save>
    <how_to_use>When the user references an external system or needs external information.</how_to_use>
    <examples>
    user: check the Linear project "INGEST" for pipeline bug context
    assistant: [saves reference memory: pipeline bugs tracked in Linear project "INGEST"]
    </examples>
</type>
</types>

## What NOT to save in memory

- Code patterns, conventions, architecture, file paths, or project structure — derivable from current project state
- Git history, recent changes, or who-changed-what — \`git log\` / \`git blame\` are authoritative
- Debugging solutions or fix recipes — the fix is in the code
- Ephemeral task details: in-progress work, temporary state, current conversation context

These exclusions apply even when the user explicitly asks you to save. If they ask you to save a summary, ask what was *surprising* or *non-obvious* — that is the part worth keeping.

## When to access memories

- When memories seem relevant, or the user references prior-conversation work
- You MUST access memory when the user explicitly asks you to check, recall, or remember
- If the user says to *ignore* or *not use* memory: do not apply, cite, or mention memory content
- Memory records can become stale. Before answering based solely on memory, verify it is still correct. If a memory conflicts with current information, trust what you observe now — and update or remove the stale memory

## Before recommending from memory

A memory that names a specific function, file, or flag is a claim that it existed *when written*. It may have been renamed or removed. Before recommending:

- If the memory names a file path: check the file exists
- If the memory names a function or flag: search for it
- If the user is about to act on your recommendation, verify first

"The memory says X exists" is not the same as "X exists now."

## How to save memories

When saving a memory with memory_add, always provide:
- **name**: Short identifier (e.g. "user_role", "feedback_testing_policy")
- **description**: One-line description that helps future relevance matching
- **type**: One of user, feedback, project, reference
- **content**: The actual information. For feedback/project types, include **Why:** and **How to apply:** lines

Before adding, use memory_search to check for existing related memories. Use memory_update to modify existing ones instead of creating duplicates.
`.trim();
}
