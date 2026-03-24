/**
 * 平台注册表
 *
 * 用于内置平台与插件平台的统一创建。
 */

import type { AppConfig } from '../config/types';
import type { Backend } from '../core/backend';
import type { LLMRouter } from '../llm/router';
import type { MCPManager } from '../mcp';
import type { Computer } from '../computer-use/types';
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
  computerEnv?: Computer;
  extensions: BootstrapExtensionRegistry;
  initWarnings: string[];
  onSwitchAgent?: () => void;
  /** 插件间共享事件总线 */
  eventBus?: PluginEventBus;
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

  registry.register('discord', async ({ backend, config }) => {
    const { DiscordPlatform } = await import('./discord');
    return new DiscordPlatform(backend, { token: config.platform.discord.token });
  });

  registry.register('telegram', async ({ backend, config }) => {
    const { TelegramPlatform } = await import('./telegram');
    return new TelegramPlatform(backend, {
      token: config.platform.telegram.token,
      showToolStatus: config.platform.telegram.showToolStatus,
      groupMentionRequired: config.platform.telegram.groupMentionRequired,
      pairing: config.platform.telegram.pairing,
    });
  });

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

  registry.register('wxwork', async ({ backend, config }) => {
    const { WXWorkPlatform } = await import('./wxwork');
    return new WXWorkPlatform(backend, {
      botId: config.platform.wxwork.botId,
      secret: config.platform.wxwork.secret,
      showToolStatus: config.platform.wxwork.showToolStatus,
    });
  });

  registry.register('qq', async ({ backend, config }) => {
    const { QQPlatform } = await import('./qq');
    return new QQPlatform(backend, {
      wsUrl: config.platform.qq.wsUrl,
      accessToken: config.platform.qq.accessToken,
      selfId: config.platform.qq.selfId,
      groupMode: config.platform.qq.groupMode,
      showToolStatus: config.platform.qq.showToolStatus,
    });
  });

  registry.register('lark', async ({ backend, config }) => {
    const { LarkPlatform } = await import('./lark');
    return new LarkPlatform(backend, {
      appId: config.platform.lark.appId,
      appSecret: config.platform.lark.appSecret,
      showToolStatus: config.platform.lark.showToolStatus,
    });
  });

  registry.register('console', async ({ backend, config, configDir, router, getMCPManager, setMCPManager, computerEnv, initWarnings, agentName, onSwitchAgent, extensions }) => {
    if (typeof (globalThis as { Bun?: unknown }).Bun === 'undefined') {
      console.error(
        '[Iris] Console 平台需要 Bun 运行时。\n'
        + '  - 请优先使用: bun run dev\n'
        + '  - 或直接执行: bun src/index.ts\n'
        + '  - 或切换到其他平台（如 web）'
      );
      process.exit(1);
    }

    const { ConsolePlatform } = await import('./console');
    const currentModel = router.getCurrentModelInfo();
    const defaultMode = config.system.defaultMode ?? 'default';

    return new ConsolePlatform(backend, {
      modeName: defaultMode,
      modelName: currentModel.modelName,
      modelId: currentModel.modelId,
      contextWindow: currentModel.contextWindow,
      configDir,
      getMCPManager,
      setMCPManager,
      computerEnv,
      initWarnings,
      agentName,
      onSwitchAgent,
      extensions: { llmProviders: extensions.llmProviders, ocrProviders: extensions.ocrProviders },
    });
  });

  return registry;
}
