/**
 * API 客户端
 *
 * 封装 REST 调用和 SSE 聊天流解析。
 */

import type {
  ImageInput, DocumentInput, ChatImageAttachment, ChatDocumentAttachment, Message, StatusInfo, ChatCallbacks, DetectResponse, DeployResponse, DeploySyncCloudflareResponse,
  DeployFormOptions, DeployStateResponse, DeployPreviewResponse,
  CfStatusResponse, CfDnsRecord, CfDnsInput, CfSetupResponse, SessionSummary, ConfigModelListResponse,
} from './types'
import { clearManagementToken, loadManagementToken } from '../utils/managementToken'
import { clearAuthToken, loadAuthToken } from '../utils/authToken'

interface ErrorResponseBody {
  error?: string
  code?: string
}

// ============ Agent 上下文 ============

/** 当前选中的 Agent 名称（由 useAgents composable 设置） */
let _currentAgentName: string | null = null

export function setCurrentAgentName(name: string | null): void {
  _currentAgentName = name
}

export function getCurrentAgentName(): string | null {
  return _currentAgentName
}

// ============ 通用 ============

/** 是否为管理接口 */
function isManagementRequest(url: string): boolean {
  return url === '/api/config'
    || url.startsWith('/api/config/')
    || url.startsWith('/api/deploy/')
    || url.startsWith('/api/cloudflare/')
    || url.startsWith('/api/extensions/')
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

  // 多 Agent 模式：注入当前 Agent 名称
  if (_currentAgentName) {
    merged['X-Agent-Name'] = _currentAgentName
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

// ============ Agent 列表 ============

export async function getAgents(): Promise<{ agents: Array<{ name: string; description?: string }> }> {
  const res = await request('/api/agents')
  return res.json()
}

export interface AgentStatusResponse {
  exists: boolean
  enabled: boolean
  agents: Array<{ name: string; description?: string; dataDir?: string }>
  manifestPath: string
}

export async function getAgentStatus(): Promise<AgentStatusResponse> {
  const res = await request('/api/agents/status')
  return res.json()
}

export async function toggleAgentEnabled(enabled: boolean): Promise<{ success: boolean; message: string }> {
  const res = await request('/api/agents/toggle', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  })
  return res.json()
}

export async function initAgentManifest(): Promise<{ success: boolean; message: string }> {
  const res = await request('/api/agents/init', { method: 'POST' })
  return res.json()
}

export async function createAgentDef(name: string, description?: string): Promise<{ success: boolean; message: string }> {
  const res = await request('/api/agents/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, description }),
  })
  return res.json()
}

export async function updateAgentDef(name: string, fields: { description?: string; dataDir?: string }): Promise<{ success: boolean; message: string }> {
  const res = await request('/api/agents/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, ...fields }),
  })
  return res.json()
}

export async function deleteAgentDef(name: string): Promise<{ success: boolean; message: string }> {
  const res = await request('/api/agents/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  return res.json()
}

// ============ REST ============

export async function getSessions(signal?: AbortSignal): Promise<{ sessions: SessionSummary[] }> {
  const res = await request('/api/sessions', { signal })
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
  modelName?: string
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

// ============ 工具审批 ============

export async function approveTool(id: string, approved: boolean): Promise<{ ok: boolean }> {
  const res = await request(`/api/tools/${encodeURIComponent(id)}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ approved }),
  })
  return res.json()
}

export async function applyTool(id: string, applied: boolean): Promise<{ ok: boolean }> {
  const res = await request(`/api/tools/${encodeURIComponent(id)}/apply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ applied }),
  })
  return res.json()
}

export async function abortTool(id: string): Promise<{ ok: boolean }> {
  const res = await request(`/api/tools/${encodeURIComponent(id)}/abort`, {
    method: 'POST',
  })
  return res.json()
}

// ============ 撤销/重做 ============

export async function undoMessage(sessionId: string): Promise<{ ok: boolean; changed: boolean; messages?: Message[] }> {
  const res = await request(`/api/sessions/${encodeURIComponent(sessionId)}/undo`, { method: 'POST' })
  return res.json()
}

export async function redoMessage(sessionId: string): Promise<{ ok: boolean; changed: boolean; messages?: Message[] }> {
  const res = await request(`/api/sessions/${encodeURIComponent(sessionId)}/redo`, { method: 'POST' })
  return res.json()
}

// ============ Shell / 模型切换 ============

export async function runShellCommand(command: string): Promise<{ output: string; cwd: string }> {
  const res = await request('/api/shell', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command }),
  })
  return res.json()
}

export async function switchModel(modelName: string): Promise<any> {
  const res = await request('/api/model/switch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ modelName }),
  })
  return res.json()
}

export interface DiffPreviewItem {
  filePath: string
  label: string
  diff?: string
  added: number
  removed: number
  message?: string
}

export interface DiffPreviewResponse {
  toolName: string
  title: string
  summary: string[]
  items: DiffPreviewItem[]
}

export async function getToolDiffPreview(toolId: string): Promise<DiffPreviewResponse> {
  const res = await request(`/api/tools/${encodeURIComponent(toolId)}/diff`)
  return res.json()
}

export async function resetConfig(): Promise<{ success: boolean; message: string }> {
  const res = await request('/api/config/reset', { method: 'POST' })
  return res.json()
}

export async function listModels(): Promise<{ models: Array<{ modelName: string; modelId: string; provider: string; current?: boolean }> }> {
  const res = await request('/api/models')
  return res.json()
}

// ============ 上下文压缩 ============

export async function compactContext(sessionId: string): Promise<{ ok: boolean; summary?: string; error?: string }> {
  const res = await request('/api/compact', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId }),
  })
  return res.json()
}

// ============ SSE 聊天 ============

let _dispatchCount = 0

function dispatchChatStreamEvent(rawBlock: string, callbacks: ChatCallbacks): void {
  const dataLines = rawBlock
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => (line.startsWith('data: ') ? line.slice(6) : line.slice(5)))

  if (dataLines.length === 0) return

  try {
    const event = JSON.parse(dataLines.join('\n'))
    _dispatchCount++
    if (_dispatchCount <= 5 || event.type !== 'delta') {
      console.log(`[SSE-dispatch #${_dispatchCount}] type=${event.type}`)
    }
    switch (event.type) {
      case 'stream_start': _dispatchCount = 0; callbacks.onStreamStart?.(); break
      case 'delta': callbacks.onDelta?.(event.text); break
      case 'thought_delta': callbacks.onThoughtDelta?.(event.text, event.durationMs); break
      case 'message': callbacks.onMessage?.(event.text); break
      case 'assistant_content': callbacks.onAssistantContent?.(event.message); break
      case 'stream_end': callbacks.onStreamEnd?.(); break
      case 'done': callbacks.onDone?.(); break
      case 'done_meta': callbacks.onDoneMeta?.(event.durationMs); break
      case 'error': callbacks.onError?.(event.message); break
      case 'tool_start':
        callbacks.onToolStart?.(event.tool);
        break
      case 'tool_state':
        callbacks.onToolState?.(event.toolId, event.status, event.prev, event.snapshot);
        break
      case 'tool_output':
        callbacks.onToolOutput?.(event.toolId, event.entry);
        break
      case 'tool_progress':
        callbacks.onToolProgress?.(event.toolId, event.data);
        break
      case 'usage': callbacks.onUsage?.(event.usage); break
      case 'retry': callbacks.onRetry?.(event.attempt, event.maxRetries, event.error); break
      case 'auto_compact': callbacks.onAutoCompact?.(event.summary); break
      case 'user_token': callbacks.onUserToken?.(event.tokenCount); break
      case 'agent_notification': callbacks.onAgentNotification?.(event.taskId, event.status, event.summary); break
      case 'turn_start': callbacks.onTurnStart?.(event.turnId, event.mode); break
    }
  } catch {
    // 忽略解析错误（如心跳）
  }
}

function canUseMultipartPayload(images: ChatImageAttachment[], documents: ChatDocumentAttachment[]): boolean {
  if (images.length === 0 && documents.length === 0) return false
  return images.every((image) => image.file instanceof File)
    && documents.every((doc) => doc.file instanceof File)
}

function buildMultipartChatPayload(sessionId: string | null, message: string, images: ChatImageAttachment[], documents: ChatDocumentAttachment[]): FormData {
  const formData = new FormData()

  if (sessionId) {
    formData.append('sessionId', sessionId)
  }
  formData.append('message', message)

  for (const image of images) {
    if (!(image.file instanceof File)) continue
    formData.append('images', image.file, image.fileName || image.file.name || 'image')
  }

  for (const doc of documents) {
    if (!(doc.file instanceof File)) continue
    formData.append('documents', doc.file, doc.fileName || doc.file.name || 'document')
  }

  return formData
}

function buildJsonChatPayload(sessionId: string | null, message: string, images: ChatImageAttachment[], documents: ChatDocumentAttachment[]) {
  const encodedImages: ImageInput[] = []
  for (const image of images) {
    if (!image.data) {
      throw new Error('当前附件只保留了本地文件引用，请重新上传后再试')
    }
    encodedImages.push({
      mimeType: image.mimeType,
      data: image.data,
    })
  }

  const encodedDocuments: DocumentInput[] = []
  for (const doc of documents) {
    if (!doc.data) {
      throw new Error('当前附件只保留了本地文件引用，请重新上传后再试')
    }
    encodedDocuments.push({
      fileName: doc.fileName,
      mimeType: doc.mimeType,
      data: doc.data,
    })
  }

  return {
    sessionId,
    message,
    ...(encodedImages.length > 0 ? { images: encodedImages } : {}),
    ...(encodedDocuments.length > 0 ? { documents: encodedDocuments } : {}),
  }
}

/**
 * 发送聊天消息并通过 SSE 接收响应。
 * 使用 fetch + ReadableStream 手动解析（EventSource 不支持 POST）。
 */
export function sendChat(
  sessionId: string | null,
  message: string,
  callbacks: ChatCallbacks,
  images?: ChatImageAttachment[],
  documents?: ChatDocumentAttachment[],
): AbortController {
  const controller = new AbortController()
  const resolvedImages = images ?? []
  const resolvedDocuments = documents ?? []

  let body: BodyInit
  let headers: HeadersInit | undefined

  try {
    if (canUseMultipartPayload(resolvedImages, resolvedDocuments)) {
      body = buildMultipartChatPayload(sessionId, message, resolvedImages, resolvedDocuments)
      headers = applyStoredTokens('/api/chat')
    } else {
      body = JSON.stringify(buildJsonChatPayload(sessionId, message, resolvedImages, resolvedDocuments))
      headers = applyStoredTokens('/api/chat', { 'Content-Type': 'application/json' })
    }
  } catch (error) {
    queueMicrotask(() => {
      callbacks.onError?.(error instanceof Error ? error.message : String(error))
    })
    return controller
  }

  fetch('/api/chat', {
    method: 'POST',
    headers,
    body,
    signal: controller.signal,
  })
    .then(async (response) => {
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

      const processBufferedEvents = async (flushRemainder = false) => {
        const blocks = buffer.split(/\r?\n\r?\n/)
        if (!flushRemainder) {
          buffer = blocks.pop() || ''
        } else {
          buffer = ''
        }

        for (let i = 0; i < blocks.length; i++) {
          dispatchChatStreamEvent(blocks[i], callbacks)
          // 当多个 SSE 事件落入同一个 reader.read() 缓冲区时，
          // 在事件之间让出到宏任务，使 rAF 回调有机会将流式增量
          // 刷新到 streamingText 并触发 Vue 渲染。
          // 否则 onDone 会在同一同步块中清除流式状态，流式文本永远不会渲染。
          if (i < blocks.length - 1) {
            await new Promise<void>((resolve) => setTimeout(resolve, 0))
          }
        }
      }

      let _readCount = 0

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        _readCount++
        const chunk = decoder.decode(value, { stream: true })
        buffer += chunk
        const blockCount = (chunk.match(/\r?\n\r?\n/g) || []).length
        if (_readCount <= 5 || _readCount % 10 === 0) {
          console.log(`[SSE-client] read#${_readCount}: ${chunk.length} bytes, ~${blockCount} events`)
        }
        await processBufferedEvents(false)

        // await reader.read() 在数据已就绪时通过微任务恢复，不会让出给渲染引擎。
        // 插入一个宏任务断点，确保 rAF 和浏览器渲染有机会执行，使流式内容可见。
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
      }

      buffer += decoder.decode()
      await processBufferedEvents(true)
    })
    .catch((err) => {
      if (err.name !== 'AbortError') callbacks.onError?.(err.message)
    })

  return controller
}


// ============ 扩展管理 ============

import type { ExtensionSummary, PlatformOption } from './types'

export async function getInstalledExtensions(): Promise<{ extensions: ExtensionSummary[] }> {
  const res = await request('/api/extensions')
  return res.json()
}

export async function getRemoteExtensions(): Promise<{ extensions: ExtensionSummary[] }> {
  const res = await request('/api/extensions/remote')
  return res.json()
}

export async function installExtension(requestedPath: string): Promise<{ ok: boolean; extension?: ExtensionSummary; error?: string }> {
  const res = await request('/api/extensions/install', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestedPath }),
  })
  return res.json()
}

export async function enableExtension(name: string): Promise<{ ok: boolean; error?: string }> {
  const res = await request(`/api/extensions/${encodeURIComponent(name)}/enable`, { method: 'POST' })
  return res.json()
}

export async function disableExtension(name: string): Promise<{ ok: boolean; error?: string }> {
  const res = await request(`/api/extensions/${encodeURIComponent(name)}/disable`, { method: 'POST' })
  return res.json()
}

export async function deleteExtension(name: string): Promise<{ ok: boolean; error?: string }> {
  const res = await request(`/api/extensions/${encodeURIComponent(name)}`, { method: 'DELETE' })
  return res.json()
}

// ============ 平台目录 ============

export async function getAvailablePlatforms(): Promise<{ platforms: PlatformOption[] }> {
  const res = await request('/api/platforms')
  return res.json()
}


// ============ 扩展面板 ============

export interface WebPanelInfo {
  id: string
  title: string
  icon?: string
  contentPath: string
}

export async function getWebPanels(): Promise<WebPanelInfo[]> {
  const res = await request('/api/panels')
  return res.json()
}
