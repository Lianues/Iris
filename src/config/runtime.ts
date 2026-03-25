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

export interface RuntimeConfigReloadContext {
  backend: Backend;
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

  // ---- Computer Use 热重载 ----
  if (context.getComputerEnv && context.setComputerEnv) {
    await reloadComputerUse(context, tools, mergedConfig);
  }

  return {
    modelName: currentModel.modelName,
    modelId: currentModel.modelId,
    provider: currentModel.provider,
    streamEnabled: mergedConfig.system?.stream ?? context.backend.isStreamEnabled(),
    contextWindow: currentModel.contextWindow,
  };
}

/** 上次应用的 computer_use 配置快照，用于跳过无变化的重载 */
let lastCuConfigSnapshot = '';

/** bootstrap 初始化 CU 后调用，记录初始快照，避免首次配置保存时误触发重载 */
export function initCuConfigSnapshot(rawComputerUse: any): void {
  lastCuConfigSnapshot = JSON.stringify(rawComputerUse ?? null);
}

/** 并发守卫：防止快速连续保存导致多个 reload 重叠 */
let cuReloading = false;
let cuPendingReload: { context: RuntimeConfigReloadContext; tools: ToolRegistry; mergedConfig: any } | null = null;

async function reloadComputerUse(
  context: RuntimeConfigReloadContext,
  tools: ToolRegistry,
  mergedConfig: any,
): Promise<void> {
  if (cuReloading) {
    // 正在重载中，记下最新配置，当前重载完成后会重新检查
    cuPendingReload = { context, tools, mergedConfig };
    return;
  }
  cuReloading = true;
  try {
    await doReloadComputerUse(context, tools, mergedConfig);
  } finally {
    cuReloading = false;
    if (cuPendingReload) {
      const pending = cuPendingReload;
      cuPendingReload = null;
      await reloadComputerUse(pending.context, pending.tools, pending.mergedConfig);
    }
  }
}

async function doReloadComputerUse(
  context: RuntimeConfigReloadContext,
  tools: ToolRegistry,
  mergedConfig: any,
): Promise<void> {
  const cuConfig = mergedConfig.computer_use;
  const newSnapshot = JSON.stringify(cuConfig ?? null);

  // 配置未变化时跳过，避免修改 LLM/MCP 等无关配置时重启浏览器
  if (newSnapshot === lastCuConfigSnapshot) return;
  lastCuConfigSnapshot = newSnapshot;

  const { COMPUTER_USE_FUNCTION_NAMES, BrowserEnvironment, ScreenEnvironment, createComputerUseTools, resolveEnvironmentKey } = await import('../computer-use');

  // 注销旧的 Computer Use 工具
  for (const name of tools.listTools()) {
    if (COMPUTER_USE_FUNCTION_NAMES.has(name)) {
      tools.unregister(name);
    }
  }

  // 销毁旧环境
  const oldEnv = context.getComputerEnv!();
  if (oldEnv) {
    try { await oldEnv.dispose(); } catch { /* sidecar 可能已退出 */ }
    context.setComputerEnv!(undefined);
  }

  // 如果新配置启用了 computer_use，重新初始化
  if (cuConfig?.enabled) {
    try {
      const { parseComputerUseConfig } = await import('./computer-use');
      const parsedConfig = parseComputerUseConfig(cuConfig);
      if (parsedConfig) {
        const env = parsedConfig.environment ?? 'browser';
        const envKey = resolveEnvironmentKey(env, parsedConfig.backgroundMode);
        let cuEnv: Computer;

        if (env === 'screen') {
          cuEnv = new ScreenEnvironment({
            searchEngineUrl: parsedConfig.searchEngineUrl,
            targetWindow: parsedConfig.targetWindow,
            backgroundMode: parsedConfig.backgroundMode,
          });
        } else {
          cuEnv = new BrowserEnvironment({
            screenWidth: parsedConfig.screenWidth ?? 1440,
            screenHeight: parsedConfig.screenHeight ?? 900,
            headless: parsedConfig.headless,
            initialUrl: parsedConfig.initialUrl,
            searchEngineUrl: parsedConfig.searchEngineUrl,
            highlightMouse: parsedConfig.highlightMouse,
          });
        }

        await cuEnv.initialize();

        const userPolicy = parsedConfig.environmentTools?.[envKey as keyof typeof parsedConfig.environmentTools];
        tools.registerAll(createComputerUseTools(cuEnv, envKey, userPolicy));
        context.setComputerEnv!(cuEnv);
      }
    } catch (err) {
      console.error('[Iris] Computer Use 热重载失败:', err);
    }
  }
}
