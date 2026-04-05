/**
 * 扩展系统统一导出
 */

// ── 扩展发现 / 安装 / 注册 ─────────────────────────────────────

export {
  discoverLocalExtensions,
  importLocalExtensionModule,
  registerExtensionPlatforms,
  resolveLocalPluginSource,
  ensureDevSourceSdkShims,
} from './registry';

export {
  getRemoteExtensionIndexUrl,
  installExtension,
  installLocalExtension,
} from './installer';

export type { ExtensionInstallOptions } from './installer';

// ── 插件系统实现 ───────────────────────────────────────────

export { PluginManager } from './manager';
export { PluginEventBus } from './event-bus';
export { patchMethod, patchPrototype } from './patch';
export { ServiceRegistry } from './service-registry';
export { ConfigContributionRegistry } from './config-contribution-registry';

// ── 宿主内部类型 ─────────────────────────────────────────────

export type {
  LoadedPlugin,
  PluginInfo,
  BeforeToolExecInterceptor,
  AfterToolExecInterceptor,
  BeforeLLMCallInterceptor,
  AfterLLMCallInterceptor,
} from './types';

// ── SDK 类型便捷 re-export（让宿主其他模块 from './extension' 也能拿到）

export type {
  IrisPlugin,
  IrisAPI,
  PreBootstrapContext,
  PluginContext,
  PluginHook,
  PluginLogger,
  InlinePluginEntry,
  PluginEntry,
  ToolExecInterception,
  ToolWrapper,
  WebPanelDefinition,
  PatchDisposer,
  Disposable,
  ServiceDescriptor,
  ServiceRegistryLike,
  ConfigContribution,
  ConfigContributionRegistryLike,
  ConfigFieldSchema,
  ExtensionManifest,
  ExtensionPackage,
  ExtensionPlatformContribution,
  ExtensionPluginContribution,
  ExtensionSource,
  ResolvedLocalPlugin,
  ExtensionInstallFallbackReason,
  ExtensionDistributionMode,
  InstalledExtensionResult,
} from '@irises/extension-sdk';

export type {
  BootstrapExtensionRegistry,
  LLMProviderFactory,
  StorageFactory,
  OCRFactory,
} from '../bootstrap/extensions';
