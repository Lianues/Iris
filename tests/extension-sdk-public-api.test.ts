import { describe, expect, it, vi } from 'vitest';
import {
  createPluginLogger,
  DELIVERY_REGISTRY_SERVICE_ID,
  definePlatformFactory,
  definePlugin,
  ENVIRONMENT_CONTEXT_SERVICE_ID,
  SCHEDULER_SERVICE_ID,
  WEATHER_SERVICE_ID,
  summarizeToolCall,
  type IrisBackendLike,
} from '../packages/extension-sdk/src';
import {
  CONSOLE_SETTINGS_TAB_SERVICE_ID,
  CONSOLE_TOOL_DISPLAY_SERVICE_ID,
} from '../packages/extension-sdk/src/console';

describe('extension sdk public api', () => {
  it('definePlatformFactory 应按平台名读取配置并创建实例', async () => {
    const backend = {
      on: vi.fn(),
      chat: vi.fn(async () => undefined),
      isStreamEnabled: vi.fn(() => true),
    } as unknown as IrisBackendLike;

    const create = vi.fn((resolvedBackend: IrisBackendLike, config: { token: string; flag?: boolean }) => ({
      backend: resolvedBackend,
      config,
    }));

    const factory = definePlatformFactory({
      platformName: 'demo',
      resolveConfig: (raw) => ({
        token: String(raw.token ?? ''),
        flag: raw.flag === true,
      }),
      create,
    });

    const result = await factory({
      backend,
      config: {
        platform: {
          demo: {
            token: 'abc',
            flag: true,
          },
        },
      },
    });

    expect(create).toHaveBeenCalledOnce();
    expect(result).toEqual({
      backend,
      config: {
        token: 'abc',
        flag: true,
      },
    });
  });

  it('definePlugin 应返回原插件对象', () => {
    const plugin = definePlugin({
      name: 'demo-plugin',
      version: '1.0.0',
      activate: vi.fn(),
    });

    expect(plugin.name).toBe('demo-plugin');
    expect(plugin.version).toBe('1.0.0');
  });

  it('createPluginLogger 应返回完整日志接口', () => {
    const logger = createPluginLogger('demo-plugin', 'test');

    expect(typeof logger.info).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.error).toBe('function');
    expect(typeof logger.debug).toBe('function');
  });

  it('应导出 delivery registry service id', () => {
    expect(DELIVERY_REGISTRY_SERVICE_ID).toBe('delivery.registry');
  });

  it('应导出 scheduler service id', () => {
    expect(SCHEDULER_SERVICE_ID).toBe('scheduler.tasks');
  });

  it('应导出 environment/weather service id', () => {
    expect(ENVIRONMENT_CONTEXT_SERVICE_ID).toBe('environment.context');
    expect(WEATHER_SERVICE_ID).toBe('environment.weather');
  });

  it('应导出 console integration service ids', () => {
    expect(CONSOLE_SETTINGS_TAB_SERVICE_ID).toBe('console:settings-tab');
    expect(CONSOLE_TOOL_DISPLAY_SERVICE_ID).toBe('console:tool-display');
  });

  it('应导出平台无关的工具摘要 formatter', () => {
    expect(summarizeToolCall('shell', { command: 'npm test' })?.text).toBe('npm test');
  });
});
