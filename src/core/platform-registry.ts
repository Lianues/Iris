/**
 * 平台注册表
 *
 * 用于内置平台与插件平台的统一创建。
 * 从 src/platforms/registry.ts 迁移而来，不再包含任何内置平台工厂。
 */

import type { AppConfig } from '../config/types';
import type { BackendHandle } from 'irises-extension-sdk';
import type { LLMRouter } from '../llm/router';
import type { BootstrapExtensionRegistry } from '../bootstrap/extensions';
import { PlatformAdapter } from 'irises-extension-sdk';
import type { PluginEventBus } from '../extension/event-bus';

export interface PlatformFactoryContext {
  [key: string]: unknown;
  backend: BackendHandle;
  config: AppConfig;
  configDir: string;
  router: LLMRouter;
  agentName?: string;
  extensions: BootstrapExtensionRegistry;
  initWarnings: string[];
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
