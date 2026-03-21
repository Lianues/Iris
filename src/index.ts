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
import { PlatformAdapter } from './platforms/base';
import type { WebPlatform as WebPlatformType } from './platforms/web';
import type { MCPManager } from './mcp';
import { isMultiAgentEnabled, loadAgentDefinitions, resolveAgentPaths } from './agents';
import type { AgentDefinition } from './agents';

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
): Promise<{ platforms: PlatformAdapter[]; webPlatformRef?: WebPlatformType }> {
  const { backend, config, configDir, router, getMCPManager, setMCPManager, computerEnv, initWarnings } = result;
  const currentModel = router.getCurrentModelInfo();
  const defaultMode = config.system.defaultMode ?? 'default';

  const platforms: PlatformAdapter[] = [];
  let webPlatformRef: WebPlatformType | undefined;

  for (const platformType of config.platform.types) {
    if (options?.excludeConsole && platformType === 'console') continue;
    if (options?.excludeWeb && platformType === 'web') continue;

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
      case 'qq': {
        const { QQPlatform } = await import('./platforms/qq');
        platforms.push(new QQPlatform(backend, {
          wsUrl: config.platform.qq.wsUrl,
          accessToken: config.platform.qq.accessToken,
          selfId: config.platform.qq.selfId,
          groupMode: config.platform.qq.groupMode,
          showToolStatus: config.platform.qq.showToolStatus,
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
          computerEnv,
          initWarnings,
        }));
        break;
      }
    }
  }

  return { platforms, webPlatformRef };
}

// ============ 单 Agent 模式（原有逻辑） ============

async function runSingleAgent(): Promise<void> {
  const result = await bootstrap();
  const { getMCPManager } = result;

  const { platforms, webPlatformRef } = await createPlatforms(result);

  if (platforms.length === 0) {
    console.error('未配置任何有效平台，请检查 platform.yaml 的 type 字段。');
    process.exit(1);
  }

  await Promise.all(platforms.map(p => p.start()));

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

// ============ 多 Agent 模式 ============

async function runMultiAgent(): Promise<void> {
  const agentDefs = loadAgentDefinitions();
  if (agentDefs.length === 0) {
    console.error('[Iris] agents.yaml 已启用但未定义任何 agent。');
    process.exit(1);
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

  // 2. 创建共享 WebPlatform（所有 agent 共用一个 HTTP 端口）+ 其他非 Console 平台
  const allNonConsolePlatforms: PlatformAdapter[] = [];
  let sharedWebPlatform: WebPlatformType | undefined;

  // 找到第一个配置了 web 平台的 agent，用其端口/认证配置创建共享 WebPlatform
  for (const [name, result] of bootstrapCache) {
    if (result.config.platform.types.includes('web')) {
      const { WebPlatform } = await import('./platforms/web');
      const currentModel = result.router.getCurrentModelInfo();
      sharedWebPlatform = new WebPlatform(result.backend, {
        port: result.config.platform.web.port,
        host: result.config.platform.web.host,
        authToken: result.config.platform.web.authToken,
        managementToken: result.config.platform.web.managementToken,
        configPath: result.configDir,
        provider: currentModel.provider,
        modelId: currentModel.modelId,
        streamEnabled: result.config.system.stream,
      });
      break;
    }
  }

  // 将所有 agent 注册到共享 WebPlatform
  if (sharedWebPlatform) {
    // 先清空默认的 'default' agent（构造函数创建的）
    // 然后逐个添加真正的 agent
    for (const [name, result] of bootstrapCache) {
      const currentModel = result.router.getCurrentModelInfo();
      const displayName = name === '__global__' ? '全局 AI' : (agentDefs.find(d => d.name === name)?.description);
      sharedWebPlatform.addAgent(name, result.backend, {
        port: result.config.platform.web.port,
        host: result.config.platform.web.host,
        authToken: result.config.platform.web.authToken,
        managementToken: result.config.platform.web.managementToken,
        configPath: result.configDir,
        provider: currentModel.provider,
        modelId: currentModel.modelId,
        streamEnabled: result.config.system.stream,
      }, displayName, () => result.getMCPManager(), (mgr?) => result.setMCPManager(mgr));
    }
    allNonConsolePlatforms.push(sharedWebPlatform);
  }

  // 创建其他非 Console/非 Web 平台
  for (const def of agentDefs) {
    const result = bootstrapCache.get(def.name)!;
    const { platforms } = await createPlatforms(result, { excludeConsole: true, excludeWeb: true });
    allNonConsolePlatforms.push(...platforms);
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
    const { showAgentSelector, GLOBAL_AGENT_NAME } = await import('./platforms/console/agent-selector');
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
  const { backend, config, configDir, router, getMCPManager, setMCPManager, computerEnv, initWarnings } = result;
  const currentModel = router.getCurrentModelInfo();
  const defaultMode = config.system.defaultMode ?? 'default';

  const { ConsolePlatform } = await import('./platforms/console');

  let resolveAction: (action: 'exit' | 'switch-agent') => void;
  const promise = new Promise<'exit' | 'switch-agent'>((resolve) => {
    resolveAction = resolve;
  });

  let resolved = false;
  const consolePlatform = new ConsolePlatform(backend, {
    modeName: defaultMode,
    modelName: currentModel.modelName,
    modelId: currentModel.modelId,
    contextWindow: currentModel.contextWindow,
    configDir,
    getMCPManager,
    setMCPManager: (manager?: MCPManager) => { setMCPManager(manager); },
    agentName,
    computerEnv,
    initWarnings,
    onSwitchAgent: () => {
      resolved = true;
      consolePlatform.stop();
      resolveAction('switch-agent');
    },
  });

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
