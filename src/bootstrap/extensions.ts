/**
 * Bootstrap 扩展注册表
 *
 * 供插件在 PreBootstrap 阶段注册新的 Provider / Factory / Platform。
 */

import type { LLMConfig, StorageConfig, MemoryConfig } from '../config/types';
import type { OCRConfig } from '../config/ocr';
import type { LLMProviderLike } from '../llm/providers/base';
import { createGeminiProvider } from '../llm/providers/gemini';
import { createOpenAICompatibleProvider } from '../llm/providers/openai-compatible';
import { createClaudeProvider } from '../llm/providers/claude';
import { createOpenAIResponsesProvider } from '../llm/providers/openai-responses';
import type { StorageProvider } from '../storage/base';
import { JsonFileStorage } from '../storage/json-file';
import { SqliteStorage } from '../storage/sqlite';
import type { MemoryProvider } from '../memory/base';
import { SqliteMemory } from '../memory/sqlite';
import type { OCRProvider } from '../ocr';
import { OCRService } from '../ocr';
import { PlatformRegistry, createDefaultPlatformRegistry } from '../platforms/registry';

/** 通用命名工厂注册表 */
export class NamedFactoryRegistry<TFactory> {
  private factories = new Map<string, TFactory>();

  register(name: string, factory: TFactory): void {
    this.factories.set(name, factory);
  }

  unregister(name: string): boolean {
    return this.factories.delete(name);
  }

  get(name: string): TFactory | undefined {
    return this.factories.get(name);
  }

  has(name: string): boolean {
    return this.factories.has(name);
  }

  list(): string[] {
    return Array.from(this.factories.keys());
  }
}

export type LLMProviderFactory = (config: LLMConfig) => LLMProviderLike;
export type StorageFactory = (config: StorageConfig) => Promise<StorageProvider> | StorageProvider;
export type MemoryFactory = (config: MemoryConfig) => Promise<MemoryProvider> | MemoryProvider;
export type OCRFactory = (config: OCRConfig) => Promise<OCRProvider> | OCRProvider;

export class LLMProviderFactoryRegistry extends NamedFactoryRegistry<LLMProviderFactory> {}
export class StorageFactoryRegistry extends NamedFactoryRegistry<StorageFactory> {}
export class MemoryFactoryRegistry extends NamedFactoryRegistry<MemoryFactory> {}
export class OCRFactoryRegistry extends NamedFactoryRegistry<OCRFactory> {}

export interface BootstrapExtensionRegistry {
  llmProviders: LLMProviderFactoryRegistry;
  storageProviders: StorageFactoryRegistry;
  memoryProviders: MemoryFactoryRegistry;
  ocrProviders: OCRFactoryRegistry;
  platforms: PlatformRegistry;
}

/** 创建并注册内置扩展 */
export function createBootstrapExtensionRegistry(): BootstrapExtensionRegistry {
  const llmProviders = new LLMProviderFactoryRegistry();

  // 注册内置 LLM Provider
  // 修改原因：改为透传整个 config 对象，消除手动同步字段的负担。
  // 字段解构现在由各个 Provider 的 create 函数自行处理。
  llmProviders.register('gemini', (config) => createGeminiProvider(config));
  llmProviders.register('openai-compatible', (config) => createOpenAICompatibleProvider(config));
  llmProviders.register('claude', (config) => createClaudeProvider(config));
  llmProviders.register('openai-responses', (config) => createOpenAIResponsesProvider(config));

  const storageProviders = new StorageFactoryRegistry();
  storageProviders.register('json-file', (config) => new JsonFileStorage(config.dir));
  storageProviders.register('sqlite', (config) => new SqliteStorage(config.dbPath));

  const memoryProviders = new MemoryFactoryRegistry();
  memoryProviders.register('sqlite', (config) => new SqliteMemory(config.dbPath));

  const ocrProviders = new OCRFactoryRegistry();
  ocrProviders.register('openai-compatible', (config) => new OCRService(config));

  return {
    llmProviders,
    storageProviders,
    memoryProviders,
    ocrProviders,
    platforms: createDefaultPlatformRegistry(),
  };
}
