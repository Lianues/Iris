/**
 * 入口文件
 *
 * 根据配置创建各模块实例，组装并启动应用。
 */

import { loadConfig, findConfigFile } from './config';

//平台
import { PlatformAdapter } from './platforms/base';
import { ConsolePlatform } from './platforms/console';
import { DiscordPlatform } from './platforms/discord';
import { TelegramPlatform } from './platforms/telegram';
import { WebPlatform } from './platforms/web';

// LLM
import { createLLMRouter } from './llm/factory';
import { setRequestLogging } from './llm/transport';

// 存储
import { JsonFileStorage } from './storage/json-file';
import { SqliteStorage } from './storage/sqlite';

// 记忆
import { createMemoryProvider, createMemoryTools, MemoryProvider } from './memory';

// MCP
import { createMCPManager, MCPManager } from './mcp';

// OCR
import { OCRService } from './ocr';

// 工具
import { ToolRegistry } from './tools/registry';
import { ToolStateManager } from './tools/state';
import { readFile } from './tools/internal/read_file';
import { searchReplace } from './tools/internal/search_replace';
import { terminal } from './tools/internal/terminal';
import { applyDiff } from './tools/internal/apply_diff';
import { writeFile } from './tools/internal/write_file';
import { listFiles } from './tools/internal/list_files';
import { deleteFile } from './tools/internal/delete_file';
import { createDirectory } from './tools/internal/create_directory';
import { insertCode } from './tools/internal/insert_code';
import { deleteCode } from './tools/internal/delete_code';

// 子代理
import { SubAgentTypeRegistry, createDefaultSubAgentTypes, buildSubAgentGuidance, createSubAgentTool } from './tools/internal/sub-agent';

// 模式
import { ModeRegistry, DEFAULT_MODE, DEFAULT_MODE_NAME } from './modes';

// 提示词
import { PromptAssembler } from './prompt/assembler';
import { DEFAULT_SYSTEM_PROMPT } from './prompt/templates/default';

// 核心
import { Backend } from './core/backend';

async function main() {
  const configDir = findConfigFile();
  const config = loadConfig();

  // ---- 0. 配置日志 ----
  setRequestLogging(!!config.system.logRequests);

  // ---- 1. 创建 LLM 路由器 ----
  const router = createLLMRouter(config.llm);

  // ---- 2. 创建存储 ----
  let storage;
  switch (config.storage.type) {
    case 'sqlite':
      storage = new SqliteStorage(config.storage.dbPath);
      break;
    case 'json-file':
    default:
      storage = new JsonFileStorage(config.storage.dir);
      break;
  }

  // ---- 2.5 创建记忆模块 ----
  let memory: MemoryProvider | undefined;
  if (config.memory?.enabled) {
    memory = createMemoryProvider({ dbPath: config.memory.dbPath });
  }

  // ---- 2.6 创建 OCR 服务 ----
  const ocrService = config.ocr ? new OCRService(config.ocr) : undefined;

  // ---- 3. 注册工具 ----
  const tools = new ToolRegistry();
  tools.registerAll([readFile, writeFile, applyDiff, searchReplace, terminal, listFiles, deleteFile, createDirectory, insertCode, deleteCode]);
  if (memory) {
    tools.registerAll(createMemoryTools(memory));
  }

  // ---- 3.1 连接 MCP 服务器 ----
  let mcpManager: MCPManager | undefined;
  if (config.mcp) {
    mcpManager = createMCPManager(config.mcp);
    mcpManager.connectAll().then(() => {
      tools.registerAll(mcpManager!.getTools());
    });
  }

  // ---- 3.5 注册子 Agent 工具 ----
  const subAgentTypes = new SubAgentTypeRegistry();
  for (const t of createDefaultSubAgentTypes()) {
    if (t.name === 'recall' && !memory) continue;
    subAgentTypes.register(t);
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
  const agentGuidance = buildSubAgentGuidance(subAgentTypes, !!memory);
  const autoRecall = !(memory && tools.get('agent'));

  const backend = new Backend(router, storage, tools, toolState, prompt, {
    maxToolRounds: config.system.maxToolRounds,
    stream: config.system.stream,
    autoRecall,
    agentGuidance,
    defaultMode,
    primaryLLMConfig: config.llm.primary,
    ocrService,
  }, memory, modeRegistry);

  // 注册子代理工具（需要 backend 引用）
  tools.register(createSubAgentTool({
    getRouter: () => backend.getRouter(),
    tools,
    subAgentTypes,
    maxDepth: config.system.maxAgentDepth,
  }));

  // ---- 6. 创建平台适配器 ----
  let platform: PlatformAdapter;
  switch (config.platform.type) {
    case 'discord':
      platform = new DiscordPlatform(backend, { token: config.platform.discord.token });
      break;
    case 'telegram':
      platform = new TelegramPlatform(backend, { token: config.platform.telegram.token });
      break;
    case 'web': {
      const webPlatform = new WebPlatform(backend, {
        port: config.platform.web.port,
        host: config.platform.web.host,
        authToken: config.platform.web.authToken,
        managementToken: config.platform.web.managementToken,
        configPath: configDir,
        llmName: config.llm.primary.provider,
        modelName: config.llm.primary.model,
        streamEnabled: config.system.stream,
      });
      if (mcpManager) webPlatform.setMCPManager(mcpManager);
      platform = webPlatform;
      break;
    }
    case 'console':
    default:
      platform = new ConsolePlatform(backend, {
        modeName: defaultMode,
        contextWindow: config.llm.primary.contextWindow,
        configDir,
        getMCPManager: () => mcpManager,
        setMCPManager: (manager?: MCPManager) => { mcpManager = manager; },
      });
      break;
  }

  // ---- 7. 启动平台 ----
  await platform.start();

  // ---- 退出清理 ----
  let cleaning = false;
  const cleanup = async () => {
    if (cleaning) return;
    cleaning = true;
    try {
      const activeMcp = (platform instanceof WebPlatform) ? platform.getMCPManager() : mcpManager;
      if (activeMcp) await activeMcp.disconnectAll();
      await platform.stop();
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
