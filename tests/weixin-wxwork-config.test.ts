/**
 * Weixin / WXWork extension 迁移测试。
 *
 * 目标：验证普通微信与企业微信平台已经不再由核心内置注册，
 * 作为 workspace 可选 extension 时可通过清单显式注册。
 */

import { describe, expect, it } from 'vitest';
import { registerExtensionPlatforms } from '../src/extension/index';
import { parsePlatformConfig } from '../src/config/platform';
import { PlatformRegistry } from '../src/core/platform-registry';

describe('Weixin / WXWork: parsePlatformConfig', () => {
  it('解析 wxwork 配置并提供默认值', () => {
    const config = parsePlatformConfig({
      type: 'wxwork',
      wxwork: {
        botId: 'bot_xxx',
        secret: 'secret_xxx',
      },
    });

    expect(config.types).toEqual(['wxwork']);
    expect(config.wxwork.botId).toBe('bot_xxx');
    expect(config.wxwork.secret).toBe('secret_xxx');
    // 扩展平台默认值由扩展运行时自行处理，宿主只做透传
  });

  it('解析 weixin 配置并提供默认值', () => {
    const config = parsePlatformConfig({
      type: 'weixin',
      weixin: {
        botToken: 'token_xxx',
        baseUrl: 'https://ilinkai.weixin.qq.com',
      },
    });

    expect(config.types).toEqual(['weixin']);
    expect(config.weixin.botToken).toBe('token_xxx');
    expect(config.weixin.baseUrl).toBe('https://ilinkai.weixin.qq.com');
    // 扩展平台默认值由扩展运行时自行处理，宿主只做透传
  });
});

describe('Weixin / WXWork: extension registration', () => {
  it('默认不注册 workspace 平台扩展，但显式启用 workspace discovery 后可由 extension 清单注册', async () => {
    const defaultRegistry = new PlatformRegistry();
    const defaultRegistered = registerExtensionPlatforms(defaultRegistry);
    expect(defaultRegistered).not.toContain('wxwork');
    expect(defaultRegistered).not.toContain('weixin');

    const registry = new PlatformRegistry();
    expect(registry.has('wxwork')).toBe(false);
    expect(registry.has('weixin')).toBe(false);

    const registered = registerExtensionPlatforms(registry, undefined, undefined, {
      workspace: { enabled: true, allowlist: ['wxwork', 'weixin'] },
    });
    expect(registered).toContain('wxwork');
    expect(registered).toContain('weixin');
    expect(registry.has('wxwork')).toBe(true);
    expect(registry.has('weixin')).toBe(true);

    const wxworkPlatform = await registry.create('wxwork', {
      backend: {} as any,
      config: { platform: { wxwork: { botId: 'bot_xxx', secret: 'secret_xxx' } } } as any,
    } as any);
    expect(typeof (wxworkPlatform as { start?: unknown }).start).toBe('function');

    const weixinPlatform = await registry.create('weixin', {
      backend: {} as any,
      config: { platform: { weixin: { botToken: 'token_xxx', baseUrl: 'https://ilinkai.weixin.qq.com' } } } as any,
      configDir: '__test_placeholder__',
    } as any);
    expect(typeof (weixinPlatform as { start?: unknown }).start).toBe('function');
  });
});
