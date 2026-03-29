/**
 * Lark Phase 0 测试。
 *
 * 目标：验证飞书平台的配置解析与平台骨架接线已完成。
 */

import { describe, expect, it } from 'vitest';
import { registerExtensionPlatforms } from '../src/extension/index';
import { parsePlatformConfig } from '../src/config/platform';
import { createDefaultPlatformRegistry } from '../src/platforms/registry';
import { LarkPlatform } from '../extensions/lark/src';

describe('Lark Phase 0: parsePlatformConfig', () => {
  it('解析 lark 配置并提供默认值', () => {
    const config = parsePlatformConfig({
      type: 'lark',
      lark: {
        appId: 'cli_xxx',
        appSecret: 'secret_xxx',
      },
    });

    expect(config.types).toEqual(['lark']);
    expect(config.lark.appId).toBe('cli_xxx');
    expect(config.lark.appSecret).toBe('secret_xxx');
    // showToolStatus 默认值由扩展运行时自行处理，parsePlatformConfig 原样透传
    expect(config.lark.showToolStatus).toBeUndefined();
  });
});

describe('Lark Phase 0: platform skeleton', () => {
  it('在缺少凭据时给出明确错误', async () => {
    const platform = new LarkPlatform({} as any, {
      appId: '',
      appSecret: '',
    });

    await expect(platform.start()).rejects.toThrow('Lark 平台启动失败：缺少 appId 或 appSecret。');
  });

  it('不再内置注册 lark，而是由 extension 清单注册', async () => {
    const registry = createDefaultPlatformRegistry();
    expect(registry.has('lark')).toBe(false);

    const registered = registerExtensionPlatforms(registry);
    expect(registered).toContain('lark');

    const platform = await registry.create('lark', {
      backend: {} as any,
      config: { platform: { lark: { appId: 'cli_xxx', appSecret: 'secret_xxx' } } } as any,
    } as any);
    expect(typeof (platform as { start?: unknown }).start).toBe('function');
  });
});
