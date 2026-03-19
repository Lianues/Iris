/**
 * 入口文件（平台模式）
 *
 * 调用 bootstrap() 初始化核心模块，然后创建平台适配器并启动。
 */

import { bootstrap } from './bootstrap';
import { PlatformAdapter } from './platforms/base';
import type { WebPlatform as WebPlatformType } from './platforms/web';
import type { MCPManager } from './mcp';

async function main() {
  const {
    backend,
    config,
    configDir,
    router,
    mcpManager: initialMcpManager,
    getMCPManager,
    setMCPManager,
  } = await bootstrap();

  const currentModel = router.getCurrentModelInfo();
  const defaultMode = config.system.defaultMode ?? 'default';

  // ---- 创建平台适配器（按需动态导入） ----
  const platforms: PlatformAdapter[] = [];
  let webPlatformRef: WebPlatformType | undefined;

  for (const platformType of config.platform.types) {
    switch (platformType) {
      case 'discord': {
        const { DiscordPlatform } = await import('./platforms/discord');
        platforms.push(new DiscordPlatform(backend, { token: config.platform.discord.token }));
        break;
      }
      case 'telegram': {
        const { TelegramPlatform } = await import('./platforms/telegram');
        platforms.push(new TelegramPlatform(backend, {
          token: config.platform.telegram.token,
          showToolStatus: config.platform.telegram.showToolStatus,
          groupMentionRequired: config.platform.telegram.groupMentionRequired,
        }));
        break;
      }
      case 'web': {
        const { WebPlatform } = await import('./platforms/web');
        const webPlatform = new WebPlatform(backend, {
          port: config.platform.web.port,
          host: config.platform.web.host,
          authToken: config.platform.web.authToken,
          managementToken: config.platform.web.managementToken,
          configPath: configDir,
          provider: currentModel.provider,
          modelId: currentModel.modelId,
          streamEnabled: config.system.stream,
        });
        const mcpMgr = getMCPManager();
        if (mcpMgr) webPlatform.setMCPManager(mcpMgr);
        webPlatformRef = webPlatform;
        platforms.push(webPlatform);
        break;
      }
      case 'wxwork': {
        const { WXWorkPlatform } = await import('./platforms/wxwork');
        platforms.push(new WXWorkPlatform(backend, {
          botId: config.platform.wxwork.botId,
          secret: config.platform.wxwork.secret,
          showToolStatus: config.platform.wxwork.showToolStatus,
        }));
        break;
      }
      case 'lark': {
        const { LarkPlatform } = await import('./platforms/lark');
        platforms.push(new LarkPlatform(backend, {
          appId: config.platform.lark.appId,
          appSecret: config.platform.lark.appSecret,
          showToolStatus: config.platform.lark.showToolStatus,
        }));
        break;
      }
      case 'console': {
        if (typeof (globalThis as any).Bun === 'undefined') {
          console.error(
            '[Iris] Console 平台需要 Bun 运行时。\n' +
            '  - 请优先使用: bun run dev\n' +
            '  - 或直接执行: bun src/index.ts\n' +
            '  - 或切换到其他平台（如 web）'
          );
          process.exit(1);
        }
        const { ConsolePlatform } = await import('./platforms/console');
        platforms.push(new ConsolePlatform(backend, {
          modeName: defaultMode,
          modelName: currentModel.modelName,
          modelId: currentModel.modelId,
          contextWindow: currentModel.contextWindow,
          configDir,
          getMCPManager,
          setMCPManager: (manager?: MCPManager) => { setMCPManager(manager); },
        }));
        break;
      }
    }
  }

  if (platforms.length === 0) {
    console.error('未配置任何有效平台，请检查 platform.yaml 的 type 字段。');
    process.exit(1);
  }

  // ---- 启动所有平台 ----
  await Promise.all(platforms.map(p => p.start()));

  // ---- 退出清理 ----
  let cleaning = false;
  const cleanup = async () => {
    if (cleaning) return;
    cleaning = true;
    try {
      const activeMcp = webPlatformRef ? webPlatformRef.getMCPManager() : getMCPManager();
      if (activeMcp) await activeMcp.disconnectAll();
      await Promise.all(platforms.map(p => p.stop()));
    } catch (err) {
      console.error('清理时出错:', err);
    }
    process.exit(0);
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

main().catch((err) => {
  console.error('启动失败:', err);
  process.exit(1);
});
