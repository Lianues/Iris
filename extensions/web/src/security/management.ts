/**
 * 管理面鉴权
 */

import * as crypto from 'crypto';
import * as http from 'http';
import { sendJSON } from '../router';

/** 读取请求头中的管理令牌 */
function getPresentedManagementToken(req: http.IncomingMessage): string {
  const token = req.headers['x-management-token'];
  if (typeof token === 'string') return token.trim();
  if (Array.isArray(token)) return token[0]?.trim() || '';
  return '';
}

/** 常量时间比较字符串 */
function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

/** 校验管理面权限，返回 true 表示通过 */
export function assertManagementToken(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  expectedToken?: string,
): boolean {
  if (!expectedToken) return true;

  const presented = getPresentedManagementToken(req);
  if (!presented || !safeEqual(presented, expectedToken)) {
    sendJSON(res, 401, {
      error: '未授权：缺少或无效的管理令牌',
      code: 'MANAGEMENT_TOKEN_INVALID',
    });
    return false;
  }

  return true;
}
