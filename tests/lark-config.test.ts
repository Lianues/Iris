/**
 * Lark Phase 0 测试。
 *
 * 目标：验证飞书平台的配置解析与平台骨架接线已完成。
 */

import { describe, expect, it } from 'vitest';
import { parsePlatformConfig } from '../src/config/platform';
import { LarkPlatform } from '../src/platforms/lark';

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
    expect(config.lark.showToolStatus).toBe(true);
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
});
