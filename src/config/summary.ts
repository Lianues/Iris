/**
 * 上下文压缩（/compact）配置解析
 */

import { SummaryConfig } from './types';

export const DEFAULT_SYSTEM_PROMPT = 'Please summarize the above conversation, keeping key information and context points while removing redundant content.';

export const DEFAULT_MAX_OUTPUT_TOKENS = 16_384;

export const DEFAULT_USER_PROMPT = `Please summarize the above conversation history and output the following sections, so that the AI can continue completing the unfinished tasks.

## User Requirements
What the user wants to accomplish (overall goal).

## Completed Work
List what has been done in chronological order, including which files were changed and what decisions were made.
File paths, variable names, and configuration values must be preserved exactly, do not generalize.

## Current Progress
What step has been reached, what is currently being done.

## TODO Items
What still needs to be done, listed by priority.

## Important Conventions
Constraints, preferences, and technical requirements raised by the user (e.g., "do not use third-party libraries", "use TypeScript", etc.).

Output content directly without any prefix.`;

export function parseSummaryConfig(raw: any = {}): SummaryConfig {
  return {
    systemPrompt: typeof raw?.systemPrompt === 'string' && raw.systemPrompt.trim()
      ? raw.systemPrompt.trim()
      : DEFAULT_SYSTEM_PROMPT,
    userPrompt: typeof raw?.userPrompt === 'string' && raw.userPrompt.trim()
      ? raw.userPrompt.trim()
      : DEFAULT_USER_PROMPT,
    maxOutputTokens: typeof raw?.maxOutputTokens === 'number'
      && Number.isFinite(raw.maxOutputTokens) && raw.maxOutputTokens > 0
      ? Math.floor(raw.maxOutputTokens)
      : DEFAULT_MAX_OUTPUT_TOKENS,
  };
}
