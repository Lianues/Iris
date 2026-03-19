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
import { setRequestLogging } from './llm/transport';
import { createLLMRouter } from './llm/factory';
import { LLMRouter } from './llm/router';
import { JsonFileStorage } from './storage/json-file';
import type { MemoryProvider } from './memory';
import { createMCPManager, MCPManager } from './mcp';
import { OCRService } from './ocr';
import { ToolRegistry } from './tools/registry';
import { ToolStateManager } from './tools/state';
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
import { SubAgentTypeRegistry, createDefaultSubAgentTypes, buildSubAgentGuidance, createSubAgentTool } from './tools/internal/sub-agent';
import { ModeRegistry, DEFAULT_MODE, DEFAULT_MODE_NAME } from './modes';
import { PromptAssembler } from './prompt/assembler';
import { DEFAULT_SYSTEM_PROMPT } from './prompt/templates/default';
import { Backend } from './core/backend';
import type { StorageProvider } from './storage/base';

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
}

export async function bootstrap(): Promise<BootstrapResult> {
  const configDir = findConfigFile();
  const config = loadConfig();

  // ---- 0. 配置日志 ----
  setRequestLogging(!!config.system.logRequests);

  // ---- 1. 创建 LLM 路由器 ----
  const router = createLLMRouter(config.llm);

  // ---- 2. 创建存储 ----
  let storage: StorageProvider;
  switch (config.storage.type) {
    case 'sqlite': {
      const { SqliteStorage } = await import('./storage/sqlite');
      storage = new SqliteStorage(config.storage.dbPath);
      break;
    }
    case 'json-file':
    default:
      storage = new JsonFileStorage(config.storage.dir);
      break;
  }

  // ---- 2.5 创建记忆模块 ----
  let memory: MemoryProvider | undefined;
  if (config.memory?.enabled) {
    const { createMemoryProvider } = await import('./memory');
    memory = createMemoryProvider({ dbPath: config.memory.dbPath });
  }

  // ---- 2.6 创建 OCR 服务 ----
  const ocrService = config.ocr ? new OCRService(config.ocr) : undefined;

  // ---- 3. 注册工具 ----
  const tools = new ToolRegistry();
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
  if (config.computerUse?.enabled) {
    try {
      const { BrowserEnvironment, ScreenEnvironment, createComputerUseTools, resolveEnvironmentKey } = await import('./computer-use');
      const env = config.computerUse.environment ?? 'browser';
      let computerEnv: import('./computer-use').Computer;
      const envKey = resolveEnvironmentKey(env, config.computerUse.backgroundMode);

      if (env === 'screen') {
        computerEnv = new ScreenEnvironment({
          initialUrl: config.computerUse.initialUrl,
          searchEngineUrl: config.computerUse.searchEngineUrl,
          targetWindow: config.computerUse.targetWindow,
          backgroundMode: config.computerUse.backgroundMode,
        });
      } else {
        computerEnv = new BrowserEnvironment({
          screenWidth: config.computerUse.screenWidth ?? 1440,
          screenHeight: config.computerUse.screenHeight ?? 900,
          headless: config.computerUse.headless,
          initialUrl: config.computerUse.initialUrl,
          searchEngineUrl: config.computerUse.searchEngineUrl,
          highlightMouse: config.computerUse.highlightMouse,
        });
      }

      await computerEnv.initialize();

      // 用户配置的工具策略（按环境键名取对应分组）
      const userPolicy = config.computerUse.environmentTools?.[envKey as keyof typeof config.computerUse.environmentTools];
      tools.registerAll(createComputerUseTools(computerEnv, envKey, userPolicy));
    } catch (err) {
      console.error('[Iris] Computer Use 初始化失败:');
      console.error(err);
      console.error('[Iris] 已跳过 Computer Use，其余功能正常启动。');
    }
  }

  // ---- 3.5 注册子代理工具 ----
  const subAgentTypes = new SubAgentTypeRegistry();
  const MEMORY_TOOLS = new Set(['memory_search', 'memory_add', 'memory_delete']);

  if (config.subAgents?.types && config.subAgents.types.length > 0) {
    for (const t of config.subAgents.types) {
      if (!memory && t.allowedTools?.every(name => MEMORY_TOOLS.has(name))) continue;
      subAgentTypes.register({ ...t });
    }
  } else {
    for (const t of createDefaultSubAgentTypes()) {
      if (!memory && t.allowedTools?.every(name => MEMORY_TOOLS.has(name))) continue;
      subAgentTypes.register(t);
    }
  }

  // ---- 3.5 注册用户自定义模式 ----
  const modeRegistry = new ModeRegistry();
  modeRegistry.register(DEFAULT_MODE);
  if (config.modes) {
    modeRegistry.registerAll(config.modes);
  }
  const defaultMode = config.system.defaultMode ?? DEFAULT_MODE_NAME;

  // ---- 3.5a. 创建工具状态管理器 ----
  const toolState = new ToolStateManager();

  // ---- 4. 配置提示词 ----
  const prompt = new PromptAssembler();
  prompt.setSystemPrompt(config.system.systemPrompt || DEFAULT_SYSTEM_PROMPT);

  // ---- 5. 创建 Backend ----
  const subAgentGuidance = buildSubAgentGuidance(subAgentTypes, !!memory);
  const autoRecall = !(memory && tools.get('sub_agent'));

  const backend = new Backend(router, storage, tools, toolState, prompt, {
    maxToolRounds: config.system.maxToolRounds,
    stream: config.system.stream,
    toolsConfig: config.tools,
    autoRecall,
    subAgentGuidance,
    defaultMode,
    currentLLMConfig: router.getCurrentConfig(),
    ocrService,
    maxRecentScreenshots: config.computerUse?.maxRecentScreenshots,
  }, memory, modeRegistry);

  // 注册子代理工具（需要 backend 引用）
  tools.register(createSubAgentTool({
    getRouter: () => backend.getRouter(),
    getToolPolicies: () => backend.getToolPolicies(),
    tools,
    subAgentTypes,
    maxDepth: config.system.maxAgentDepth,
  }));

  return {
    backend,
    config,
    configDir,
    router,
    tools,
    mcpManager,
    setMCPManager: (manager?: MCPManager) => { mcpManager = manager; },
    getMCPManager: () => mcpManager,
  };
}
