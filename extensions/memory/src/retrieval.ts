/**
 * Phase 3: 智能记忆检索
 *
 * 两阶段检索：
 *   Phase 1 — user 类型记忆无条件注入（身份/偏好信息始终相关）
 *   Phase 2 — 其余类型走 LLM 选择（小集合直接全注入，大集合调 LLM 选择器）
 *
 * 降级策略：LLM 调用失败时 fallback 到 token 分词搜索。
 */

import type { MemoryProvider } from './base.js';
import type { MemoryEntry, MemoryManifestEntry } from './types.js';
import { formatManifest } from './utils/manifest.js';
import { memoryAge, memoryFreshnessNote } from './utils/age.js';

interface RetrievalContext {
  router: any;  // LLMRouterLike
  provider: MemoryProvider;
  userText: string;
  maxBytes: number;
  surfaced: Set<number>;
  /** 非 user 类型记忆 <= 此数时跳过 LLM 选择器 */
  smallSetThreshold?: number;
  logger?: { info(...args: unknown[]): void; warn(...args: unknown[]): void };
  /** 指定检索选择器使用的模型；不填则使用当前活动模型 */
  modelName?: string;
}

/** user 类型记忆的字节子预算比例 */
const USER_BUDGET_RATIO = 0.25;

/** 默认小集合阈值 */
const DEFAULT_SMALL_SET_THRESHOLD = 15;

/** 查找与用户输入相关的记忆，返回格式化的上下文文本 */
export async function findAndFormatRelevantMemories(ctx: RetrievalContext): Promise<{
  text: string;
  bytes: number;
  /** 非 user 类型的已注入 ID（应加入 surfacedIds） */
  ids: number[];
  /** user 类型的已注入 ID（不加入 surfacedIds，每轮可重复注入） */
  userIds: number[];
} | undefined> {
  const { provider, maxBytes, logger } = ctx;
  const threshold = ctx.smallSetThreshold ?? DEFAULT_SMALL_SET_THRESHOLD;

  const injectedParts: string[] = [];
  let totalBytes = 0;
  const allIds: number[] = [];
  const allUserIds: number[] = [];

  // ============ Phase 1: user 类型记忆无条件注入 ============

  const userBudget = Math.floor(maxBytes * USER_BUDGET_RATIO);
  try {
    const userMemories = await provider.list('user');
    if (userMemories.length > 0) {
      const { text, bytes, usedIds } = formatUserMemories(userMemories, userBudget);
      if (text) {
        injectedParts.push(text);
        totalBytes += bytes;
        allUserIds.push(...usedIds);
      }
    }
  } catch (err) {
    logger?.warn('加载 user 记忆失败:', err);
  }

  // ============ Phase 2: 其余类型走选择逻辑 ============

  const remainingBudget = maxBytes - totalBytes;
  if (remainingBudget > 0) {
    try {
      const result = await selectAndFormatOtherMemories(ctx, remainingBudget, threshold);
      if (result) {
        injectedParts.push(result.text);
        totalBytes += result.bytes;
        allIds.push(...result.ids);
      }
    } catch (err) {
      logger?.warn('检索非 user 记忆失败:', err);
    }
  }

  if (injectedParts.length === 0) return undefined;

  return {
    text: injectedParts.join('\n'),
    bytes: totalBytes,
    ids: allIds,
    userIds: allUserIds,
  };
}

// ============ Phase 1 辅助：格式化 user 记忆 ============

/** 格式化 user 类型记忆为 User Profile 段 */
function formatUserMemories(
  memories: MemoryEntry[],
  maxBytes: number,
): { text: string; bytes: number; usedIds: number[] } {
  const lines: string[] = [];
  const usedIds: number[] = [];
  let totalBytes = 0;

  const header = '\n\n## User Profile\n';
  totalBytes += new TextEncoder().encode(header).length;

  for (const m of memories) {
    const title = m.name ? `**${m.name}**` : `#${m.id}`;
    const content = m.content.length > 2048
      ? m.content.slice(0, 2048) + '...'
      : m.content;

    const entry = `- ${title}: ${content}`;
    const entryBytes = new TextEncoder().encode(entry).length;
    if (totalBytes + entryBytes > maxBytes) break;

    lines.push(entry);
    usedIds.push(m.id);
    totalBytes += entryBytes;
  }

  if (lines.length === 0) return { text: '', bytes: 0, usedIds: [] };

  const text = header + lines.join('\n');
  return { text, bytes: totalBytes, usedIds };
}

// ============ Phase 2: 非 user 类型记忆选择 + 格式化 ============

async function selectAndFormatOtherMemories(
  ctx: RetrievalContext,
  maxBytes: number,
  smallSetThreshold: number,
): Promise<{ text: string; bytes: number; ids: number[] } | undefined> {
  const { router, provider, userText, surfaced, logger } = ctx;

  // 构建非 user 类型的清单
  const manifest = await provider.buildManifest();
  const unsurfaced = manifest.filter(m => m.type !== 'user' && !surfaced.has(m.id));
  if (unsurfaced.length === 0) return undefined;

  let selectedIds: number[];

  if (unsurfaced.length <= smallSetThreshold) {
    // 小集合：跳过 LLM 选择器，直接注入全部
    selectedIds = unsurfaced.map(m => m.id);
    logger?.info(`小集合 bypass: ${unsurfaced.length} 条非 user 记忆直接注入`);
  } else {
    // 大集合：LLM 选择
    try {
      selectedIds = await selectRelevantMemories(router, userText, unsurfaced, ctx.modelName);
    } catch (err) {
      logger?.warn('LLM 检索失败，降级到搜索:', err);
      const ftsResults = await provider.search(userText, 5);
      selectedIds = ftsResults
        .filter(m => m.type !== 'user' && !surfaced.has(m.id))
        .map(m => m.id);
    }
  }

  if (selectedIds.length === 0) return undefined;

  const memories = await provider.getByIds(selectedIds);
  if (memories.length === 0) return undefined;

  return formatRelevantMemories(memories, maxBytes);
}

/** 使用 LLM 从清单中选择最相关的记忆 */
async function selectRelevantMemories(
  router: any,
  userText: string,
  manifest: MemoryManifestEntry[],
  modelName?: string,
): Promise<number[]> {
  const manifestText = formatManifest(manifest);

  const prompt = `Given the user's message below, select the most relevant memories from the manifest. Return ONLY a JSON array of memory IDs (numbers), maximum 5 entries. If no memories are relevant, return an empty array [].

## User message
${userText}

## Available memories
${manifestText}

## Selection guidelines
- For identity/profile questions ("who am I", "what do I do"), select ALL [user] type memories
- For preference/guidance questions, select [user] and [feedback] type memories
- Consider both explicit keyword matches AND semantic relevance
- When in doubt, INCLUDE rather than exclude — it is better to surface a marginally relevant memory than to miss an important one

Respond with ONLY the JSON array, no explanation. Example: [3, 7, 12]`;

  const response = await router.chat({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    systemInstruction: {
      parts: [{ text: 'You are a memory relevance filter. Be inclusive — err on the side of selecting more rather than fewer. Identity questions should match ALL user-type memories. Output only a JSON array of memory IDs.' }],
    },
    generationConfig: {
      maxOutputTokens: 100,
      temperature: 0,
    },
  }, modelName);

  // 解析响应
  const content = response.content ?? response;
  const responseText = content.parts?.map((p: any) => p.text).filter(Boolean).join('') ?? '';

  // 提取 JSON 数组
  const match = responseText.match(/\[[\d\s,]*\]/);
  if (!match) return [];

  try {
    const ids = JSON.parse(match[0]) as number[];
    return ids.filter(id => typeof id === 'number').slice(0, 5);
  } catch {
    return [];
  }
}

/** 格式化选中的记忆为注入文本，限制总字节数 */
function formatRelevantMemories(
  memories: MemoryEntry[],
  maxBytes: number,
): { text: string; bytes: number; ids: number[] } {
  const lines: string[] = [];
  const ids: number[] = [];
  let totalBytes = 0;

  const header = '\n\n## Relevant Memories\n';
  totalBytes += new TextEncoder().encode(header).length;

  for (const m of memories) {
    const age = memoryAge(m.updatedAt);
    const freshness = memoryFreshnessNote(m.updatedAt);
    const title = m.name ? `**${m.name}** [${m.type}]` : `[${m.type}]`;
    // 截断过长的内容
    const content = m.content.length > 4096
      ? m.content.slice(0, 4096) + '...'
      : m.content;

    let entry = `- ${title} (${age}): ${content}`;
    if (freshness) entry += `\n  ${freshness}`;

    const entryBytes = new TextEncoder().encode(entry).length;
    if (totalBytes + entryBytes > maxBytes) break;

    lines.push(entry);
    ids.push(m.id);
    totalBytes += entryBytes;
  }

  if (lines.length === 0) return { text: '', bytes: 0, ids: [] };

  const text = header + lines.join('\n');
  return { text, bytes: totalBytes, ids };
}
