/**
 * 状态 API 处理器
 *
 * GET /api/status — 返回系统状态信息
 */

import * as http from 'http';
import { sendJSON } from '../router';

export interface StatusInfo {
  provider: string;
  /** 提供商真实模型 ID，对应 LLMConfig.model */
  model: string;
  tools: string[];
  /** 被禁用的工具名称列表*/
  disabledTools?: string[];
  stream: boolean;
  authProtected?: boolean;
  managementProtected?: boolean;
  platform: string;
}

export function createStatusHandler(info: StatusInfo) {
  return async (_req: http.IncomingMessage, res: http.ServerResponse) => {
    sendJSON(res, 200, info);
  };
}
