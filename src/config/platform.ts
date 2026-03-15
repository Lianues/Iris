/**
 * 平台配置解析
 *
 * 支持两种写法：
 *   type: console           # 单平台（兼容旧格式）
 *   type: [console, web]    # 多平台同时启动
 */

import { PlatformConfig } from './types';

type PlatformType = PlatformConfig['types'][number];

const VALID_TYPES = new Set<string>(['console', 'discord', 'telegram', 'web']);

function parseTypes(raw: unknown): PlatformType[] {
  // 数组写法
  if (Array.isArray(raw)) {
    const result = raw
      .map(v => String(v).trim().toLowerCase())
      .filter(v => VALID_TYPES.has(v)) as PlatformType[];
    return result.length > 0 ? [...new Set(result)] : ['console'];
  }

  // 单字符串写法（兼容旧格式）
  if (typeof raw === 'string') {
    const v = raw.trim().toLowerCase();
    return VALID_TYPES.has(v) ? [v as PlatformType] : ['console'];
  }

  // 默认
  return ['console'];
}

export function parsePlatformConfig(raw: any = {}): PlatformConfig {
  return {
    types: parseTypes(raw.type),
    discord: { token: raw.discord?.token ?? '' },
    telegram: { token: raw.telegram?.token ?? '' },
    web: {
      port: raw.web?.port ?? 8192,
      host: raw.web?.host ?? '127.0.0.1',
      authToken: raw.web?.authToken,
      managementToken: raw.web?.managementToken,
    },
  };
}
