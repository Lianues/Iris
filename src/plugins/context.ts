/**
 * 插件上下文实现
 *
 * 每个插件在激活时获得一个独立的 PluginContext 实例。
 * 提供便捷 API 和对内部对象的直接访问。
 */

import type { ToolDefinition, Part } from '../types';
import type { ModeDefinition } from '../modes/types';
import type { AppConfig } from '../config/types';
import type { ToolRegistry } from '../tools/registry';
import * as fs from 'fs';
import * as path from 'path';
import { parse as parseYAML } from 'yaml';
import type { ModeRegistry } from '../modes/registry';
import type { PromptAssembler } from '../prompt/assembler';
import type { LLMRouter } from '../llm/router';
import type { PluginContext, PluginHook, PluginLogger, ToolWrapper, IrisAPI } from './types';
import { createLogger } from '../logger';
import type { PlatformAdapter } from '../platforms/base';

export class PluginContextImpl implements PluginContext {
  private hooks: PluginHook[] = [];
  private readyCallbacks: Array<(api: IrisAPI) => void | Promise<void>> = [];
  private _platformReadyCallbacks: Array<(platforms: ReadonlyMap<string, PlatformAdapter>, api: IrisAPI) => void | Promise<void>> = [];

  constructor(
    private pluginName: string,
    private toolRegistry: ToolRegistry,
    private modeRegistry: ModeRegistry,
    private router: LLMRouter,
    private appConfig: AppConfig,
    private promptAssembler: PromptAssembler,
    private pluginConfig?: Record<string, unknown>,
    private extensionRootDir?: string,
    private configDir?: string,
  ) {}

  // ---- 工具扩展 ----

  registerTool(tool: ToolDefinition): void {
    this.toolRegistry.register(tool);
  }

  registerTools(tools: ToolDefinition[]): void {
    this.toolRegistry.registerAll(tools);
  }

  // ---- 模式扩展 ----

  registerMode(mode: ModeDefinition): void {
    this.modeRegistry.register(mode);
  }

  // ---- 事件钩子 ----

  addHook(hook: PluginHook): void {
    this.hooks.push(hook);
  }

  // ---- 直接访问内部注册表 ----

  getToolRegistry(): ToolRegistry {
    return this.toolRegistry;
  }

  getModeRegistry(): ModeRegistry {
    return this.modeRegistry;
  }

  getRouter(): LLMRouter {
    return this.router;
  }

  // ---- 工具拦截 ----

  wrapTool(toolName: string, wrapper: ToolWrapper): void {
    const tool = this.toolRegistry.get(toolName);
    if (!tool) {
      throw new Error(`wrapTool: 工具 "${toolName}" 未注册`);
    }
    const originalHandler = tool.handler;
    tool.handler = (args) => wrapper(originalHandler, args, toolName);
  }

  // ---- 提示词操作 ----

  addSystemPromptPart(part: Part): void {
    this.promptAssembler.addSystemPart(part);
  }

  removeSystemPromptPart(part: Part): void {
    this.promptAssembler.removeSystemPart(part);
  }

  // ---- 延迟初始化 ----

  onReady(callback: (api: IrisAPI) => void | Promise<void>): void {
    this.readyCallbacks.push(callback);
  }

  onPlatformsReady(callback: (platforms: ReadonlyMap<string, PlatformAdapter>, api: IrisAPI) => void | Promise<void>): void {
    this._platformReadyCallbacks.push(callback);
  }

  // ---- 工具方法 ----

  getConfig(): Readonly<AppConfig> {
    return this.appConfig;
  }

  getLogger(tag?: string): PluginLogger {
    const prefix = tag
      ? `Plugin:${this.pluginName}:${tag}`
      : `Plugin:${this.pluginName}`;
    return createLogger(prefix);
  }

  getPluginConfig<T = Record<string, unknown>>(): T | undefined {
    return this.pluginConfig as T | undefined;
  }

  getExtensionRootDir(): string | undefined {
    return this.extensionRootDir;
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

  // ---- 内部方法（供 PluginManager 使用） ----

  /** 获取插件注册的所有钩子 */
  getHooks(): PluginHook[] {
    return this.hooks;
  }

  /** 获取插件注册的 onReady 回调 */
  getReadyCallbacks(): Array<(api: IrisAPI) => void | Promise<void>> {
    return this.readyCallbacks;
  }

  /** 获取插件注册的 onPlatformsReady 回调 */
  getPlatformReadyCallbacks(): Array<(platforms: ReadonlyMap<string, PlatformAdapter>, api: IrisAPI) => void | Promise<void>> {
    return this._platformReadyCallbacks;
  }
}
