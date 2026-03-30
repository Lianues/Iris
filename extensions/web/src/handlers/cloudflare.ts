import * as http from 'http'
import { readBody, sendJSON } from '../router'
import {
  addCloudflareDnsRecord,
  getCloudflareStatus,
  getCloudflareSslMode,
  listCloudflareDnsRecords,
  removeCloudflareDnsRecord,
  resolveCloudflareConfig,
  saveCloudflareConfig,
  setCloudflareSslMode,
  listCloudflareZones,
} from '../cloudflare'

function getQueryValue(req: http.IncomingMessage, key: string): string | null {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
  const value = url.searchParams.get(key)
  return value && value.trim() ? value.trim() : null
}

async function resolveZoneId(configDir: string, requestedZoneId?: string | null): Promise<string> {
  const status = await getCloudflareStatus(configDir, requestedZoneId)
  if (!status.connected || !status.activeZoneId) {
    throw new Error(status.error || 'Cloudflare 未连接或未选择可用 Zone')
  }
  return status.activeZoneId
}

async function resolveApiToken(configDir: string): Promise<string> {
  const resolved = resolveCloudflareConfig(configDir)
  if (!resolved.token) {
    throw new Error(resolved.error || '未配置 Cloudflare API Token')
  }
  return resolved.token
}

export function createCloudflareHandlers(configDir: string) {
  return {
    async status(_req: http.IncomingMessage, res: http.ServerResponse) {
      try {
        const result = await getCloudflareStatus(configDir)
        sendJSON(res, 200, result)
      } catch (error) {
        sendJSON(res, 500, { error: error instanceof Error ? error.message : String(error) })
      }
    },

    async setup(req: http.IncomingMessage, res: http.ServerResponse) {
      try {
        const body = await readBody(req)
        const apiToken = typeof body.apiToken === 'string' ? body.apiToken.trim() : ''
        if (!apiToken) {
          sendJSON(res, 400, { ok: false, error: '请输入 Cloudflare API Token' })
          return
        }
        const zones = await listCloudflareZones(apiToken)
        saveCloudflareConfig(configDir, {
          apiToken,
          apiTokenEnv: null,
          apiTokenFile: null,
          zoneId: zones.length === 1 ? zones[0].id : 'auto',
        })
        sendJSON(res, 200, {
          ok: true,
          zones: zones.map((zone) => ({ id: zone.id, name: zone.name })),
        })
      } catch (error) {
        sendJSON(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error), zones: [] })
      }
    },

    async listDns(req: http.IncomingMessage, res: http.ServerResponse) {
      try {
        const token = await resolveApiToken(configDir)
        const zoneId = await resolveZoneId(configDir, getQueryValue(req, 'zoneId'))
        const records = await listCloudflareDnsRecords(token, zoneId)
        sendJSON(res, 200, { records })
      } catch (error) {
        sendJSON(res, 500, { error: error instanceof Error ? error.message : String(error) })
      }
    },

    async addDns(req: http.IncomingMessage, res: http.ServerResponse) {
      try {
        const body = await readBody(req)
        const token = await resolveApiToken(configDir)
        const zoneIdInput = typeof body.zoneId === 'string' ? body.zoneId.trim() : ''
        const zoneId = await resolveZoneId(configDir, zoneIdInput || null)
        await addCloudflareDnsRecord(token, zoneId, {
          type: typeof body.type === 'string' ? body.type.trim().toUpperCase() : '',
          name: typeof body.name === 'string' ? body.name.trim() : '',
          content: typeof body.content === 'string' ? body.content.trim() : '',
          proxied: typeof body.proxied === 'boolean' ? body.proxied : undefined,
          ttl: typeof body.ttl === 'number' ? body.ttl : undefined,
        })
        sendJSON(res, 200, { ok: true })
      } catch (error) {
        sendJSON(res, 500, { error: error instanceof Error ? error.message : String(error) })
      }
    },

    async removeDns(req: http.IncomingMessage, res: http.ServerResponse, params: Record<string, string>) {
      try {
        const token = await resolveApiToken(configDir)
        const zoneId = await resolveZoneId(configDir, getQueryValue(req, 'zoneId'))
        await removeCloudflareDnsRecord(token, zoneId, params.id)
        sendJSON(res, 200, { ok: true })
      } catch (error) {
        sendJSON(res, 500, { error: error instanceof Error ? error.message : String(error) })
      }
    },

    async getSsl(req: http.IncomingMessage, res: http.ServerResponse) {
      try {
        const token = await resolveApiToken(configDir)
        const zoneId = await resolveZoneId(configDir, getQueryValue(req, 'zoneId'))
        const mode = await getCloudflareSslMode(token, zoneId)
        sendJSON(res, 200, { mode })
      } catch (error) {
        sendJSON(res, 500, { error: error instanceof Error ? error.message : String(error) })
      }
    },

    async setSsl(req: http.IncomingMessage, res: http.ServerResponse) {
      try {
        const body = await readBody(req)
        const mode = typeof body.mode === 'string' ? body.mode.trim() : ''
        if (mode !== 'off' && mode !== 'flexible' && mode !== 'full' && mode !== 'strict') {
          sendJSON(res, 400, { error: '无效的 SSL 模式' })
          return
        }
        const token = await resolveApiToken(configDir)
        const zoneIdInput = typeof body.zoneId === 'string' ? body.zoneId.trim() : ''
        const zoneId = await resolveZoneId(configDir, zoneIdInput || null)
        const appliedMode = await setCloudflareSslMode(token, zoneId, mode)
        sendJSON(res, 200, { ok: true, mode: appliedMode })
      } catch (error) {
        sendJSON(res, 500, { error: error instanceof Error ? error.message : String(error) })
      }
    },
  }
}
