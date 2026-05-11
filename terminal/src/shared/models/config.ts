import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { parse, stringify } from "yaml"
import { resolveRuntimeConfigDir } from "../runtime-paths.js"
import { normalizeDeepSeekModelId, PROVIDER_DEFAULTS } from "./provider-config.js"
import { normalizeText as normalizeTextShared } from "irises-extension-sdk/utils"

export interface EditableModelConfig {
  provider: string
  apiKey: string
  baseUrl: string
  model: string
  modelName: string
}

export interface EditableModelEntry extends EditableModelConfig {
  originalModelName: string
  isDefault: boolean
}

export interface EditableModelRegistry {
  defaultModelName: string
  models: EditableModelEntry[]
}

function readYamlSafe(filepath: string): Record<string, unknown> {
  try {
    if (!existsSync(filepath)) return {}
    const parsed = parse(readFileSync(filepath, "utf-8"))
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function normalizeText(value: unknown): string | undefined { return normalizeTextShared(value) }

function readCurrentLlmConfig(installDir: string): Record<string, unknown> {
  const runtimePath = join(resolveRuntimeConfigDir(), "llm.yaml")
  const runtimeConfig = readYamlSafe(runtimePath)
  if (Object.keys(runtimeConfig).length > 0) {
    return runtimeConfig
  }

  return readYamlSafe(join(installDir, "data", "configs.example", "llm.yaml"))
}

function toEditableModelEntry(
  modelName: string,
  rawValue: Record<string, unknown>,
  defaultModelName: string,
): EditableModelEntry {
  const provider = normalizeText(rawValue.provider) ?? "gemini"
  const providerDefaults = PROVIDER_DEFAULTS[provider] ?? PROVIDER_DEFAULTS.gemini
  const baseUrl = provider === "deepseek"
    ? providerDefaults.baseUrl
    : normalizeText(rawValue.baseUrl) ?? providerDefaults.baseUrl
  const model = provider === "deepseek"
    ? normalizeDeepSeekModelId(rawValue.model)
    : normalizeText(rawValue.model) ?? providerDefaults.model

  return {
    originalModelName: modelName,
    modelName,
    provider,
    apiKey: normalizeText(rawValue.apiKey) ?? "",
    baseUrl,
    model,
    isDefault: defaultModelName === modelName,
  }
}

function buildFallbackRegistry(): EditableModelRegistry {
  const provider = "gemini"
  const providerDefaults = PROVIDER_DEFAULTS[provider]
  const modelName = provider.replace(/-/g, "_")

  return {
    defaultModelName: modelName,
    models: [
      {
        originalModelName: modelName,
        modelName,
        provider,
        apiKey: "",
        baseUrl: providerDefaults.baseUrl,
        model: providerDefaults.model,
        isDefault: true,
      },
    ],
  }
}

export function loadEditableModelRegistry(installDir: string): EditableModelRegistry {
  const llmConfig = readCurrentLlmConfig(installDir)
  const rawModels = llmConfig.models && typeof llmConfig.models === "object"
    ? llmConfig.models as Record<string, unknown>
    : {}

  const requestedDefaultModelName = normalizeText(llmConfig.defaultModel)
  const modelEntries = Object.entries(rawModels)
    .filter(([modelName, value]) => !!normalizeText(modelName) && !!value && typeof value === "object" && !Array.isArray(value))
    .map(([modelName, value]) => [normalizeText(modelName)!, value as Record<string, unknown>] as const)

  if (modelEntries.length === 0) {
    return buildFallbackRegistry()
  }

  const effectiveDefaultModelName = requestedDefaultModelName && modelEntries.some(([modelName]) => modelName === requestedDefaultModelName)
    ? requestedDefaultModelName
    : modelEntries[0][0]

  return {
    defaultModelName: effectiveDefaultModelName,
    models: modelEntries.map(([modelName, value]) => toEditableModelEntry(modelName, value, effectiveDefaultModelName)),
  }
}

export function loadEditableModelConfig(installDir: string): EditableModelConfig {
  const registry = loadEditableModelRegistry(installDir)
  const selected = registry.models.find((item) => item.isDefault) ?? registry.models[0]

  return {
    provider: selected.provider,
    apiKey: selected.apiKey,
    baseUrl: selected.baseUrl,
    model: selected.model,
    modelName: selected.modelName,
  }
}

function ensureRuntimeLlmFile(installDir: string): string {
  const configDir = resolveRuntimeConfigDir()
  const llmPath = join(configDir, "llm.yaml")

  mkdirSync(configDir, { recursive: true })
  if (!existsSync(llmPath)) {
    const examplePath = join(installDir, "data", "configs.example", "llm.yaml")
    if (existsSync(examplePath)) {
      copyFileSync(examplePath, llmPath)
    } else {
      writeFileSync(llmPath, "# LLM 配置（模型池）\n\ndefaultModel: default\nmodels: {}\n", "utf-8")
    }
  }

  return llmPath
}

export function writeEditableModelConfig(
  installDir: string,
  config: EditableModelConfig & { originalModelName?: string },
): void {
  const llmPath = ensureRuntimeLlmFile(installDir)
  const existing = readYamlSafe(llmPath)
  const rawModels = existing.models && typeof existing.models === "object"
    ? { ...(existing.models as Record<string, unknown>) }
    : {}

  const originalModelName = normalizeText(config.originalModelName) ?? config.modelName
  const existingEntry = originalModelName && rawModels[originalModelName] && typeof rawModels[originalModelName] === "object"
    ? rawModels[originalModelName] as Record<string, unknown>
    : {}

  if (originalModelName !== config.modelName) {
    delete rawModels[originalModelName]
  }

  const providerDefaults = PROVIDER_DEFAULTS[config.provider] ?? PROVIDER_DEFAULTS.gemini
  const model = config.provider === "deepseek" ? normalizeDeepSeekModelId(config.model) : config.model
  rawModels[config.modelName] = {
    ...existingEntry,
    provider: config.provider,
    apiKey: config.apiKey,
    model,
    baseUrl: config.provider === "deepseek" ? providerDefaults.baseUrl : config.baseUrl,
  }

  const currentDefaultModel = normalizeText(existing.defaultModel)
  let nextDefaultModel = currentDefaultModel ?? config.modelName

  if (currentDefaultModel === originalModelName) {
    nextDefaultModel = config.modelName
  }

  if (!rawModels[nextDefaultModel]) {
    nextDefaultModel = config.modelName
  }

  const nextConfig = {
    ...existing,
    defaultModel: nextDefaultModel,
    models: rawModels,
  }

  const content = `# LLM 配置（模型池）\n\n${stringify(nextConfig, { indent: 2 })}`
  writeFileSync(llmPath, content, "utf-8")
}
