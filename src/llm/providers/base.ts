/**
 * LLM Provider 组合器
 *
 * 将格式转换、HTTP 传输、响应处理组装为统一的 Provider 接口。
 * 上层（Orchestrator）只依赖此接口的 chat() 和 chatStream()。
 */

import { LLMRequest, LLMResponse, LLMStreamChunk } from '../../types';
import { FormatAdapter } from '../formats/types';
import { EndpointConfig, sendRequest } from '../transport';
import { processResponse, processStreamResponse } from '../response';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * 深合并两个对象。合并策略：
 * - 两边都是普通对象 → 递归合并
 * - base 是数组 + override 是数组 → concat 追加
 * - base 是数组 + override 是非 null 对象 → 将对象追加到数组末尾
 * - 其他情况（标量、类型不同等） → override 直接覆盖
 */
function deepMergeObjects(base: Record<string, unknown>, override: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const current = result[key];
    if (isPlainObject(current) && isPlainObject(value)) {
      // 两边都是普通对象 → 递归合并
      result[key] = deepMergeObjects(current, value);
    } else if (Array.isArray(current) && Array.isArray(value)) {
      // 两边都是数组 → 追加
      result[key] = [...current, ...value];
    } else if (Array.isArray(current) && value !== null && typeof value === 'object') {
      // base 是数组，override 是单个对象 → 追加为数组元素
      result[key] = [...current, value];
    } else {
      // 标量 / 类型不同 → 直接覆盖
      result[key] = value;
    }
  }
  return result;
}

function mergeRequestBody(baseBody: unknown, overrideBody?: Record<string, unknown>): unknown {
  if (!overrideBody) return baseBody;
  if (!isPlainObject(baseBody)) return overrideBody;
  return deepMergeObjects(baseBody, overrideBody);
}

export class LLMProvider {
  private providerName: string;

  constructor(
    private format: FormatAdapter,
    private endpoint: EndpointConfig,
    providerName?: string,
    private requestBodyOverrides?: Record<string, unknown>,
  ) {
    this.providerName = providerName ?? 'LLMProvider';
  }

  /** 非流式调用 */
  async chat(request: LLMRequest, signal?: AbortSignal): Promise<LLMResponse> {
    const body = mergeRequestBody(this.format.encodeRequest(request, false), this.requestBodyOverrides);
    const res = await sendRequest(this.endpoint, body, false, undefined, signal);
    return processResponse(res, this.format);
  }

  /** 流式调用 */
  async *chatStream(request: LLMRequest, signal?: AbortSignal): AsyncGenerator<LLMStreamChunk> {
    const body = mergeRequestBody(this.format.encodeRequest(request, true), this.requestBodyOverrides);
    const res = await sendRequest(this.endpoint, body, true, undefined, signal);
    yield* processStreamResponse(res, this.format);
  }

  get name(): string {
    return this.providerName;
  }
}
