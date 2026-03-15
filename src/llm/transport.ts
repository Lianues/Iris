/**
 * HTTP 请求模块
 *
 * 通用的 HTTP 发送逻辑，不含任何格式转换。
 * 支持流式和非流式请求，通过 streamUrl 字段区分 URL。
 */

import { logRequest } from '../logger/request-logger';

let loggingEnabled = false;

/** 启用/禁用请求日志 */
export function setRequestLogging(enabled: boolean) {
  loggingEnabled = enabled;
}

export interface EndpointConfig {
  /** 非流式请求 URL */
  url: string;
  /**流式请求 URL（与非流式不同时使用，如 Gemini），默认同 url */
  streamUrl?: string;
  /** 请求头（不含 Content-Type，内部自动加） */
  headers: Record<string, string>;
}

/** 非流式请求默认超时（毫秒） */
const DEFAULT_TIMEOUT = 60_000;

/** 流式请求默认超时（毫秒）—— thinking 模型可能长时间无输出，需要更长超时 */
const DEFAULT_STREAM_TIMEOUT = 600_000;

/** 发送 HTTP 请求，返回原始 Response */
export async function sendRequest(
  endpoint: EndpointConfig,
  body: unknown,
  stream: boolean,
  timeout?: number,
  signal?: AbortSignal,
): Promise<Response> {
  const url = stream ? (endpoint.streamUrl ?? endpoint.url) : endpoint.url;
  const effectiveTimeout = timeout ?? (stream ? DEFAULT_STREAM_TIMEOUT : DEFAULT_TIMEOUT);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'Iris',
    ...endpoint.headers,
  };

  if (loggingEnabled) {
    logRequest({ url, method: 'POST', headers, body }).catch(() => {});
  }

  // 合并外部 signal 和超时 signal
  const timeoutSignal = AbortSignal.timeout(effectiveTimeout);
  const combinedSignal = signal
    ? AbortSignal.any([signal, timeoutSignal])
    : timeoutSignal;

  return fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: combinedSignal,
  });
}
