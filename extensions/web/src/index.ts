/**
 * Web GUI 平台扩展入口
 *
 * 使用 definePlatformFactory 注册 web 平台。
 */

import { definePlatformFactory } from '@irises/extension-sdk';
import type { IrisAPI } from '@irises/extension-sdk';
import { WebPlatform } from './web-platform';

export { WebPlatform };

export default definePlatformFactory<Record<string, unknown>, WebPlatform>({
  platformName: 'web',

  resolveConfig(raw) {
    return {
      port: (raw as any).port ?? 8192,
      host: (raw as any).host ?? '127.0.0.1',
      authToken: (raw as any).authToken,
      managementToken: (raw as any).managementToken,
      lastModel: (raw as any).lastModel,
    };
  },

  async create(backend, config, context) {
    const api = context.api as IrisAPI | undefined;
    const router = context.router as any;
    const currentModel = router?.getCurrentModelInfo?.() ?? { provider: 'unknown', modelId: 'unknown' };
    const fullConfig = context.config as Record<string, any> | undefined;

    const webPlatform = new WebPlatform(backend, {
      port: (config as any).port ?? 8192,
      host: (config as any).host ?? '127.0.0.1',
      authToken: (config as any).authToken,
      managementToken: (config as any).managementToken,
      configPath: context.configDir ?? '',
      provider: currentModel.provider,
      modelId: currentModel.modelId,
      streamEnabled: fullConfig?.system?.stream ?? true,
    }, {
      api,
      projectRoot: (context as any).projectRoot ?? process.cwd(),
      dataDir: (context as any).dataDir ?? '',
      configDir: context.configDir,
      isCompiledBinary: (context as any).isCompiledBinary ?? false,
    });

    // 注入 MCP 管理器
    const mcpManager = (context as any).getMCPManager?.();
    if (mcpManager) webPlatform.setMCPManager(mcpManager);

    return webPlatform;
  },
});
