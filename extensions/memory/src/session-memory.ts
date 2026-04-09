/**
 * Phase 4b: 会话记忆
 *
 * 维护结构化会话笔记，用于 compact 时保留上下文连续性。
 * 通过 onAfterLLMCall 监控 token 消耗，在阈值时用 LLM 提取笔记。
 */

import type { IrisAPI } from '@irises/extension-sdk';
import type { SqliteMemory } from './sqlite/index.js';
import { buildSessionNotesPrompt } from './prompts/session-notes.js';

interface SessionMemoryContext {
  api: IrisAPI;
  provider: SqliteMemory;
  sessionId: string;
  logger: { info(...args: unknown[]): void; warn(...args: unknown[]): void };
}

/** token 阈值：上下文达到此值时开始提取会话笔记 */
const INITIAL_TOKEN_THRESHOLD = 10000;
/** 增量阈值：距上次提取增长此数量 token 后再次提取 */
const UPDATE_TOKEN_DELTA = 5000;

/** 各会话的上次提取时的 token 数 */
const lastExtractTokens = new Map<string, number>();

/**
 * 检查是否应该提取会话笔记。
 * @param sessionId 会话 ID
 * @param currentTokens 当前 token 数
 */
export function shouldExtractSessionMemory(sessionId: string, currentTokens: number): boolean {
  const lastTokens = lastExtractTokens.get(sessionId) ?? 0;

  if (lastTokens === 0) {
    // 初始阈值
    return currentTokens >= INITIAL_TOKEN_THRESHOLD;
  }

  // 增量阈值
  return currentTokens - lastTokens >= UPDATE_TOKEN_DELTA;
}

/**
 * 提取并保存会话笔记。
 */
export async function extractSessionNotes(ctx: SessionMemoryContext): Promise<void> {
  const { api, provider, sessionId, logger } = ctx;

  // 1. 获取对话历史
  const history = await (api.storage as any).getHistory(sessionId);
  if (!history || history.length < 4) return;

  // 2. 构建对话摘要（取最近 30 条）
  const recentCount = Math.min(history.length, 30);
  const recentMessages = history.slice(-recentCount);

  const conversationText = recentMessages.map((msg: any) => {
    const role = msg.role === 'user' ? 'User' : 'Assistant';
    const text = msg.parts?.filter((p: any) => p.text).map((p: any) => p.text).join('\n') ?? '';
    if (!text) return '';
    const truncated = text.length > 1500 ? text.slice(0, 1500) + '...' : text;
    return `${role}: ${truncated}`;
  }).filter(Boolean).join('\n\n');

  if (!conversationText.trim()) return;

  // 3. 获取现有笔记
  const existingNotes = provider.getSessionNotes(sessionId) || '';

  // 4. 构建 prompt 并调用 LLM
  const prompt = buildSessionNotesPrompt(conversationText, existingNotes);

  try {
    const response = await (api.router as any).chat({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      systemInstruction: {
        parts: [{ text: 'You are a session memory agent. Extract structured notes that capture the essential context of the conversation. Be concise and factual.' }],
      },
      generationConfig: {
        maxOutputTokens: 2000,
      },
    });

    const content = response.content ?? response;
    const notesText = content.parts?.filter((p: any) => p.text).map((p: any) => p.text).join('\n') ?? '';

    if (notesText.trim()) {
      // 截断到最大 12000 tokens 估算（~48KB）
      const truncated = notesText.length > 48000 ? notesText.slice(0, 48000) : notesText;
      provider.saveSessionNotes(sessionId, truncated);
      logger.info(`会话笔记已更新 (session=${sessionId}, ${truncated.length} chars)`);
    }
  } catch (err) {
    logger.warn('会话笔记提取失败:', err);
  }
}

/**
 * 获取会话笔记文本（供 compact 时注入）。
 */
export function getSessionNotesForCompact(provider: SqliteMemory, sessionId: string): string | undefined {
  const notes = provider.getSessionNotes(sessionId);
  if (!notes) return undefined;
  return `\n## Session Context (from previous conversation)\n\n${notes}`;
}

/**
 * 更新 token 追踪。
 */
export function updateTokenTracking(sessionId: string, currentTokens: number): void {
  lastExtractTokens.set(sessionId, currentTokens);
}

/**
 * 清除会话追踪。
 */
export function clearSessionTracking(sessionId: string): void {
  lastExtractTokens.delete(sessionId);
}
