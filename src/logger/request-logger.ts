import * as fs from 'fs';
import * as path from 'path';
import { logsDir } from '../paths';

/** 运行时日志目录（可通过 setLogsDir 覆盖） */
let _logsDir = logsDir;

/**
 * 覆盖日志目录（多 Agent 模式下指向 agent 专属路径）。
 * 需在写日志前调用。
 */
export function setLogsDir(dir: string): void {
  _logsDir = dir;
}

/**
 * 确保日志目录存在
 */
function ensureLogDir() {
  if (!fs.existsSync(_logsDir)) {
    fs.mkdirSync(_logsDir, { recursive: true });
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
export function logRequest(details: {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}): string {
  const timestamp = generateTimestamp();
  try {
    ensureLogDir();
    const filename = `request_${timestamp}.json`;
    const filePath = path.join(_logsDir, filename);
    const content = JSON.stringify(details, null, 2);
    fs.writeFileSync(filePath, content, 'utf-8');
  } catch (err) {
    console.error('Failed to log request:', err);
  }
  return timestamp;
}

/**
 * 将响应内容保存到日志文件，与同一时间戳的 request 文件配对。
 *
 * @param timestamp  logRequest 返回的时间戳
 * @param body       响应原文
 * @param stream     是否为流式响应（影响文件扩展名）
 */
export function logResponse(timestamp: string, body: string, stream: boolean): void {
  try {
    ensureLogDir();
    const ext = stream ? '.txt' : '.json';
    const filename = `response_${timestamp}${ext}`;
    const filePath = path.join(_logsDir, filename);
    fs.writeFileSync(filePath, body, 'utf-8');
  } catch (err) {
    console.error('Failed to log response:', err);
  }
}
