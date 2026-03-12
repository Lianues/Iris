import * as fs from 'fs';
import * as path from 'path';

const LOG_DIR = path.resolve(process.cwd(), 'logs');

/**
 * 确保日志目录存在
 */
function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

/**
 * 将完整的请求详情保存到日志文件
 * 文件名格式: request_YYYYMMDD_HHMMSS_MS.json
 */
export async function logRequest(details: {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}): Promise<void> {
  try {
    ensureLogDir();
    const now = new Date();
    const timestamp = now.toISOString().replace(/[:.]/g, '-');
    const filename = `request_${timestamp}.json`;
    const filePath = path.join(LOG_DIR, filename);

    const content = JSON.stringify(details, null, 2);
    fs.writeFileSync(filePath, content, 'utf-8');
  } catch (err) {
    console.error('Failed to log request:', err);
  }
}
