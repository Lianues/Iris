/**
 * Console 设置中心的数据模型与控制器
 */

import { Backend } from '../../core/backend';
import { DEFAULTS, parseLLMConfig } from '../../config/llm';
import { parseSystemConfig } from '../../config/system';
import { parseToolsConfig } from '../../config/tools';
import { isMasked, readEditableConfig, updateEditableConfig } from '../../config/manage';
import { applyRuntimeConfigReload } from '../../config/runtime';
import { MCPManager, MCPServerInfo } from '../../mcp';
import { supportsConsoleDiffApprovalViewSetting } from './diff-approval';
import type { BootstrapExtensionRegistry } from '../../bootstrap/extensions';

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
  };
  toolPolicies: ConsoleToolPolicySettings[];
  mcpServers: ConsoleMCPServerSettings[];
  mcpStatus: MCPServerInfo[];
  mcpOriginalNames: string[];
}

export interface ConsoleSettingsSaveResult {
  ok: boolean;
  restartRequired: boolean;
  message: string;
  snapshot?: ConsoleSettingsSnapshot;
}

interface ConsoleSettingsControllerOptions {
  backend: Backend;
  configDir: string;
  dataDir?: string;
  getMCPManager(): MCPManager | undefined;
  setMCPManager(manager?: MCPManager): void;
  extensions?: Pick<BootstrapExtensionRegistry, 'llmProviders' | 'ocrProviders'>;
}

function normalizeTransport(value: unknown): ConsoleMCPTransport {
  if (value === 'sse' || value === 'streamable-http') return value;
  if (value === 'http') return 'streamable-http';
  return 'stdio';
}

function sanitizeServerName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, '_');
}

export function createEmptyModel(provider: ConsoleLLMProvider = 'gemini', modelName: string = ''): ConsoleModelSettings {
  const defaults = DEFAULTS[provider] ?? DEFAULTS.gemini;
  return {
    modelName,
    provider,
    apiKey: '',
    modelId: defaults.model ?? '',
    baseUrl: defaults.baseUrl ?? '',
  };
}

export function applyModelProviderChange(
  model: ConsoleModelSettings,
  nextProvider: ConsoleLLMProvider,
): ConsoleModelSettings {
  const oldDefaults = DEFAULTS[model.provider] ?? {};
  const newDefaults = DEFAULTS[nextProvider] ?? {};

  return {
    ...model,
    provider: nextProvider,
    apiKey: model.apiKey.startsWith('****') ? '' : model.apiKey,
    modelId: !model.modelId || model.modelId === oldDefaults.model
      ? newDefaults.model ?? model.modelId
      : model.modelId,
    baseUrl: !model.baseUrl || model.baseUrl === oldDefaults.baseUrl
      ? newDefaults.baseUrl ?? model.baseUrl
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
  };

  if (model.apiKey && !model.apiKey.startsWith('****')) {
    payload.apiKey = model.apiKey;
  }

  return payload;
}

function validateSnapshot(snapshot: ConsoleSettingsSnapshot): string | null {
  if (!Number.isFinite(snapshot.system.maxToolRounds) || snapshot.system.maxToolRounds < 1 || snapshot.system.maxToolRounds > 2000) {
    return '工具最大轮次必须在 1 到 2000 之间';
  }

  if (!Number.isFinite(snapshot.system.maxRetries) || snapshot.system.maxRetries < 0 || snapshot.system.maxRetries > 20) {
    return '最大重试次数必须在 0 到 20 之间';
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
      if (server.authHeader.trim() && !isMasked(server.authHeader.trim())) {
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
  private backend: Backend;
  private configDir: string;
  private dataDir?: string;
  private getMCPManager: () => MCPManager | undefined;
  private setMCPManager: (manager?: MCPManager) => void;
  private extensions?: Pick<BootstrapExtensionRegistry, 'llmProviders' | 'ocrProviders'>;

  constructor(options: ConsoleSettingsControllerOptions) {
    this.backend = options.backend;
    this.configDir = options.configDir;
    this.dataDir = options.dataDir;
    this.getMCPManager = options.getMCPManager;
    this.setMCPManager = options.setMCPManager;
    this.extensions = options.extensions;
  }

  async loadSnapshot(): Promise<ConsoleSettingsSnapshot> {
    const data = readEditableConfig(this.configDir);
    const llm = parseLLMConfig(data.llm);
    const system = parseSystemConfig(data.system);
    const toolsConfig = parseToolsConfig(data.tools);
    const registeredToolNames = this.backend.getToolNames();
    const configuredToolNames = Object.keys(toolsConfig.permissions);
    const allToolNames = Array.from(new Set([...registeredToolNames, ...configuredToolNames])).sort((a, b) => a.localeCompare(b, 'zh-CN'));
    const rawMcpServers = data.mcp?.servers && typeof data.mcp.servers === 'object'
      ? data.mcp.servers as Record<string, any>
      : {};

    return {
      models: llm.models.map(model => ({
        modelName: model.modelName,
        originalModelName: model.modelName,
        provider: model.provider,
        apiKey: model.apiKey,
        modelId: model.model,
        baseUrl: model.baseUrl,
      })),
      modelOriginalNames: llm.models.map(model => model.modelName),
      defaultModelName: llm.defaultModelName,
      system: {
        systemPrompt: system.systemPrompt,
        maxToolRounds: system.maxToolRounds,
        stream: system.stream,
        retryOnError: system.retryOnError,
        maxRetries: system.maxRetries,
      },
      toolPolicies: allToolNames.map(name => ({
        name,
        configured: Object.prototype.hasOwnProperty.call(toolsConfig.permissions, name),
        autoApprove: toolsConfig.permissions[name]?.autoApprove === true,
        registered: registeredToolNames.includes(name),
        showApprovalView: supportsConsoleDiffApprovalViewSetting(name)
          ? toolsConfig.permissions[name]?.showApprovalView !== false
          : toolsConfig.permissions[name]?.showApprovalView,
        allowPatterns: toolsConfig.permissions[name]?.allowPatterns,
        denyPatterns: toolsConfig.permissions[name]?.denyPatterns,
      })),
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
      mcpStatus: this.getMCPManager()?.getServerInfo() ?? [],
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
      },
      tools: draft.toolPolicies.reduce((result: Record<string, Record<string, unknown>>, tool) => {
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
      mcp: buildMCPPayload(draft),
    };

    let mergedRaw: any;
    try {
      ({ mergedRaw } = updateEditableConfig(this.configDir, updates));
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
      await applyRuntimeConfigReload(
        {
          backend: this.backend,
          getMCPManager: this.getMCPManager,
          dataDir: this.dataDir,
          setMCPManager: this.setMCPManager,
          extensions: this.extensions,
        },
        mergedRaw,
      );
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
