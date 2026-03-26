/**
 * 平台配置解析
 *
 * 支持两种写法：
 *   type: console           # 单平台（兼容旧格式）
 *   type: [console, web]    # 多平台同时启动
 *
 * 同时支持插件注册的自定义平台类型。
 */

import * as fs from 'fs';
import * as path from 'path';
import { parseDocument } from 'yaml';
import { PlatformConfig } from './types';

function parseTypes(raw: unknown): string[] {
  // 环境变量覆盖（用于嵌入式终端等场景，避免端口冲突）
  const envOverride = process.env.IRIS_PLATFORM;
  if (envOverride) {
    const types = envOverride.split(',')
      .map(v => v.trim().toLowerCase())
      .filter(Boolean);
    if (types.length > 0) return [...new Set(types)];
  }

  // 数组写法
  if (Array.isArray(raw)) {
    const result = raw
      .map(v => String(v).trim().toLowerCase())
      .filter(Boolean);
    return result.length > 0 ? [...new Set(result)] : ['console'];
  }

  // 单字符串写法（兼容旧格式）
  if (typeof raw === 'string') {
    const v = raw.trim().toLowerCase();
    return v ? [v] : ['console'];
  }

  // 默认
  return ['console'];
}

export function parsePlatformConfig(raw: any = {}): PlatformConfig {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};

  // 全局对码配置默认值
  const globalPairing = {
    dmPolicy: source.pairing?.dmPolicy ?? 'pairing',
    admin: source.pairing?.admin,
    allowFrom: source.pairing?.allowFrom,
  };

  // 辅助函数：合并分平台覆盖
  const parsePairingOverride = (platformPairing: any) => {
    if (!platformPairing) return globalPairing;
    return {
      dmPolicy: platformPairing.dmPolicy ?? globalPairing.dmPolicy,
      admin: platformPairing.admin ?? globalPairing.admin,
      allowFrom: platformPairing.allowFrom ?? globalPairing.allowFrom,
    };
  };

  return {
    ...source,
    types: parseTypes(source.type),
    pairing: globalPairing,
    discord: {
      token: source.discord?.token ?? '',
      lastModel: source.discord?.lastModel,
      pairing: parsePairingOverride(source.discord?.pairing),
    },
    telegram: {
      token: source.telegram?.token ?? '',
      lastModel: source.telegram?.lastModel,
      showToolStatus: source.telegram?.showToolStatus !== false,
      groupMentionRequired: source.telegram?.groupMentionRequired !== false,
      pairing: parsePairingOverride(source.telegram?.pairing),
    },
    web: {
      port: source.web?.port ?? 8192,
      host: source.web?.host ?? '127.0.0.1',
      lastModel: source.web?.lastModel,
      authToken: source.web?.authToken,
      managementToken: source.web?.managementToken,
    },
    wxwork: {
      botId: source.wxwork?.botId ?? '',
      secret: source.wxwork?.secret ?? '',
      lastModel: source.wxwork?.lastModel,
      showToolStatus: source.wxwork?.showToolStatus !== false,
      pairing: parsePairingOverride(source.wxwork?.pairing),
    },
    lark: {
      appId: source.lark?.appId ?? '',
      appSecret: source.lark?.appSecret ?? '',
      lastModel: source.lark?.lastModel,
      verificationToken: source.lark?.verificationToken,
      encryptKey: source.lark?.encryptKey,
      showToolStatus: source.lark?.showToolStatus !== false,
      pairing: parsePairingOverride(source.lark?.pairing),
    },
    weixin: {
      botToken: source.weixin?.botToken ?? '',
      lastModel: source.weixin?.lastModel,
      baseUrl: source.weixin?.baseUrl,
      showToolStatus: source.weixin?.showToolStatus !== false,
      pairing: parsePairingOverride(source.weixin?.pairing),
    },
    qq: {
      wsUrl: source.qq?.wsUrl ?? 'ws://127.0.0.1:3001',
      lastModel: source.qq?.lastModel,
      accessToken: source.qq?.accessToken,
      selfId: source.qq?.selfId ?? '',
      groupMode: source.qq?.groupMode ?? 'at',
      showToolStatus: source.qq?.showToolStatus !== false,
      pairing: parsePairingOverride(source.qq?.pairing),
    },
  } as PlatformConfig;
}


/**
 * 将平台上次使用的模型名写回 platform.yaml（保留注释和格式）。
 * 仅在 rememberPlatformModel 启用时由 Backend.switchModel 调用。
 */
export function updatePlatformLastModel(configDir: string, platformName: string, modelName: string): void {
  const filePath = path.join(configDir, 'platform.yaml');
  let content = '';
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return; // 文件不存在则跳过
  }

  const doc = parseDocument(content);
  doc.setIn([platformName, 'lastModel'], modelName);
  fs.writeFileSync(filePath, doc.toString(), 'utf-8');
}
