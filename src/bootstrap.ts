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

import { loadConfig, findConfigFile, AppConfig } from './config';
import type { AgentPaths } from './paths';
import { dataDir as globalDataDir, logsDir as globalLogsDir } from './paths';
import { createLLMRouter } from './llm/factory';
import { LLMRouter } from './llm/router';
import { createSkillWatcher } from './config/skill-loader';
import { createMCPManager, MCPManager } from './mcp';
import type { OCRProvider } from './ocr';
import { ToolRegistry } from './tools/registry';
import { ToolStateManager } from './tools/state';
import { setToolLimits } from './tools/tool-limits';
import { readFile } from './tools/internal/read_file';
import { searchInFiles } from './tools/internal/search_in_files';
import { createShellTool } from './tools/internal/shell';
import { createBashTool } from './tools/internal/bash';
import { findFiles } from './tools/internal/find_files';
import { applyDiff } from './tools/internal/apply_diff';
import { writeFile } from './tools/internal/write_file';
import { listFiles } from './tools/internal/list_files';
import { deleteFile } from './tools/internal/delete_file';
import { createDirectory } from './tools/internal/create_directory';
import { insertCode } from './tools/internal/insert_code';
import { deleteCode } from './tools/internal/delete_code';
import { SubAgentTypeRegistry, createSubAgentTool } from './tools/internal/sub-agent';
import { ModeRegistry, DEFAULT_MODE, DEFAULT_MODE_NAME } from './modes';
import { PromptAssembler } from './prompt/assembler';
import { CrossAgentTaskBoard } from './core/cross-agent-task-board';
import { ToolLoop } from './core/tool-loop';
import { createHistorySearchTool } from './tools/internal/history_search';
import { createReadSkillTool } from './tools/internal/read_skill';
import { DEFAULT_SYSTEM_PROMPT } from './prompt/templates/default';
import { Backend } from './core/backend';
import type { StorageProvider } from './storage/base';
import { PluginManager } from './extension';
import { createBootstrapExtensionRegistry, type BootstrapExtensionRegistry } from './bootstrap/extensions';
import type { PlatformRegistry } from './core/platform-registry';
import { PluginEventBus } from './extension/event-bus';
import { patchMethod, patchPrototype } from './extension/patch';
import { registerExtensionPlatforms } from './extension';
import type { IrisAPI, InlinePluginEntry, WebPanelDefinition, ConsoleSettingsTabDefinition } from '@irises/extension-sdk';
import { readEditableConfig, updateEditableConfig } from './config/manage';
import { applyRuntimeConfigReload, type RuntimeConfigReloadContext } from './config/runtime';
import { DEFAULTS, parseLLMConfig } from './config/llm';
import { parseSystemConfig } from './config/system';
import { parseToolsConfig } from './config/tools';
import { setGlobalLogLevel, getGlobalLogLevel, LogLevel } from './logger';
import { isCompiledBinary } from './paths';
import { resizeImage, formatDimensionNote } from './media/image-resize';
import { extractDocument, isSupportedDocumentMime } from './media/document-extract';
import { convertToPDF, isConversionAvailable } from './media/office-to-pdf';
import {
  getAgentStatus, setAgentEnabled, createManifestIfNotExists,
  createAgent, updateAgent, deleteAgent, resetCache as resetAgentCache, loadAgentDefinitions,
} from './agents';
import { parseUnifiedDiff } from './tools/internal/apply_diff/unified_diff';
import { buildSearchRegex, decodeText, globToRegExp, isLikelyBinary, toPosix, walkFiles } from './tools/internal/search_in_files';
import { normalizeWriteArgs } from './tools/internal/write_file';
import { normalizeInsertArgs } from './tools/internal/insert_code';
import { normalizeDeleteCodeArgs } from './tools/internal/delete_code';
import { resolveProjectPath } from './tools/utils';
import { supportsVision as checkVision, supportsNativePDF as checkNativePDF, supportsNativeOffice as checkNativeOffice, isDocumentMimeType as checkDocMime } from './llm/vision';
import { setExtensionLogLevel } from '@irises/extension-sdk';

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
  /** 完整 IrisAPI（供平台 factory context 注入） */
  irisAPI?: Record<string, unknown>;
}

/** Bootstrap 选项（多 Agent 模式传入） */
export interface BootstrapOptions {
  /** Agent 名称（用于日志标识和 TUI 显示） */
  agentName?: string;
  /** Agent 专属路径集（不提供则使用全局默认路径） */
  agentPaths?: AgentPaths;
  /** 运行时直接注入的内联插件 */
  inlinePlugins?: InlinePluginEntry[];
  /** 外部注入的全局任务板（多 Agent 模式下由 runMultiAgent 创建并共享） */
  taskBoard?: CrossAgentTaskBoard;
}

export async function bootstrap(options?: BootstrapOptions): Promise<BootstrapResult> {
  const agentPaths = options?.agentPaths;
  const agentLabel = options?.agentName;

  const configDir = findConfigFile(agentPaths?.configDir);
  const config = loadConfig(agentPaths?.configDir, agentPaths);
  const extensions = createBootstrapExtensionRegistry();
  registerExtensionPlatforms(extensions.platforms, undefined, config.system.devSourceExtensions);

  if (config.system.devSourceExtensions?.length) {
    console.log(`[Iris] DevSource 模式已启用，以下扩展将从源码加载: ${config.system.devSourceExtensions.join(', ')}`);
  }

  // ---- 0. 预加载插件 + PreBootstrap 阶段 ----
  const inlinePlugins = options?.inlinePlugins ?? [];
  let pluginManager: PluginManager | undefined;
  if (config.plugins?.length || inlinePlugins.length > 0) {
    pluginManager = new PluginManager();
    pluginManager.setConfigDir(configDir);
    pluginManager.setDevSourceExtensions(config.system.devSourceExtensions);
    await pluginManager.prepareAll(config.plugins ?? [], config, inlinePlugins);
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

  // 命令执行工具：根据平台选择 shell (Windows PowerShell) 或 bash (Linux/macOS)
  const isWindows = process.platform === 'win32';
  const commandToolName = isWindows ? 'shell' : 'bash';
  const shellClassifierConfig = (config.tools.permissions[commandToolName] as any)?.classifier
    ?? { enabled: true };   // 默认启用 AI 安全分类器
  const commandToolDeps = {
    getRouter: () => router,
    classifierConfig: shellClassifierConfig,
    // 动态学习（autoLearn）所需的额外依赖：
    // 学习 sub-agent 需要 ToolRegistry（获取命令工具）和 ToolPolicies（自动批准 --help）
    tools,
    getToolPolicies: () => config.tools.permissions,
    retryOnError: config.system.retryOnError,
  };
  const commandTool = isWindows
    ? createShellTool(commandToolDeps)
    : createBashTool(commandToolDeps);
  tools.registerAll([readFile, writeFile, applyDiff, searchInFiles, findFiles, commandTool, listFiles, deleteFile, createDirectory, insertCode, deleteCode]);

  // ---- 3.1 连接 MCP 服务器 ----
  let mcpManager: MCPManager | undefined;
  if (config.mcp) {
    mcpManager = createMCPManager(config.mcp);
    await mcpManager.connectAll();
    tools.registerAll(mcpManager.getTools());
  }

  const initWarnings: string[] = [];

  // ---- 3.5 注册子代理工具 ----
  const subAgentTypes = new SubAgentTypeRegistry();

  // 注册子代理类型（来自 sub_agents.yaml）。
  // 默认配置（general-purpose / explore）在 data/configs.example/sub_agents.yaml 中定义，
  // 首次运行时自动拷贝到用户目录，无需代码硬编码 fallback。
  // 用户可直接编辑 sub_agents.yaml 修改/新增/禁用子代理类型。
  if (config.subAgents?.enabled !== false && config.subAgents?.types) {
    const globalStream = config.subAgents.stream;
    for (const t of config.subAgents.types) {
      if (t.enabled === false) continue;
      // 全局 stream 有值时覆盖类型独立设置
      const effectiveStream = globalStream ?? t.stream;
      subAgentTypes.register({ ...t, stream: effectiveStream });
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
  // 判断异步子代理是否启用（需要配置开启 + 存在子代理类型定义）
  const asyncSubAgentsEnabled = config.system.asyncSubAgents === true && hasSubAgents;

  // 使用外部注入的 taskBoard 或创建本地实例（单 Agent 模式兜底）
  const taskBoard = options?.taskBoard ?? new CrossAgentTaskBoard();
  const backend = new Backend(router, storage, tools, toolState, prompt, {
    maxToolRounds: config.system.maxToolRounds,
    stream: config.system.stream,
    retryOnError: config.system.retryOnError,
    maxRetries: config.system.maxRetries,
    toolsConfig: config.tools,
    defaultMode,
    currentLLMConfig: router.getCurrentConfig(),
    ocrService,
    summaryModelName: config.llm.summaryModelName,
    summaryConfig: config.summary,
    skills: config.system.skills,
    configDir,
    rememberPlatformModel: config.llm.rememberPlatformModel,
    asyncSubAgents: asyncSubAgentsEnabled,
  }, modeRegistry);

  // 将任务板注入 Backend，使 board 生命周期事件转发为 BackendEvents
  backend.setTaskBoard(taskBoard);

  // [cron 重构] 单 Agent 模式下也需要注册 backend 到 taskBoard，
  // 否则 cron 任务 complete() 时 pushNotification() 找不到 backend 会静默失败。
  // 多 Agent 模式下此步骤由 runMultiAgent() 中的循环统一完成（会覆盖这里的注册）。
  taskBoard.registerBackend(options?.agentName ?? '__global__', backend);

  // 注册子代理工具（需要 backend 引用；无类型定义时跳过）
  if (hasSubAgents) {
    tools.register(createSubAgentTool({
      getRouter: () => backend.getRouter(),
      // [权限修复] 将完整 toolsConfig 传给 sub_agent。
      // 目的：让子代理继承父级的全局审批开关（如 autoApproveAll / autoApproveDiff），
      // 避免“前台已授权、子代理里却重新被拦截”的配置割裂。
      getToolsConfig: () => backend.getToolsConfig(),
      retryOnError: config.system.retryOnError,
      maxRetries: config.system.maxRetries,
      tools,
      subAgentTypes,
      maxDepth: config.system.maxAgentDepth,
      // ---- 异步子代理依赖注入（仅在 asyncSubAgents 启用时提供 taskBoard） ----
      // 不提供时子代理只能同步运行（向后兼容）。
      ...(asyncSubAgentsEnabled ? {
        getSessionId: () => backend.getActiveSessionId(),
        taskBoard,
        agentName: options?.agentName ?? '__global__',
      } : {}),
    }));
  }

  // 注册历史搜索工具（需要 backend 引用以获取 storage 和 sessionId）
  tools.register(createHistorySearchTool({
    getStorage: () => backend.getStorage(),
    getSessionId: () => backend.getActiveSessionId(),
  }));

  // 注册 Skill 读取工具。
  // 说明：即使启动时没有 Skill，也保留回调，便于运行时热重载新增 Skill 后自动出现 read_skill 工具。
  const rebuildSkillsTool = () => {
    const skillsList = backend.listSkills();
    tools.unregister('read_skill');
    if (skillsList.length > 0) {
      tools.register(createReadSkillTool({
        getBackend: () => backend,
      }));
    }
  };

  // 初始注册
  rebuildSkillsTool();

  // 注册回调：Skill 列表变化时自动重建 read_skill 工具声明
  backend.setOnSkillsChanged(rebuildSkillsTool);

  // 启动 Skill 目录文件系统监听：
  // 检测到 SKILL.md 变化时自动重新扫描并更新 Skill 列表，
  // 使 AI 创建或修改 Skill 后无需重启即可生效。
  const effectiveDataDir = agentPaths?.dataDir || globalDataDir;
  const inlineSkills = config.system.skills?.filter(s => s.path.startsWith('inline:'));
  const stopSkillWatcher = createSkillWatcher(effectiveDataDir, () => {
    backend.reloadSkillsFromFilesystem(effectiveDataDir, inlineSkills);
  });
  void stopSkillWatcher;

  // 将插件钩子注入 Backend
  const eventBus = new PluginEventBus();

  // 记录插件注册的 Web 路由；若 WebPlatform 尚未创建，先缓存，绑定后统一补注册。
  const webRouteRegistrations: Array<{ method: string; path: string; handler: (req: any, res: any, params: Record<string, string>) => Promise<void> }> = [];
  let webRouteRegistrar: ((method: string, path: string, handler: any) => void) | undefined;
  const registerDeferredWebRoute = (method: string, path: string, handler: (req: any, res: any, params: Record<string, string>) => Promise<void>) => {
    const record = { method: method.toUpperCase(), path, handler };
    webRouteRegistrations.push(record);
    webRouteRegistrar?.(record.method, record.path, record.handler);
  };
  const bindWebRouteRegistration = (register: (method: string, path: string, handler: any) => void) => {
    webRouteRegistrar = register;
    for (const route of webRouteRegistrations) register(route.method, route.path, route.handler);
  };

  // 扩展面板注册表：插件通过 registerWebPanel 注册前端面板，宿主通过 /api/web-panels 暴露给 Web UI。
  const webPanels: WebPanelDefinition[] = [];
  const registerWebPanel = (panel: WebPanelDefinition) => {
    if (!webPanels.some(p => p.id === panel.id)) webPanels.push(panel);
  };
  registerDeferredWebRoute('GET', '/api/web-panels', async (_req: any, res: any) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(webPanels));
  });

  // Console Settings Tab 注册表：
  // 插件通过 registerConsoleSettingsTab 注册声明式表单 schema，
  // Console 平台在 start() 时通过 getConsoleSettingsTabs() 读取并渲染。
  const consoleSettingsTabs: ConsoleSettingsTabDefinition[] = [];
  const registerConsoleSettingsTab = (tab: ConsoleSettingsTabDefinition) => {
    if (!consoleSettingsTabs.some(t => t.id === tab.id)) consoleSettingsTabs.push(tab);
  };


  // 构建完整内部 API（供插件和平台扩展使用）
  const getMCPManagerFn = () => mcpManager;
  const setMCPManagerFn = (m?: MCPManager) => { mcpManager = m; };
  const irisAPI = {
    backend,
    media: { resizeImage, formatDimensionNote, extractDocument, isSupportedDocumentMime, convertToPDF, isConversionAvailable },
    router,
    storage,
    tools,
    modes: modeRegistry,
    prompt,
    config,
    get mcpManager() { return mcpManager; },
    ocrService,
    extensions,
    configManager: {
      getConfigDir: () => configDir,
      readEditableConfig: () => readEditableConfig(configDir),
      updateEditableConfig: (updates: Record<string, unknown>) => updateEditableConfig(configDir, updates),
      applyRuntimeConfigReload: async (mergedConfig: Record<string, unknown>) => {
        try {
          const ctx: RuntimeConfigReloadContext = {
            backend, getMCPManager: getMCPManagerFn, setMCPManager: setMCPManagerFn, extensions,
          };
          await applyRuntimeConfigReload(ctx, mergedConfig);
          return { success: true };
        } catch (e) {
          return { success: false, error: e instanceof Error ? e.message : String(e) };
        }
      },
      getLLMDefaults: () => DEFAULTS as Record<string, Record<string, unknown>>,
      parseLLMConfig: (raw?: Record<string, unknown>) => parseLLMConfig(raw as any) as unknown as Record<string, unknown>,
      parseSystemConfig: (raw?: Record<string, unknown>) => parseSystemConfig(raw as any) as unknown as Record<string, unknown>,
      parseToolsConfig: (raw?: Record<string, unknown>) => parseToolsConfig(raw as any) as unknown as Record<string, unknown>,
    },
    isCompiledBinary,
    projectRoot: (await import('./paths')).projectRoot,
    dataDir: agentPaths?.dataDir || globalDataDir,
    fetchAvailableModels: async (input: { provider: string; apiKey: string; baseUrl?: string }) => {
      const { listAvailableModels } = await import('./llm/model-catalog');
      return await listAvailableModels(input as any);
    },
    agentManager: {
      getStatus: () => getAgentStatus(),
      setEnabled: (enabled: boolean) => setAgentEnabled(enabled),
      createManifest: () => createManifestIfNotExists(),
      create: (name: string, description?: string) => createAgent(name, description),
      update: (name: string, fields: any) => updateAgent(name, fields),
      delete: (name: string) => deleteAgent(name),
      resetCache: () => resetAgentCache(),
      getActiveSessionId: () => backend.getActiveSessionId(),
      getLastSessionTokens: (sessionId: string) => (backend as any).lastSessionTokens?.get(sessionId),
      getAllSessionTokens: () => {
        const map: Map<string, number> = (backend as any).lastSessionTokens;
        if (!map) return {};
        const result: Record<string, number> = {};
        for (const [k, v] of map) result[k] = v;
        return result;
      },
    },
    toolPreviewUtils: { parseUnifiedDiff, normalizeWriteArgs, normalizeInsertArgs, normalizeDeleteCodeArgs, resolveProjectPath, buildSearchRegex, decodeText, globToRegExp, isLikelyBinary, toPosix, walkFiles },
    setLogLevel: (level: number) => {
      setGlobalLogLevel(level as LogLevel);
      setExtensionLogLevel(level);
    },
    getLogLevel: () => getGlobalLogLevel() as number,
    pluginManager: pluginManager!,
    eventBus,
    // 暴露 taskBoard 供插件（如 cron）在后台执行任务时复用任务板
    taskBoard,
    // [cron 重构] 暴露 agentName 供插件在注册任务时标识 sourceAgent / targetAgent
    agentName: options?.agentName ?? '__global__',
    patchMethod,
    patchPrototype,
    // 暴露 ToolLoop 工厂方法，供插件（如 cron）创建后台工具循环。
    // 避免插件直接 import 核心模块，通过 IrisAPI 间接访问。
    createToolLoop: (options: { tools: any; systemPrompt: string; maxRounds?: number }) => {
      // 创建独立的 PromptAssembler 实例（不影响前台会话的系统提示词）
      const loopPrompt = new PromptAssembler();
      loopPrompt.setSystemPrompt(options.systemPrompt);

      // 构建 ToolLoop 配置
      const loopConfig = {
        maxRounds: options.maxRounds ?? 15,
        toolsConfig: config.tools ?? {},
        retryOnError: true,
        maxRetries: 2,
      };

      // 创建 ToolLoop 实例：
      // - tools: 调用方传入的工具注册表（可以是过滤后的子集）
      // - prompt: 独立的 PromptAssembler（定时任务专用系统提示词）
      // - config: ToolLoop 配置（maxRounds、重试策略等）
      // - toolState: 不传入（后台任务不需要 toolState 追踪 UI 状态）
      return new ToolLoop(options.tools as ToolRegistry, loopPrompt, loopConfig);
    },
    registerWebRoute: registerDeferredWebRoute,
    registerWebPanel,
    registerConsoleSettingsTab,
    getConsoleSettingsTabs: () => consoleSettingsTabs,
    listAgents: () => loadAgentDefinitions(),
    supportsVision: (modelName?: string) => {
      const cfg = modelName ? router.getModelConfig(modelName) : router.getCurrentConfig();
      return checkVision(cfg);
    },
    supportsNativePDF: (modelName?: string) => {
      const cfg = modelName ? router.getModelConfig(modelName) : router.getCurrentConfig();
      return checkNativePDF(cfg);
    },
    supportsNativeOffice: (modelName?: string) => {
      const cfg = modelName ? router.getModelConfig(modelName) : router.getCurrentConfig();
      return checkNativeOffice(cfg);
    },
    isDocumentMimeType: (mimeType: string) => {
      return checkDocMime(mimeType);
    },
  } satisfies Record<string, unknown> as unknown as IrisAPI;

  // 同步初始日志级别到 SDK logger
  setExtensionLogLevel(getGlobalLogLevel());

  if (pluginManager && pluginManager.size > 0) {
    backend.setPluginHooks(pluginManager.getHooks());
    await pluginManager.notifyReady(irisAPI);
  }

  return {
    backend,
    config,
    configDir,
    router,
    tools,
    get mcpManager() { return mcpManager; },
    setMCPManager: (manager?: MCPManager) => { mcpManager = manager; },
    getMCPManager: () => mcpManager,
    agentName: agentLabel,
    initWarnings,
    pluginManager,
    extensions,
    platformRegistry: extensions.platforms,
    eventBus,
    bindWebRouteRegistration,
    irisAPI: irisAPI as unknown as Record<string, unknown>,
  };
}
