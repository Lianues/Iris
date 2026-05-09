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

export interface LLMProviderLike {
  setLogging(logsDir: string): void;
  chat(request: LLMRequest, signal?: AbortSignal): Promise<LLMResponse>;
  chatStream(request: LLMRequest, signal?: AbortSignal): AsyncGenerator<LLMStreamChunk>;
  /** 运行时深合并 requestBody 覆盖（递归合并嵌套对象） */
  patchRequestBodyOverrides?(patch: Record<string, unknown>): void;
  /** 运行时按点分路径删除 requestBody 覆盖中的嵌套 key（如 'thinking.type'） */
  removeRequestBodyOverridePaths?(...paths: string[]): void;
  /** 运行时移除 requestBody 覆盖中的指定顶层 key */
  removeRequestBodyOverrideKeys?(...keys: string[]): void;
  readonly name: string;
}

/**
 * LLM Provider 实现。
 *
 * requestBody 覆盖分为两层：
 *   1. runtimeOverrides  — 运行时补丁（如便捷思考强度控制），低优先级
 *   2. staticOverrides   — YAML requestBody 配置，高优先级
 *
 * 最终合并顺序：encodeRequest() ← runtimeOverrides ← staticOverrides
 * 即用户在 YAML 中显式设置的字段始终胜出。
 */
export class LLMProvider implements LLMProviderLike {
  private providerName: string;
  /** 日志目录。有值时启用请求/响应日志，每个 Provider 实例独立。 */
  private loggingDir?: string;
  /** 运行时请求体覆盖（来自便捷控制等），优先级低于 staticOverrides */
  private runtimeOverrides?: Record<string, unknown>;

  constructor(
    private format: FormatAdapter,
    private endpoint: EndpointConfig,
    providerName?: string,
    /** 静态请求体覆盖（来自 YAML requestBody），优先级高于运行时补丁 */
    private staticOverrides?: Record<string, unknown>,
  ) {
    this.providerName = providerName ?? 'LLMProvider';
  }

  /**
   * 合并后的最终 requestBody 覆盖。
   * 合并顺序：runtimeOverrides ← staticOverrides（static 优先）
   */
  private get effectiveOverrides(): Record<string, unknown> | undefined {
    if (!this.runtimeOverrides && !this.staticOverrides) return undefined;
    if (!this.runtimeOverrides) return this.staticOverrides;
    if (!this.staticOverrides) return this.runtimeOverrides;
    return deepMergeObjects(this.runtimeOverrides, this.staticOverrides);
  }

  /** 启用请求日志，日志写入指定目录 */
  setLogging(logsDir: string): void {
    this.loggingDir = logsDir;
  }

  /** 非流式调用 */
  async chat(request: LLMRequest, signal?: AbortSignal): Promise<LLMResponse> {
    const body = mergeRequestBody(this.format.encodeRequest(request, false), this.effectiveOverrides);
    const res = await sendRequest(this.endpoint, body, false, undefined, signal, this.loggingDir);
    return processResponse(res, this.format);
  }

  /** 流式调用 */
  async *chatStream(request: LLMRequest, signal?: AbortSignal): AsyncGenerator<LLMStreamChunk> {
    const body = mergeRequestBody(this.format.encodeRequest(request, true), this.effectiveOverrides);
    const res = await sendRequest(this.endpoint, body, true, undefined, signal, this.loggingDir);
    yield* processStreamResponse(res, this.format);
  }

  /** 运行时深合并 requestBody 覆盖（递归合并嵌套对象，不会覆盖整个父对象） */
  patchRequestBodyOverrides(patch: Record<string, unknown>): void {
    this.runtimeOverrides = this.runtimeOverrides
      ? deepMergeObjects(this.runtimeOverrides, patch)
      : { ...patch };
  }

  /** 运行时移除 requestBody 覆盖中的指定顶层 key */
  removeRequestBodyOverrideKeys(...keys: string[]): void {
    if (!this.runtimeOverrides) return;
    for (const key of keys) {
      delete this.runtimeOverrides[key];
    }
    if (Object.keys(this.runtimeOverrides).length === 0) {
      this.runtimeOverrides = undefined;
    }
  }

  /**
   * 按点分路径删除 requestBody 覆盖中的嵌套 key。
   *
   * 例如 removeRequestBodyOverridePaths('thinking.type', 'output_config.effort')
   * 只删除 thinking.type 和 output_config.effort 两个叶节点，
   * 保留 thinking / output_config 下的其他 key。
   * 删除后递归清理空的祖先对象。
   */
  removeRequestBodyOverridePaths(...paths: string[]): void {
    if (!this.runtimeOverrides) return;
    for (const path of paths) {
      const segments = path.split('.');
      if (segments.length === 1) {
        delete this.runtimeOverrides[segments[0]];
      } else {
        let obj: Record<string, unknown> = this.runtimeOverrides;
        const parents: Array<{ obj: Record<string, unknown>; key: string }> = [];
        let valid = true;
        for (let i = 0; i < segments.length - 1; i++) {
          parents.push({ obj, key: segments[i] });
          const child = obj[segments[i]];
          if (!isPlainObject(child)) { valid = false; break; }
          obj = child as Record<string, unknown>;
        }
        if (valid) {
          delete obj[segments[segments.length - 1]];
          for (let i = parents.length - 1; i >= 0; i--) {
            const { obj: parent, key } = parents[i];
            const child = parent[key];
            if (isPlainObject(child) && Object.keys(child as object).length === 0) {
              delete parent[key];
            } else break;
          }
        }
      }
    }
    if (Object.keys(this.runtimeOverrides).length === 0) {
      this.runtimeOverrides = undefined;
    }
  }

  get name(): string {
    return this.providerName;
  }
}
