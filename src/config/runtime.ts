/**
 * 运行时配置热重载
 */

import { Backend } from '../core/backend';
import { dataDir } from '../paths';
import { createLLMRouter } from '../llm/factory';
import { parseLLMConfig } from './llm';
import { parseToolsConfig } from './tools';
import { parseSystemConfig } from './system';
import { DEFAULT_SYSTEM_PROMPT } from '../prompt/templates/default';
import type { BootstrapExtensionRegistry } from '../bootstrap/extensions';
import type { PluginManager } from '../extension/manager';

export interface RuntimeConfigReloadContext {
  backend: Backend;
  pluginManager?: PluginManager;
  /** Skill 文件系统扫描使用的数据目录（多 Agent 模式下为 agent 专属目录） */
  dataDir?: string;
  extensions?: Pick<BootstrapExtensionRegistry, 'llmProviders'>;
}

export interface RuntimeConfigSummary {
  modelName: string;
  modelId: string;
  provider: string;
  streamEnabled: boolean;
  contextWindow?: number;
}

export async function applyRuntimeConfigReload(
  context: RuntimeConfigReloadContext,
  mergedConfig: any,
): Promise<RuntimeConfigSummary> {
  const llmConfig = parseLLMConfig(mergedConfig.llm);
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
    // 热重载 Skill 定义
    skills: systemConfig.skills,
  });

  // ---- 触发插件 onConfigReload 钩子 ----
  // MCP 热重载由 mcp 扩展自身通过 onConfigReload 钩子处理
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
