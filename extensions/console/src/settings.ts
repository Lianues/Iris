/**
 * Console 设置中心的数据模型与控制器
 *
 * 当前已覆盖的配置项：
 *   llm.yaml    — defaultModel, models.*.{provider, model, apiKey, baseUrl}
 *   system.yaml — systemPrompt, maxToolRounds, stream, retryOnError, maxRetries,
 *                 logRequests, maxAgentDepth, defaultMode, asyncSubAgents
 *   tools.yaml  — autoApproveAll, autoApproveConfirmation, autoApproveDiff,
 *                 按工具的 autoApprove / showApprovalView（allowPatterns/denyPatterns 仅透传）
 *   mcp.yaml    — servers.*.{name, enabled, transport, command, args, cwd, url, headers.Authorization, timeout}
 *
 * TODO: 以下配置项尚未加入 settings 界面，按优先级排列：
 *
 *  ▸ llm.yaml 模型高级字段
 *     - models.*.contextWindow          上下文窗口大小
 *     - models.*.supportsVision         是否支持图片输入
 *     - models.*.autoSummaryThreshold   自动上下文压缩阈值
 *     - models.*.requestBody            自定义请求体（temperature, maxOutputTokens 等）
 *     - models.*.headers                自定义请求头
 *     - models.*.promptCaching          Claude Prompt Caching 开关
 *     - models.*.autoCaching            Claude 自动缓存
 *     - summaryModel                    /compact 压缩用的模型
 *     - rememberPlatformModel           记住各平台上次使用的模型
 *
 *  ▸ tools.yaml 高级配置
 *     - shell.allowPatterns / denyPatterns  Shell 白名单/黑名单（数据模型已透传，缺编辑 UI）
 *     - disabledTools                   禁用工具列表
 *     - limits.*                        各工具防御性参数（maxFiles, maxResults 等）
 *
 *  ▸ system.yaml 高级配置
 *     - skills                          Skill 定义（内联提示词模块，结构较复杂）
 *
 *  ▸ 完全未覆盖的配置文件（需新增 section）
 *     - platform.yaml                   平台类型与各平台参数（console/discord/telegram/web/...）
 *     - modes.yaml                      自定义模式（description, systemPrompt, tools include/exclude）
 *     - sub_agents.yaml                 子代理类型定义（enabled, stream, types.* 各项参数）
 *     - summary.yaml                    上下文压缩提示词（systemPrompt, userPrompt）
 *     - storage.yaml                    存储类型与路径（type, dir, dbPath）
 *     - ocr.yaml                        OCR 配置（provider, apiKey, baseUrl, model）
 *     - plugins.yaml                    插件列表（name, type, enabled, priority, config）
 */

import type {
  IrisBackendLike,
  ConfigManagerLike,
  MCPManagerLike,
  MCPServerInfoLike,
  BootstrapExtensionRegistryLike,
} from 'irises-extension-sdk';
import { supportsConsoleDiffApprovalViewSetting } from './diff-approval';

export const CONSOLE_LLM_PROVIDER_OPTIONS = [
  'gemini',
  'openai-compatible',
  'openai-responses',
  'claude',
] as const;

export const CONSOLE_MCP_TRANSPORT_OPTIONS = [
  'stdio',
  'sse',
  'streamable-http',
] as const;

export type ConsoleLLMProvider = typeof CONSOLE_LLM_PROVIDER_OPTIONS[number];
export type ConsoleMCPTransport = typeof CONSOLE_MCP_TRANSPORT_OPTIONS[number];

export interface ConsoleModelSettings {
  modelName: string;
  originalModelName?: string;
  provider: string;
  apiKey: string;
  /** 提供商真实模型 ID，对应 LLMConfig.model */
  modelId: string;
  contextWindow?: number;
  baseUrl: string;
}

export interface ConsoleToolPolicySettings {
  name: string;
  configured: boolean;
  autoApprove: boolean;
  registered: boolean;
  /** 支持 diff 预览的工具：审批时是否打开专门视图 */
  showApprovalView?: boolean;
  /** Shell 工具专用：白名单模式（透传保存） */
  allowPatterns?: string[];
  /** Shell 工具专用：黑名单模式（透传保存） */
  denyPatterns?: string[];
}

export interface ConsoleMCPServerSettings {
  name: string;
  originalName?: string;
  transport: ConsoleMCPTransport;
  command: string;
  args: string;
  cwd: string;
  url: string;
  authHeader: string;
  timeout: number;
  enabled: boolean;
}

export interface ConsoleSettingsSnapshot {
  models: ConsoleModelSettings[];
  modelOriginalNames: string[];
  defaultModelName: string;
  system: {
    systemPrompt: string;
    maxToolRounds: number;
    stream: boolean;
    retryOnError: boolean;
    maxRetries: number;
    logRequests: boolean;
    maxAgentDepth: number;
    defaultMode: string;
    asyncSubAgents: boolean;
  };
  toolPolicies: ConsoleToolPolicySettings[];
  autoApproveAll: boolean;
  autoApproveConfirmation: boolean;
  autoApproveDiff: boolean;
  mcpServers: ConsoleMCPServerSettings[];
  mcpStatus: MCPServerInfoLike[];
  mcpOriginalNames: string[];
}

export interface ConsoleSettingsSaveResult {
  ok: boolean;
  restartRequired: boolean;
  message: string;
  snapshot?: ConsoleSettingsSnapshot;
}

interface ConsoleSettingsControllerOptions {
  backend: IrisBackendLike;
  configManager?: ConfigManagerLike;
  mcpManager?: MCPManagerLike;
  extensions?: Pick<BootstrapExtensionRegistryLike, 'llmProviders' | 'ocrProviders'>;
}

function normalizeTransport(value: unknown): ConsoleMCPTransport {
  if (value === 'sse' || value === 'streamable-http') return value;
  if (value === 'http') return 'streamable-http';
  return 'stdio';
}

function sanitizeServerName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, '_');
}

export function createEmptyModel(
  provider: ConsoleLLMProvider = 'gemini',
  modelName: string = '',
  defaults: Record<string, Record<string, unknown>> = {},
): ConsoleModelSettings {
  const providerDefaults = defaults[provider] ?? defaults.gemini ?? {};
  return {
    modelName,
    provider,
    apiKey: '',
    modelId: (providerDefaults.model as string) ?? '',
    contextWindow: typeof providerDefaults.contextWindow === 'number' ? providerDefaults.contextWindow : undefined,
    baseUrl: (providerDefaults.baseUrl as string) ?? '',
  };
}

export function applyModelProviderChange(
  model: ConsoleModelSettings,
  nextProvider: ConsoleLLMProvider,
  defaults: Record<string, Record<string, unknown>> = {},
): ConsoleModelSettings {
  const oldDefaults = defaults[model.provider] ?? {};
  const newDefaults = defaults[nextProvider] ?? {};

  return {
    ...model,
    provider: nextProvider,
    apiKey: model.apiKey,
    modelId: !model.modelId || model.modelId === oldDefaults.model
      ? (newDefaults.model as string) ?? model.modelId
      : model.modelId,
    baseUrl: !model.baseUrl || model.baseUrl === oldDefaults.baseUrl
      ? (newDefaults.baseUrl as string) ?? model.baseUrl
      : model.baseUrl,
  };
}

export function createDefaultMCPServerEntry(): ConsoleMCPServerSettings {
  return {
    name: '',
    transport: 'stdio',
    command: '',
    args: '',
    cwd: '',
    url: '',
    authHeader: '',
    timeout: 30000,
    enabled: true,
  };
}

export function cloneConsoleSettingsSnapshot(snapshot: ConsoleSettingsSnapshot): ConsoleSettingsSnapshot {
  return JSON.parse(JSON.stringify(snapshot)) as ConsoleSettingsSnapshot;
}

function buildModelPayload(model: ConsoleModelSettings): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    provider: model.provider,
    model: model.modelId,
    baseUrl: model.baseUrl,
    contextWindow: Number.isFinite(model.contextWindow) ? model.contextWindow : null,
  };
  payload.apiKey = model.apiKey || null;

  return payload;
}

function validateSnapshot(snapshot: ConsoleSettingsSnapshot): string | null {
  if (!Number.isFinite(snapshot.system.maxToolRounds) || snapshot.system.maxToolRounds < 1 || snapshot.system.maxToolRounds > 2000) {
    return '工具最大轮次必须在 1 到 2000 之间';
  }

  if (!Number.isFinite(snapshot.system.maxRetries) || snapshot.system.maxRetries < 0 || snapshot.system.maxRetries > 20) {
    return '最大重试次数必须在 0 到 20 之间';
  }

  if (!Number.isFinite(snapshot.system.maxAgentDepth) || snapshot.system.maxAgentDepth < 1 || snapshot.system.maxAgentDepth > 20) {
    return '最大代理深度必须在 1 到 20 之间';
  }

  if (!Array.isArray(snapshot.models) || snapshot.models.length === 0) {
    return '至少需要保留一个模型';
  }

  const modelNames = new Set<string>();
  for (const model of snapshot.models) {
    const modelName = model.modelName.trim();
    if (!modelName) {
      return '模型名称不能为空';
    }
    if (modelNames.has(modelName)) {
      return `模型名称 "${modelName}" 重复`;
    }
    if (!model.modelId.trim()) {
      return `模型 "${modelName}" 缺少模型 ID`;
    }
    if (model.contextWindow != null && (!Number.isFinite(model.contextWindow) || model.contextWindow <= 0)) {
      return `模型 "${modelName}" 的上下文窗口必须为正数`;
    }
    modelNames.add(modelName);
  }

  if (!snapshot.defaultModelName.trim()) {
    return '默认模型名称不能为空';
  }
  if (!modelNames.has(snapshot.defaultModelName.trim())) {
    return `默认模型 "${snapshot.defaultModelName}" 不存在`;
  }

  const names = new Set<string>();

  for (const server of snapshot.mcpServers) {
    const trimmedName = server.name.trim();
    const safeName = sanitizeServerName(trimmedName);

    if (!trimmedName) {
      return 'MCP 服务器名称不能为空';
    }

    if (safeName !== trimmedName) {
      return `MCP 服务器名称 "${trimmedName}" 仅支持字母、数字和下划线`;
    }

    if (names.has(trimmedName)) {
      return `MCP 服务器名称 "${trimmedName}" 重复`;
    }
    names.add(trimmedName);

    if (!Number.isFinite(server.timeout) || server.timeout < 1000 || server.timeout > 120000) {
      return `MCP 服务器 "${trimmedName}" 的超时必须在 1000 到 120000 毫秒之间`;
    }

    if (server.transport === 'stdio' && !server.command.trim()) {
      return `MCP 服务器 "${trimmedName}" 缺少 command`;
    }

    if (server.transport !== 'stdio' && !server.url.trim()) {
      return `MCP 服务器 "${trimmedName}" 缺少 url`;
    }
  }

  return null;
}

function buildLLMPayload(snapshot: ConsoleSettingsSnapshot): { defaultModel: string; models: Record<string, any> } {
  const models: Record<string, any> = {};

  for (const originalName of snapshot.modelOriginalNames) {
    if (!snapshot.models.some(model => model.modelName.trim() === originalName)) {
      models[originalName] = null;
    }
  }

  for (const model of snapshot.models) {
    const modelName = model.modelName.trim();
    if (!modelName) continue;

    if (model.originalModelName && model.originalModelName !== modelName) {
      models[model.originalModelName] = null;
    }

    models[modelName] = buildModelPayload(model);
  }

  return {
    defaultModel: snapshot.defaultModelName.trim(),
    models,
  };
}

function buildMCPPayload(snapshot: ConsoleSettingsSnapshot): { servers: Record<string, any> } | null {
  const servers: Record<string, any> = {};

  for (const originalName of snapshot.mcpOriginalNames) {
    if (!snapshot.mcpServers.some(server => server.name.trim() === originalName)) {
      servers[originalName] = null;
    }
  }

  for (const server of snapshot.mcpServers) {
    const name = sanitizeServerName(server.name.trim());
    if (!name) continue;

    if (server.originalName && server.originalName !== name) {
      servers[server.originalName] = null;
    }

    const entry: Record<string, unknown> = {
      transport: server.transport,
      enabled: server.enabled,
      timeout: server.timeout || 30000,
    };

    if (server.transport === 'stdio') {
      entry.command = server.command.trim();
      entry.args = server.args
        .split(/\r?\n/g)
        .map(arg => arg.trim())
        .filter(Boolean);
      entry.cwd = server.cwd.trim() ? server.cwd.trim() : null;
      entry.url = null;
      entry.headers = null;
    } else {
      entry.url = server.url.trim();
      entry.command = null;
      entry.args = null;
      entry.cwd = null;
      if (server.authHeader.trim()) {
        entry.headers = { Authorization: server.authHeader.trim() };
      } else if (!server.authHeader.trim()) {
        entry.headers = null;
      }
    }

    servers[name] = entry;
  }

  return Object.keys(servers).length > 0 ? { servers } : null;
}

export class ConsoleSettingsController {
  private backend: IrisBackendLike;
  private configManager?: ConfigManagerLike;
  private mcpManager?: MCPManagerLike;
  private extensions?: Pick<BootstrapExtensionRegistryLike, 'llmProviders' | 'ocrProviders'>;

  constructor(options: ConsoleSettingsControllerOptions) {
    this.backend = options.backend;
    this.configManager = options.configManager;
    this.mcpManager = options.mcpManager;
    this.extensions = options.extensions;
  }

  async loadSnapshot(): Promise<ConsoleSettingsSnapshot> {
    const data = this.configManager?.readEditableConfig() ?? {} as Record<string, unknown>;
    const llm = this.configManager?.parseLLMConfig((data as any).llm) ?? {} as any;
    const system = this.configManager?.parseSystemConfig((data as any).system) ?? {} as any;
    const toolsConfig = this.configManager?.parseToolsConfig((data as any).tools) ?? {} as any;
    const registeredToolNames = this.backend.getToolNames?.() ?? [];
    const configuredToolNames = Object.keys(toolsConfig.permissions ?? {});
    const allToolNames = Array.from(new Set([...registeredToolNames, ...configuredToolNames])).sort((a, b) => a.localeCompare(b, 'zh-CN'));
    const rawMcpServers = (data as any).mcp?.servers && typeof (data as any).mcp.servers === 'object'
      ? (data as any).mcp.servers as Record<string, any>
      : {};

    const permissions = toolsConfig.permissions ?? {};

    return {
      models: (llm.models ?? []).map((model: any) => ({
        modelName: model.modelName,
        originalModelName: model.modelName,
        provider: model.provider,
        apiKey: model.apiKey,
        modelId: model.model,
        contextWindow: model.contextWindow,
        baseUrl: model.baseUrl,
      })),
      modelOriginalNames: (llm.models ?? []).map((model: any) => model.modelName),
      defaultModelName: llm.defaultModelName ?? '',
      system: {
        systemPrompt: system.systemPrompt ?? '',
        maxToolRounds: system.maxToolRounds ?? 30,
        stream: system.stream !== false,
        retryOnError: system.retryOnError !== false,
        maxRetries: system.maxRetries ?? 3,
        logRequests: system.logRequests === true,
        maxAgentDepth: system.maxAgentDepth ?? 3,
        defaultMode: system.defaultMode ?? '',
        asyncSubAgents: system.asyncSubAgents === true,
      },
      toolPolicies: allToolNames.map(name => ({
        name,
        configured: Object.prototype.hasOwnProperty.call(permissions, name),
        autoApprove: permissions[name]?.autoApprove === true,
        registered: registeredToolNames.includes(name),
        showApprovalView: supportsConsoleDiffApprovalViewSetting(name)
          ? permissions[name]?.showApprovalView !== false
          : permissions[name]?.showApprovalView,
        allowPatterns: permissions[name]?.allowPatterns,
        denyPatterns: permissions[name]?.denyPatterns,
      })),
      autoApproveAll: toolsConfig.autoApproveAll === true,
      autoApproveConfirmation: toolsConfig.autoApproveConfirmation === true,
      autoApproveDiff: toolsConfig.autoApproveDiff === true,
      mcpServers: Object.entries(rawMcpServers).map(([name, cfg]) => ({
        name,
        originalName: name,
        transport: normalizeTransport(cfg?.transport),
        command: cfg?.command ? String(cfg.command) : '',
        args: Array.isArray(cfg?.args) ? cfg.args.map((arg: unknown) => String(arg)).join('\n') : '',
        cwd: cfg?.cwd ? String(cfg.cwd) : '',
        url: cfg?.url ? String(cfg.url) : '',
        authHeader: cfg?.headers?.Authorization ? String(cfg.headers.Authorization) : '',
        timeout: typeof cfg?.timeout === 'number' ? cfg.timeout : 30000,
        enabled: cfg?.enabled !== false,
      })),
      mcpStatus: (this.mcpManager?.listServers?.() ?? []) as MCPServerInfoLike[],
      mcpOriginalNames: Object.keys(rawMcpServers),
    };
  }

  async saveSnapshot(snapshot: ConsoleSettingsSnapshot): Promise<ConsoleSettingsSaveResult> {
    const draft = cloneConsoleSettingsSnapshot(snapshot);

    const validationError = validateSnapshot(draft);
    if (validationError) {
      return {
        ok: false,
        restartRequired: false,
        message: validationError,
      };
    }

    const updates: Record<string, any> = {
      llm: buildLLMPayload(draft),
      system: {
        systemPrompt: draft.system.systemPrompt,
        maxToolRounds: draft.system.maxToolRounds,
        stream: draft.system.stream,
        retryOnError: draft.system.retryOnError,
        maxRetries: draft.system.maxRetries,
        logRequests: draft.system.logRequests,
        maxAgentDepth: draft.system.maxAgentDepth,
        defaultMode: draft.system.defaultMode || null,
        asyncSubAgents: draft.system.asyncSubAgents,
      },
      tools: {
        autoApproveAll: draft.autoApproveAll || null,
        autoApproveConfirmation: draft.autoApproveConfirmation || null,
        autoApproveDiff: draft.autoApproveDiff || null,
        ...draft.toolPolicies.reduce((result: Record<string, Record<string, unknown>>, tool) => {
        if (!tool.configured) {
          return result;
        }
        const entry: Record<string, unknown> = { autoApprove: tool.autoApprove };
        if (typeof tool.showApprovalView === 'boolean') entry.showApprovalView = tool.showApprovalView;
        if (tool.allowPatterns?.length) entry.allowPatterns = tool.allowPatterns;
        if (tool.denyPatterns?.length) entry.denyPatterns = tool.denyPatterns;
        result[tool.name] = entry;
        return result;
        }, {}),
      },
      mcp: buildMCPPayload(draft),
    };

    let mergedRaw: any;
    try {
      ({ mergedRaw } = this.configManager?.updateEditableConfig(updates) ?? { mergedRaw: {} });
    } catch (err: unknown) {
      return {
        ok: false,
        restartRequired: false,
        message: err instanceof Error ? err.message : String(err),
      };
    }

    let restartRequired = false;
    let message = '已保存并生效';

    try {
      const result = await this.configManager?.applyRuntimeConfigReload(mergedRaw);
      if (result && !result.success) {
        restartRequired = true;
        message = `已保存，需要重启生效：${result.error ?? '未知错误'}`;
      }
    } catch (err: unknown) {
      restartRequired = true;
      const detail = err instanceof Error ? err.message : String(err);
      message = `已保存，需要重启生效：${detail}`;
    }

    try {
      const refreshed = await this.loadSnapshot();
      return {
        ok: true,
        restartRequired,
        message,
        snapshot: refreshed,
      };
    } catch (err: unknown) {
      return {
        ok: true,
        restartRequired: true,
        message: `已保存，但刷新设置视图失败：${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }
}
