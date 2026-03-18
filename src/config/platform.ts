/**
 * 平台配置解析
 *
 * 支持两种写法：
 *   type: console           # 单平台（兼容旧格式）
 *   type: [console, web]    # 多平台同时启动
 */

import { PlatformConfig } from './types';

type PlatformType = PlatformConfig['types'][number];

const VALID_TYPES = new Set<string>(['console', 'discord', 'telegram', 'web', 'wxwork', 'lark']);

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
    telegram: {
      // 这里先把 Telegram 的行为开关统一收口到配置层。
      // 目的：避免后续重构时把“是否显示工具状态”“群聊是否必须 @”这类策略写死在平台实现里。
      token: raw.telegram?.token ?? '',
      showToolStatus: raw.telegram?.showToolStatus !== false,
      groupMentionRequired: raw.telegram?.groupMentionRequired !== false,
    },
    web: {
      port: raw.web?.port ?? 8192,
      host: raw.web?.host ?? '127.0.0.1',
      authToken: raw.web?.authToken,
      managementToken: raw.web?.managementToken,
    },
    // 这里先把飞书配置接入统一配置层。
    // 目的：让后续 LarkPlatform 可以像其他平台一样，从标准化配置对象中读取凭据和行为开关。
    wxwork: {
      botId: raw.wxwork?.botId ?? '',
      secret: raw.wxwork?.secret ?? '',
      showToolStatus: raw.wxwork?.showToolStatus !== false,
    },
    lark: {
      // 这里统一做默认值兜底，避免平台层重复判空。
      // 后续真正连接飞书时，只需要检查字段是否为空并给出明确错误即可。
      appId: raw.lark?.appId ?? '',
      appSecret: raw.lark?.appSecret ?? '',
      verificationToken: raw.lark?.verificationToken,
      encryptKey: raw.lark?.encryptKey,
      showToolStatus: raw.lark?.showToolStatus !== false,
    },
  };
}
