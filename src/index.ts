/**
 * 入口文件（平台模式）
 *
 * 使用 IrisHost 统一管理所有 Agent，通过能力接口检测区分平台行为。
 * 不出现任何硬编码平台名称（如 'web'/'console'）。
 *
 * 启动流程：
 *   1. IrisHost.start() → 加载 Agent 定义，为每个 Agent 创建 IrisCore
 *   2. 仅为默认 Agent（第一个）创建平台适配器
 *      - 非默认 Agent 只启动后端（backend / IPC），供 delegate 等跨 Agent 机制调用
 *      - console 等前台平台通过 agentNetwork 实现 Agent 切换，不需要为每个 Agent 各建一套平台
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
} from 'irises-extension-sdk';
import type { MultiAgentCapable, ForegroundPlatform } from 'irises-extension-sdk';
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
 * 仅为默认 Agent（第一个 Core）创建平台。
 *
 * 设计原则：
 *   - 平台是用户界面层，一个进程只需要一套平台实例。
 *   - 非默认 Agent 只有后端（backend + IPC），不需要自己的平台。
 *   - console（ForegroundPlatform）独占 stdin/stdout，天然只能有一个。
 *   - web（MultiAgentCapable）通过 addAgent 注册多个 backend 到同一个 HTTP 服务。
 *   - 非默认 Agent 的交互通过以下机制完成：
 *     · delegate_to_agent 工具：直接调用目标 Agent 的 backend.chat()
 *     · console Agent 切换：通过 agentNetwork 获取目标 backendHandle 并 swap
 *     · IPC：每个 Agent 有独立的 IPC 端口，外部客户端可直接连接
 */
async function createPlatforms(host: IrisHost) {
  const allPlatforms: PlatformAdapter[] = [];
  let sharedPlatform: (PlatformAdapter & MultiAgentCapable) | undefined;
  let foregroundPlatform: (PlatformAdapter & ForegroundPlatform) | undefined;

  // 只为默认 Agent（第一个 Core）创建平台。
  // 非默认 Agent 只有 backend + IPC，不创建平台实例。
  const defaultCore = host.getDefaultCore();
  const platforms = await createPlatformsForCore(defaultCore);

  for (const platform of platforms) {
    // MultiAgentCapable 平台（如 web）：将其他 Agent 注册进来
    if (isMultiAgentCapable(platform) && !sharedPlatform) {
      sharedPlatform = platform;

      // 多 Agent 模式下将非默认 Core 注册到共享平台
      if (host.cores.size > 1) {
        for (const [agentName, agentCore] of host.cores) {
          if (agentCore === defaultCore) continue; // 创建者已自动注册
          const agentDefs = host.getAgentDefs();
          const displayName = agentDefs.find(d => d.name === agentName)?.description;
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
            { llmProviders: agentCore.extensions.llmProviders, ocrProviders: agentCore.extensions.ocrProviders },
          );
        }
      }
    }

    // RoutableHttpPlatform 平台：绑定路由注册器
    if (isRoutableHttpPlatform(platform)) {
      defaultCore.bindRouteRegistrar(platform.registerRoute.bind(platform));
    }

    // ForegroundPlatform 平台：记录引用
    if (isForegroundPlatform(platform) && !foregroundPlatform) {
      foregroundPlatform = platform;
    }

    allPlatforms.push(platform);
  }

  // 通知默认 Core 的插件
  if (defaultCore.pluginManager) {
    const platformMap = new Map<string, PlatformAdapter>();
    for (let i = 0; i < defaultCore.config.platform.types.length && i < platforms.length; i++) {
      platformMap.set(defaultCore.config.platform.types[i], platforms[i]);
    }
    await defaultCore.pluginManager.notifyPlatformsReady(platformMap);
  }

  // 热重载注入
  if (sharedPlatform?.setReloadHandler) {
    sharedPlatform.setReloadHandler(async (agent: any): Promise<any> => {
      const agentName = (typeof agent === 'object' ? agent.name : undefined) ?? 'master';
      return await host.reloadAgent(agentName);
    });
  }

  return { allPlatforms, sharedPlatform, foregroundPlatform };
}

// ============ 主入口 ============

async function main() {
  // 1. 启动 Host（创建所有 Core）
  //    所有 Agent 的 backend + IPC 在此阶段全部就绪，
  //    保证 delegate_to_agent 等跨 Agent 机制可用。
  const host = new IrisHost();
  await host.start();

  // 2. 仅为默认 Agent 创建平台
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

  // 4. 优雅关闭
  let isShuttingDown = false;
  const shutdown = async () => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    await Promise.all(allPlatforms.map(p => p.stop())).catch(() => {});
    await host.shutdown();
  };

  // 5. 前台平台处理
  if (foregroundPlatform) {
    // 前台平台（Console TUI）自己处理 Ctrl+C（exitOnCtrlC: false + useKeyboard）
    // SIGINT 必须被吞掉，否则 Windows 下 Ctrl+C 同时触发 TUI 退出 + 进程信号退出，终端崩溃
    process.on('SIGINT', () => { /* Console TUI 内部处理，此处忽略 */ });
    process.on('SIGTERM', () => void shutdown());

    await foregroundPlatform.start();
    await (foregroundPlatform as PlatformAdapter & ForegroundPlatform).waitForExit();
    await shutdown();
    process.exit(0);
  } else {
    // 无前台平台（纯后台服务模式）：信号直接触发关闭
    process.on('SIGINT', () => void shutdown());
    process.on('SIGTERM', () => void shutdown());
  }
}

main().catch((err) => {
  console.error('启动失败:', err);
  process.exit(1);
});
