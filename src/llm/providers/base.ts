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

function deepMergeObjects(base: Record<string, unknown>, override: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const current = result[key];
    if (isPlainObject(current) && isPlainObject(value)) {
      result[key] = deepMergeObjects(current, value);
    } else {
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
  async chat(request: LLMRequest): Promise<LLMResponse> {
    const body = mergeRequestBody(this.format.encodeRequest(request, false), this.requestBodyOverrides);
    const res = await sendRequest(this.endpoint, body, false);
    return processResponse(res, this.format);
  }

  /** 流式调用 */
  async *chatStream(request: LLMRequest): AsyncGenerator<LLMStreamChunk> {
    const body = mergeRequestBody(this.format.encodeRequest(request, true), this.requestBodyOverrides);
    const res = await sendRequest(this.endpoint, body, true);
    yield* processStreamResponse(res, this.format);
  }

  get name(): string {
    return this.providerName;
  }
}
