/**
 * API 客户端
 *
 * 封装 REST 调用和 SSE 聊天流解析。
 */

import type {
  ImageInput, DocumentInput, Message, StatusInfo, ChatCallbacks, DetectResponse, DeployResponse, DeploySyncCloudflareResponse,
  DeployFormOptions, DeployStateResponse, DeployPreviewResponse,
  CfStatusResponse, CfDnsRecord, CfDnsInput, CfSetupResponse, SessionSummary, ConfigModelListResponse,
} from './types'
import { clearManagementToken, loadManagementToken } from '../utils/managementToken'
import { clearAuthToken, loadAuthToken } from '../utils/authToken'

interface ErrorResponseBody {
  error?: string
  code?: string
}

// ============ 通用 ============

/** 是否为管理接口 */
function isManagementRequest(url: string): boolean {
  return url === '/api/config'
    || url.startsWith('/api/config/')
    || url.startsWith('/api/deploy/')
    || url.startsWith('/api/cloudflare/')
}

/** 合并请求头 */
function mergeHeaders(...headers: Array<HeadersInit | undefined>): Record<string, string> {
  const merged: Record<string, string> = {}

  for (const item of headers) {
    if (!item) continue

    if (item instanceof Headers) {
      item.forEach((value, key) => {
        merged[key] = value
      })
      continue
    }

    if (Array.isArray(item)) {
      for (const [key, value] of item) {
        merged[key] = value
      }
      continue
    }

    for (const [key, value] of Object.entries(item)) {
      if (value !== undefined) merged[key] = String(value)
    }
  }

  return merged
}

function applyStoredTokens(url: string, headers?: HeadersInit): Record<string, string> {
  const merged = mergeHeaders(headers)

  const authToken = loadAuthToken().trim()
  if (authToken) {
    merged.Authorization = `Bearer ${authToken}`
  }

  if (isManagementRequest(url)) {
    const managementToken = loadManagementToken().trim()
    if (managementToken) {
      merged['X-Management-Token'] = managementToken
    }
  }

  return merged
}

function handleUnauthorized(body: ErrorResponseBody): void {
  if (body.code === 'AUTH_TOKEN_INVALID') {
    clearAuthToken()
  }

  if (body.code === 'MANAGEMENT_TOKEN_INVALID') {
    clearManagementToken()
  }
}

/** 发送请求并检查响应状态 */
async function request(url: string, init?: RequestInit): Promise<Response> {
  const headers = applyStoredTokens(url, init?.headers)

  const res = await fetch(url, {
    ...init,
    headers,
  })

  if (!res.ok) {
    const body = await res.json().catch(() => ({} as ErrorResponseBody))
    if (res.status === 401) {
      handleUnauthorized(body)
    }
    throw new Error(body.error || `HTTP ${res.status}`)
  }

  return res
}

// ============ REST ============

export async function getSessions(): Promise<{ sessions: SessionSummary[] }> {
  const res = await request('/api/sessions')
  return res.json()
}

export async function getMessages(sessionId: string): Promise<{ messages: Message[] }> {
  const res = await request(`/api/sessions/${encodeURIComponent(sessionId)}/messages`)
  return res.json()
}

export async function deleteSession(sessionId: string): Promise<void> {
  await request(`/api/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' })
}

export async function truncateMessages(sessionId: string, keepCount: number): Promise<void> {
  await request(
    `/api/sessions/${encodeURIComponent(sessionId)}/messages?keepCount=${keepCount}`,
    { method: 'DELETE' },
  )
}

export async function getStatus(): Promise<StatusInfo> {
  const res = await request('/api/status')
  return res.json()
}

export async function getConfig(): Promise<any> {
  const res = await request('/api/config')
  return res.json()
}

export async function updateConfig(data: any): Promise<{ ok: boolean; restartRequired?: boolean; error?: string }> {
  const res = await request('/api/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  return res.json()
}

export async function fetchConfigModels(data: {
  tier: 'primary' | 'secondary' | 'light'
  provider: string
  baseUrl: string
  apiKey?: string
}): Promise<ConfigModelListResponse> {
  const res = await request('/api/config/models', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })

  return res.json()
}

// ============ 部署 ============

export async function getDeployState(): Promise<DeployStateResponse> {
  const res = await request('/api/deploy/state')
  return res.json()
}

export async function detectDeploy(): Promise<DetectResponse> {
  const res = await request('/api/deploy/detect')
  return res.json()
}

export async function previewDeploy(options: DeployFormOptions): Promise<DeployPreviewResponse> {
  const res = await request('/api/deploy/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ options }),
  })
  return res.json()
}

export async function deployNginx(options: DeployFormOptions, token: string): Promise<DeployResponse> {
  const res = await request('/api/deploy/nginx', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Deploy-Token': token },
    body: JSON.stringify({ options }),
  })
  return res.json()
}

export async function syncDeployCloudflare(mode: 'flexible' | 'full' | 'strict', zoneId?: string | null): Promise<DeploySyncCloudflareResponse> {
  const res = await request('/api/deploy/sync-cloudflare', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode, zoneId }),
  })
  return res.json()
}

export async function deployService(options: DeployFormOptions, token: string): Promise<DeployResponse> {
  const res = await request('/api/deploy/service', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Deploy-Token': token },
    body: JSON.stringify({ options }),
  })
  return res.json()
}

// ============ Cloudflare ============

export async function cfGetStatus(): Promise<CfStatusResponse> {
  const res = await request('/api/cloudflare/status')
  return res.json()
}

export async function cfListDns(zoneId?: string | null): Promise<{ records: CfDnsRecord[] }> {
  const q = zoneId ? `?zoneId=${encodeURIComponent(zoneId)}` : ''
  const res = await request(`/api/cloudflare/dns${q}`)
  return res.json()
}

export async function cfAddDns(record: CfDnsInput, zoneId?: string | null): Promise<any> {
  const res = await request('/api/cloudflare/dns', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...record, zoneId }),
  })
  return res.json()
}

export async function cfRemoveDns(id: string, zoneId?: string | null): Promise<any> {
  const q = zoneId ? `?zoneId=${encodeURIComponent(zoneId)}` : ''
  const res = await request(`/api/cloudflare/dns/${encodeURIComponent(id)}${q}`, { method: 'DELETE' })
  return res.json()
}

export async function cfGetSsl(zoneId?: string | null): Promise<{ mode: string }> {
  const q = zoneId ? `?zoneId=${encodeURIComponent(zoneId)}` : ''
  const res = await request(`/api/cloudflare/ssl${q}`)
  return res.json()
}

export async function cfSetSsl(mode: string, zoneId?: string | null): Promise<any> {
  const res = await request('/api/cloudflare/ssl', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode, zoneId }),
  })
  return res.json()
}

export async function cfSetup(apiToken: string): Promise<CfSetupResponse> {
  const res = await request('/api/cloudflare/setup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiToken }),
  })
  return res.json()
}

// ============ SSE 聊天 ============

/**
 * 发送聊天消息并通过 SSE 接收响应。
 * 使用 fetch + ReadableStream 手动解析（EventSource 不支持 POST）。
 */
export function sendChat(sessionId: string | null, message: string, callbacks: ChatCallbacks, images?: ImageInput[], documents?: DocumentInput[]): AbortController {
  const controller = new AbortController()

  fetch('/api/chat', {
    method: 'POST',
    headers: applyStoredTokens('/api/chat', { 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      sessionId,
      message,
      ...(images && images.length > 0 ? { images } : {}),
      ...(documents && documents.length > 0 ? { documents } : {}),
    }),
    signal: controller.signal,
  }).then(async (response) => {
    if (!response.ok) {
      const err = await response.json().catch(() => ({ error: '请求失败' } as ErrorResponseBody))
      if (response.status === 401) {
        handleUnauthorized(err)
      }
      callbacks.onError?.(err.error || `HTTP ${response.status}`)
      return
    }

    // 获取服务端分配的 sessionId
    const actualSessionId = response.headers.get('X-Session-Id')
    if (actualSessionId) callbacks.onSessionId?.(actualSessionId)

    // 手动解析 SSE 流
    if (!response.body) {
      callbacks.onError?.('响应体为空')
      return
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const event = JSON.parse(line.slice(6))
            switch (event.type) {
              case 'delta': callbacks.onDelta?.(event.text); break
              case 'message': callbacks.onMessage?.(event.text); break
              case 'stream_end': callbacks.onStreamEnd?.(); break
              case 'done': callbacks.onDone?.(); break
              case 'error': callbacks.onError?.(event.message); break
            }
          } catch {
            // 忽略解析错误（如心跳）
          }
        }
      }
    }
  }).catch((err) => {
    if (err.name !== 'AbortError') callbacks.onError?.(err.message)
  })

  return controller
}
