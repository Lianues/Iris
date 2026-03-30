/**
 * 入口文件（平台模式）
 *
 * 调用 bootstrap() 初始化核心模块，然后创建平台适配器并启动。
 *
 * 支持两种模式：
 *   - 单 Agent 模式（默认）：与改造前行为完全一致
 *   - 多 Agent 模式（agents.yaml enabled: true）：每个 Agent 独立 bootstrap，
 *     非 Console 平台各自启动，Console 平台通过选择循环切换
 */

import { bootstrap, BootstrapResult } from './bootstrap';
import { PlatformAdapter, isMultiAgentCapable } from '@irises/extension-sdk';
import type { MultiAgentCapable } from '@irises/extension-sdk';
import type { MCPManager } from './mcp';
import { isMultiAgentEnabled, loadAgentDefinitions, resolveAgentPaths } from './agents';
import type { AgentDefinition } from './agents';
import { isCompiledBinary } from './paths';

// ============ 平台创建（从原 main 中抽取） ============

interface CreatePlatformsOptions {
  /** 排除 console 平台（多 Agent 模式下由选择循环单独处理） */
  excludeConsole?: boolean;
  /** 排除 web 平台（多 Agent 模式下由共享 WebPlatform 处理） */
  excludeWeb?: boolean;
}

/**
 * 根据配置创建平台适配器列表。
 * 将原 main 中的 switch-case 逻辑抽取为独立函数，供单/多 Agent 模式复用。
 */
async function createPlatforms(
  result: BootstrapResult,
  options?: CreatePlatformsOptions,
): Promise<{ platforms: PlatformAdapter[]; platformMap: Map<string, PlatformAdapter>; multiAgentPlatformRef?: PlatformAdapter & MultiAgentCapable }> {
  const { backend, config, configDir, router, getMCPManager, setMCPManager, initWarnings, platformRegistry, agentName, eventBus } = result;

  const platforms: PlatformAdapter[] = [];
  const platformMap = new Map<string, PlatformAdapter>();
  let multiAgentPlatformRef: (PlatformAdapter & MultiAgentCapable) | undefined;

  for (const platformType of config.platform.types) {
    if (options?.excludeConsole && platformType === 'console') continue;
    if (options?.excludeWeb && platformType === 'web') continue;

    if (!platformRegistry.has(platformType)) {
      console.error(`[Iris] 未注册的平台类型: ${platformType}`);
      continue;
    }

    // 恢复平台上次使用的模型（rememberPlatformModel 启用时）
    if (config.llm.rememberPlatformModel) {
      const platformSubConfig = config.platform[platformType];
      const lastModel = platformSubConfig && typeof platformSubConfig === 'object' && 'lastModel' in platformSubConfig
        ? (platformSubConfig as { lastModel?: string }).lastModel
        : undefined;
      if (lastModel && router.hasModel(lastModel)) {
        try { backend.switchModel(lastModel); } catch { /* ignore */ }
      }
    }

    const platform = await platformRegistry.create(platformType, {
      backend,
      config,
      configDir,
      router,
      getMCPManager,
      setMCPManager: (manager?: MCPManager) => { setMCPManager(manager); },
      agentName,
      extensions: result.extensions,
      initWarnings,
      eventBus,
      api: result.irisAPI,
      isCompiledBinary,
    });

    // 检测支持多 Agent 的平台（如 web），绑定路由注册
    if (isMultiAgentCapable(platform) && !multiAgentPlatformRef) {
      multiAgentPlatformRef = platform;
      if (platform.registerRoute) {
        result.bindWebRouteRegistration(platform.registerRoute.bind(platform));
      }
    }
    platforms.push(platform);
    platformMap.set(platformType, platform);
  }

  return { platforms, platformMap, multiAgentPlatformRef };
}

// ============ 单 Agent 模式（原有逻辑） ============

async function runSingleAgent(): Promise<void> {
  const result = await bootstrap();
  const { getMCPManager } = result;

  let { platforms, platformMap, multiAgentPlatformRef } = await createPlatforms(result);
  let activePlatforms = platforms;

  if (activePlatforms.length === 0) {
    console.error('未配置任何有效平台，请检查 platform.yaml 的 type 字段。');
    process.exit(1);
  }

  // 注入 Agent 热重载能力
  if (multiAgentPlatformRef?.setReloadHandler) {
    multiAgentPlatformRef.setReloadHandler(async (agent: any) => {
      if (agent === '__default__' || (typeof agent === 'object' && agent.name === '__global__')) {
        return bootstrap();
      }
      const { resolveAgentPaths } = await import('./agents');
      const paths = resolveAgentPaths(agent);
      return bootstrap({ agentName: agent.name, agentPaths: paths });
    });
  }

  // 注入平台配置热重载能力
  if (multiAgentPlatformRef?.setPlatformReloadHandler) {
    const { parsePlatformConfig } = await import('./config/platform');
    multiAgentPlatformRef.setPlatformReloadHandler(async (mergedConfig: any) => {
      const newPlatformConfig = parsePlatformConfig(mergedConfig.platform);

      // 停止所有非 web 平台
      const nonWebPlatforms = activePlatforms.filter(p => p !== multiAgentPlatformRef);
      await Promise.all(nonWebPlatforms.map(p => p.stop()));

      // 用新配置重建非 web 平台
      // 更新 result.config.platform 以便 createPlatforms 使用新配置
      result.config.platform = newPlatformConfig;
      const rebuilt = await createPlatforms(result, { excludeWeb: true });
      await Promise.all(rebuilt.platforms.map(p => p.start()));

      // 更新活跃平台列表（保留 web 平台 + 新的非 web 平台）
      activePlatforms = [multiAgentPlatformRef!, ...rebuilt.platforms];
    });
  }

  // 通知插件平台已创建完成
  if (result.pluginManager) {
    await result.pluginManager.notifyPlatformsReady(platformMap);
  }

  await Promise.all(activePlatforms.map(p => p.start()));

  let cleaning = false;
  const cleanup = async () => {
    if (cleaning) return;
    cleaning = true;
    try {
      const activeMcp = multiAgentPlatformRef?.getMCPManager ? multiAgentPlatformRef.getMCPManager() : getMCPManager();
      if (activeMcp) await (activeMcp as any).disconnectAll();
      await Promise.all(activePlatforms.map(p => p.stop()));
    } catch (err) {
      console.error('清理时出错:', err);
    }
    process.exit(0);
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

// ============ 多 Agent 模式 ============

async function runMultiAgent(): Promise<void> {
  const agentDefs = loadAgentDefinitions();
  if (agentDefs.length === 0) {
    console.log('[Iris] agents.yaml 已启用但未定义任何 agent，回退到单 Agent 模式。');
    await runSingleAgent();
    return;
  }

  // 1. 统一 bootstrap 所有 agent + 全局配置
  const bootstrapCache = new Map<string, BootstrapResult>();

  // 全局 AI（使用 ~/.iris/configs/ 的配置）
  console.log('[Iris] 正在初始化全局 AI...');
  const globalResult = await bootstrap();
  bootstrapCache.set('__global__', globalResult);

  for (const def of agentDefs) {
    const paths = resolveAgentPaths(def);
    console.log(`[Iris] 正在初始化 Agent: ${def.name}...`);
    const result = await bootstrap({ agentName: def.name, agentPaths: paths });
    bootstrapCache.set(def.name, result);
  }

  // 2. 创建共享多 Agent 平台（所有 agent 共用一个 HTTP 端口）+ 其他非 Console 平台
  const allNonConsolePlatforms: PlatformAdapter[] = [];
  let sharedMultiAgentPlatform: (PlatformAdapter & MultiAgentCapable) | undefined;

  // 找到第一个配置了 web 平台的 agent，通过注册表创建共享平台
  for (const [name, result] of bootstrapCache) {
    if (result.config.platform.types.includes('web')) {
      const platform = await result.platformRegistry.create('web', {
        backend: result.backend,
        config: result.config,
        configDir: result.configDir,
        router: result.router,
        getMCPManager: result.getMCPManager,
        setMCPManager: result.setMCPManager,
        extensions: result.extensions,
        initWarnings: result.initWarnings,
        eventBus: result.eventBus,
        api: result.irisAPI,
        isCompiledBinary,
      });
      if (isMultiAgentCapable(platform)) {
        sharedMultiAgentPlatform = platform;
      }
      break;
    }
  }

  // 将所有 agent 注册到共享平台
  if (sharedMultiAgentPlatform) {
    const registerSharedWebRoute = sharedMultiAgentPlatform.registerRoute?.bind(sharedMultiAgentPlatform);
    // 然后逐个添加真正的 agent
    for (const [name, result] of bootstrapCache) {
      const currentModel = result.router.getCurrentModelInfo();
      const displayName = name === '__global__' ? '全局 AI' : (agentDefs.find(d => d.name === name)?.description);
      sharedMultiAgentPlatform.addAgent(name, result.backend, {
        port: result.config.platform.web.port,
        host: result.config.platform.web.host,
        authToken: result.config.platform.web.authToken,
        managementToken: result.config.platform.web.managementToken,
        configPath: result.configDir,
        provider: currentModel.provider,
        modelId: currentModel.modelId,
        streamEnabled: result.config.system.stream,
      },
      displayName,
      () => result.getMCPManager(),
      (mgr?) => result.setMCPManager(mgr),
      { llmProviders: result.extensions.llmProviders, ocrProviders: result.extensions.ocrProviders },
      );
      if (registerSharedWebRoute) result.bindWebRouteRegistration(registerSharedWebRoute);
    }
    allNonConsolePlatforms.push(sharedMultiAgentPlatform);

    // 注入 Agent 热重载能力
    sharedMultiAgentPlatform.setReloadHandler?.(async (agent: any) => {
      if (agent === '__default__' || (typeof agent === 'object' && agent.name === '__global__')) {
        return bootstrap();
      }
      const paths = resolveAgentPaths(agent as AgentDefinition);
      return bootstrap({ agentName: (agent as AgentDefinition).name, agentPaths: paths });
    });
  }

  // 创建其他非 Console/非 Web 平台
  for (const [name, result] of bootstrapCache) {
    const platformMap = new Map<string, PlatformAdapter>();
    if (sharedMultiAgentPlatform) {
      platformMap.set('web', sharedMultiAgentPlatform);
    }
    if (name !== '__global__') {
      const created = await createPlatforms(result, { excludeConsole: true, excludeWeb: true });
      allNonConsolePlatforms.push(...created.platforms);
      created.platformMap.forEach((platform, type) => platformMap.set(type, platform));
    }
    if (result.pluginManager) {
      await result.pluginManager.notifyPlatformsReady(platformMap);
    }
  }

  if (allNonConsolePlatforms.length > 0) {
    await Promise.all(allNonConsolePlatforms.map(p => p.start()));
  }

  // 3. 注册退出清理（在 Console 循环之前，确保运行期间信号也能触发清理）
  let cleaning = false;
  const cleanup = async () => {
    if (cleaning) return;
    cleaning = true;
    try {
      for (const result of bootstrapCache.values()) {
        const mcpManager = result.getMCPManager();
        if (mcpManager) await mcpManager.disconnectAll();
      }
      await Promise.all(allNonConsolePlatforms.map(p => p.stop()));
    } catch (err) {
      console.error('清理时出错:', err);
    }
    process.exit(0);
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  // 4. Console Agent 选择循环
  //    全局 AI 始终可选，所有已定义 agent 也可选
  await runConsoleAgentLoop(agentDefs, bootstrapCache);
}

// ============ Console Agent 选择循环 ============

async function runConsoleAgentLoop(
  agentDefs: AgentDefinition[],
  cache: Map<string, BootstrapResult>,
): Promise<void> {
  if (typeof (globalThis as any).Bun === 'undefined') {
    console.error(
      '[Iris] Console 平台需要 Bun 运行时。\n' +
      '  - 请优先使用: bun run dev\n' +
      '  - 或直接执行: bun src/index.ts\n' +
      '  - 或切换到其他平台（如 web）'
    );
    return;
  }

  while (true) {
    // 显示 Agent 选择界面
    const { showAgentSelector, GLOBAL_AGENT_NAME } = await import('../extensions/console/src/agent-selector');
    const selected = await showAgentSelector(agentDefs);
    if (!selected) break; // Esc / Ctrl+C → 退出

    const isGlobal = selected.name === GLOBAL_AGENT_NAME;
    const result = cache.get(selected.name);
    if (!result) break; // 不应发生

    // 全局 AI 不传 agentName，和单 Agent 模式行为一致
    const displayName = isGlobal ? undefined : selected.name;
    const action = await startConsoleForAgent(result, displayName);

    if (action === 'exit') break;
    // action === 'switch-agent' → 继续循环
  }
}

/**
 * 为指定 Agent 启动 Console TUI。
 * 返回用户的退出意图：'exit' 表示退出应用，'switch-agent' 表示切换 Agent。
 */
async function startConsoleForAgent(
  result: BootstrapResult,
  agentName?: string,
): Promise<'exit' | 'switch-agent'> {
  const { backend, config, configDir, router, getMCPManager, setMCPManager, initWarnings, platformRegistry } = result;
  const currentModel = router.getCurrentModelInfo();
  const defaultMode = config.system.defaultMode ?? 'default';

  let resolveAction: (action: 'exit' | 'switch-agent') => void;
  const promise = new Promise<'exit' | 'switch-agent'>((resolve) => {
    resolveAction = resolve;
  });

  let resolved = false;
  const consolePlatform = await platformRegistry.create('console', {
    backend,
    config: {
      ...config,
      system: { ...config.system, defaultMode },
    },
    configDir,
    router,
    getMCPManager,
    setMCPManager: (manager?: MCPManager) => { setMCPManager(manager); },
    extensions: result.extensions,
    agentName,
    initWarnings,
    api: result.irisAPI,
    isCompiledBinary,
    onSwitchAgent: () => {
      resolved = true;
      consolePlatform.stop();
      resolveAction('switch-agent');
    },
  }) as PlatformAdapter;

  const originalStop = consolePlatform.stop.bind(consolePlatform);
  consolePlatform.stop = async () => {
    await originalStop();
    if (!resolved) {
      resolved = true;
      resolveAction('exit');
    }
  };

  await consolePlatform.start();
  return promise;
}

// ============ 主入口 ============

async function main() {
  if (isMultiAgentEnabled()) {
    await runMultiAgent();
  } else {
    await runSingleAgent();
  }
}

main().catch((err) => {
  console.error('启动失败:', err);
  process.exit(1);
});
