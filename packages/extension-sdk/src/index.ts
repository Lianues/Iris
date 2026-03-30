export type {
  ExtensionDistributionContribution,
  ExtensionManifest,
  ExtensionPackage,
  ExtensionPlatformContribution,
  ExtensionPlatformPanelContribution,
  ExtensionPlatformPanelField,
  ExtensionPlatformPanelFieldType,
  ExtensionPluginContribution,
  ExtensionSource,
  InstalledExtensionResult,
  ExtensionDistributionMode,
  ResolvedLocalPlugin,
  ExtensionInstallFallbackReason,
} from './manifest.js';

export {
  definePlatformFactory,
  getPlatformConfig,
  PlatformAdapter,
  splitText,
  isMultiAgentCapable,
} from './platform.js';

export type {
  DocumentInput,
  ImageInput,
  AgentContextLike,
  MultiAgentCapable,
  IrisBackendLike,
  IrisModeInfoLike,
  IrisModelInfoLike,
  IrisPlatformFactoryContextLike,
  IrisSessionMetaLike,
  IrisSkillInfoLike,
  IrisToolInvocationLike,
  PlatformFactoryHelperOptions,
  ToolAttachment,
} from './platform.js';

export type {
  Content,
  FunctionCallPart,
  FunctionResponsePart,
  InlineDataPart,
  Part,
  Role,
  TextPart,
  TokensDetail,
  UsageMetadata,
} from './message.js';

export {
  isTextPart,
  isThoughtTextPart,
  isVisibleTextPart,
  isInlineDataPart,
  isFunctionCallPart,
  isFunctionResponsePart,
  extractText,
} from './message.js';

export type {
  LLMGenerationConfig,
  LLMRequest,
  LLMResponse,
  LLMStreamChunk,
} from './llm.js';

export type {
  ModeDefinition,
  ToolFilter,
} from './mode.js';

export type {
  FunctionDeclaration,
  ToolDefinition,
  ToolHandler,
  ToolInvocation,
  ToolParallelPolicy,
  ToolParallelResolver,
  ToolStatus,
} from './tool.js';

export {
  createExtensionLogger,
} from './logger.js';

export type {
  ExtensionLogger,
} from './logger.js';

export {
  createPluginLogger,
  definePlugin,
} from './plugin.js';

export {
  LogLevel,
} from './plugin.js';

export type {
  AgentDefinitionLike,
  AgentManagerLike,
  BootstrapExtensionRegistryLike,
  ConfigManagerLike,
  DeleteCodeEntryLike,
  ExtensionManagerLike,
  InlinePluginEntry,
  InsertEntryLike,
  IrisAPI,
  IrisPlugin,
  LLMProviderFactory,
  LLMRouterLike,
  MCPManagerLike,
  MCPServerInfoLike,
  MemoryFactory,
  ModelCatalogResultLike,
  ModeRegistryLike,
  NamedFactoryRegistryLike,
  OCRFactory,
  ParsedUnifiedDiffLike,
  PatchDisposer,
  PatchMethod,
  PatchPrototype,
  PlatformFactory,
  PluginContext,
  PluginEntry,
  PluginEventBusLike,
  PluginHook,
  PluginLogger,
  PluginManagerLike,
  PreBootstrapContext,
  PromptAssemblerLike,
  SessionInfoLike,
  StorageFactory,
  StorageLike,
  ToolExecInterception,
  ToolPreviewUtilsLike,
  ToolRegistryLike,
  ToolWrapper,
  UnifiedDiffHunkLike,
  UnifiedDiffLineLike,
  WebPanelDefinition,
  WriteEntryLike,
} from './plugin.js';

export {
  resolveDefaultDataDir,
} from './runtime-paths.js';

export {
  PairingGuard,
  PairingStore,
  generatePairingCode,
} from './pairing/index.js';

export type {
  AllowedUser,
  PairingAdmin,
  PairingCheckResult,
  PairingConfig,
  PendingPairing,
} from './pairing/index.js';
