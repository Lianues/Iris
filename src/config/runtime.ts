/**
 * 运行时配置热重载
 */

import { Backend } from '../core/backend';
import { dataDir } from '../paths';
import { createLLMRouter } from '../llm/factory';
import { OCRService, type OCRProvider } from '../ocr';
import { parseLLMConfig } from './llm';
import { parseOCRConfig } from './ocr';
import { parseToolsConfig } from './tools';
import { parseMCPConfig } from './mcp';
import { parseSystemConfig } from './system';
import { DEFAULT_SYSTEM_PROMPT } from '../prompt/templates/default';
import { createMCPManager, MCPManager } from '../mcp';
import { ToolRegistry } from '../tools/registry';
import type { Computer } from '../computer-use/types';
import type { BootstrapExtensionRegistry } from '../bootstrap/extensions';
import type { PluginManager } from '../plugins/manager';

export interface RuntimeConfigReloadContext {
  backend: Backend;
  pluginManager?: PluginManager;
  getMCPManager(): MCPManager | undefined;
  setMCPManager(manager?: MCPManager): void;
  getComputerEnv?(): Computer | undefined;
  setComputerEnv?(env?: Computer): void;
  /** Skill 文件系统扫描使用的数据目录（多 Agent 模式下为 agent 专属目录） */
  dataDir?: string;
  extensions?: Pick<BootstrapExtensionRegistry, 'llmProviders' | 'ocrProviders'>;
}

export interface RuntimeConfigSummary {
  modelName: string;
  modelId: string;
  provider: string;
  streamEnabled: boolean;
  contextWindow?: number;
}

function unregisterOldMcpTools(tools: ToolRegistry): void {
  for (const name of tools.listTools()) {
    if (name.startsWith('mcp__')) {
      tools.unregister(name);
    }
  }
}

async function createReloadOCRProvider(
  context: RuntimeConfigReloadContext,
  ocrConfig: ReturnType<typeof parseOCRConfig>,
): Promise<OCRProvider | undefined> {
  if (!ocrConfig) return undefined;

  const registeredFactory = context.extensions?.ocrProviders.get(ocrConfig.provider);
  if (registeredFactory) {
    return await registeredFactory(ocrConfig);
  }

  if (ocrConfig.provider === 'openai-compatible') {
    return new OCRService(ocrConfig);
  }

  throw new Error(`未注册的 OCR provider: ${ocrConfig.provider}`);
}

export async function applyRuntimeConfigReload(
  context: RuntimeConfigReloadContext,
  mergedConfig: any,
): Promise<RuntimeConfigSummary> {
  const llmConfig = parseLLMConfig(mergedConfig.llm);
  const ocrConfig = parseOCRConfig(mergedConfig.ocr);
  const toolsConfig = parseToolsConfig(mergedConfig.tools);
  const previousModelName = context.backend.getCurrentModelName();
  const newRouter = createLLMRouter(llmConfig, previousModelName, context.extensions?.llmProviders);
  const currentModel = newRouter.getCurrentModelInfo();

  context.backend.reloadLLM(newRouter);
  // 解析 system 配置（提取技能定义，避免重复调用 parseSystemConfig）
  // 修复：优先使用 context 中传入的 agent 专属 dataDir，
  // 避免多 Agent 热重载时错误地扫描全局 skills 目录。
  const effectiveDataDir = context.dataDir ?? dataDir;
  const systemConfig = parseSystemConfig(mergedConfig.system, effectiveDataDir);
  context.backend.reloadConfig({
    stream: mergedConfig.system?.stream,
    maxToolRounds: mergedConfig.system?.maxToolRounds,
    retryOnError: mergedConfig.system?.retryOnError,
    maxRetries: mergedConfig.system?.maxRetries,
    toolsConfig,
    systemPrompt: mergedConfig.system?.systemPrompt || DEFAULT_SYSTEM_PROMPT,
    currentLLMConfig: newRouter.getCurrentConfig(),
    ocrService: await createReloadOCRProvider(context, ocrConfig),
    // 热重载 Skill 定义
    skills: systemConfig.skills,
  });

  const tools = context.backend.getTools();
  const currentMcpManager = context.getMCPManager();
  const newMcpConfig = parseMCPConfig(mergedConfig.mcp);

  if (currentMcpManager) {
    if (newMcpConfig) {
      await currentMcpManager.reload(newMcpConfig);
      unregisterOldMcpTools(tools);
      tools.registerAll(currentMcpManager.getTools());
    } else {
      await currentMcpManager.disconnectAll();
      unregisterOldMcpTools(tools);
      context.setMCPManager(undefined);
    }
  } else if (newMcpConfig) {
    const nextMcpManager = createMCPManager(newMcpConfig);
    await nextMcpManager.connectAll();
    unregisterOldMcpTools(tools);
    tools.registerAll(nextMcpManager.getTools());
    context.setMCPManager(nextMcpManager);
  }

  // ---- 触发插件 onConfigReload 钩子 ----
  if (context.pluginManager) {
    await context.pluginManager.invokeConfigReloadHooks(mergedConfig, mergedConfig);
  }

  return {
    modelName: currentModel.modelName,
    modelId: currentModel.modelId,
    provider: currentModel.provider,
    streamEnabled: mergedConfig.system?.stream ?? context.backend.isStreamEnabled(),
    contextWindow: currentModel.contextWindow,
  };
}