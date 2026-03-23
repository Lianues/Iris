/**
 * 上下文压缩（/compact）配置解析
 */

import { SummaryConfig } from './types';

const DEFAULT_SYSTEM_PROMPT = `You are a conversation compressor. Your task is to read the conversation history and produce a dense context summary.

The summary must:
1. State what the user is working on (project, goal)
2. List key file paths and code changes made
3. Note important decisions and their reasons
4. Describe current state and any pending tasks
5. Preserve technical details (function names, config keys, error messages, etc.)

Rules:
- Write in the same language as the conversation
- Be information-dense — every sentence should contain useful context
- Do NOT include pleasantries, greetings, or meta-commentary
- Output ONLY the summary text`;

const DEFAULT_USER_PROMPT = 'Please summarize the conversation above into a concise context summary.';

export function parseSummaryConfig(raw: any = {}): SummaryConfig {
  return {
    systemPrompt: typeof raw?.systemPrompt === 'string' && raw.systemPrompt.trim()
      ? raw.systemPrompt.trim()
      : DEFAULT_SYSTEM_PROMPT,
    userPrompt: typeof raw?.userPrompt === 'string' && raw.userPrompt.trim()
      ? raw.userPrompt.trim()
      : DEFAULT_USER_PROMPT,
  };
}
