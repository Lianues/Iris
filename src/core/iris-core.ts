/**
 * IrisCore — 单个 Agent 的完整运行时
 *
 * 持有 Backend 及其所有依赖资源（LLM 路由、存储、MCP、插件、工具等），
 * 提供 start() / shutdown() 生命周期管理。
 *
 * 原 bootstrap() 函数的逻辑搬入 start()，原 BootstrapResult 的字段
 * 变成类的公开属性。新增幂等 shutdown() 统一关闭所有资源。
 *
 * 使用方式：
 *   - index.ts（平台模式）：由 IrisHost 创建和管理
 *   - cli.ts（CLI 模式）：直接 new IrisCore() → start() → 使用 → shutdown()
 */

import { loadConfig, findConfigFile, AppConfig } from '../config';
import type { AgentPaths } from '../paths';
import { dataDir as globalDataDir, logsDir as globalLogsDir } from '../paths';
import { createLLMRouter } from '../llm/factory';
import { LLMRouter } from '../llm/router';
import { createSkillWatcher } from '../config/skill-loader';
import { createMCPManager, MCPManager } from '../mcp';
import type { OCRProvider } from '../ocr';
import { ToolRegistry } from '../tools/registry';
import { ToolStateManager } from '../tools/state';
import { setToolLimits } from '../tools/tool-limits';
import { readFile } from '../tools/internal/read_file';
import { searchInFiles } from '../tools/internal/search_in_files';
import { createShellTool } from '../tools/internal/shell';
import { createBashTool } from '../tools/internal/bash';
import { findFiles } from '../tools/internal/find_files';
import { applyDiff } from '../tools/internal/apply_diff';
import { writeFile } from '../tools/internal/write_file';
import { listFiles } from '../tools/internal/list_files';
import { deleteFile } from '../tools/internal/delete_file';
import { createDirectory } from '../tools/internal/create_directory';
import { insertCode } from '../tools/internal/insert_code';
import { deleteCode } from '../tools/internal/delete_code';
import { SubAgentTypeRegistry, createSubAgentTool } from '../tools/internal/sub-agent';
import { createDelegateToAgentTool, createQueryDelegatedTaskTool } from '../tools/internal/delegate-agent';
import { ModeRegistry, DEFAULT_MODE, DEFAULT_MODE_NAME } from '../modes';
import { PromptAssembler } from '../prompt/assembler';
import { CrossAgentTaskBoard } from './cross-agent-task-board';
import { ToolLoop } from './tool-loop';
import { createHistorySearchTool } from '../tools/internal/history_search';
import { createReadSkillTool } from '../tools/internal/read_skill';
import { createInvokeSkillTool } from '../tools/internal/invoke_skill';
import { DEFAULT_SYSTEM_PROMPT } from '../prompt/templates/default';
import { Backend } from './backend';
import type { StorageProvider } from '../storage/base';
import { PluginManager } from '../extension';
import { createBootstrapExtensionRegistry, type BootstrapExtensionRegistry } from '../bootstrap/extensions';
import type { PlatformRegistry } from './platform-registry';
import { PluginEventBus } from '../extension/event-bus';
import { patchMethod, patchPrototype } from '../extension/patch';
import { registerExtensionPlatforms } from '../extension';
import { ensureDevSourceSdkShims } from '../extension';
import type { IrisAPI, InlinePluginEntry, WebPanelDefinition, ConsoleSettingsTabDefinition } from '@irises/extension-sdk';
import { BackendHandle } from '@irises/extension-sdk';
import { readEditableConfig, updateEditableConfig, LayeredConfigManager } from '../config/manage';
import { applyRuntimeConfigReload, type RuntimeConfigReloadContext } from '../config/runtime';
import { DEFAULTS, parseLLMConfig } from '../config/llm';
import { parseSystemConfig } from '../config/system';
import { parseToolsConfig } from '../config/tools';
import { setGlobalLogLevel, getGlobalLogLevel, LogLevel } from '../logger';
import { isCompiledBinary } from '../paths';
import { resizeImage, formatDimensionNote } from '../media/image-resize';
import { extractDocument, isSupportedDocumentMime } from '../media/document-extract';
import { convertToPDF, isConversionAvailable } from '../media/office-to-pdf';
import {
  // 多 Agent 配置分层重构：移除 setAgentEnabled / createManifestIfNotExists 导入
  getAgentStatus,
  createAgent, updateAgent, deleteAgent, resetCache as resetAgentCache, loadAgentDefinitions,
} from '../agents';
import { parseUnifiedDiff } from '../tools/internal/apply_diff/unified_diff';
import { buildSearchRegex, decodeText, globToRegExp, isLikelyBinary, toPosix, walkFiles } from '../tools/internal/search_in_files';
import { normalizeWriteArgs } from '../tools/internal/write_file';
import { normalizeInsertArgs } from '../tools/internal/insert_code';
import { normalizeDeleteCodeArgs } from '../tools/internal/delete_code';
import { resolveProjectPath } from '../tools/utils';
import { supportsVision as checkVision, supportsNativePDF as checkNativePDF, supportsNativeOffice as checkNativeOffice, isDocumentMimeType as checkDocMime } from '../llm/vision';
import { setExtensionLogLevel } from '@irises/extension-sdk';

// ── 类型 ──

export type CoreState = 'init' | 'running' | 'stopping' | 'stopped';

/** Agent 网络提供者（由 IrisHost 在多 Agent 模式下构建并传入） */
export interface AgentNetworkProvider {
  readonly selfName: string;
  listPeers(): string[];
  getPeerDescription(name: string): string | undefined;
  getPeerBackend(name: string): Backend | undefined;
  getPeerBackendHandle?(name: string): BackendHandle | undefined;
  /** 获取指定 peer Agent 的 IrisAPI（含 configManager 等）。
   *  分层配置修复：console 切换 Agent 后需要从新 Agent 获取 configManager 重建 settingsController。 */
  getPeerAPI?(name: string): Record<string, unknown> | undefined;
}

/** IrisCore 构造选项 */
export interface IrisCoreOptions {
  /** Agent 名称（用于日志标识和 TUI 显示） */
  agentName?: string;
  /** Agent 专属路径集（不提供则使用全局默认路径） */
  agentPaths?: AgentPaths;
  /**
   * 已合并的完整配置（由 IrisHost 分层合并后传入）。
   * 多 Agent 配置分层重构：优先使用此字段，不提供时 fallback 到自行加载。
   */
  resolvedConfig?: AppConfig;
  /** 运行时直接注入的内联插件 */
  inlinePlugins?: InlinePluginEntry[];
  /** 外部注入的全局任务板（多 Agent 模式下由 IrisHost 创建并共享） */
  taskBoard?: CrossAgentTaskBoard;
  /** 多 Agent 模式下的 agentNetwork（由 IrisHost 构造时注入） */
  agentNetwork?: AgentNetworkProvider;
  /** MCP 共享：外部注入的共享 MCPManager（由 IrisHost 在 MCP 配置相同时传入，Core 不拥有其生命周期） */
  sharedMCPManager?: MCPManager;
}

// ── IrisCore ──

export class IrisCore {
  // ---- 生命周期状态 ----
  private _state: CoreState = 'init';
  private shutdownPromise: Promise<void> | null = null;

  get state(): CoreState { return this._state; }

  // ---- 公开属性（原 BootstrapResult 的字段，start() 后可用） ----
  backend!: Backend;
  backendHandle!: BackendHandle;
  config!: AppConfig;
  configDir!: string;
  router!: LLMRouter;
  tools!: ToolRegistry;
  agentName?: string;
  initWarnings: string[] = [];
  pluginManager: PluginManager | undefined;
  extensions!: BootstrapExtensionRegistry;
  platformRegistry!: PlatformRegistry;
  eventBus!: PluginEventBus;
  irisAPI?: Record<string, unknown>;

  // ---- MCP 管理（支持热重载，需要 getter/setter） ----
  private _mcpManager: MCPManager | undefined;

  /**
   * MCP 共享：标识该 Core 是否拥有 MCPManager 的生命周期。
   * false 表示使用的是 IrisHost 注入的共享实例，shutdown 时不 disconnect。
   */
  private _mcpOwned = true;
  get mcpManager(): MCPManager | undefined { return this._mcpManager; }
  setMCPManager(manager?: MCPManager): void { this._mcpManager = manager; }
  getMCPManager(): MCPManager | undefined { return this._mcpManager; }

  // ---- 路由延迟注册（平台无关） ----
  private pendingRoutes: Array<{ method: string; path: string; handler: (req: any, res: any, params: Record<string, string>) => Promise<void> }> = [];
  private routeRegistrar: ((method: string, path: string, handler: any) => void) | undefined;

  /** 绑定路由注册器（由实现了 RoutableHttpPlatform 的平台提供） */
  bindRouteRegistrar(register: (method: string, path: string, handler: any) => void): void {
    this.routeRegistrar = register;
    for (const route of this.pendingRoutes) register(route.method, route.path, route.handler);
  }

  // ---- 内部资源（shutdown 时清理） ----
  private skillWatcherDispose?: () => void;
  private storage?: StorageProvider;

  // ---- 构造参数暂存 ----
  private options: IrisCoreOptions;

  constructor(options?: IrisCoreOptions) {
    this.options = options ?? {};
    this.agentName = options?.agentName;
  }

  // ============ start() ============

  async start(): Promise<void> {
    if (this._state !== 'init') {
      throw new Error(`IrisCore.start() 只能在 init 状态调用，当前状态: ${this._state}`);
    }

    const options = this.options;
    const agentPaths = options.agentPaths;
    const agentLabel = options.agentName;

    // 多 Agent 配置分层重构：优先使用 IrisHost 传入的 resolvedConfig，
    // fallback 到自行加载（兼容 CLI 模式直接 new IrisCore() 的用法）。
    const configDir = agentPaths?.configDir
      ? findConfigFile(agentPaths.configDir, true)
      : findConfigFile();
    // 分层配置修复：获取全局配置目录，用于构造 LayeredConfigManager。
    // 当没有 agentPaths 时 configDir 已经指向全局目录，globalDir == configDir，
    // LayeredConfigManager 退化为单目录模式，零回归风险。
    const globalDir = findConfigFile();
    const config = options.resolvedConfig ?? loadConfig(agentPaths?.configDir, agentPaths);
    const extensions = createBootstrapExtensionRegistry();
    registerExtensionPlatforms(extensions.platforms, undefined, config.system.devSourceExtensions);

    if (config.system.devSourceExtensions?.length) {
      if (config.system.devSourceSdk) {
        ensureDevSourceSdkShims();
      }
      console.log(`[Iris] DevSource 模式已启用，以下扩展将从源码加载: ${config.system.devSourceExtensions.join(', ')}`);
    }

    // ---- 0. 预加载插件 + PreBootstrap 阶段 ----
    const inlinePlugins = options.inlinePlugins ?? [];
    const pluginManager = new PluginManager();
    if (config.plugins?.length || inlinePlugins.length > 0) {
      pluginManager.setConfigDir(configDir);
      pluginManager.setDevSourceExtensions(config.system.devSourceExtensions);
      await pluginManager.prepareAll(config.plugins ?? [], config, inlinePlugins);
      await pluginManager.runPreBootstrap(config, extensions);
    }

    // ---- 1. 创建 LLM 路由器 ----
    const router = createLLMRouter(config.llm, undefined, extensions.llmProviders);

    // ---- 1.5 配置请求日志 ----
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

    const isWindows = process.platform === 'win32';
    const commandToolName = isWindows ? 'shell' : 'bash';
    const shellClassifierConfig = (config.tools.permissions[commandToolName] as any)?.classifier
      ?? { enabled: true };
    const commandToolDeps = {
      getRouter: () => router,
      classifierConfig: shellClassifierConfig,
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
    // MCP 共享：如果 IrisHost 注入了 sharedMCPManager（配置相同时），
    // 直接复用该实例，跳过 createMCPManager + connectAll。
    // 此时 _mcpOwned = false，shutdown 时不 disconnect。
    if (options.sharedMCPManager) {
      mcpManager = options.sharedMCPManager;
      this._mcpOwned = false;
      tools.registerAll(mcpManager.getTools());
    } else if (config.mcp) {
      // 没有共享注入时走原有逻辑：自建 MCPManager + connectAll。
      // _mcpOwned 保持默认 true，shutdown 时由 Core 自行 disconnect。
      mcpManager = createMCPManager(config.mcp);
      await mcpManager.connectAll();
      tools.registerAll(mcpManager.getTools());
    }

    const initWarnings: string[] = [];

    // ---- 3.5 注册子代理工具 ----
    const subAgentTypes = new SubAgentTypeRegistry();

    if (config.subAgents?.enabled !== false && config.subAgents?.types) {
      const globalStream = config.subAgents.stream;
      for (const t of config.subAgents.types) {
        if (t.enabled === false) continue;
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

    // ---- 3.8 配置提示词 ----
    const prompt = new PromptAssembler();
    prompt.setSystemPrompt(config.system.systemPrompt || DEFAULT_SYSTEM_PROMPT);

    // ---- 3.9 激活插件 ----
    if (pluginManager) {
      await pluginManager.activateAll(
        { tools, modes: modeRegistry, prompt, router },
        config,
      );
    }

    // ---- 5. 创建 Backend ----
    const hasSubAgents = subAgentTypes.getAll().length > 0;
    const asyncSubAgentsEnabled = config.system.asyncSubAgents === true && hasSubAgents;

    const taskBoard = options.taskBoard ?? new CrossAgentTaskBoard();
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

    backend.setTaskBoard(taskBoard);
    // 多 Agent 配置分层重构：移除 __global__ fallback，所有 agent 都有明确名称（至少 master）
    taskBoard.registerBackend(options.agentName ?? 'master', backend);

    // 注册子代理工具
    if (hasSubAgents) {
      tools.register(createSubAgentTool({
        getRouter: () => backend.getRouter(),
        getToolsConfig: () => backend.getToolsConfig(),
        retryOnError: config.system.retryOnError,
        maxRetries: config.system.maxRetries,
        tools,
        toolState,
        subAgentTypes,
        maxDepth: config.system.maxAgentDepth,
        ...(asyncSubAgentsEnabled ? {
          getSessionId: () => backend.getActiveSessionId(),
          taskBoard,
          // 多 Agent 配置分层重构：移除 __global__ fallback
          agentName: options.agentName ?? 'master',
        } : {}),
      }));
    }

    // ---- 3.7b 注册 agentNetwork delegate 工具（多 Agent 模式） ----
    if (options.agentNetwork) {
      const network = options.agentNetwork;
      tools.register(createDelegateToAgentTool({
        agentNetwork: network,
        taskBoard,
        getSessionId: () => backend.getActiveSessionId(),
      }));
      tools.register(createQueryDelegatedTaskTool({ taskBoard }));
    }

    // 注册历史搜索工具
    tools.register(createHistorySearchTool({
      getStorage: () => backend.getStorage(),
      getSessionId: () => backend.getActiveSessionId(),
    }));

    // 注册 Skill 工具（read_skill + invoke_skill）。
    // 即使启动时没有 Skill，也保留回调，便于运行时热重载新增 Skill 后自动出现工具。
    const rebuildSkillsTool = () => {
      const skillsList = backend.listSkills();
      tools.unregister('read_skill');
      if (skillsList.length > 0) {
        tools.register(createReadSkillTool({
          getBackend: () => backend,
        }));
      }
    };

    const rebuildInvokeSkillTool = () => {
      tools.unregister('invoke_skill');
      const skillsList = backend.listSkills();
      // 仅在有模型可调用的 skill 时注册（全部 disableModelInvocation 时不注册）
      const hasInvocableSkills = skillsList.some(s => !s.disableModelInvocation);
      if (skillsList.length > 0 && hasInvocableSkills) {
        tools.register(createInvokeSkillTool({
          getBackend: () => backend,
          getRouter: () => backend.getRouter(),
          tools,
          getToolsConfig: () => backend.getToolsConfig(),
          retryOnError: config.system.retryOnError,
          maxRetries: config.system.maxRetries,
        }));
      }
    };

    // 初始注册
    rebuildSkillsTool();
    rebuildInvokeSkillTool();

    // 注册回调：Skill 列表变化时自动重建所有 Skill 工具声明
    const rebuildAllSkillTools = () => {
      rebuildSkillsTool();
      rebuildInvokeSkillTool();
    };
    backend.setOnSkillsChanged(rebuildAllSkillTools);

    // 启动 Skill 目录文件系统监听
    const effectiveDataDir = agentPaths?.dataDir || globalDataDir;
    const inlineSkills = config.system.skills?.filter(s => s.path.startsWith('inline:'));
    const stopSkillWatcher = createSkillWatcher(effectiveDataDir, () => {
      backend.reloadSkillsFromFilesystem(effectiveDataDir, inlineSkills);
    });

    // 将插件钩子注入 Backend
    const eventBus = new PluginEventBus();

    // 路由延迟注册（平台无关）
    const registerRoute = (method: string, path: string, handler: (req: any, res: any, params: Record<string, string>) => Promise<void>) => {
      const record = { method: method.toUpperCase(), path, handler };
      this.pendingRoutes.push(record);
      this.routeRegistrar?.(record.method, record.path, record.handler);
    };

    // 面板注册表
    const panelDefinitions: WebPanelDefinition[] = [];
    const registerPanel = (panel: WebPanelDefinition) => {
      if (!panelDefinitions.some(p => p.id === panel.id)) panelDefinitions.push(panel);
    };
    registerRoute('GET', '/api/panels', async (_req: any, res: any) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(panelDefinitions));
    });

    // Console Settings Tab 注册表
    const consoleSettingsTabs: ConsoleSettingsTabDefinition[] = [];
    const registerConsoleSettingsTab = (tab: ConsoleSettingsTabDefinition) => {
      if (!consoleSettingsTabs.some(t => t.id === tab.id)) consoleSettingsTabs.push(tab);
    };

    // 内置 Net 设置标签页
    registerConsoleSettingsTab({
      id: 'net',
      label: '多端互联',
      fields: [
        { key: 'enabled', label: '启用 Net 服务', type: 'toggle', defaultValue: false,
          description: '启用后其他设备可通过 WebSocket 连接控制此 Iris 实例' },
        { key: 'port', label: '端口', type: 'number', defaultValue: 9100 },
        { key: 'host', label: '监听地址', type: 'text', defaultValue: '0.0.0.0' },
        { key: 'token', label: '认证 Token', type: 'text',
          description: '远程连接密码（首次自动生成，可自行修改）' },
        { key: 'relay.url', label: '中继地址', type: 'text',
          description: '不在同一局域网时，通过公网中继服务器连接（如 wss://relay.example.com:9001）' },
        { key: 'relay.nodeId', label: '中继节点 ID', type: 'text',
          description: '本机在中继上的唯一标识，远程连接时需要用到（如 my-vps）' },
        { key: 'relay.token', label: '中继 Token', type: 'text',
          description: '中继服务器的认证密码（与上面的认证 Token 不同）' },
      ],
      onLoad: async () => {
        const raw = readEditableConfig(configDir) as Record<string, any>;
        const net = raw.net ?? {};
        // 没有 token 时预生成一个随机值，用户可直接保存或修改
        let token = net.token ?? '';
        if (!token) {
          const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
          token = Array.from({ length: 24 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
        }
        return {
          enabled: net.enabled ?? false,
          port: net.port ?? 9100,
          host: net.host ?? '0.0.0.0',
          token,
          'relay.url': net.relay?.url ?? '',
          'relay.nodeId': net.relay?.nodeId ?? '',
          'relay.token': net.relay?.token ?? '',
        };
      },
      onSave: async (values) => {
        try {
          const netUpdate: Record<string, unknown> = {
            enabled: values.enabled,
            port: values.port,
            host: values.host,
            token: values.token,
          };
          if (values['relay.url'] || values['relay.nodeId'] || values['relay.token']) {
            netUpdate.relay = {
              url: values['relay.url'] || undefined,
              nodeId: values['relay.nodeId'] || undefined,
              token: values['relay.token'] || undefined,
            };
          }
          const merged = updateEditableConfig(configDir, { net: netUpdate });
          const ctx: RuntimeConfigReloadContext = {
            backend, getMCPManager: getMCPManagerFn, setMCPManager: setMCPManagerFn, extensions,
          };
          await applyRuntimeConfigReload(ctx, merged.mergedRaw);
          return { success: true };
        } catch (e) {
          return { success: false, error: e instanceof Error ? e.message : String(e) };
        }
      },
    });

    // 构建完整内部 API
    const getMCPManagerFn = () => this._mcpManager;
    const setMCPManagerFn = (m?: MCPManager) => { this._mcpManager = m; };
    const irisAPI = {
      backend,
      media: { resizeImage, formatDimensionNote, extractDocument, isSupportedDocumentMime, convertToPDF, isConversionAvailable },
      router,
      storage,
      tools,
      modes: modeRegistry,
      prompt,
      config,
      get mcpManager() { return getMCPManagerFn(); },
      ocrService,
      extensions,
      // 分层配置修复：用 LayeredConfigManager 替代原来的单目录闭包。
      // 读时返回 global + agent 合并后的完整配置（解决 settings UI 空白问题），
      // 写时只修改 agent 覆盖层，返回合并后的 mergedRaw（解决热重载不完整问题）。
      // 每个 IrisCore 持有独立实例（解决 Agent 切换后 configManager 未更新问题）。
      configManager: Object.assign(
        new LayeredConfigManager(globalDir, configDir),
        {
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
      ),
      isCompiledBinary,
      projectRoot: (await import('../paths')).projectRoot,
      dataDir: agentPaths?.dataDir || globalDataDir,
      fetchAvailableModels: async (input: { provider: string; apiKey: string; baseUrl?: string }) => {
        const { listAvailableModels } = await import('../llm/model-catalog');
        return await listAvailableModels(input as any);
      },
      agentManager: {
        getStatus: () => getAgentStatus(),
        // 多 Agent 配置分层重构：移除 setEnabled / createManifest（不再有 enabled 开关）
        create: (name: string, description?: string) => createAgent(name, description),
        update: (name: string, fields: any) => updateAgent(name, fields),
        delete: (name: string) => deleteAgent(name),
        resetCache: () => resetAgentCache(),
        getActiveSessionId: () => backend.getActiveSessionId(),
        getLastSessionTokens: (sessionId: string) => backend.getLastSessionTokens(sessionId),
        getAllSessionTokens: () => backend.getAllSessionTokens(),
      },
      toolPreviewUtils: { parseUnifiedDiff, normalizeWriteArgs, normalizeInsertArgs, normalizeDeleteCodeArgs, resolveProjectPath, buildSearchRegex, decodeText, globToRegExp, isLikelyBinary, toPosix, walkFiles },
      setLogLevel: (level: number) => {
        setGlobalLogLevel(level as LogLevel);
        setExtensionLogLevel(level);
      },
      getLogLevel: () => getGlobalLogLevel() as number,
      pluginManager,
      eventBus,
      services: pluginManager.getServiceRegistry(),
      configContributions: pluginManager.getConfigContributionRegistry(),
      taskBoard,
      // 多 Agent 配置分层重构：移除 __global__ fallback
      agentName: options.agentName ?? 'master',
      patchMethod,
      patchPrototype,
      createToolLoop: (loopOptions: { tools: any; systemPrompt: string; maxRounds?: number }) => {
        const loopPrompt = new PromptAssembler();
        loopPrompt.setSystemPrompt(loopOptions.systemPrompt);
        const loopConfig = {
          maxRounds: loopOptions.maxRounds ?? 15,
          toolsConfig: config.tools ?? {},
          retryOnError: true,
          maxRetries: 2,
        };
        return new ToolLoop(loopOptions.tools as ToolRegistry, loopPrompt, loopConfig);
      },
      registerRoute,
      registerPanel,
      agentNetwork: options.agentNetwork,
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
    } as IrisAPI;

    // 同步初始日志级别到 SDK logger
    setExtensionLogLevel(getGlobalLogLevel());

    if (pluginManager && pluginManager.size > 0) {
      backend.setPluginHooks(pluginManager.getHooks());
      await pluginManager.notifyReady(irisAPI);
    }

    // ---- 赋值公开属性 ----
    this.backend = backend;
    this.backendHandle = new BackendHandle(backend);
    this.config = config;
    this.configDir = configDir;
    this.router = router;
    this.tools = tools;
    this.agentName = agentLabel;
    this.initWarnings = initWarnings;
    this.pluginManager = pluginManager;
    this.extensions = extensions;
    this.platformRegistry = extensions.platforms;
    this.eventBus = eventBus;
    this.irisAPI = irisAPI as unknown as Record<string, unknown>;

    // ---- 赋值内部资源 ----
    this._mcpManager = mcpManager;
    this.skillWatcherDispose = stopSkillWatcher;
    this.storage = storage;

    this._state = 'running';
  }

  // ============ shutdown() — 幂等 ============

  /**
   * 优雅关闭所有资源。幂等：多次调用返回同一个 Promise。
   */
  shutdown(): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise;
    this.shutdownPromise = this.doShutdown();
    return this.shutdownPromise;
  }

  private async doShutdown(): Promise<void> {
    if (this._state === 'stopped' || this._state === 'init') return;
    this._state = 'stopping';

    try {
      // 断开 MCP 连接。
      // MCP 共享：_mcpOwned === false 表示使用的是 IrisHost 注入的共享实例，
      // 由 Host 统一管理生命周期，Core shutdown 时跳过 disconnect。
      if (this._mcpManager && this._mcpOwned) {
        try { await this._mcpManager.disconnectAll(); } catch { /* 忽略 */ }
      }

      // 停止 Skill 文件监听
      if (this.skillWatcherDispose) {
        try { this.skillWatcherDispose(); } catch { /* 忽略 */ }
      }

      // 反激活插件
      if (this.pluginManager) {
        try { await this.pluginManager.deactivateAll(); } catch { /* 忽略 */ }
      }

      // 关闭存储
      if (this.storage) {
        try { await this.storage.close(); } catch { /* 忽略 */ }
      }
    } catch (err) {
      console.error('[IrisCore] shutdown 出错:', err);
    }

    this._state = 'stopped';
  }
}
