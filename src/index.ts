/**
 * 入口文件
 *
 * 根据配置创建各模块实例，组装并启动应用。
 */

import { loadConfig, findConfigFile } from './config';

//平台（动态导入，避免未使用的平台拉入原生依赖导致 Termux 等环境安装失败）
import { PlatformAdapter } from './platforms/base';
import type { WebPlatform as WebPlatformType } from './platforms/web';

// LLM
import { createLLMRouter } from './llm/factory';
import { setRequestLogging } from './llm/transport';

// 存储
import { JsonFileStorage } from './storage/json-file';

// 记忆（动态导入，避免 better-sqlite3 原生依赖）
import type { MemoryProvider } from './memory';

// MCP
import { createMCPManager, MCPManager } from './mcp';

// OCR
import { OCRService } from './ocr';

// 工具
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
  const currentModel = router.getCurrentModelInfo();

  // ---- 2. 创建存储 ----
  let storage;
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

  // ---- 2.5 创建记忆模块（按需加载，避免 better-sqlite3 原生依赖） ----
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
    mcpManager.connectAll().then(() => {
      tools.registerAll(mcpManager!.getTools());
    });
  }

  // ---- 3.5 注册子代理工具 ----
  const subAgentTypes = new SubAgentTypeRegistry();
  const MEMORY_TOOLS = new Set(['memory_search', 'memory_add', 'memory_delete']);

  if (config.subAgents?.types && config.subAgents.types.length > 0) {
    // 使用配置文件的子代理类型定义
    for (const t of config.subAgents.types) {
      // 跳过纯记忆类型（allowedTools 全为记忆工具且记忆未启用）
      if (!memory && t.allowedTools?.every(name => MEMORY_TOOLS.has(name))) continue;
      subAgentTypes.register({ ...t });
    }
  } else {
    // 使用内置默认类型
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
  }, memory, modeRegistry);

  // 注册子代理工具（需要 backend 引用）
  tools.register(createSubAgentTool({
    getRouter: () => backend.getRouter(),
    getToolPolicies: () => backend.getToolPolicies(),
    tools,
    subAgentTypes,
    maxDepth: config.system.maxAgentDepth,
  }));

  // ---- 6. 创建平台适配器（按需动态导入，减少不必要的原生依赖加载） ----
  const platforms: PlatformAdapter[] = [];
  let webPlatformRef: WebPlatformType | undefined;

  for (const platformType of config.platform.types) {
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
          // 这里显式透传 Telegram 的平台策略。
          // 目的：让平台层后续分阶段演进时，不需要再回头修改主入口的参数结构。
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
        if (mcpManager) webPlatform.setMCPManager(mcpManager);
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
        // @opentui/core 依赖 Bun FFI，仅在 Bun 运行时可用
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
          getMCPManager: () => mcpManager,
          setMCPManager: (manager?: MCPManager) => { mcpManager = manager; },
        }));
        break;
      }
    }
  }

  if (platforms.length === 0) {
    console.error('未配置任何有效平台，请检查 platform.yaml 的 type 字段。');
    process.exit(1);
  }

  // ---- 7. 启动所有平台 ----
  await Promise.all(platforms.map(p => p.start()));

  // ---- 退出清理 ----
  let cleaning = false;
  const cleanup = async () => {
    if (cleaning) return;
    cleaning = true;
    try {
      const activeMcp = webPlatformRef ? webPlatformRef.getMCPManager() : mcpManager;
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

main().catch((err) => {
  console.error('启动失败:', err);
  process.exit(1);
});
