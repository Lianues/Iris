/** 图片输入 */
export interface ImageInput {
  mimeType: string
  data: string
}

/** 文档输入 */
export interface DocumentInput {
  fileName: string
  mimeType: string
  data: string
}

/** 前端上传中的图片附件 */
export interface ChatImageAttachment {
  mimeType: string
  data?: string
  file?: File
  fileName?: string
  previewUrl?: string
  size?: number
}

/** 前端上传中的文档附件 */
export interface ChatDocumentAttachment {
  fileName: string
  mimeType: string
  data?: string
  file?: File
  size?: number
}

/** 消息内容部分 */
export interface MessagePart {
  type: 'text' | 'thought' | 'image' | 'document' | 'function_call' | 'function_response'
  text?: string
  durationMs?: number
  mimeType?: string
  data?: string
  file?: File
  fileName?: string
  previewUrl?: string
  size?: number
  name?: string
  args?: unknown
  response?: unknown
  callId?: string
}

/** 消息性能元数据 */
export interface MessageMeta {
  tokenIn?: number
  tokenOut?: number
  durationMs?: number
  streamOutputDurationMs?: number
  modelName?: string
  isError?: boolean
}

/** 一条完整消息 */
export interface Message {
  role: 'user' | 'model'
  parts: MessagePart[]
  meta?: MessageMeta
  /** 前端记录的消息时间戳（毫秒） */
  timestamp?: number
  /** 如果此消息由异步子代理 notification turn 触发 */
  notificationSource?: {
    taskId: string
    description: string
  }
}

/** 会话摘要 */
export interface SessionSummary {
  id: string
  title: string
  cwd?: string
  createdAt?: string
  updatedAt?: string
}

/** MCP 客户端连接状态 */
export type MCPClientStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

/** MCP 服务器运行时信息 */
export interface MCPServerInfo {
  name: string
  status: MCPClientStatus
  toolCount: number
  error?: string
}

/** 运行环境信息 */
export interface RuntimeInfo {
  projectRoot: string
  dataDir: string
  configDir: string
  isCompiledBinary: boolean
  configSource: 'template' | 'embedded'
}

/** 系统状态 */
export interface StatusInfo {
  provider: string
  model: string
  tools: string[]
  disabledTools?: string[]
  stream: boolean
  authProtected?: boolean
  managementProtected?: boolean
  platform: string
  contextWindow?: number
  mcpStatus?: MCPServerInfo[]
  runtime?: RuntimeInfo
}

// ============ 工具审批 ============

/** 工具调用状态 */
export type ToolStatus =
  | 'pending'
  | 'running'
  | 'awaiting_approval'
  | 'awaiting_apply'
  | 'approved'
  | 'rejected'
  | 'applied'
  | 'skipped'
  | 'completed'
  | 'error'

/** 工具调用记录 */
export interface ToolInvocation {
  id: string
  toolName: string
  args: Record<string, unknown>
  status: ToolStatus
  result?: unknown
  error?: string
  createdAt: number
  updatedAt: number
}

/** 模型用量元数据 */
export interface UsageMetadata {
  promptTokenCount?: number
  cachedContentTokenCount?: number
  candidatesTokenCount?: number
  totalTokenCount?: number
}

/** 设置中心模型候选项 */
export interface ConfigModelOption {
  id: string
  label: string
}

/** 设置中心模型列表响应 */
export interface ConfigModelListResponse {
  provider: string
  baseUrl: string
  usedStoredApiKey: boolean
  models: ConfigModelOption[]
}

/** Cloudflare token 来源 */
export type CloudflareTokenSource = 'inline' | 'env' | 'file'

/** Cloudflare SSL 模式 */
export type CloudflareSslMode = 'off' | 'flexible' | 'full' | 'strict' | 'unknown'

/** Cloudflare zone 摘要 */
export interface CloudflareZoneInfo {
  id: string
  name: string
  status: string
}

/** 部署联动场景中的 Cloudflare 上下文 */
export interface CloudflareDeployContext {
  configured: boolean
  connected: boolean
  zoneId: string | null
  zoneName: string | null
  sslMode: CloudflareSslMode | null
  domain: string | null
  domainRecordProxied: boolean | null
  tokenSource?: CloudflareTokenSource | null
  error?: string
}

/** 部署环境检测结果 */
export interface DetectResponse {
  isLinux: boolean
  isLocal?: boolean
  nginx: {
    installed: boolean
    version: string
    configDir: string
    existingConfig: boolean
  }
  systemd: {
    available: boolean
    existingService: boolean
    serviceStatus: string
  }
  sudo: {
    available: boolean
    noPassword: boolean
  }
}

/** 部署页表单选项 */
export interface DeployFormOptions {
  domain: string
  port: number
  deployPath: string
  user: string
  enableHttps: boolean
  enableAuth: boolean
}

/** 部署页面初始化状态 */
export interface DeployStateResponse {
  web: {
    host: string
    port: number
  }
  defaults: DeployFormOptions
  cloudflare: CloudflareDeployContext | null
}

/** 统一部署预览结果 */
export interface DeployPreviewResponse {
  options: DeployFormOptions
  nginxConfig: string
  serviceConfig: string
  warnings: string[]
  errors: string[]
  recommendations: string[]
  cloudflare: CloudflareDeployContext | null
}

/** 部署步骤结果 */
export interface DeployStep {
  name: string
  success: boolean
  output: string
}

/** 部署操作响应 */
export interface DeployResponse {
  ok: boolean
  steps: DeployStep[]
  error?: string
}

/** 部署后 Cloudflare 同步响应 */
export interface DeploySyncCloudflareResponse {
  ok: boolean
  mode?: CloudflareSslMode
  error?: string
}

// ============ Cloudflare ============

export interface CfStatusResponse {
  configured: boolean
  connected: boolean
  zones: CloudflareZoneInfo[]
  activeZoneId: string | null
  activeZoneName: string | null
  sslMode: CloudflareSslMode | null
  tokenSource?: CloudflareTokenSource | null
  error?: string
}

export interface CfDnsRecord {
  id: string
  type: string
  name: string
  content: string
  proxied: boolean
  ttl: number
}

export interface CfDnsInput {
  type: string
  name: string
  content: string
  proxied?: boolean
  ttl?: number
}

export interface CfSetupResponse {
  ok: boolean
  error?: string
  zones: { id: string; name: string }[]
}

/** SSE 聊天回调 */
export interface ChatCallbacks {
  onStreamStart?: () => void
  onDelta?: (text: string) => void
  onThoughtDelta?: (text: string, durationMs?: number) => void
  onMessage?: (text: string) => void
  onStreamEnd?: () => void
  onDone?: () => void
  onDoneMeta?: (durationMs: number) => void
  onError?: (message: string) => void
  onSessionId?: (id: string) => void
  onAssistantContent?: (message: Message) => void
  onToolUpdate?: (invocations: ToolInvocation[]) => void
  /** 工具调用开始（tool_start 事件） */
  onToolStart?: (tool: { toolId: string; name: string; args: Record<string, unknown> }) => void
  /** 工具执行状态变更（tool_state 事件） */
  onToolState?: (toolId: string, status: string, prev: string, snapshot: Record<string, unknown>) => void
  /** 工具输出条目（tool_output 事件） */
  onToolOutput?: (toolId: string, entry: Record<string, unknown>) => void
  /** 工具进度更新（tool_progress 事件） */
  onToolProgress?: (toolId: string, data: Record<string, unknown>) => void
  onUsage?: (usage: UsageMetadata) => void
  onRetry?: (attempt: number, maxRetries: number, error: string) => void
  onAutoCompact?: (summary: string) => void
  onUserToken?: (tokenCount: number) => void
  /** 异步子代理任务状态变更（registered/completed/failed/killed） */
  onAgentNotification?: (taskId: string, status: string, summary: string) => void
  /** Turn 开始（可区分 chat 和 task-notification turn） */
  onTurnStart?: (turnId: string, mode: 'chat' | 'task-notification') => void
}

/** 异步子代理任务信息 */
export interface AgentTaskInfo {
  taskId: string
  sessionId: string
  description: string
  status: 'running' | 'completed' | 'failed' | 'killed'
  startTime: number
  endTime?: number
}

/** 通知 WebSocket 回调 */
export interface NotificationCallbacks {
  onAgentNotification?: (sessionId: string, taskId: string, status: string, summary: string) => void
  onTurnStart?: (sessionId: string, turnId: string, mode: 'chat' | 'task-notification') => void
  /** 通过 WS 接收的标准聊天事件（SSE 不可用时的 fallback） */
  onChatEvent?: (sessionId: string, event: Record<string, unknown>) => void
}


// ============ 扩展管理 ============

/** 平台配置面板字段声明 */
export interface PanelFieldDefinition {
  key: string
  configKey: string
  type: 'string' | 'password' | 'number'
  label: string
  description?: string
  placeholder?: string
  example?: string
  defaultValue?: string | number
  required?: boolean
}

/** 可用平台选项（内置 + 扩展贡献） */
export interface PlatformOption {
  value: string
  label: string
  desc: string
  source: 'builtin' | 'extension'
  panelTitle?: string
  panelDescription?: string
  panelFields: PanelFieldDefinition[]
}

/** 扩展摘要（列表项） */
export interface ExtensionSummary {
  name: string
  version: string
  description: string
  typeLabel: string
  hasPlugin: boolean
  hasPlatforms: boolean
  platformCount: number
  distributionMode: 'bundled' | 'source'
  distributionLabel: string
  installed: boolean
  enabled: boolean
  stateLabel: string
  localSource?: 'installed' | 'embedded'
  localVersion?: string
  localVersionHint?: string
  requestedPath?: string
}
