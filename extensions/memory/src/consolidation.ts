/**
 * Phase 4a: 跨会话记忆归纳整理
 *
 * 定期整理记忆：合并冗余、删除过时、改善元数据。
 * 使用 SQLite 行记录做分布式锁（替代文件 mtime）。
 */

import type { IrisAPI } from '@irises/extension-sdk';
import type { SqliteMemory } from './sqlite/index.js';
import type { MemoryPluginConfig } from './config.js';
import { parseMemoryType } from './types.js';
import { formatManifestCompact } from './utils/manifest.js';
import { memoryAge } from './utils/age.js';
import { buildConsolidationPrompt } from './prompts/consolidation.js';

export interface ConsolidationContext {
  api: IrisAPI;
  provider: SqliteMemory;
  config: MemoryPluginConfig;
  logger: { info(...args: unknown[]): void; warn(...args: unknown[]): void };
}

/**
 * 检查是否应该运行归纳，并在条件满足时执行。
 */
export async function maybeRunConsolidation(ctx: ConsolidationContext): Promise<void> {
  const { provider, config, logger } = ctx;

  if (!config.consolidation.enabled) return;

  // 时间门控
  const meta = provider.getConsolidationMeta();
  const hoursSinceLastRun = (Date.now() / 1000 - meta.lastRun) / 3600;
  if (hoursSinceLastRun < config.consolidation.minHours) return;

  // 会话门控：检查自上次归纳以来是否有足够多的新会话
  try {
    const sessionMetas = await (ctx.api.storage as any).listSessionMetas?.();
    if (sessionMetas && Array.isArray(sessionMetas)) {
      const lastRunMs = meta.lastRun * 1000;
      const newSessionCount = sessionMetas.filter(
        (m: any) => m.createdAt && new Date(m.createdAt).getTime() > lastRunMs
      ).length;
      if (newSessionCount < config.consolidation.minSessions) return;
    }
  } catch {
    // listSessionMetas 不可用时跳过会话门控
  }

  // 记忆太少不需要归纳
  const memoryCount = await provider.count();
  if (memoryCount < 5) return;

  // 获取锁
  const pid = process.pid;
  if (!provider.acquireConsolidationLock(pid)) {
    logger.info('归纳锁被占用，跳过');
    return;
  }

  let success = false;
  try {
    await runConsolidation(ctx);
    success = true;
  } catch (err) {
    logger.warn('归纳执行失败:', err);
  } finally {
    provider.releaseConsolidationLock(success);
  }
}

/** 手动归纳的返回结果 */
export interface DreamResult {
  ok: boolean;
  message: string;
  opCount: number;
}

/**
 * 手动触发归纳（由 /dream 命令调用），跳过时间/会话门控，仅保留锁和记忆数检查。
 */
export async function forceRunConsolidation(ctx: ConsolidationContext): Promise<DreamResult> {
  const { provider, logger } = ctx;

  const memoryCount = await provider.count();
  if (memoryCount < 2) {
    return { ok: false, message: `记忆条数过少（${memoryCount} 条），无需整理。`, opCount: 0 };
  }

  const pid = process.pid;
  if (!provider.acquireConsolidationLock(pid)) {
    return { ok: false, message: '另一个归纳正在进行，请稍后再试。', opCount: 0 };
  }

  let success = false;
  try {
    const opCount = await runConsolidation(ctx);
    success = true;
    const message = opCount > 0
      ? `归纳完成，执行了 ${opCount} 个操作（合并 / 删除 / 更新元数据）。`
      : '所有记忆状态良好，无需变更。';
    return { ok: true, message, opCount };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.warn('手动归纳失败:', err);
    return { ok: false, message: `归纳失败: ${errMsg}`, opCount: 0 };
  } finally {
    provider.releaseConsolidationLock(success);
  }
}

async function runConsolidation(ctx: ConsolidationContext): Promise<number> {
  const { api, provider, logger } = ctx;

  // 1. 获取所有记忆（单次查询，避免两次调用间的竞态）
  const memories = await provider.list(undefined, 500);
  if (memories.length === 0) return 0;

  // 2. 从同一份数据构建清单和完整内容
  const manifestEntries = memories.map(m => ({
    id: m.id,
    name: m.name || `memory_${m.id}`,
    description: m.description || m.content.slice(0, 80),
    type: m.type,
    age: memoryAge(m.updatedAt),
    updatedAt: m.updatedAt,
  }));
  const manifestText = formatManifestCompact(manifestEntries);

  const memoryDetails = memories.map(m => {
    const age = memoryAge(m.updatedAt);
    return `### #${m.id} [${m.type}] ${m.name || '(unnamed)'} (${age})\n${m.content}`;
  }).join('\n\n');

  // 3. 构建 prompt（带大小保护）
  // 粗估 token：1 token ≈ 4 chars（英文），保守限制在 80K chars ≈ 20K tokens
  const MAX_PROMPT_CHARS = 80_000;
  let truncatedDetails = memoryDetails;
  if (manifestText.length + memoryDetails.length > MAX_PROMPT_CHARS) {
    // 截断完整内容，保留前 N 条
    const available = MAX_PROMPT_CHARS - manifestText.length - 2000; // 2000 留给模板
    if (available <= 0) {
      logger.warn(`记忆清单过大 (${manifestText.length} chars)，跳过归纳`);
      return 0;
    }
    truncatedDetails = memoryDetails.slice(0, available);
    // 在最后一个完整条目处截断（找最后一个 ### 标记）
    const lastEntry = truncatedDetails.lastIndexOf('\n\n### ');
    if (lastEntry > 0) truncatedDetails = truncatedDetails.slice(0, lastEntry);
    truncatedDetails += '\n\n(... remaining memories truncated due to size limit)';
    logger.info(`归纳 prompt 已截断: ${memoryDetails.length} → ${truncatedDetails.length} chars`);
  }
  const prompt = buildConsolidationPrompt(manifestText, truncatedDetails);

  // 4. 调用 LLM
  const toolDeclarations = [
    {
      name: 'memory_update',
      description: 'Update an existing memory',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'number' },
          content: { type: 'string' },
          name: { type: 'string' },
          description: { type: 'string' },
          type: { type: 'string', enum: ['user', 'feedback', 'project', 'reference'] },
        },
        required: ['id'],
      },
    },
    {
      name: 'memory_delete',
      description: 'Delete a memory',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'number' },
        },
        required: ['id'],
      },
    },
  ];

  const response = await (api.router as any).chat({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    tools: [{ functionDeclarations: toolDeclarations }],
    systemInstruction: {
      parts: [{ text: 'You are a memory consolidation agent. Review and organize memories using the provided tools. Be conservative — prefer updating over deleting.' }],
    },
  });

  // 5. 处理工具调用
  const content = response.content ?? response;
  const parts = content.parts ?? [];
  let opCount = 0;

  for (const part of parts) {
    if (!part.functionCall || opCount >= 20) continue;

    const { name: toolName, args } = part.functionCall;
    if (!args) continue;

    // 校验 id 字段（LLM 可能返回 string 或缺失）
    const rawId = args.id;
    const id = typeof rawId === 'number' ? rawId : typeof rawId === 'string' ? Number(rawId) : NaN;
    if (!Number.isFinite(id)) continue;

    try {
      if (toolName === 'memory_update') {
        const ok = await provider.update({
          id,
          content: args.content as string | undefined,
          name: args.name as string | undefined,
          description: args.description as string | undefined,
          type: parseMemoryType(args.type),
        });
        if (ok) opCount++;
      } else if (toolName === 'memory_delete') {
        const ok = await provider.delete(id);
        if (ok) opCount++;
      }
    } catch (err) {
      logger.warn(`归纳工具调用失败 (${toolName} #${id}):`, err);
    }
  }

  if (opCount > 0) {
    logger.info(`归纳完成: ${opCount} 个操作已执行`);
  } else {
    logger.info('归纳完成: 无需变更');
  }
  return opCount;
}
