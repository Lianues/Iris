import type { Content } from 'irises-extension-sdk';
import type { MessageMeta } from './app-types';

function asPositiveTokenCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

/** 将持久化消息的 usage 转为卡片元数据；summary 卡片只显示摘要自身 token。 */
export function getHistoryMessageMeta(content: Content): MessageMeta | undefined {
  const meta: MessageMeta = {};
  if (content.usageMetadata?.promptTokenCount != null) meta.tokenIn = content.usageMetadata.promptTokenCount;
  if (content.usageMetadata?.candidatesTokenCount != null) meta.tokenOut = content.usageMetadata.candidatesTokenCount;
  if (content.createdAt != null) meta.createdAt = content.createdAt;
  if (content.isSummary) meta.isSummary = true;
  if (content.durationMs != null) meta.durationMs = content.durationMs;
  if (content.streamOutputDurationMs != null) meta.streamOutputDurationMs = content.streamOutputDurationMs;
  if (content.modelName) meta.modelName = content.modelName;
  return Object.keys(meta).length > 0 ? meta : undefined;
}

/**
 * 解析 session 重载后状态栏应显示的完整上下文 token。
 *
 * - summary 后已有模型回复时，优先使用该回复的 provider usage；
 * - 否则读取 summary 上单独持久化的 compact 后完整请求 token；
 * - 旧 transcript 没有该字段时，使用 Backend.getHistory() 已恢复的 token。
 *
 * 没有 summary 时返回 undefined，让常规历史 usage 回放保持原行为。
 */
export function resolveLoadedSessionContextTokenCount(
  history: readonly Content[],
  restoredTokenCount?: number,
): number | undefined {
  let lastSummaryIndex = -1;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].isSummary) {
      lastSummaryIndex = i;
      break;
    }
  }
  if (lastSummaryIndex < 0) return undefined;

  for (let i = history.length - 1; i > lastSummaryIndex; i--) {
    if (history[i].role !== 'model') continue;
    const providerTokens = asPositiveTokenCount(history[i].usageMetadata?.totalTokenCount);
    if (providerTokens !== undefined) return providerTokens;
  }

  const persistedCompactTokens = asPositiveTokenCount(
    history[lastSummaryIndex].compactedContextTokenCount,
  );
  if (persistedCompactTokens !== undefined) return persistedCompactTokens;

  return asPositiveTokenCount(restoredTokenCount);
}
