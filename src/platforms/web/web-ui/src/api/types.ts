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
}

/** 一条完整消息 */
export interface Message {
  role: 'user' | 'model'
  parts: MessagePart[]
  meta?: MessageMeta
  /** 前端记录的消息时间戳（毫秒） */
  timestamp?: number
}

/** 会话摘要 */
export interface SessionSummary {
  id: string
  title: string
  cwd?: string
  createdAt?: string
  updatedAt?: string
}

/** 系统状态 */
export interface StatusInfo {
  provider: string
  model: string
  tools: string[]
  stream: boolean
  authProtected?: boolean
  managementProtected?: boolean
  platform: string
  contextWindow?: number
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
  candidatesTokenCount?: number
  totalTokenCount?: number
}

/** 聊天输入区快捷建议 */
export interface ChatSuggestion {
  label: string
  text: string
}

/** 快捷建议响应 */
export interface ChatSuggestionsResponse {
  suggestions: ChatSuggestion[]
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
  onUsage?: (usage: UsageMetadata) => void
  onRetry?: (attempt: number, maxRetries: number, error: string) => void
}
