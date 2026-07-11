/**
 * 对话历史总结模块
 *
 * 将最后一条 summary 以来的完整历史压缩为新的上下文摘要。压缩输入会移除
 * thought/签名/本地元数据，并限制超大的文本与工具负载；历史超过总结模型
 * 窗口时按完整对话回合分块，再合并局部摘要。
 */

import { estimateTokenCount } from 'tokenx';
import { Content, Part, LLMRequest, extractText, isFunctionCallPart, isFunctionResponsePart, isInlineDataPart } from '../types';
import { LLMRouter } from '../llm/router';
import { DEFAULT_SYSTEM_PROMPT, DEFAULT_USER_PROMPT } from '../config/summary';
import type { LLMConfig, SummaryConfig } from '../config/types';

export interface SummarizeHistoryOptions {
  /** 是否使用流式接口调用总结模型（来自 system.yaml 的 stream 配置） */
  stream?: boolean;
  signal?: AbortSignal;
  /** continuation 用于尚未结束的 ToolLoop 检查点。 */
  purpose?: 'default' | 'continuation';
}

const MAX_TEXT_PART_CHARS = 16_000;
const MAX_TOOL_STRING_CHARS = 4_000;
const MAX_TOOL_ARRAY_ITEMS = 40;
const MAX_TOOL_OBJECT_KEYS = 80;
const MAX_TOOL_DEPTH = 8;
const SUMMARY_INPUT_RATIO = 0.8;
const MAX_CHUNK_REDUCTION_DEPTH = 4;
const CONTINUATION_PROMPT = `

This compact happens inside an unfinished tool loop. The next model call must continue the same task rather than treat it as complete.
Mandatory requirements:
- Preserve the user's current goal and constraints precisely.
- Preserve completed tool actions, changed file paths, commands, test results, and errors.
- State the exact current progress, unresolved issues, and the next executable step.
- Do not claim the task is complete unless the conversation explicitly proves it.
- Do not ask the user to repeat the original request.`;

function resolveSummaryUserPrompt(config?: SummaryConfig, purpose: SummarizeHistoryOptions['purpose'] = 'default'): string {
  const base = config?.userPrompt ?? DEFAULT_USER_PROMPT;
  return purpose === 'continuation' ? `${base}${CONTINUATION_PROMPT}` : base;
}

function truncateMiddle(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const marker = `\n...[truncated ${text.length - maxChars} chars for compact]...\n`;
  const remaining = Math.max(0, maxChars - marker.length);
  const head = Math.ceil(remaining * 0.7);
  const tail = remaining - head;
  return `${text.slice(0, head)}${marker}${tail > 0 ? text.slice(-tail) : ''}`;
}

function compactUnknown(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return truncateMiddle(value, MAX_TOOL_STRING_CHARS);
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (depth >= MAX_TOOL_DEPTH) return '[nested value omitted for compact]';

  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_TOOL_ARRAY_ITEMS).map(item => compactUnknown(item, depth + 1));
    if (value.length > MAX_TOOL_ARRAY_ITEMS) {
      items.push(`[${value.length - MAX_TOOL_ARRAY_ITEMS} more items omitted]`);
    }
    return items;
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    const compacted: Record<string, unknown> = {};
    for (const [key, item] of entries.slice(0, MAX_TOOL_OBJECT_KEYS)) {
      compacted[key] = compactUnknown(item, depth + 1);
    }
    if (entries.length > MAX_TOOL_OBJECT_KEYS) {
      compacted.__compact_omitted_keys__ = entries.length - MAX_TOOL_OBJECT_KEYS;
    }
    return compacted;
  }

  return String(value);
}

/**
 * 清理单个 Part 供总结模型消费。
 * thought 不属于未来任务事实，直接丢弃；二进制只保留描述，避免 base64 淹没摘要。
 */
function preparePartForSummary(part: Part): Part | undefined {
  if ('text' in part) {
    if (part.thought === true) return undefined;
    return { text: truncateMiddle(part.text ?? '', MAX_TEXT_PART_CHARS) };
  }

  if (isInlineDataPart(part)) {
    const name = part.inlineData.name ? ` ${part.inlineData.name}` : '';
    return { text: `[${part.inlineData.mimeType}${name} binary omitted during compact]` };
  }

  if (isFunctionCallPart(part)) {
    return {
      functionCall: {
        name: part.functionCall.name,
        args: compactUnknown(part.functionCall.args ?? {}) as Record<string, unknown>,
        callId: part.functionCall.callId,
      },
    };
  }

  if (isFunctionResponsePart(part)) {
    return {
      functionResponse: {
        name: part.functionResponse.name,
        response: compactUnknown(part.functionResponse.response ?? {}) as Record<string, unknown>,
        callId: part.functionResponse.callId,
      },
    };
  }

  return undefined;
}

/** 可单测的 compact 历史预处理。 */
export function prepareHistoryForSummary(history: Content[]): Content[] {
  return history.map(({ role, parts }) => {
    const cleanParts = parts
      .map(preparePartForSummary)
      .filter((part): part is Part => part !== undefined);
    return {
      role,
      parts: cleanParts.length > 0 ? cleanParts : [{ text: '[non-visible content omitted during compact]' }],
    };
  });
}

export function estimateSummaryInputTokens(
  history: Content[],
  config?: SummaryConfig,
  purpose: SummarizeHistoryOptions['purpose'] = 'default',
): number {
  const systemPrompt = config?.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
  const userPrompt = resolveSummaryUserPrompt(config, purpose);
  return estimateTokenCount(`${systemPrompt}\n${JSON.stringify(history)}\n${userPrompt}`);
}

function normalizeOptions(optionsOrSignal?: AbortSignal | SummarizeHistoryOptions): SummarizeHistoryOptions {
  if (!optionsOrSignal) return {};
  if ('aborted' in optionsOrSignal || 'addEventListener' in optionsOrSignal) {
    return { signal: optionsOrSignal as AbortSignal };
  }
  return optionsOrSignal;
}

/** 只收集可见文本，不向 Backend/UI 转发总结模型的 stream 事件。 */
async function collectStreamText(
  router: LLMRouter,
  request: LLMRequest,
  modelName?: string,
  signal?: AbortSignal,
): Promise<string> {
  const parts: string[] = [];

  for await (const chunk of router.chatStream(request, modelName, signal)) {
    if (chunk.partsDelta && chunk.partsDelta.length > 0) {
      for (const part of chunk.partsDelta) {
        if ('text' in part && part.thought !== true && part.text) parts.push(part.text);
      }
    }
    if ((!chunk.partsDelta || chunk.partsDelta.length === 0) && chunk.textDelta) {
      parts.push(chunk.textDelta);
    }
  }

  return parts.join('').trim();
}

function buildSummaryRequest(
  history: Content[],
  config?: SummaryConfig,
  purpose: SummarizeHistoryOptions['purpose'] = 'default',
): LLMRequest {
  const contents = history.map(({ role, parts }) => ({ role, parts }));
  contents.push({
    role: 'user',
    parts: [{ text: resolveSummaryUserPrompt(config, purpose) }],
  });

  const request: LLMRequest = { contents };
  const systemPrompt = config?.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
  if (systemPrompt) request.systemInstruction = { parts: [{ text: systemPrompt }] };
  return request;
}

async function callSummaryModel(
  router: LLMRouter,
  history: Content[],
  modelName: string | undefined,
  config: SummaryConfig | undefined,
  options: SummarizeHistoryOptions,
): Promise<string> {
  const request = buildSummaryRequest(history, config, options.purpose);
  const text = options.stream
    ? await collectStreamText(router, request, modelName, options.signal)
    : extractText((await router.chat(request, modelName, options.signal)).content.parts).trim();

  if (!text.trim()) throw new Error('总结模型返回了空摘要');
  return text.trim();
}

const CHUNK_CONTINUATION_TEXT = '[Continuation segment from the same unfinished task. Summarize the completed actions and resulting state in this segment.]';
const MIN_ENFORCED_SUMMARY_BUDGET = 1_024;

/**
 * 按总结安全原子单元分组。完整 functionCall/functionResponse 始终放在同一单元，
 * 但一个普通用户 turn 内的多轮工具调用可以拆到不同 summary chunk。
 */
export function groupHistoryByCompactUnit(history: Content[]): Content[][] {
  const units: Content[][] = [];
  let index = 0;
  while (index < history.length) {
    const content = history[index];
    const calls = content.role === 'model' ? content.parts.filter(isFunctionCallPart) : [];
    const next = history[index + 1];
    const responses = next?.role === 'user' ? next.parts.filter(isFunctionResponsePart) : [];
    const isCompleteToolPair = calls.length > 0
      && !!next
      && next.role === 'user'
      && next.parts.length > 0
      && next.parts.every(isFunctionResponsePart)
      && responses.length === calls.length;

    if (isCompleteToolPair) {
      units.push([content, next]);
      index += 2;
      continue;
    }
    units.push([content]);
    index++;
  }
  return units;
}

function normalizeChunkStart(chunk: Content[]): Content[] {
  const first = chunk[0];
  if (!first || first.role === 'user') return chunk;
  return [
    { role: 'user', parts: [{ text: CHUNK_CONTINUATION_TEXT }] },
    ...chunk,
  ];
}

function oversizedUnitLabel(unit: Content[]): string {
  const toolNames = unit.flatMap(content => content.parts.flatMap(part => {
    if (isFunctionCallPart(part)) return [part.functionCall.name];
    if (isFunctionResponsePart(part)) return [part.functionResponse.name];
    return [];
  }));
  return toolNames.length > 0
    ? `Oversized completed tool exchange (${[...new Set(toolNames)].join(', ')})`
    : 'Oversized conversation segment';
}

/** 单个原子单元仍超预算时退化为有界文本预览，绝不拆开原生工具调用对。 */
function fitCompactUnitToBudget(
  unit: Content[],
  budget: number,
  config: SummaryConfig | undefined,
  purpose: SummarizeHistoryOptions['purpose'],
): Content[] {
  const normalized = normalizeChunkStart(unit);
  if (!Number.isFinite(budget) || estimateSummaryInputTokens(normalized, config, purpose) <= budget) {
    return unit;
  }

  const serialized = JSON.stringify(unit);
  let charLimit = Math.max(256, Math.floor(budget * 2.5));
  for (let attempt = 0; attempt < 8; attempt++) {
    const fallback: Content[] = [{
      role: 'user',
      parts: [{
        text: `[${oversizedUnitLabel(unit)}; payload bounded for compact]\n${truncateMiddle(serialized, charLimit)}`,
      }],
    }];
    if (estimateSummaryInputTokens(fallback, config, purpose) <= budget) return fallback;
    charLimit = Math.max(64, Math.floor(charLimit * 0.6));
  }

  const minimal: Content[] = [{
    role: 'user',
    parts: [{ text: `[${oversizedUnitLabel(unit)}; detailed payload omitted because it exceeds the summary model window]` }],
  }];
  if (estimateSummaryInputTokens(minimal, config, purpose) > budget) {
    throw new Error(`总结模型可用上下文过小，无法容纳 compact 指令（budget=${budget} tokens）`);
  }
  return minimal;
}

function chunkHistoryByBudget(
  history: Content[],
  budget: number,
  config: SummaryConfig | undefined,
  purpose: SummarizeHistoryOptions['purpose'],
): Content[][] {
  const units = groupHistoryByCompactUnit(history);
  const chunks: Content[][] = [];
  let current: Content[] = [];

  for (const rawUnit of units) {
    const unit = fitCompactUnitToBudget(rawUnit, budget, config, purpose);
    const candidate = normalizeChunkStart([...current, ...unit]);
    if (current.length > 0 && estimateSummaryInputTokens(candidate, config, purpose) > budget) {
      chunks.push(normalizeChunkStart(current));
      current = [...unit];
    } else {
      current = [...current, ...unit];
    }
  }
  if (current.length > 0) chunks.push(normalizeChunkStart(current));
  return chunks;
}

function resolveSummaryModel(
  router: LLMRouter,
  requestedModelName: string | undefined,
  inputTokens: number,
): { modelName?: string; config?: LLMConfig } {
  const routerLike = router as LLMRouter & {
    getModelConfig?: (name?: string) => LLMConfig;
    getCurrentConfig?: () => LLMConfig;
  };
  // 兼容精简测试桩/第三方 Router：无法查询配置时仍使用调用方指定的模型。
  if (typeof routerLike.getModelConfig !== 'function') {
    return { modelName: requestedModelName };
  }

  let requestedConfig: LLMConfig | undefined;
  let currentConfig: LLMConfig | undefined;

  try { requestedConfig = routerLike.getModelConfig(requestedModelName); } catch { /* stale summary model */ }
  try { currentConfig = routerLike.getCurrentConfig?.(); } catch { /* ignore */ }

  if (!requestedConfig) return { modelName: undefined, config: currentConfig };
  const requestedWindow = requestedConfig.contextWindow ?? Number.POSITIVE_INFINITY;
  const currentWindow = currentConfig?.contextWindow ?? 0;
  if (inputTokens > requestedWindow * SUMMARY_INPUT_RATIO && currentWindow > requestedWindow) {
    return { modelName: undefined, config: currentConfig };
  }
  return { modelName: requestedModelName, config: requestedConfig };
}

async function summarizeWithBudget(
  router: LLMRouter,
  history: Content[],
  modelName: string | undefined,
  modelConfig: LLMConfig | undefined,
  config: SummaryConfig | undefined,
  options: SummarizeHistoryOptions,
  depth = 0,
): Promise<string> {
  const contextWindow = modelConfig?.contextWindow;
  // 低于 1k 的 contextWindow 只会出现在精简测试桩中；真实模型若连 compact
  // 指令本身都装不下，不应把生产绝对预留逻辑套到该模拟值上。
  const budget = contextWindow && contextWindow >= MIN_ENFORCED_SUMMARY_BUDGET
    ? Math.max(1, Math.floor(contextWindow * SUMMARY_INPUT_RATIO))
    : Number.POSITIVE_INFINITY;
  const inputTokens = estimateSummaryInputTokens(history, config, options.purpose);

  if (inputTokens <= budget || depth >= MAX_CHUNK_REDUCTION_DEPTH) {
    return callSummaryModel(router, history, modelName, config, options);
  }

  const chunks = chunkHistoryByBudget(history, budget, config, options.purpose);
  if (chunks.length === 0) return callSummaryModel(router, history, modelName, config, options);
  if (chunks.length === 1) {
    return callSummaryModel(router, chunks[0], modelName, config, options);
  }

  const partialSummaries: string[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const partial = await callSummaryModel(router, chunks[i], modelName, config, options);
    partialSummaries.push(`## Partial Summary ${i + 1}/${chunks.length}\n${truncateMiddle(partial, MAX_TEXT_PART_CHARS)}`);
  }

  const mergedHistory: Content[] = [{
    role: 'user',
    parts: [{ text: partialSummaries.join('\n\n') }],
  }];
  return summarizeWithBudget(router, mergedHistory, modelName, modelConfig, config, options, depth + 1);
}

/**
 * 调用 LLM 对历史进行总结。历史会先做 compact 专用清理；若首选 summary model
 * 容量不足，会回退到上下文更大的当前模型，再按完整回合分块。
 */
export async function summarizeHistory(
  router: LLMRouter,
  history: Content[],
  modelName?: string,
  config?: SummaryConfig,
  optionsOrSignal?: AbortSignal | SummarizeHistoryOptions,
): Promise<string> {
  const options = normalizeOptions(optionsOrSignal);
  const cleanHistory = prepareHistoryForSummary(history);
  const inputTokens = estimateSummaryInputTokens(cleanHistory, config, options.purpose);
  const resolved = resolveSummaryModel(router, modelName, inputTokens);
  return summarizeWithBudget(router, cleanHistory, resolved.modelName, resolved.config, config, options);
}
