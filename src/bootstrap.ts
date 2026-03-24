/**
 * 核心初始化
 *
 * 从 index.ts 提取的共享初始化逻辑。
 * 创建 Backend 及其所有依赖模块，不涉及平台层。
 *
 * 复用场景：
 *   - index.ts（平台模式）：bootstrap() → 创建平台适配器 → 启动
 *   - cli.ts（CLI 模式）：bootstrap() → backend.chat() → 输出 → 退出
 */

import type { Computer } from './computer-use/types';
import { loadConfig, findConfigFile, AppConfig } from './config';
import type { AgentPaths } from './paths';
import { logsDir as globalLogsDir } from './paths';
import { createLLMRouter } from './llm/factory';
import { LLMRouter } from './llm/router';
import type { MemoryProvider } from './memory';
import { createMCPManager, MCPManager } from './mcp';
import type { OCRProvider } from './ocr';
import { ToolRegistry } from './tools/registry';
import { ToolStateManager } from './tools/state';
import { setToolLimits } from './tools/tool-limits';
import { readFile } from './tools/internal/read_file';
import { searchInFiles } from './tools/internal/search_in_files';
import { shell } from './tools/internal/shell';
import { findFiles } from './tools/internal/find_files';
import { applyDiff } from './tools/internal/apply_diff';
import { writeFile } from './tools/internal/write_file';
import { listFiles } from './tools/internal/list_files';
import { deleteFile } from './tools/internal/delete_file';
import { createDirectory } from './tools/internal/create_directory';
import { insertCode } from './tools/internal/insert_code';
import { deleteCode } from './tools/internal/delete_code';
import { SubAgentTypeRegistry, buildSubAgentGuidance, createSubAgentTool } from './tools/internal/sub-agent';
import { ModeRegistry, DEFAULT_MODE, DEFAULT_MODE_NAME } from './modes';
import { PromptAssembler } from './prompt/assembler';
import { createHistorySearchTool } from './tools/internal/history_search';
import { createManageSkillsTool } from './tools/internal/manage_skills';
import { DEFAULT_SYSTEM_PROMPT } from './prompt/templates/default';
import { Backend } from './core/backend';
import type { StorageProvider } from './storage/base';
import { PluginManager } from './plugins';
import { createBootstrapExtensionRegistry, type BootstrapExtensionRegistry } from './bootstrap/extensions';
import type { PlatformRegistry } from './platforms/registry';
import { PluginEventBus } from './plugins/event-bus';
import { patchMethod, patchPrototype } from './plugins/patch';
import type { IrisAPI } from './plugins/types';

export interface BootstrapResult {
  backend: Backend;
  config: AppConfig;
  configDir: string;
  router: LLMRouter;
  tools: ToolRegistry;
  mcpManager: MCPManager | undefined;
  /** 更新 mcpManager 引用（供 Web 平台热重载使用） */
  setMCPManager: (manager?: MCPManager) => void;
  getMCPManager: () => MCPManager | undefined;
  /** Agent 名称（多 Agent 模式下标识；单 Agent 模式为 undefined） */
  agentName?: string;
  /** Computer Use 环境实例（screen 模式下提供窗口管理能力） */
  computerEnv?: Computer;
  /** 初始化过程中的警告信息（TUI 启动后展示给用户） */
  initWarnings: string[];
  /** 插件管理器（未配置插件时为 undefined） */
  pluginManager: PluginManager | undefined;
  /** Bootstrap 扩展注册表（供运行时热重载与平台创建复用） */
  extensions: BootstrapExtensionRegistry;
  /** 平台注册表（内置 + 插件注册） */
  platformRegistry: PlatformRegistry;
  /** 插件间共享事件总线 */
  eventBus: PluginEventBus;
  /** 绑定 Web 路由注册到 IrisAPI（在 WebPlatform 创建后调用） */
  bindWebRouteRegistration: (register: (method: string, path: string, handler: any) => void) => void;
}

/** Bootstrap 选项（多 Agent 模式传入） */
export interface BootstrapOptions {
  /** Agent 名称（用于日志标识和 TUI 显示） */
  agentName?: string;
  /** Agent 专属路径集（不提供则使用全局默认路径） */
  agentPaths?: AgentPaths;
}

export async function bootstrap(options?: BootstrapOptions): Promise<BootstrapResult> {
  const agentPaths = options?.agentPaths;
  const agentLabel = options?.agentName;

  const configDir = findConfigFile(agentPaths?.configDir);
  const config = loadConfig(agentPaths?.configDir, agentPaths);
  const extensions = createBootstrapExtensionRegistry();

  // ---- 0. 预加载插件 + PreBootstrap 阶段 ----
  let pluginManager: PluginManager | undefined;
  if (config.plugins?.length) {
    pluginManager = new PluginManager();
    await pluginManager.prepareAll(config.plugins, config);
    await pluginManager.runPreBootstrap(config, extensions);
  }

  // ---- 1. 创建 LLM 路由器 ----
  const router = createLLMRouter(config.llm, undefined, extensions.llmProviders);

  // ---- 1.5 配置请求日志（每个 Provider 实例独立，避免多 Agent 间互相覆盖） ----
  if (config.system.logRequests) {
    const effectiveLogsDir = agentPaths?.logsDir || globalLogsDir;
    for (const model of router.listModels()) {
      router.resolve(model.modelName).setLogging(effectiveLogsDir);
    }
  }

  // ---- 2. 创建存储 ----
  const storageFactory = extensions.storageProviders.get(config.storage.type);
  if (!storageFactory) {
    throw new Error(`未注册的存储类型: ${config.storage.type}`);
  }
  const storage = await storageFactory(config.storage) as StorageProvider;

  // ---- 2.5 创建记忆模块 ----
  let memory: MemoryProvider | undefined;
  if (config.memory?.enabled) {
    const memoryType = config.memory.type ?? 'sqlite';
    const memoryFactory = extensions.memoryProviders.get(memoryType);
    if (!memoryFactory) {
      throw new Error(`未注册的记忆类型: ${memoryType}`);
    }
    memory = await memoryFactory(config.memory) as MemoryProvider;
  }

  // ---- 2.6 创建 OCR 服务 ----
  let ocrService: OCRProvider | undefined;
  if (config.ocr) {
    const ocrFactory = extensions.ocrProviders.get(config.ocr.provider);
    if (!ocrFactory) {
      throw new Error(`未注册的 OCR provider: ${config.ocr.provider}`);
    }
    ocrService = await ocrFactory(config.ocr) as OCRProvider;
  }

  // ---- 3. 注册工具 ----
  const tools = new ToolRegistry();
  setToolLimits(config.tools.limits);
  tools.registerAll([readFile, writeFile, applyDiff, searchInFiles, findFiles, shell, listFiles, deleteFile, createDirectory, insertCode, deleteCode]);
  if (memory) {
    const { createMemoryTools } = await import('./memory');
    tools.registerAll(createMemoryTools(memory));
  }

  // ---- 3.1 连接 MCP 服务器 ----
  let mcpManager: MCPManager | undefined;
  if (config.mcp) {
    mcpManager = createMCPManager(config.mcp);
    await mcpManager.connectAll();
    tools.registerAll(mcpManager.getTools());
  }

  // ---- 3.2 注册 Computer Use 工具 ----
  let computerEnv: Computer | undefined;
  const initWarnings: string[] = [];
  if (config.computerUse?.enabled) {
    try {
      const { BrowserEnvironment, ScreenEnvironment, createComputerUseTools, resolveEnvironmentKey } = await import('./computer-use');
      const env = config.computerUse.environment ?? 'browser';
      let cuEnv: import('./computer-use').Computer;
      const envKey = resolveEnvironmentKey(env, config.computerUse.backgroundMode);

      if (env === 'screen') {
        cuEnv = new ScreenEnvironment({
          searchEngineUrl: config.computerUse.searchEngineUrl,
          targetWindow: config.computerUse.targetWindow,
          backgroundMode: config.computerUse.backgroundMode,
        });
      } else {
        cuEnv = new BrowserEnvironment({
          screenWidth: config.computerUse.screenWidth ?? 1440,
          screenHeight: config.computerUse.screenHeight ?? 900,
          headless: config.computerUse.headless,
          initialUrl: config.computerUse.initialUrl,
          searchEngineUrl: config.computerUse.searchEngineUrl,
          highlightMouse: config.computerUse.highlightMouse,
        });
      }

      await cuEnv.initialize();

      // 收集初始化警告（如窗口绑定失败）
      if ('initWarnings' in cuEnv && Array.isArray((cuEnv as { initWarnings?: string[] }).initWarnings)) {
        initWarnings.push(...(((cuEnv as { initWarnings?: string[] }).initWarnings) ?? []));
      }

      // 用户配置的工具策略（按环境键名取对应分组）
      const userPolicy = config.computerUse.environmentTools?.[envKey as keyof typeof config.computerUse.environmentTools];
      tools.registerAll(createComputerUseTools(cuEnv, envKey, userPolicy));

      computerEnv = cuEnv;
    } catch (err) {
      console.error('[Iris] Computer Use 初始化失败:');
      console.error(err);
      console.error('[Iris] 已跳过 Computer Use，其余功能正常启动。');
    }
  }

  // ---- 3.5 注册子代理工具 ----
  const subAgentTypes = new SubAgentTypeRegistry();
  const MEMORY_TOOLS = new Set(['memory_search', 'memory_add', 'memory_delete']);

  if (config.subAgents?.types) {
    for (const t of config.subAgents.types) {
      if (!memory && t.allowedTools?.every(name => MEMORY_TOOLS.has(name))) continue;
      subAgentTypes.register({ ...t });
    }
  }

  // ---- 3.6 注册用户自定义模式 ----
  const modeRegistry = new ModeRegistry();
  modeRegistry.register(DEFAULT_MODE);
  if (config.modes) {
    modeRegistry.registerAll(config.modes);
  }
  const defaultMode = config.system.defaultMode ?? DEFAULT_MODE_NAME;

  // ---- 3.7 创建工具状态管理器 ----
  const toolState = new ToolStateManager();

  // ---- 3.8 配置提示词（提前创建，供插件操作 systemParts） ----
  const prompt = new PromptAssembler();
  prompt.setSystemPrompt(config.system.systemPrompt || DEFAULT_SYSTEM_PROMPT);

  // ---- 3.9 激活插件（插件可通过 ctx 访问 tools/modes/prompt/router） ----
  if (pluginManager) {
    await pluginManager.activateAll(
      { tools, modes: modeRegistry, prompt, router },
      config,
    );
  }

  // ---- 5. 创建 Backend ----
  const hasSubAgents = subAgentTypes.getAll().length > 0;
  const subAgentGuidance = hasSubAgents ? buildSubAgentGuidance(subAgentTypes, !!memory) : '';
  const autoRecall = !(memory && hasSubAgents);

  const backend = new Backend(router, storage, tools, toolState, prompt, {
    maxToolRounds: config.system.maxToolRounds,
    stream: config.system.stream,
    retryOnError: config.system.retryOnError,
    maxRetries: config.system.maxRetries,
    toolsConfig: config.tools,
    autoRecall,
    subAgentGuidance,
    defaultMode,
    currentLLMConfig: router.getCurrentConfig(),
    ocrService,
    maxRecentScreenshots: config.computerUse?.maxRecentScreenshots,
    summaryModelName: config.llm.summaryModelName,
    summaryConfig: config.summary,
    skills: config.system.skills,
    skillPreamble: config.system.skillPreamble,
  }, memory, modeRegistry);

  // 注册子代理工具（需要 backend 引用；无类型定义时跳过）
  if (hasSubAgents) {
    tools.register(createSubAgentTool({
      getRouter: () => backend.getRouter(),
      getToolPolicies: () => backend.getToolPolicies(),
      tools,
      subAgentTypes,
      maxDepth: config.system.maxAgentDepth,
    }));
  }

  // 注册历史搜索工具（需要 backend 引用以获取 storage 和 sessionId）
  tools.register(createHistorySearchTool({
    getStorage: () => backend.getStorage(),
    getSessionId: () => backend.getActiveSessionId(),
  }));

  // 注册 Skill 管理工具（toggle_skills 风格，仅在配置了 Skill 时注册）
  // 工具声明中包含每个 Skill 的 name 和 description，LLM 从声明即可了解所有可用 Skill。
  // Skill 列表或启用状态变化时，通过回调重新注册工具以更新声明中的参数。
  if (config.system.skills?.length) {
    const rebuildSkillsTool = () => {
      const skillsList = backend.listSkills();
      if (skillsList.length > 0) {
        // 有 Skill 时注册/更新 toggle_skills 工具
        tools.register(createManageSkillsTool({
          getBackend: () => backend,
        }));
      } else {
        // 无 Skill 时注销工具，避免空参数列表混淆 LLM
        tools.unregister('toggle_skills');
      }
    };

    // 初始注册
    rebuildSkillsTool();

    // 注册回调：Skill 列表或启用状态变化时自动重建工具声明
    backend.setOnSkillsChanged(rebuildSkillsTool);
  }

  // 将插件钩子注入 Backend
  const eventBus = new PluginEventBus();

  // 用一个可变引用存放 registerWebRoute，以便在 WebPlatform 创建后绑定到 IrisAPI
  const irisApiRef: Partial<IrisAPI> = {};
  const bindWebRouteRegistration = (register: (method: string, path: string, handler: any) => void) => {
    irisApiRef.registerWebRoute = register;
  };

  if (pluginManager && pluginManager.size > 0) {
    backend.setPluginHooks(pluginManager.getHooks());

    // 通知插件系统初始化完成，传递完整内部 API
    const irisAPI: IrisAPI = {
      backend,
      router,
      storage,
      memory,
      tools,
      modes: modeRegistry,
      prompt,
      config,
      mcpManager,
      computerEnv,
      ocrService,
      extensions,
      pluginManager,
      eventBus,
      patchMethod,
      patchPrototype,
      get registerWebRoute() { return irisApiRef.registerWebRoute; },
    };
    await pluginManager.notifyReady(irisAPI);
  }

  return {
    backend,
    config,
    configDir,
    router,
    tools,
    mcpManager,
    setMCPManager: (manager?: MCPManager) => { mcpManager = manager; },
    getMCPManager: () => mcpManager,
    agentName: agentLabel,
    computerEnv,
    initWarnings,
    pluginManager,
    extensions,
    platformRegistry: extensions.platforms,
    eventBus,
    bindWebRouteRegistration,
  };
}
