/**
 * Discord / QQ extension 迁移测试。
 *
 * 目标：验证 Discord 与 QQ 平台已经不再由核心内置注册，
 * 作为 workspace 可选 extension 时可通过清单显式注册。
 */

import { describe, expect, it } from 'vitest';
import { registerExtensionPlatforms } from '../src/extension/index';
import { parsePlatformConfig } from '../src/config/platform';
import { PlatformRegistry } from '../src/core/platform-registry';

describe('Discord / QQ: parsePlatformConfig', () => {
  it('解析 discord 配置并提供默认值', () => {
    const config = parsePlatformConfig({
      type: 'discord',
      discord: {
        token: 'discord-token-xxx',
      },
    });

    expect(config.types).toEqual(['discord']);
    expect(config.discord.token).toBe('discord-token-xxx');
  });

  it('解析 qq 配置并提供默认值', () => {
    const config = parsePlatformConfig({
      type: 'qq',
      qq: {
        wsUrl: 'ws://127.0.0.1:3001',
        selfId: '123456789',
      },
    });

    expect(config.types).toEqual(['qq']);
    expect(config.qq.wsUrl).toBe('ws://127.0.0.1:3001');
    expect(config.qq.selfId).toBe('123456789');
    // 扩展平台默认值由扩展运行时自行处理，宿主只做透传
  });
});

describe('Discord / QQ: extension registration', () => {
  it('默认不注册 workspace 平台扩展，但显式启用 workspace discovery 后可由 extension 清单注册', async () => {
    const defaultRegistry = new PlatformRegistry();
    const defaultRegistered = registerExtensionPlatforms(defaultRegistry);
    expect(defaultRegistered).not.toContain('discord');
    expect(defaultRegistered).not.toContain('qq');

    const registry = new PlatformRegistry();
    expect(registry.has('discord')).toBe(false);
    expect(registry.has('qq')).toBe(false);

    const registered = registerExtensionPlatforms(registry, undefined, undefined, {
      workspace: { enabled: true, allowlist: ['discord', 'qq'] },
    });
    expect(registered).toContain('discord');
    expect(registered).toContain('qq');
    expect(registry.has('discord')).toBe(true);
    expect(registry.has('qq')).toBe(true);

    const discordPlatform = await registry.create('discord', {
      backend: {} as any,
      config: { platform: { discord: { token: 'discord-token-xxx' } } } as any,
    } as any);
    expect(typeof (discordPlatform as { start?: unknown }).start).toBe('function');

    const qqPlatform = await registry.create('qq', {
      backend: {} as any,
      config: { platform: { qq: { wsUrl: 'ws://127.0.0.1:3001', selfId: '123456789' } } } as any,
    } as any);
    expect(typeof (qqPlatform as { start?: unknown }).start).toBe('function');
  });
});
