/**
 * 会话记忆提示词模板
 *
 * 基于 SessionMemory/prompts.ts 的 10 section 模板适配。
 * 用于从对话中提取结构化会话笔记，在 compact 时保留上下文连续性。
 */

/** 会话笔记模板的 section 列表 */
export const SESSION_NOTE_SECTIONS = [
  'Session Title',
  'Current State',
  'Task Specification',
  'Files and Functions',
  'Workflow',
  'Errors and Corrections',
  'Codebase Documentation',
  'Learnings',
  'Key Results',
  'Worklog',
] as const;

/**
 * 构建会话笔记提取 prompt。
 * @param conversationText 最近的对话摘要
 * @param existingNotes 现有的会话笔记（可能为空）
 */
export function buildSessionNotesPrompt(
  conversationText: string,
  existingNotes: string,
): string {
  const template = SESSION_NOTE_SECTIONS.map(s => `## ${s}\n`).join('\n');

  return `You are the session memory agent. Extract structured notes from the conversation to preserve context continuity.

${existingNotes ? `## Existing session notes\n\n${existingNotes}\n\nUpdate these notes with new information from the conversation below.\n` : ''}

## Conversation

${conversationText}

## Instructions

Produce session notes following this template. Each section should be concise (max ~200 words). Only include sections that have relevant content — skip empty sections.

${template}

### Section guidelines:
- **Session Title**: One-line description of the overall session goal
- **Current State**: What was accomplished, what's pending, any blockers
- **Task Specification**: The user's original request and key requirements
- **Files and Functions**: Important files/functions referenced or modified
- **Workflow**: Steps taken, approaches tried, decision points
- **Errors and Corrections**: Mistakes made, how they were fixed, things to avoid
- **Codebase Documentation**: Non-obvious patterns or architecture discovered
- **Learnings**: Technical insights or domain knowledge gained
- **Key Results**: Concrete outputs (commits, files created, configs changed)
- **Worklog**: Chronological summary of major actions

Output ONLY the structured notes, no preamble.`;
}
