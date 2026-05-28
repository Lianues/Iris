export function buildNoteSystemPrompt(note: string): string {
  return `【User Note】
以下是用户通过 /note 设置的长期偏好/约束。除非用户本轮明确覆盖，否则请遵守：

${note.trim()}`;
}
