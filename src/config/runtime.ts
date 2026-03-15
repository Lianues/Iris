/**
 * 运行时配置热重载
 */

import { Backend } from '../core/backend';
import { createLLMRouter } from '../llm/factory';
import { OCRService } from '../ocr';
import { parseLLMConfig } from './llm';
import { parseOCRConfig } from './ocr';
import { parseToolsConfig } from './tools';
import { parseMCPConfig } from './mcp';
import { DEFAULT_SYSTEM_PROMPT } from '../prompt/templates/default';
import { createMCPManager, MCPManager } from '../mcp';
import { ToolRegistry } from '../tools/registry';

export interface RuntimeConfigReloadContext {
  backend: Backend;
  getMCPManager(): MCPManager | undefined;
  setMCPManager(manager?: MCPManager): void;
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

export async function applyRuntimeConfigReload(
  context: RuntimeConfigReloadContext,
  mergedConfig: any,
): Promise<RuntimeConfigSummary> {
  const llmConfig = parseLLMConfig(mergedConfig.llm);
  const ocrConfig = parseOCRConfig(mergedConfig.ocr);
  const toolsConfig = parseToolsConfig(mergedConfig.tools);
  const previousModelName = context.backend.getCurrentModelName();
  const newRouter = createLLMRouter(llmConfig, previousModelName);
  const currentModel = newRouter.getCurrentModelInfo();

  context.backend.reloadLLM(newRouter);
  context.backend.reloadConfig({
    stream: mergedConfig.system?.stream,
    maxToolRounds: mergedConfig.system?.maxToolRounds,
    toolsConfig,
    systemPrompt: mergedConfig.system?.systemPrompt || DEFAULT_SYSTEM_PROMPT,
    currentLLMConfig: newRouter.getCurrentConfig(),
    ocrService: ocrConfig ? new OCRService(ocrConfig) : undefined,
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

  return {
    modelName: currentModel.modelName,
    modelId: currentModel.modelId,
    provider: currentModel.provider,
    streamEnabled: mergedConfig.system?.stream ?? context.backend.isStreamEnabled(),
    contextWindow: currentModel.contextWindow,
  };
}
