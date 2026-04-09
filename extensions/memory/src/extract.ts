/**
 * Phase 2: 自动记忆提取引擎
 *
 * 对话回合结束后，用独立 LLM 调用从对话中提取值得记住的信息。
 * 通过 api.router.chat() 做轻量 LLM 调用，解析 function_call 结果并写入存储。
 */

import type { IrisAPI } from '@irises/extension-sdk';
import type { MemoryProvider } from './base.js';
import { parseMemoryType } from './types.js';
import { formatManifestCompact } from './utils/manifest.js';
import { buildExtractionPrompt } from './prompts/extract.js';

interface ExtractionContext {
  api: IrisAPI;
  provider: MemoryProvider;
  sessionId: string;
  logger: { info(...args: unknown[]): void; warn(...args: unknown[]): void };
}

/** 从最近的对话中提取记忆，返回保存/更新的条数 */
export async function runMemoryExtraction(ctx: ExtractionContext): Promise<number> {
  const { api, provider, sessionId, logger } = ctx;

  // 1. 获取最近对话历史
  const history = await (api.storage as any).getHistory(sessionId);
  if (!history || history.length < 2) return 0;

  // 取最近 20 条消息（约 10 轮对话）
  const recentCount = Math.min(history.length, 20);
  const recentMessages = history.slice(-recentCount);

  // 2. 构建对话摘要文本
  const conversationText = recentMessages.map((msg: any) => {
    const role = msg.role === 'user' ? 'User' : 'Assistant';
    const text = extractTextFromParts(msg.parts);
    if (!text) return '';
    // 截断过长的消息
    const truncated = text.length > 2000 ? text.slice(0, 2000) + '...' : text;
    return `${role}: ${truncated}`;
  }).filter(Boolean).join('\n\n');

  if (!conversationText.trim()) return 0;

  // 3. 构建现有记忆清单
  const manifest = await provider.buildManifest();
  const manifestText = formatManifestCompact(manifest);

  // 4. 构建提取 prompt
  const extractionPrompt = buildExtractionPrompt(conversationText, manifestText, recentCount);

  // 5. 构建工具声明
  const toolDeclarations = [
    {
      name: 'memory_add',
      description: 'Save a new memory',
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string', description: 'Memory content' },
          name: { type: 'string', description: 'Short identifier' },
          description: { type: 'string', description: 'One-line description' },
          type: { type: 'string', enum: ['user', 'feedback', 'project', 'reference'] },
        },
        required: ['content', 'name', 'type'],
      },
    },
    {
      name: 'memory_update',
      description: 'Update an existing memory',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'number', description: 'Memory ID to update' },
          content: { type: 'string' },
          name: { type: 'string' },
          description: { type: 'string' },
          type: { type: 'string', enum: ['user', 'feedback', 'project', 'reference'] },
        },
        required: ['id'],
      },
    },
  ];

  // 6. 调用 LLM
  try {
    const response = await (api.router as any).chat({
      contents: [
        { role: 'user', parts: [{ text: extractionPrompt }] },
      ],
      tools: [{ functionDeclarations: toolDeclarations }],
      systemInstruction: {
        parts: [{ text: 'You are a memory extraction agent. Analyze conversations and extract durable memories using the provided tools. Be selective — only save information that will be useful in future conversations.' }],
      },
    });

    // 7. 处理 function_call 结果
    const responseContent = response.content ?? response;
    const parts = responseContent.parts ?? [];
    let savedCount = 0;

    for (const part of parts) {
      if (!part.functionCall) continue;

      const { name: toolName, args } = part.functionCall;
      if (!args) continue;

      try {
        if (toolName === 'memory_add') {
          const content = args.content;
          if (typeof content !== 'string' || !content.trim()) continue;
          await provider.add({
            content,
            name: (args.name as string) || '',
            description: (args.description as string) || '',
            type: parseMemoryType(args.type) ?? 'reference',
          });
          savedCount++;
        } else if (toolName === 'memory_update') {
          const rawId = args.id;
          const id = typeof rawId === 'number' ? rawId : typeof rawId === 'string' ? Number(rawId) : NaN;
          if (!Number.isFinite(id)) continue;
          const ok = await provider.update({
            id,
            content: args.content as string | undefined,
            name: args.name as string | undefined,
            description: args.description as string | undefined,
            type: parseMemoryType(args.type),
          });
          if (ok) savedCount++;
        }
      } catch (err) {
        logger.warn(`提取记忆工具调用失败 (${toolName}):`, err);
      }
    }

    if (savedCount > 0) {
      logger.info(`自动提取完成: ${savedCount} 条记忆已保存/更新 (session=${sessionId})`);
    }
    return savedCount;
  } catch (err) {
    logger.warn('自动提取 LLM 调用失败:', err);
    return 0;
  }
}

/** 从消息 parts 中提取纯文本 */
function extractTextFromParts(parts: any[]): string {
  if (!parts) return '';
  return parts
    .filter((p: any) => p.text)
    .map((p: any) => p.text)
    .join('\n');
}
