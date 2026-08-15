import * as fs from 'fs';
import * as path from 'path';

const REDACTED_HEADER_VALUE = '[REDACTED]';
const SENSITIVE_REQUEST_HEADERS = new Set([
  'authorization',
  'proxy-authorization',
  'x-api-key',
  'x-goog-api-key',
  'api-key',
  'x-auth-token',
  'x-access-token',
  'cookie',
  'set-cookie',
]);

/** 请求日志必须保留排障所需结构，但不能把可直接使用的凭据写入磁盘。 */
function redactRequestHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [
      name,
      SENSITIVE_REQUEST_HEADERS.has(name.toLowerCase()) ? REDACTED_HEADER_VALUE : value,
    ]),
  );
}

function redactRequestUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    const sensitiveParams = new Set(['key', 'api_key', 'apikey', 'token', 'access_token']);
    for (const name of Array.from(url.searchParams.keys())) {
      if (sensitiveParams.has(name.toLowerCase())) {
        url.searchParams.set(name, REDACTED_HEADER_VALUE);
      }
    }
    return url.toString();
  } catch {
    return rawUrl;
  }
}

/**
 * 确保日志目录存在
 */
function ensureLogDir(logsDir: string) {
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }
}

/** 生成时间戳字符串，用于关联 request/response 文件 */
function generateTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

/**
 * 将完整的请求详情保存到日志文件
 * 文件名格式: request_<timestamp>.json
 *
 * 返回时间戳，供 logResponse 配对使用。
 */
export function logRequest(logsDir: string, details: {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}): string {
  const timestamp = generateTimestamp();
  try {
    ensureLogDir(logsDir);
    const filename = `request_${timestamp}.json`;
    const filePath = path.join(logsDir, filename);
    const content = JSON.stringify({
      ...details,
      url: redactRequestUrl(details.url),
      headers: redactRequestHeaders(details.headers),
    }, null, 2);
    fs.writeFileSync(filePath, content, 'utf-8');
  } catch (err) {
    console.error('Failed to log request:', err);
  }
  return timestamp;
}

/**
 * 将响应内容保存到日志文件，与同一时间戳的 request 文件配对。
 *
 * @param logsDir    日志目录
 * @param timestamp  logRequest 返回的时间戳
 * @param body       响应原文
 * @param stream     是否为流式响应（影响文件扩展名）
 */
export function logResponse(logsDir: string, timestamp: string, body: string, stream: boolean): void {
  try {
    ensureLogDir(logsDir);
    const ext = stream ? '.txt' : '.json';
    const filename = `response_${timestamp}${ext}`;
    const filePath = path.join(logsDir, filename);
    fs.writeFileSync(filePath, body, 'utf-8');
  } catch (err) {
    console.error('Failed to log response:', err);
  }
}
