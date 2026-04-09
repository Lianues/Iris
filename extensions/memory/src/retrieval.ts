/**
 * Phase 3: 智能记忆检索
 *
 * 基于 LLM 判断相关性，替代纯 FTS5 关键词搜索。
 * 流程：构建 manifest → LLM 选择相关条目 → 读取完整内容 → 注入上下文。
 *
 * 降级策略：LLM 调用失败时 fallback 到 FTS5 搜索。
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
  logger?: { info(...args: unknown[]): void; warn(...args: unknown[]): void };
}

/** 查找与用户输入相关的记忆，返回格式化的上下文文本 */
export async function findAndFormatRelevantMemories(ctx: RetrievalContext): Promise<{ text: string; bytes: number; ids: number[] } | undefined> {
  const { router, provider, userText, maxBytes, surfaced, logger } = ctx;

  // 1. 构建清单
  const manifest = await provider.buildManifest();
  if (manifest.length === 0) return undefined;

  // 过滤已在本会话中注入过的记忆
  const unsurfaced = manifest.filter(m => !surfaced.has(m.id));
  if (unsurfaced.length === 0) return undefined;

  // 2. 尝试 LLM 选择
  let selectedIds: number[];
  try {
    selectedIds = await selectRelevantMemories(router, userText, unsurfaced);
  } catch (err) {
    logger?.warn('LLM 检索失败，降级到 FTS5:', err);
    // Fallback: FTS5 搜索
    const ftsResults = await provider.search(userText, 5);
    selectedIds = ftsResults
      .filter(m => !surfaced.has(m.id))
      .map(m => m.id);
  }

  if (selectedIds.length === 0) return undefined;

  // 3. 读取完整内容
  const memories = await provider.getByIds(selectedIds);
  if (memories.length === 0) return undefined;

  // 4. 格式化并限制字节数
  const { text, bytes, usedIds } = formatRelevantMemories(memories, maxBytes);
  if (!text) return undefined;

  return { text, bytes, ids: usedIds };
}

/** 使用 LLM 从清单中选择最相关的记忆 */
async function selectRelevantMemories(
  router: any,
  userText: string,
  manifest: MemoryManifestEntry[],
): Promise<number[]> {
  const manifestText = formatManifest(manifest);

  const prompt = `Given the user's message below, select the most relevant memories from the manifest. Return ONLY a JSON array of memory IDs (numbers), maximum 5 entries. If no memories are relevant, return an empty array [].

## User message
${userText}

## Available memories
${manifestText}

Respond with ONLY the JSON array, no explanation. Example: [3, 7, 12]`;

  const response = await router.chat({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    systemInstruction: {
      parts: [{ text: 'You are a memory relevance filter. Output only a JSON array of memory IDs.' }],
    },
    generationConfig: {
      maxOutputTokens: 100,
      temperature: 0,
    },
  });

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
): { text: string; bytes: number; usedIds: number[] } {
  const lines: string[] = [];
  const usedIds: number[] = [];
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
    usedIds.push(m.id);
    totalBytes += entryBytes;
  }

  if (lines.length === 0) return { text: '', bytes: 0, usedIds: [] };

  const text = header + lines.join('\n');
  return { text, bytes: totalBytes, usedIds };
}
