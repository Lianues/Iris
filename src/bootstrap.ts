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
import type { IrisAPI, InlinePluginEntry, WebPanelDefinition } from '@irises/extension-sdk';
import { readEditableConfig, updateEditableConfig } from './config/manage';
import { applyRuntimeConfigReload, type RuntimeConfigReloadContext } from './config/runtime';
import { DEFAULTS, parseLLMConfig } from './config/llm';
import { parseSystemConfig } from './config/system';
import { parseToolsConfig } from './config/tools';
import { setGlobalLogLevel, getGlobalLogLevel, LogLevel } from './logger';
import { isCompiledBinary } from './paths';

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
}

export async function bootstrap(options?: BootstrapOptions): Promise<BootstrapResult> {
  const agentPaths = options?.agentPaths;
  const agentLabel = options?.agentName;

  const configDir = findConfigFile(agentPaths?.configDir);
  const config = loadConfig(agentPaths?.configDir, agentPaths);
  const extensions = createBootstrapExtensionRegistry();
  registerExtensionPlatforms(extensions.platforms);

  // ---- 0. 预加载插件 + PreBootstrap 阶段 ----
  const inlinePlugins = options?.inlinePlugins ?? [];
  let pluginManager: PluginManager | undefined;
  if (config.plugins?.length || inlinePlugins.length > 0) {
    pluginManager = new PluginManager();
    pluginManager.setConfigDir(configDir);
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

  const initWarnings: string[] = [];

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
    summaryModelName: config.llm.summaryModelName,
    summaryConfig: config.summary,
    skills: config.system.skills,
    configDir,
    rememberPlatformModel: config.llm.rememberPlatformModel,
  }, memory, modeRegistry);

  // 注册子代理工具（需要 backend 引用；无类型定义时跳过）
  if (hasSubAgents) {
    tools.register(createSubAgentTool({
      getRouter: () => backend.getRouter(),
      getToolPolicies: () => backend.getToolPolicies(),
      retryOnError: config.system.retryOnError,
      maxRetries: config.system.maxRetries,
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


  // 构建完整内部 API（供插件和平台扩展使用）
  const getMCPManagerFn = () => mcpManager;
  const setMCPManagerFn = (m?: MCPManager) => { mcpManager = m; };
  const irisAPI = {
    backend,
    router,
    storage,
    memory,
    tools,
    modes: modeRegistry,
    prompt,
    config,
    mcpManager,
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
      getStatus: () => { const { getAgentStatus } = require('./agents'); return getAgentStatus(); },
      setEnabled: (enabled: boolean) => { const { setAgentEnabled } = require('./agents'); return setAgentEnabled(enabled); },
      createManifest: () => { const { createManifestIfNotExists } = require('./agents'); return createManifestIfNotExists(); },
      create: (name: string, description?: string) => { const { createAgent } = require('./agents'); return createAgent(name, description); },
      update: (name: string, fields: any) => { const { updateAgent } = require('./agents'); return updateAgent(name, fields); },
      delete: (name: string) => { const { deleteAgent } = require('./agents'); return deleteAgent(name); },
      resetCache: () => { const { resetCache } = require('./agents'); resetCache(); },
    },
    toolPreviewUtils: (() => {
      // 懒加载工具预览工具集
      let _utils: any;
      const getUtils = () => {
        if (_utils) return _utils;
        const { parseUnifiedDiff } = require('./tools/internal/apply_diff/unified_diff');
        const { buildSearchRegex, decodeText, globToRegExp, isLikelyBinary, toPosix, walkFiles } = require('./tools/internal/search_in_files');
        const { normalizeWriteArgs } = require('./tools/internal/write_file');
        const { normalizeInsertArgs } = require('./tools/internal/insert_code');
        const { normalizeDeleteCodeArgs } = require('./tools/internal/delete_code');
        const { resolveProjectPath } = require('./tools/utils');
        _utils = { parseUnifiedDiff, normalizeWriteArgs, normalizeInsertArgs, normalizeDeleteCodeArgs, resolveProjectPath, buildSearchRegex, decodeText, globToRegExp, isLikelyBinary, toPosix, walkFiles };
        return _utils;
      };
      return new Proxy({} as any, { get: (_t, p) => (getUtils() as any)[p] });
    })(),
    setLogLevel: (level: number) => setGlobalLogLevel(level as LogLevel),
    getLogLevel: () => getGlobalLogLevel() as number,
    pluginManager: pluginManager!,
    eventBus,
    patchMethod,
    patchPrototype,
    registerWebRoute: registerDeferredWebRoute,
    registerWebPanel,
  } satisfies Record<string, unknown> as unknown as IrisAPI;

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
    mcpManager,
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
