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

/** 消息内容部分 */
export interface MessagePart {
  type: 'text' | 'image' | 'document' | 'function_call' | 'function_response'
  text?: string
  mimeType?: string
  data?: string
  fileName?: string
  name?: string
  args?: unknown
  response?: unknown
}

/** 一条完整消息 */
export interface Message {
  role: 'user' | 'model'
  parts: MessagePart[]
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
  onDelta?: (text: string) => void
  onMessage?: (text: string) => void
  onStreamEnd?: () => void
  onDone?: () => void
  onError?: (message: string) => void
  onSessionId?: (id: string) => void
}
