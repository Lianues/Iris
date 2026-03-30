/**
 * 平台注册表
 *
 * 用于内置平台与插件平台的统一创建。
 */

import type { AppConfig } from '../config/types';
import type { Backend } from '../core/backend';
import type { LLMRouter } from '../llm/router';
import type { MCPManager } from '../mcp';
import type { BootstrapExtensionRegistry } from '../bootstrap/extensions';
import { PlatformAdapter } from './base';
import type { PluginEventBus } from '../plugins/event-bus';

export interface PlatformFactoryContext {
  backend: Backend;
  config: AppConfig;
  configDir: string;
  router: LLMRouter;
  getMCPManager: () => MCPManager | undefined;
  setMCPManager: (manager?: MCPManager) => void;
  agentName?: string;
  extensions: BootstrapExtensionRegistry;
  initWarnings: string[];
  onSwitchAgent?: () => void;
  /** 插件间共享事件总线 */
  eventBus?: PluginEventBus;
  /** 完整 API（供 console 等高级平台使用） */
  api?: Record<string, unknown>;
  /** 是否编译后的二进制发行版 */
  isCompiledBinary?: boolean;
}

export type PlatformFactory = (
  context: PlatformFactoryContext,
) => Promise<PlatformAdapter> | PlatformAdapter;

export class PlatformRegistry {
  private factories = new Map<string, PlatformFactory>();

  register(name: string, factory: PlatformFactory): void {
    this.factories.set(name, factory);
  }

  unregister(name: string): boolean {
    return this.factories.delete(name);
  }

  get(name: string): PlatformFactory | undefined {
    return this.factories.get(name);
  }

  has(name: string): boolean {
    return this.factories.has(name);
  }

  list(): string[] {
    return Array.from(this.factories.keys());
  }

  async create(name: string, context: PlatformFactoryContext): Promise<PlatformAdapter> {
    const factory = this.factories.get(name);
    if (!factory) {
      throw new Error(`平台未注册: ${name}`);
    }
    return await factory(context);
  }
}

/** 注册内置平台工厂 */
export function createDefaultPlatformRegistry(): PlatformRegistry {
  const registry = new PlatformRegistry();

  registry.register('web', async ({ backend, config, configDir, router, getMCPManager, extensions }) => {
    const { WebPlatform } = await import('./web');
    const currentModel = router.getCurrentModelInfo();
    const webPlatform = new WebPlatform(backend, {
      port: config.platform.web.port,
      host: config.platform.web.host,
      authToken: config.platform.web.authToken,
      managementToken: config.platform.web.managementToken,
      configPath: configDir,
      provider: currentModel.provider,
      modelId: currentModel.modelId,
      streamEnabled: config.system.stream,
    }, { llmProviders: extensions.llmProviders, ocrProviders: extensions.ocrProviders });
    const mcpMgr = getMCPManager();
    if (mcpMgr) webPlatform.setMCPManager(mcpMgr);
    return webPlatform;
  });

  return registry;
}
