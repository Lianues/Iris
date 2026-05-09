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
  BackendHandle,
  isForegroundPlatform,
  isRoutableHttpPlatform,
  PlatformAdapter,
  splitText,
  isMultiAgentCapable,
} from './platform.js';

export type {
  AgentTaskInfoLike,
  DocumentInput,
  ImageInput,
  AgentContextLike,
  MultiAgentCapable,
  IrisBackendLike,
  ForegroundPlatform,
  RoutableHttpPlatform,
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
  AudioInput,
  ExtractedDocument,
  ImageResizeOptions,
  MediaServiceLike,
  OCRProviderLike,
  ResizedImage,
  VideoInput,
} from './media.js';

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

export {
  DELIVERY_REGISTRY_SERVICE_ID,
} from './delivery.js';

export type {
  DeliveryAttachmentInput,
  DeliveryBinding,
  DeliveryBindingAttachmentInput,
  DeliveryBindingTextInput,
  DeliveryActivityInput,
  DeliveryCapabilities,
  DeliveryPolicy,
  DeliveryPolicyDecision,
  DeliveryPolicyEvaluateInput,
  DeliveryProviderInfo,
  DeliveryProviderAttachmentInput,
  DeliveryProviderTextInput,
  DeliveryQuietHoursPolicy,
  DeliveryQuietHoursWindow,
  DeliveryRegistryService,
  DeliveryRecentTarget,
  DeliveryRecentTargetFilter,
  DeliveryRecentActivityPolicy,
  DeliveryResult,
  DeliverySendRecord,
  DeliverySendRecordFilter,
  DeliveryTarget,
  DeliveryTargetKind,
  DeliveryTextInput,
  PlatformDeliveryProvider,
} from './delivery.js';

export {
  SCHEDULER_SERVICE_ID,
} from './scheduler.js';

export type {
  SchedulerCreateJobInput,
  SchedulerDeliveryConfig,
  SchedulerJob,
  SchedulerJobFilter,
  SchedulerScheduleConfig,
  SchedulerService,
  SchedulerUpdateJobInput,
} from './scheduler.js';

export {
  ENVIRONMENT_CONTEXT_SERVICE_ID,
  WEATHER_SERVICE_ID,
} from './environment.js';

export type {
  EnvironmentContextInput,
  EnvironmentContextResult,
  EnvironmentContextService,
  WeatherQueryInput,
  WeatherResult,
  WeatherService,
} from './environment.js';

export type {
  FunctionDeclaration,
  ToolDefinition,
  ToolExecutionHandleLike,
  ToolOutputEntry,
  ToolExecutionContext,
  ToolHandler,
  ToolInvocation,
  ToolApprovalMode,
  ToolParallelPolicy,
  ToolParallelResolver,
  ToolStatus,
} from './tool.js';

export {
  createExtensionLogger,
  setExtensionLogLevel,
  getExtensionLogLevel,
  LogLevel,
} from './logger.js';

export type {
  ExtensionLogger,
} from './logger.js';

export {
  createPluginLogger,
  definePlugin,
} from './plugin.js';

export type {
  AgentDefinitionLike,
  AgentManagerLike,
  AgentNetworkLike,
  BootstrapExtensionRegistryLike,
  ConfigManagerLike,
  RawEditableConfig,
  ConfigContribution,
  ConfigContributionRegistryLike,
  ConfigFieldSchema,
  DeleteCodeEntryLike,
  Disposable,
  ExtensionManagerLike,
  GlobalStoreLike,
  InlinePluginEntry,
  InsertEntryLike,
  IrisAPI,
  AppConfigLike,
  IrisPlugin,
  ToolLoopRunnerLike,
  LLMProviderFactory,
  LLMRouterLike,
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
  PluginInfoLike,
  PluginLogger,
  PluginManagerLike,
  PreBootstrapContext,
  PromptAssemblerLike,
  ServiceDescriptor,
  ServiceRegistryLike,
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
  ConsoleSettingsField,
  ConsoleSettingsTabDefinition,
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


export {
  autoApproveHandle,
  detectImageMime,
  formatToolStatusLine,
  TOOL_STATUS_ICONS,
  TOOL_STATUS_LABELS,
} from './platform-utils.js';

export type {
  ToolInvocationInfo,
} from './platform-utils.js';
