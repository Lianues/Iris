export const DEEPSEEK_MODEL_OPTIONS = [
  {
    id: "deepseek-v4-flash",
    label: "deepseek-v4-flash · Flash",
  },
  {
    id: "deepseek-v4-pro",
    label: "deepseek-v4-pro · Pro",
  },
] as const

export function normalizeDeepSeekModelId(modelId: unknown): string {
  const value = typeof modelId === "string" ? modelId.trim() : ""
  return DEEPSEEK_MODEL_OPTIONS.some((option) => option.id === value) ? value : DEEPSEEK_MODEL_OPTIONS[0].id
}

export const PROVIDER_DEFAULTS: Record<
  string,
  { model: string; baseUrl: string; contextWindow: number }
> = {
  deepseek: {
    model: "deepseek-v4-flash",
    baseUrl: "https://api.deepseek.com/v1",
    contextWindow: 1000000,
  },
  gemini: {
    model: "gemini-2.5-flash",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    contextWindow: 1048576,
  },
  "openai-compatible": {
    model: "gpt-4o",
    baseUrl: "https://api.openai.com/v1",
    contextWindow: 128000,
  },
  "openai-responses": {
    model: "gpt-4o",
    baseUrl: "https://api.openai.com/v1",
    contextWindow: 128000,
  },
  claude: {
    model: "claude-sonnet-4-20250514",
    baseUrl: "https://api.anthropic.com/v1",
    contextWindow: 200000,
  },
}

export const PROVIDER_LABELS: Record<string, string> = {
  deepseek: "DeepSeek",
  gemini: "Google Gemini",
  "openai-compatible": "OpenAI Compatible",
  "openai-responses": "OpenAI Responses",
  claude: "Anthropic Claude",
}
