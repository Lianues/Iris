/**
 * 系统级配置解析
 */

import { SystemConfig } from './types';

export function parseSystemConfig(raw: any = {}): SystemConfig {
  return {
    systemPrompt: raw.systemPrompt ?? '',
    maxToolRounds: raw.maxToolRounds ?? 200,
    stream: raw.stream ?? true,
    maxAgentDepth: raw.maxAgentDepth ?? 3,
    logRequests: raw.logRequests ?? false,
  };
}
