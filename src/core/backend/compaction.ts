import type { Content, FunctionCallPart, FunctionResponsePart, LLMRequest } from '../../types';
import { isFunctionCallPart, isFunctionResponsePart } from '../../types';
import type { LLMConfig } from '../../config/types';
import { DEFAULT_AUTO_SUMMARY_THRESHOLD } from '../../config/llm';
import { estimateTokenCount } from 'tokenx';

/** 自动上下文压缩的触发原因。 */
export type CompactReason =
  | 'manual'
  | 'post-turn-threshold'
  | 'pre-turn-threshold'
  | 'in-turn-threshold'
  | 'context-overflow-retry';

export interface CompactResult {
  summaryText: string;
  beforeTokens: number;
  afterTokens: number;
  reason: CompactReason;
  modelName?: string;
}

const DEFAULT_OUTPUT_RESERVE_RATIO = 0.10;
const DEFAULT_SAFETY_MARGIN_RATIO = 0.02;
const MIN_OUTPUT_RESERVE = 8_192;
const MAX_OUTPUT_RESERVE = 65_536;
const MIN_SAFETY_MARGIN = 2_048;
const MAX_SAFETY_MARGIN = 16_384;
const SMALL_CONTEXT_WINDOW = 32_768;

/**
 * 从不同 provider 常见的 requestBody 字段中读取最大输出 token。
 * 只有用户显式配置时才额外收紧 90% 高水位；未配置时 90% 本身就是默认预留。
 */
export function getConfiguredMaxOutputTokens(config?: LLMConfig): number | undefined {
  const body = config?.requestBody;
  if (!body || typeof body !== 'object') return undefined;

  const generationConfig = body.generationConfig;
  const candidates = [
    body.maxOutputTokens,
    body.max_output_tokens,
    body.max_tokens,
    body.max_completion_tokens,
    generationConfig && typeof generationConfig === 'object'
      ? (generationConfig as Record<string, unknown>).maxOutputTokens
      : undefined,
  ];

  for (const value of candidates) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      return Math.floor(value);
    }
  }
  return undefined;
}

/**
 * 将模型的 autoSummaryThreshold 解析为实际 token 安全线。
 *
 * - 未配置：默认 90%
 * - false：显式关闭
 * - 百分比：必须有有效 contextWindow，不能退化成绝对 token
 * - 配置了 max output tokens 时，额外预留输出空间
 */
export function resolveAutoSummaryThreshold(config?: LLMConfig): number | undefined {
  if (!config || config.autoSummaryThreshold === false) return undefined;

  const raw = config.autoSummaryThreshold ?? DEFAULT_AUTO_SUMMARY_THRESHOLD;
  let threshold: number | undefined;

  if (typeof raw === 'number') {
    if (Number.isFinite(raw) && raw > 0) threshold = Math.floor(raw);
  } else if (typeof raw === 'string') {
    const trimmed = raw.trim();
    const percentMatch = trimmed.match(/^(\d+(?:\.\d+)?)%$/);
    if (percentMatch) {
      const percent = Number(percentMatch[1]);
      if (percent > 0 && percent <= 100 && config.contextWindow && config.contextWindow > 0) {
        threshold = Math.floor(config.contextWindow * percent / 100);
      }
    } else if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
      const absolute = Number(trimmed);
      if (Number.isFinite(absolute) && absolute > 0) threshold = Math.floor(absolute);
    }
  }

  if (!threshold || threshold <= 0) return undefined;

  const outputReserve = getConfiguredMaxOutputTokens(config);
  if (outputReserve && config.contextWindow && config.contextWindow > 0) {
    const safePromptLimit = Math.floor(config.contextWindow - outputReserve);
    if (safePromptLimit <= 0) return undefined;
    threshold = Math.min(threshold, safePromptLimit);
  }

  return threshold > 0 ? threshold : undefined;
}

function boundedWindowReserve(
  contextWindow: number,
  ratio: number,
  min: number,
  max: number,
): number {
  const proportional = Math.max(1, Math.floor(contextWindow * ratio));
  // 单测和本地 mock 常使用几十/几百 token 的窗口；不能让生产环境的绝对
  // 最小预留把这些小窗口直接压成负数。
  if (contextWindow < SMALL_CONTEXT_WINDOW) return proportional;
  return Math.min(max, Math.max(min, proportional));
}

/** 读取当前最终请求实际声明的最大输出 token。 */
export function getRequestMaxOutputTokens(request?: LLMRequest, config?: LLMConfig): number | undefined {
  const requestValue = request?.generationConfig?.maxOutputTokens;
  if (typeof requestValue === 'number' && Number.isFinite(requestValue) && requestValue > 0) {
    return Math.floor(requestValue);
  }
  return getConfiguredMaxOutputTokens(config);
}

/**
 * 计算“最终组装后的 prompt”可安全占用的 token 上限。
 *
 * autoSummaryThreshold 是用户高水位；contextWindow - output reserve - margin
 * 是 provider 硬窗口预算。两者取更严格者。未显式配置输出上限时保守预留
 * 10%（带上下界），另留 2% 给 tokenizer/格式转换估算误差。
 */
export function resolveRequestCompactThreshold(
  config?: LLMConfig,
  request?: LLMRequest,
): number | undefined {
  const configuredThreshold = resolveAutoSummaryThreshold(config);
  if (!configuredThreshold) return undefined;

  const contextWindow = config?.contextWindow;
  if (!contextWindow || !Number.isFinite(contextWindow) || contextWindow <= 0) {
    return configuredThreshold;
  }

  const outputReserve = getRequestMaxOutputTokens(request, config)
    ?? boundedWindowReserve(contextWindow, DEFAULT_OUTPUT_RESERVE_RATIO, MIN_OUTPUT_RESERVE, MAX_OUTPUT_RESERVE);
  const safetyMargin = boundedWindowReserve(
    contextWindow,
    DEFAULT_SAFETY_MARGIN_RATIO,
    MIN_SAFETY_MARGIN,
    MAX_SAFETY_MARGIN,
  );
  const hardPromptLimit = Math.floor(contextWindow - outputReserve - safetyMargin);
  if (hardPromptLimit <= 0) return undefined;
  return Math.min(configuredThreshold, hardPromptLimit);
}

/** 估算最终 LLMRequest（含 system/tools/history）的 token，而非只估历史文本。 */
export function estimateLLMRequestTokens(request: LLMRequest): number {
  return estimateTokenCount(JSON.stringify(request));
}

/** 从持久化历史恢复最近一次真实 LLM totalTokenCount。 */
export function findLastPersistedTotalTokens(history: Content[]): number | undefined {
  for (let i = history.length - 1; i >= 0; i--) {
    const value = history[i].usageMetadata?.totalTokenCount;
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      return value;
    }
  }
  return undefined;
}

/** 从最后一条 summary 开始估算当前真正会发送给主模型的历史 token。 */
export function estimateActiveHistoryTokens(history: Content[]): number {
  let startIndex = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].isSummary) {
      startIndex = i;
      break;
    }
  }
  const active = startIndex > 0 ? history.slice(startIndex) : history;
  return estimateTokenCount(JSON.stringify(active));
}

/** compact 只能发生在完整 model 回合之后。 */
export function hasStableCompactBoundary(history: Content[]): boolean {
  if (history.length === 0) return false;
  return history[history.length - 1].role === 'model';
}

function toolPartsMatch(
  calls: FunctionCallPart[],
  responses: FunctionResponsePart[],
): boolean {
  if (calls.length === 0 || calls.length !== responses.length) return false;
  const used = new Set<number>();

  for (const call of calls) {
    const matchIndex = responses.findIndex((response, index) => {
      if (used.has(index)) return false;
      const callId = call.functionCall.callId;
      const responseId = response.functionResponse.callId;
      if (callId || responseId) {
        return !!callId && !!responseId && callId === responseId;
      }
      return call.functionCall.name === response.functionResponse.name;
    });
    if (matchIndex < 0) return false;
    used.add(matchIndex);
  }
  return used.size === responses.length;
}

/**
 * 判断当前 history 是否停在可安全创建“任务检查点”的工具轮次边界。
 * 必须是紧邻的 model(functionCall) + user(functionResponse) 完整配对；普通 user
 * 消息、混入文本/附件的响应、孤立调用或缺少任一并行响应都不允许中途 compact。
 */
export function hasCompleteToolBoundary(history: Content[]): boolean {
  if (history.length < 2) return false;
  const responseContent = history[history.length - 1];
  const callContent = history[history.length - 2];
  if (callContent.role !== 'model' || responseContent.role !== 'user') return false;
  if (callContent.parts.length === 0 || responseContent.parts.length === 0) return false;
  if (!responseContent.parts.every(isFunctionResponsePart)) return false;

  const calls = callContent.parts.filter(isFunctionCallPart);
  const responses = responseContent.parts.filter(isFunctionResponsePart);
  return toolPartsMatch(calls, responses);
}

/** 完整 assistant 回合或完整工具调用对都可作为 compact 输入边界。 */
export function hasSafeCompactBoundary(history: Content[]): boolean {
  return hasStableCompactBoundary(history) || hasCompleteToolBoundary(history);
}
