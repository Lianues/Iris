import type { Content } from './message.js';

export type ImageInput = {
  mimeType: string;
  data: string;
};

export type DocumentInput = {
  fileName: string;
  mimeType: string;
  data: string;
};

export interface ToolAttachment {
  type: string;
  mimeType?: string;
  data: Buffer;
  caption?: string;
  fileName?: string;
  /** @deprecated 请使用 fileName */
  filename?: string;
  [key: string]: unknown;
}

export interface IrisModelInfoLike {
  current?: boolean;
  modelName: string;
  modelId: string;
  provider?: string;
  contextWindow?: number;
  supportsVision?: boolean;
}

export interface IrisModeInfoLike {
  name: string;
  description?: string;
  current?: boolean;
}

export interface IrisSkillInfoLike {
  name: string;
  description?: string;
  path: string;
}

export interface IrisSessionMetaLike {
  id: string;
  title?: string;
  updatedAt?: string | number | Date;
  cwd?: string;
  createdAt?: string | number | Date;
  platforms?: string[];
}

export interface IrisToolInvocationLike {
  id: string;
  toolName: string;
  status: string;
  args: Record<string, unknown>;
  createdAt: number;
}

export interface IrisBackendLike {
  on(event: string, listener: (...args: any[]) => void): this;
  once?(event: string, listener: (...args: any[]) => void): this;
  off?(event: string, listener: (...args: any[]) => void): this;
  chat(
    sessionId: string,
    text: string,
    images?: ImageInput[],
    documents?: DocumentInput[],
    platform?: string,
  ): Promise<unknown>;
  isStreamEnabled(): boolean;
  approveTool?(id: string, approved: boolean): void;
  clearSession?(sessionId: string): Promise<void>;
  switchModel?(modelName: string, platform?: string): { modelName: string; modelId: string };
  listModels?(): IrisModelInfoLike[];
  listSessionMetas?(): Promise<IrisSessionMetaLike[]>;
  abortChat?(sessionId: string): void;
  undo?(sessionId: string, scope?: string): Promise<{ assistantText?: string } | null>;
  redo?(sessionId: string): Promise<{ assistantText?: string } | null>;
  listSkills?(): IrisSkillInfoLike[];
  listModes?(): IrisModeInfoLike[];
  switchMode?(modeName: string): boolean;
  clearRedo?(sessionId: string): void;
  applyTool?(toolId: string, applied: boolean): void;
  getHistory?(sessionId: string): Promise<Content[]>;
  runCommand?(cmd: string): unknown;
  summarize?(sessionId: string): Promise<unknown>;
  resetConfigToDefaults?(): unknown;
  getToolNames?(): string[];
}

export interface IrisPlatformFactoryContextLike {
  backend: IrisBackendLike;
  config?: {
    platform?: Record<string, unknown>;
    [key: string]: unknown;
  };
  configDir?: string;
  agentName?: string;
  initWarnings?: string[];
  eventBus?: unknown;
  [key: string]: unknown;
}

export function getPlatformConfig<T extends Record<string, unknown>>(
  context: IrisPlatformFactoryContextLike,
  platformName: string,
): Partial<T> {
  const platform = context.config?.platform;
  if (!platform || typeof platform !== 'object') {
    return {};
  }

  const value = platform[platformName];
  if (!value || typeof value !== 'object') {
    return {};
  }

  return value as Partial<T>;
}

export interface PlatformFactoryHelperOptions<TConfig extends Record<string, unknown>, TPlatform> {
  platformName: string;
  resolveConfig: (raw: Partial<TConfig>, context: IrisPlatformFactoryContextLike) => TConfig;
  create: (
    backend: IrisBackendLike,
    config: TConfig,
    context: IrisPlatformFactoryContextLike,
  ) => Promise<TPlatform> | TPlatform;
}

export function definePlatformFactory<TConfig extends Record<string, unknown>, TPlatform>(
  options: PlatformFactoryHelperOptions<TConfig, TPlatform>,
): (context: IrisPlatformFactoryContextLike) => Promise<TPlatform> {
  return async (context: IrisPlatformFactoryContextLike): Promise<TPlatform> => {
    const raw = getPlatformConfig<TConfig>(context, options.platformName);
    const config = options.resolveConfig(raw, context);
    return await options.create(context.backend, config, context);
  };
}

/** 将文本按最大长度分段，优先在换行处切分 */
export function splitText(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];

  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }
    let splitAt = remaining.lastIndexOf('\n', maxLen);
    if (splitAt <= 0) splitAt = maxLen;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).replace(/^\n/, '');
  }
  return chunks;
}

export abstract class PlatformAdapter {
  abstract start(): Promise<void>;
  abstract stop(): Promise<void>;

  get name(): string {
    return this.constructor.name;
  }
}


// ── Multi-Agent 支持 ──

/** Agent 上下文（由核心层创建，传递给支持多 Agent 的平台） */
export interface AgentContextLike {
  name: string;
  description?: string;
  backend: IrisBackendLike;
  config: Record<string, unknown>;
  getMCPManager?: () => unknown;
  setMCPManager?: (mgr?: unknown) => void;
  dataDir?: string;
  extensions?: Record<string, unknown>;
}

/**
 * 支持多 Agent 管理的平台适配器接口。
 * 核心层在多 Agent 模式下，检测平台是否实现此接口来决定共享策略。
 */
export interface MultiAgentCapable {
  /** 添加 Agent 上下文 */
  addAgent(name: string, backend: IrisBackendLike, config: Record<string, unknown>, description?: string, getMCPManager?: () => unknown, setMCPManager?: (mgr?: unknown) => void, extensions?: Record<string, unknown>): void;
  /** 热重载 Agent 列表 */
  reloadAgents?(): Promise<unknown>;
  /** 设置 Agent 热重载回调 */
  setReloadHandler?(handler: (...args: unknown[]) => Promise<unknown>): void;
  /** 设置平台配置热重载回调 */
  setPlatformReloadHandler?(handler: (...args: unknown[]) => Promise<void>): void;
  /** 注册外部路由到此平台的 HTTP 服务器 */
  registerRoute?(method: string, path: string, handler: (...args: unknown[]) => Promise<void>): void;
  /** 获取 MCP 管理器 */
  getMCPManager?(agentName?: string): unknown;
}

/** 检测平台是否实现了 MultiAgentCapable 接口 */
export function isMultiAgentCapable(platform: PlatformAdapter): platform is PlatformAdapter & MultiAgentCapable {
  return typeof (platform as any).addAgent === 'function';
}
