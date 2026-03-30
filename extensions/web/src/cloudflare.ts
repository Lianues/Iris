import * as fs from 'fs'
import * as path from 'path'

// ── 内联配置读写工具（避免耦合 src/config/ 内部模块）──

function parseYAML(content: string): any {
  // 动态 import yaml，避免静态依赖
  try {
    const yaml = require('yaml');
    return yaml.parse(content);
  } catch {
    return undefined;
  }
}

function stringifyYAML(value: any): string {
  try {
    const yaml = require('yaml');
    return yaml.stringify(value, { indent: 2 });
  } catch {
    return JSON.stringify(value, null, 2);
  }
}

function readCloudflareYaml(configDir: string): any {
  const filePath = path.join(configDir, 'cloudflare.yaml');
  if (!fs.existsSync(filePath)) return undefined;
  return parseYAML(fs.readFileSync(filePath, 'utf-8')) ?? undefined;
}

function writeCloudflareYaml(configDir: string, data: any): void {
  const filePath = path.join(configDir, 'cloudflare.yaml');
  if (data === undefined || (typeof data === 'object' && data !== null && Object.keys(data).length === 0)) {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    return;
  }
  fs.writeFileSync(filePath, stringifyYAML(data), 'utf-8');
}

// ── 类型定义 ──

export type CloudflareTokenSource = 'inline' | 'env' | 'file'
export type CloudflareSslMode = 'off' | 'flexible' | 'full' | 'strict' | 'unknown'

export interface CloudflareZoneInfo {
  id: string
  name: string
  status: string
}

export interface CloudflareDnsRecord {
  id: string
  type: string
  name: string
  content: string
  proxied: boolean
  ttl: number
}

export interface CloudflareDnsInput {
  type: string
  name: string
  content: string
  proxied?: boolean
  ttl?: number
}

export interface CloudflareRawConfig {
  apiToken?: string | null
  apiTokenEnv?: string | null
  apiTokenFile?: string | null
  zoneId?: string | null
}

export interface ResolvedCloudflareConfig {
  configured: boolean
  token: string
  tokenSource: CloudflareTokenSource | null
  zoneId: string | null
  error?: string
}

export interface CloudflareStatusSummary {
  configured: boolean
  connected: boolean
  zones: CloudflareZoneInfo[]
  activeZoneId: string | null
  activeZoneName: string | null
  sslMode: CloudflareSslMode | null
  tokenSource?: CloudflareTokenSource | null
  error?: string
}

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

interface CloudflareEnvelope<T> {
  success?: boolean
  errors?: Array<{ message?: string } | string>
  result?: T
}

function normalizeDomain(domain?: string | null): string {
  return (domain ?? '').trim().replace(/\.$/, '').toLowerCase()
}

export function loadCloudflareRawConfig(configDir: string): CloudflareRawConfig {
  const cloudflare = readCloudflareYaml(configDir)
  if (!cloudflare || typeof cloudflare !== 'object' || Array.isArray(cloudflare)) {
    return {}
  }
  return cloudflare as CloudflareRawConfig
}

export function saveCloudflareConfig(configDir: string, patch: Partial<CloudflareRawConfig>): void {
  const current = loadCloudflareRawConfig(configDir)
  const merged = { ...current, ...patch }
  // 移除 null 值的键
  for (const key of Object.keys(merged)) {
    if ((merged as any)[key] === null) delete (merged as any)[key];
  }
  writeCloudflareYaml(configDir, Object.keys(merged).length > 0 ? merged : undefined)
}

export function resolveCloudflareConfig(configDir: string): ResolvedCloudflareConfig {
  const raw = loadCloudflareRawConfig(configDir)
  const inlineToken = typeof raw.apiToken === 'string' ? raw.apiToken.trim() : ''
  if (inlineToken) {
    return {
      configured: true,
      token: inlineToken,
      tokenSource: 'inline',
      zoneId: typeof raw.zoneId === 'string' && raw.zoneId.trim() ? raw.zoneId.trim() : null,
    }
  }

  const envName = typeof raw.apiTokenEnv === 'string' ? raw.apiTokenEnv.trim() : ''
  if (envName) {
    const envToken = process.env[envName]?.trim() || ''
    return {
      configured: true,
      token: envToken,
      tokenSource: 'env',
      zoneId: typeof raw.zoneId === 'string' && raw.zoneId.trim() ? raw.zoneId.trim() : null,
      ...(envToken ? {} : { error: `环境变量 ${envName} 未设置或为空` }),
    }
  }

  const filePath = typeof raw.apiTokenFile === 'string' ? raw.apiTokenFile.trim() : ''
  if (filePath) {
    const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(configDir, filePath)
    try {
      const fileToken = fs.readFileSync(absolutePath, 'utf-8').trim()
      return {
        configured: true,
        token: fileToken,
        tokenSource: 'file',
        zoneId: typeof raw.zoneId === 'string' && raw.zoneId.trim() ? raw.zoneId.trim() : null,
        ...(fileToken ? {} : { error: `文件 ${absolutePath} 中未读取到有效 Token` }),
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      return {
        configured: true,
        token: '',
        tokenSource: 'file',
        zoneId: typeof raw.zoneId === 'string' && raw.zoneId.trim() ? raw.zoneId.trim() : null,
        error: `读取 Token 文件失败: ${detail}`,
      }
    }
  }

  return {
    configured: false,
    token: '',
    tokenSource: null,
    zoneId: null,
  }
}

function buildCloudflareError(body: CloudflareEnvelope<unknown>, status: number): string {
  const messages = Array.isArray(body.errors)
    ? body.errors
      .map((item) => {
        if (typeof item === 'string') return item
        if (item && typeof item === 'object' && typeof item.message === 'string') return item.message
        return ''
      })
      .filter(Boolean)
    : []

  return messages[0] || `Cloudflare API 请求失败（HTTP ${status}）`
}

async function requestCloudflare<T>(apiToken: string, apiPath: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  headers.set('Authorization', `Bearer ${apiToken}`)
  if (init?.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  const res = await fetch(`https://api.cloudflare.com/client/v4${apiPath}`, {
    ...init,
    headers,
  })

  const body = await res.json().catch(() => ({} as CloudflareEnvelope<T>)) as CloudflareEnvelope<T>
  if (!res.ok || body.success === false || body.result === undefined) {
    throw new Error(buildCloudflareError(body, res.status))
  }

  return body.result
}

export async function listCloudflareZones(apiToken: string): Promise<CloudflareZoneInfo[]> {
  const result = await requestCloudflare<Array<{ id: string; name: string; status: string }>>(
    apiToken,
    '/zones?per_page=100&order=name&direction=asc',
  )
  return result.map((zone) => ({ id: zone.id, name: zone.name, status: zone.status }))
}

export async function getCloudflareSslMode(apiToken: string, zoneId: string): Promise<CloudflareSslMode> {
  const result = await requestCloudflare<{ value?: string }>(apiToken, `/zones/${encodeURIComponent(zoneId)}/settings/ssl`)
  const mode = typeof result.value === 'string' ? result.value : 'unknown'
  if (mode === 'off' || mode === 'flexible' || mode === 'full' || mode === 'strict') return mode
  return 'unknown'
}

export async function setCloudflareSslMode(apiToken: string, zoneId: string, mode: 'off' | 'flexible' | 'full' | 'strict'): Promise<CloudflareSslMode> {
  const result = await requestCloudflare<{ value?: string }>(apiToken, `/zones/${encodeURIComponent(zoneId)}/settings/ssl`, {
    method: 'PATCH',
    body: JSON.stringify({ value: mode }),
  })
  const nextMode = typeof result.value === 'string' ? result.value : mode
  if (nextMode === 'off' || nextMode === 'flexible' || nextMode === 'full' || nextMode === 'strict') return nextMode
  return 'unknown'
}

export async function listCloudflareDnsRecords(apiToken: string, zoneId: string, name?: string): Promise<CloudflareDnsRecord[]> {
  const params = new URLSearchParams({ per_page: '100' })
  const normalizedName = normalizeDomain(name)
  if (normalizedName) params.set('name', normalizedName)
  const result = await requestCloudflare<Array<{
    id: string; type: string; name: string; content: string; proxied?: boolean; ttl?: number
  }>>(apiToken, `/zones/${encodeURIComponent(zoneId)}/dns_records?${params.toString()}`)
  return result.map((record) => ({
    id: record.id, type: record.type, name: record.name, content: record.content,
    proxied: !!record.proxied, ttl: typeof record.ttl === 'number' ? record.ttl : 1,
  }))
}

export async function addCloudflareDnsRecord(apiToken: string, zoneId: string, record: CloudflareDnsInput): Promise<void> {
  const payload: Record<string, unknown> = {
    type: record.type, name: record.name.trim(), content: record.content.trim(), ttl: record.ttl ?? 1,
  }
  if (record.type === 'A' || record.type === 'AAAA' || record.type === 'CNAME') {
    payload.proxied = record.proxied ?? true
  }
  await requestCloudflare(apiToken, `/zones/${encodeURIComponent(zoneId)}/dns_records`, {
    method: 'POST', body: JSON.stringify(payload),
  })
}

export async function removeCloudflareDnsRecord(apiToken: string, zoneId: string, recordId: string): Promise<void> {
  await requestCloudflare(apiToken, `/zones/${encodeURIComponent(zoneId)}/dns_records/${encodeURIComponent(recordId)}`, {
    method: 'DELETE',
  })
}

function resolveActiveZone(zones: CloudflareZoneInfo[], preferredZoneId?: string | null): CloudflareZoneInfo | null {
  if (preferredZoneId && preferredZoneId !== 'auto') {
    return zones.find((zone) => zone.id === preferredZoneId) || null
  }
  return zones[0] || null
}

export function findMatchingZone(zones: CloudflareZoneInfo[], domain?: string | null): CloudflareZoneInfo | null {
  const normalizedDomain = normalizeDomain(domain)
  if (!normalizedDomain) return null
  let matched: CloudflareZoneInfo | null = null
  for (const zone of zones) {
    const zoneName = normalizeDomain(zone.name)
    if (!zoneName) continue
    if (normalizedDomain === zoneName || normalizedDomain.endsWith(`.${zoneName}`)) {
      if (!matched || zoneName.length > matched.name.length) matched = zone
    }
  }
  return matched
}

export async function getCloudflareStatus(configDir: string, requestedZoneId?: string | null): Promise<CloudflareStatusSummary> {
  const resolved = resolveCloudflareConfig(configDir)
  if (!resolved.configured) {
    return { configured: false, connected: false, zones: [], activeZoneId: null, activeZoneName: null, sslMode: null, tokenSource: null }
  }
  if (!resolved.token) {
    return { configured: true, connected: false, zones: [], activeZoneId: null, activeZoneName: null, sslMode: null, tokenSource: resolved.tokenSource, error: resolved.error || '未读取到 Cloudflare API Token' }
  }
  try {
    const zones = await listCloudflareZones(resolved.token)
    const activeZone = resolveActiveZone(zones, requestedZoneId ?? resolved.zoneId)
    const sslMode = activeZone ? await getCloudflareSslMode(resolved.token, activeZone.id) : null
    return { configured: true, connected: true, zones, activeZoneId: activeZone?.id || null, activeZoneName: activeZone?.name || null, sslMode, tokenSource: resolved.tokenSource }
  } catch (error) {
    return { configured: true, connected: false, zones: [], activeZoneId: null, activeZoneName: null, sslMode: null, tokenSource: resolved.tokenSource, error: error instanceof Error ? error.message : String(error) }
  }
}

export async function getCloudflareDeployContext(configDir: string, domain?: string | null): Promise<CloudflareDeployContext | null> {
  const normalizedDomain = normalizeDomain(domain)
  const resolved = resolveCloudflareConfig(configDir)
  if (!resolved.configured) return null
  if (!resolved.token) {
    return { configured: true, connected: false, zoneId: null, zoneName: null, sslMode: null, domain: normalizedDomain || null, domainRecordProxied: null, tokenSource: resolved.tokenSource, error: resolved.error || '未读取到 Cloudflare API Token' }
  }
  try {
    const zones = await listCloudflareZones(resolved.token)
    const matchedZone = normalizedDomain
      ? (findMatchingZone(zones, normalizedDomain) || resolveActiveZone(zones, resolved.zoneId))
      : resolveActiveZone(zones, resolved.zoneId)
    if (!matchedZone) {
      return { configured: true, connected: true, zoneId: null, zoneName: null, sslMode: null, domain: normalizedDomain || null, domainRecordProxied: null, tokenSource: resolved.tokenSource, ...(normalizedDomain ? { error: `未找到与域名 ${normalizedDomain} 匹配的 Cloudflare Zone` } : {}) }
    }
    const [sslMode, dnsRecords] = await Promise.all([
      getCloudflareSslMode(resolved.token, matchedZone.id),
      normalizedDomain ? listCloudflareDnsRecords(resolved.token, matchedZone.id, normalizedDomain) : Promise.resolve([]),
    ])
    const exactRecord = normalizedDomain
      ? dnsRecords.find((record) => normalizeDomain(record.name) === normalizedDomain && (record.type === 'A' || record.type === 'AAAA' || record.type === 'CNAME'))
      : undefined
    return { configured: true, connected: true, zoneId: matchedZone.id, zoneName: matchedZone.name, sslMode, domain: normalizedDomain || null, domainRecordProxied: exactRecord ? exactRecord.proxied : null, tokenSource: resolved.tokenSource }
  } catch (error) {
    return { configured: true, connected: false, zoneId: null, zoneName: null, sslMode: null, domain: normalizedDomain || null, domainRecordProxied: null, tokenSource: resolved.tokenSource, error: error instanceof Error ? error.message : String(error) }
  }
}
