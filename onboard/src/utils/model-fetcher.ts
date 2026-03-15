/**
 * 模型列表拉取
 *
 * 从各 provider 的 API 获取可用模型 ID 列表，供 onboard 中自动补全使用。
 * 逻辑参照主项目 src/llm/model-catalog.ts，但独立实现以避免引入主项目依赖。
 */

export interface ModelEntry {
  id: string
  label: string
}

function normalizeBaseUrl(provider: string, baseUrl: string): string {
  let url = baseUrl.trim().replace(/\/+$/, "")

  switch (provider) {
    case "gemini":
      url = url
        .replace(/\/models\/[^/?#]+:streamGenerateContent(?:\?alt=sse)?$/i, "")
        .replace(/\/models\/[^/?#]+:generateContent$/i, "")
        .replace(/\/models$/i, "")
      break
    case "openai-compatible":
    case "openai-responses":
      url = url
        .replace(/\/chat\/completions$/i, "")
        .replace(/\/responses$/i, "")
        .replace(/\/models$/i, "")
      break
    case "claude":
      url = url
        .replace(/\/messages$/i, "")
        .replace(/\/models$/i, "")
      break
  }

  return url.replace(/\/+$/, "")
}

function dedupeAndSort(entries: ModelEntry[]): ModelEntry[] {
  const seen = new Map<string, ModelEntry>()
  for (const entry of entries) {
    const id = entry.id.trim()
    if (!id || seen.has(id)) continue
    seen.set(id, { id, label: entry.label?.trim() || id })
  }
  return Array.from(seen.values()).sort((a, b) => a.id.localeCompare(b.id, "en"))
}

async function requestJSON(url: string, headers: Record<string, string>): Promise<any> {
  const res = await fetch(url, {
    method: "GET",
    headers: { Accept: "application/json", ...headers },
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(text || `HTTP ${res.status}`)
  }
  return res.json()
}

export async function fetchModelList(
  provider: string,
  apiKey: string,
  baseUrl: string
): Promise<ModelEntry[]> {
  const url = normalizeBaseUrl(provider, baseUrl)
  if (!apiKey || !url) return []

  try {
    switch (provider) {
      case "gemini": {
        const body = await requestJSON(`${url}/models?pageSize=1000`, {
          "x-goog-api-key": apiKey,
        })
        const items = Array.isArray(body?.models) ? body.models : []
        return dedupeAndSort(
          items
            .filter((m: any) => {
              const methods = Array.isArray(m?.supportedGenerationMethods)
                ? m.supportedGenerationMethods.map(String)
                : []
              return (
                methods.length === 0 ||
                methods.includes("generateContent") ||
                methods.includes("streamGenerateContent")
              )
            })
            .map((m: any) => {
              const id = String(m?.name ?? "").replace(/^models\//, "")
              const displayName = String(m?.displayName ?? "").trim()
              return { id, label: displayName ? `${id} · ${displayName}` : id }
            })
        )
      }
      case "openai-compatible":
      case "openai-responses": {
        const body = await requestJSON(`${url}/models`, {
          Authorization: `Bearer ${apiKey}`,
        })
        const items = Array.isArray(body?.data) ? body.data : []
        return dedupeAndSort(
          items.map((m: any) => {
            const id = String(m?.id ?? m?.name ?? "").trim()
            const owner = String(m?.owned_by ?? "").trim()
            return { id, label: owner ? `${id} · ${owner}` : id }
          })
        )
      }
      case "claude": {
        const body = await requestJSON(`${url}/models`, {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        })
        const items = Array.isArray(body?.data) ? body.data : []
        return dedupeAndSort(
          items.map((m: any) => {
            const id = String(m?.id ?? "").trim()
            const displayName = String(m?.display_name ?? "").trim()
            return { id, label: displayName ? `${id} · ${displayName}` : id }
          })
        )
      }
      default:
        return []
    }
  } catch {
    return []
  }
}
