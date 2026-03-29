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

  // 保留字段名，不作为扩展平台配置
  const RESERVED_KEYS = new Set(['type', 'pairing', 'web']);

  const result: Record<string, unknown> = {
    types: parseTypes(source.type),
    pairing: globalPairing,
    web: {
      port: source.web?.port ?? 8192,
      host: source.web?.host ?? '127.0.0.1',
      lastModel: source.web?.lastModel,
      authToken: source.web?.authToken,
      managementToken: source.web?.managementToken,
    },
  };

  // 动态透传扩展平台配置
  // 修改原因：平台已迁移到扩展系统，宿主不再为每个扩展平台硬编码默认值。
  // 用户在 platform.yaml 中配置的任何平台节点都会被原样透传。
  // 扩展运行时通过 getPlatformConfig(context, name) 获取并自行解析。
  for (const [key, value] of Object.entries(source)) {
    if (RESERVED_KEYS.has(key)) continue;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const platformSection = { ...value as Record<string, unknown> };
      // 自动合并 pairing 配置：扩展平台如果声明了 pairing 子字段，与全局 pairing 合并
      if ('pairing' in platformSection) {
        platformSection.pairing = parsePairingOverride(platformSection.pairing);
      } else {
        platformSection.pairing = globalPairing;
      }
      result[key] = platformSection;
    } else {
      // 非对象值原样保留（虽然通常不会出现）
      result[key] = value;
    }
  }

  return result as PlatformConfig;
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
