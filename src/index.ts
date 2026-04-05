/**
 * 入口文件（平台模式）
 *
 * 使用 IrisHost 统一管理所有 Agent，通过能力接口检测区分平台行为。
 * 不出现任何硬编码平台名称（如 'web'/'console'）。
 *
 * 启动流程：
 *   1. IrisHost.start() → 加载 Agent 定义，为每个 Agent 创建 IrisCore
 *   2. 创建平台适配器（通过 PlatformRegistry）
 *   3. 启动平台
 *   4. 等待退出条件（信号 / 前台平台退出）
 *   5. IrisHost.shutdown() → 优雅关闭所有资源
 */

import { IrisHost } from './core/iris-host';
import { IrisCore } from './core/iris-core';
import {
  PlatformAdapter,
  isMultiAgentCapable,
  isForegroundPlatform,
  isRoutableHttpPlatform,
} from '@irises/extension-sdk';
import type { MultiAgentCapable, ForegroundPlatform } from '@irises/extension-sdk';
import type { MCPManager } from './mcp';
import { isCompiledBinary } from './paths';

// ============ 平台创建 ============

/**
 * 为单个 Core 创建所有配置的平台适配器。
 */
async function createPlatformsForCore(
  core: IrisCore,
): Promise<PlatformAdapter[]> {
  const { config, configDir, router } = core;
  const platforms: PlatformAdapter[] = [];

  for (const platformType of config.platform.types) {
    if (!core.platformRegistry.has(platformType)) {
      console.error(`[Iris] 未注册的平台类型: ${platformType}`);
      continue;
    }

    // 恢复平台上次使用的模型
    if (config.llm.rememberPlatformModel) {
      const platformSubConfig = config.platform[platformType];
      const lastModel = platformSubConfig && typeof platformSubConfig === 'object' && 'lastModel' in platformSubConfig
        ? (platformSubConfig as { lastModel?: string }).lastModel
        : undefined;
      if (lastModel && router.hasModel(lastModel)) {
        try { core.backend.switchModel(lastModel); } catch { /* ignore */ }
      }
    }

    const platform = await core.platformRegistry.create(platformType, {
      backend: core.backendHandle,
      config,
      configDir,
      router,
      getMCPManager: () => core.getMCPManager(),
      setMCPManager: (manager?: MCPManager) => { core.setMCPManager(manager); },
      agentName: core.agentName,
      extensions: core.extensions,
      initWarnings: core.initWarnings,
      eventBus: core.eventBus,
      api: core.irisAPI,
      isCompiledBinary,
    });

    platforms.push(platform);
  }

  return platforms;
}

/**
 * 为所有 Core 创建平台，通过能力接口检测区分平台行为。
 * 不硬编码任何平台名称。
 */
async function createPlatforms(host: IrisHost) {
  const allPlatforms: PlatformAdapter[] = [];
  let sharedPlatform: (PlatformAdapter & MultiAgentCapable) | undefined;
  let foregroundPlatform: (PlatformAdapter & ForegroundPlatform) | undefined;

  for (const [name, core] of host.cores) {
    const platforms = await createPlatformsForCore(core);

    for (const platform of platforms) {
      // MultiAgentCapable 平台：只创建一次，多个 Core 共享
      if (isMultiAgentCapable(platform) && !sharedPlatform) {
        sharedPlatform = platform;

        // 多 Agent 模式下将所有 Core 注册到共享平台
        if (host.cores.size > 1) {
          for (const [agentName, agentCore] of host.cores) {
            if (agentName === name) continue; // 创建者已自动注册
            const agentDefs = host.getAgentDefs();
            const displayName = agentName === '__global__'
              ? '全局 AI'
              : agentDefs.find(d => d.name === agentName)?.description;
            sharedPlatform.addAgent(
              agentName,
              agentCore.backendHandle,
              {
                platform: agentCore.config.platform,
                configPath: agentCore.configDir,
                provider: agentCore.router.getCurrentModelInfo().provider,
                modelId: agentCore.router.getCurrentModelInfo().modelId,
                streamEnabled: agentCore.config.system.stream,
              },
              displayName,
              () => agentCore.getMCPManager(),
              (mgr?: any) => agentCore.setMCPManager(mgr),
              { llmProviders: agentCore.extensions.llmProviders, ocrProviders: agentCore.extensions.ocrProviders },
            );
          }
        }
      }

      // RoutableHttpPlatform 平台：绑定路由注册器
      if (isRoutableHttpPlatform(platform)) {
        core.bindRouteRegistrar(platform.registerRoute.bind(platform));
      }

      // ForegroundPlatform 平台：只取第一个
      if (isForegroundPlatform(platform) && !foregroundPlatform) {
        foregroundPlatform = platform;
      }

      allPlatforms.push(platform);
    }

    // 通知插件
    if (core.pluginManager) {
      const platformMap = new Map<string, PlatformAdapter>();
      for (let i = 0; i < core.config.platform.types.length && i < platforms.length; i++) {
        platformMap.set(core.config.platform.types[i], platforms[i]);
      }
      await core.pluginManager.notifyPlatformsReady(platformMap);
    }
  }

  // 热重载注入（统一，不分叉）
  if (sharedPlatform?.setReloadHandler) {
    sharedPlatform.setReloadHandler(async (agent: any): Promise<any> => {
      const agentName = (typeof agent === 'object' ? agent.name : undefined) ?? '__global__';
      return await host.reloadAgent(agentName);
    });
  }

  return { allPlatforms, sharedPlatform, foregroundPlatform };
}

// ============ 主入口 ============

async function main() {
  // 1. 启动 Host（创建所有 Core）
  const host = new IrisHost();
  await host.start();

  // 2. 创建平台
  const { allPlatforms, foregroundPlatform } = await createPlatforms(host);

  if (allPlatforms.length === 0) {
    console.error('未配置任何有效平台，请检查 platform.yaml 的 type 字段。');
    process.exit(1);
  }

  // 3. 启动后台平台
  const backgroundPlatforms = allPlatforms.filter(p => p !== foregroundPlatform);
  if (backgroundPlatforms.length > 0) {
    await Promise.all(backgroundPlatforms.map(p => p.start()));
  }

  // 4. 信号处理
  let isShuttingDown = false;
  const exit = async () => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    await Promise.all(allPlatforms.map(p => p.stop())).catch(() => {});
    await host.shutdown();
    process.exit(0);
  };
  process.on('SIGINT', () => exit());
  process.on('SIGTERM', () => exit());

  // 5. 前台平台处理
  if (foregroundPlatform) {
    await foregroundPlatform.start();
    // Agent 切换由前台平台内部处理（Console 通过 agentNetwork + listAgents 完成切换后重启 TUI）
    // waitForExit() 仅在用户选择退出时 resolve
    await (foregroundPlatform as PlatformAdapter & ForegroundPlatform).waitForExit();
    await exit();
  }
}

main().catch((err) => {
  console.error('启动失败:', err);
  process.exit(1);
});
