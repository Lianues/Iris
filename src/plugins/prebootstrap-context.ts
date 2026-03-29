/**
 * PreBootstrap 插件上下文实现
 */

import type { AppConfig } from '../config/types';
import type { BootstrapExtensionRegistry, LLMProviderFactory, StorageFactory, MemoryFactory, OCRFactory } from '../bootstrap/extensions';
import type { PlatformFactory } from '../platforms/registry';
import type { PreBootstrapContext, PluginLogger } from './types';
import { createLogger } from '../logger';
import * as fs from 'fs';
import * as path from 'path';
import { parse as parseYAML } from 'yaml';

export class PreBootstrapContextImpl implements PreBootstrapContext {
  constructor(
    private pluginName: string,
    private appConfig: AppConfig,
    private extensions: BootstrapExtensionRegistry,
    private pluginConfig?: Record<string, unknown>,
    private configDir?: string,
  ) {}

  getConfig(): Readonly<AppConfig> {
    return this.appConfig;
  }

  mutateConfig(mutator: (config: AppConfig) => void): void {
    mutator(this.appConfig);
  }

  registerLLMProvider(name: string, factory: LLMProviderFactory): void {
    this.extensions.llmProviders.register(name, factory);
  }

  registerStorageProvider(type: string, factory: StorageFactory): void {
    this.extensions.storageProviders.register(type, factory);
  }

  registerMemoryProvider(type: string, factory: MemoryFactory): void {
    this.extensions.memoryProviders.register(type, factory);
  }

  registerOCRProvider(name: string, factory: OCRFactory): void {
    this.extensions.ocrProviders.register(name, factory);
  }

  registerPlatform(name: string, factory: PlatformFactory): void {
    this.extensions.platforms.register(name, factory);
  }

  getExtensions(): BootstrapExtensionRegistry {
    return this.extensions;
  }

  getLogger(tag?: string): PluginLogger {
    const prefix = tag
      ? `Plugin:${this.pluginName}:PreBootstrap:${tag}`
      : `Plugin:${this.pluginName}:PreBootstrap`;
    return createLogger(prefix);
  }

  getPluginConfig<T = Record<string, unknown>>(): T | undefined {
    return this.pluginConfig as T | undefined;
  }

  // ---- 配置文件管理 ----

  getConfigDir(): string {
    if (!this.configDir) throw new Error('configDir 未设置');
    return this.configDir;
  }

  ensureConfigFile(filename: string, content: string): boolean {
    if (!this.configDir) throw new Error('configDir 未设置');
    const filePath = path.join(this.configDir, filename);
    if (fs.existsSync(filePath)) return false;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf-8');
    return true;
  }

  readConfigSection(section: string): Record<string, unknown> | undefined {
    if (!this.configDir) return undefined;
    const filePath = path.join(this.configDir, `${section}.yaml`);
    if (!fs.existsSync(filePath)) return undefined;
    const raw = fs.readFileSync(filePath, 'utf-8');
    return (parseYAML(raw) as Record<string, unknown>) ?? undefined;
  }
}
