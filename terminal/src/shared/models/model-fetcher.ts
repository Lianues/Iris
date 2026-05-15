import { DEEPSEEK_MODEL_OPTIONS, PROVIDER_DEFAULTS } from "./provider-config.js"

export interface ModelEntry {
  id: string
  label: string
}

function normalizeBaseUrl(provider: string, baseUrl: string): string {
  let url = (provider === "deepseek" ? PROVIDER_DEFAULTS.deepseek.baseUrl : baseUrl)
    .trim()
    .replace(/\/+$/, "")

  switch (provider) {
    case "gemini":
      url = url
        .replace(/\/models\/[^/?#]+:streamGenerateContent(?:\?alt=sse)?$/i, "")
        .replace(/\/models\/[^/?#]+:generateContent$/i, "")
        .replace(/\/models$/i, "")
      break
    case "openai-compatible":
    case "openai-responses":
    case "deepseek":
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
  const response = await fetch(url, {
    method: "GET",
    headers: { Accept: "application/json", ...headers },
    signal: AbortSignal.timeout(15000),
  })

  if (!response.ok) {
    const text = await response.text().catch(() => "")
    throw new Error(text || `HTTP ${response.status}`)
  }

  return response.json()
}

export async function fetchModelList(
  provider: string,
  apiKey: string,
  baseUrl: string,
): Promise<ModelEntry[]> {
  const url = normalizeBaseUrl(provider, baseUrl)
  if (provider === "deepseek") {
    return DEEPSEEK_MODEL_OPTIONS.map((option) => ({
      id: option.id,
      label: option.label,
    }))
  }

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
            .filter((model: any) => {
              const methods = Array.isArray(model?.supportedGenerationMethods)
                ? model.supportedGenerationMethods.map(String)
                : []
              return (
                methods.length === 0
                || methods.includes("generateContent")
                || methods.includes("streamGenerateContent")
              )
            })
            .map((model: any) => {
              const id = String(model?.name ?? "").replace(/^models\//, "")
              const displayName = String(model?.displayName ?? "").trim()
              return { id, label: displayName ? `${id} · ${displayName}` : id }
            }),
        )
      }
      case "openai-compatible":
      case "openai-responses":
      case "deepseek": {
        const body = await requestJSON(`${url}/models`, {
          Authorization: `Bearer ${apiKey}`,
        })
        const items = Array.isArray(body?.data) ? body.data : []
        return dedupeAndSort(
          items.map((model: any) => {
            const id = String(model?.id ?? model?.name ?? "").trim()
            const owner = String(model?.owned_by ?? "").trim()
            return { id, label: owner ? `${id} · ${owner}` : id }
          }),
        )
      }
      case "claude": {
        const body = await requestJSON(`${url}/models`, {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        })
        const items = Array.isArray(body?.data) ? body.data : []
        return dedupeAndSort(
          items.map((model: any) => {
            const id = String(model?.id ?? "").trim()
            const displayName = String(model?.display_name ?? "").trim()
            return { id, label: displayName ? `${id} · ${displayName}` : id }
          }),
        )
      }
      default:
        return []
    }
  } catch {
    return []
  }
}
