/**
 * 配置文件生成器
 * 将用户在 onboard 中的选择写入 data/configs/*.yaml
 *
 * 采用合并模式：读取已有配置，追加/更新字段，不丢失用户手动添加的内容。
 */
import { writeFileSync, readFileSync, mkdirSync, existsSync, copyFileSync, readdirSync } from "fs"
import { join } from "path"
import { stringify, parse } from "yaml"

export interface OnboardConfig {
  provider: "gemini" | "openai-compatible" | "openai-responses" | "claude"
  apiKey: string
  model: string
  baseUrl: string
  modelName: string
  platform: "console" | "web"
  webPort: number
}

/** Provider 默认值 */
export const PROVIDER_DEFAULTS: Record<
  string,
  { model: string; baseUrl: string; contextWindow: number }
> = {
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

/** Provider 显示名称 */
export const PROVIDER_LABELS: Record<string, string> = {
  gemini: "Google Gemini",
  "openai-compatible": "OpenAI Compatible",
  "openai-responses": "OpenAI Responses",
  claude: "Anthropic Claude",
}

/**
 * 安全读取并解析已有的 YAML 文件，失败则返回空对象
 */
function readYamlSafe(filepath: string): Record<string, unknown> {
  try {
    if (!existsSync(filepath)) return {}
    const content = readFileSync(filepath, "utf-8")
    const parsed = parse(content)
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/**
 * 将 onboard 配置合并写入 YAML 文件
 *
 * 合并策略：
 * - llm.yaml：保留已有模型，追加/更新本次配置的模型，更新 defaultModel
 * - platform.yaml：保留已有字段（discord/telegram token 等），仅更新 type 和对应平台配置
 * - system.yaml / storage.yaml：仅在不存在时写入默认值
 */
export function writeConfigs(irisDir: string, config: OnboardConfig): void {
  const configDir = join(irisDir, "data", "configs")
  const exampleDir = join(irisDir, "data", "configs.example")

  // 确保目录存在
  mkdirSync(configDir, { recursive: true })

  // 先从 example 复制所有未存在的可选配置
  if (existsSync(exampleDir)) {
    const exampleFiles = readdirSync(exampleDir).filter((f) => f.endsWith(".yaml"))
    for (const file of exampleFiles) {
      const target = join(configDir, file)
      if (!existsSync(target)) {
        copyFileSync(join(exampleDir, file), target)
      }
    }
  }

  // ── 合并写入 llm.yaml ──
  const llmPath = join(configDir, "llm.yaml")
  const existingLlm = readYamlSafe(llmPath)
  const modelKey = config.modelName || config.provider.replace(/-/g, "_")

  // 保留已有的 models，追加/覆盖本次的模型
  const existingModels = (existingLlm.models && typeof existingLlm.models === "object")
    ? existingLlm.models as Record<string, unknown>
    : {}

  const llmConfig = {
    ...existingLlm,
    defaultModel: modelKey,
    models: {
      ...existingModels,
      [modelKey]: {
        provider: config.provider,
        apiKey: config.apiKey,
        model: config.model,
        baseUrl: config.baseUrl,
      },
    },
  }
  writeYaml(llmPath, llmConfig, "LLM 配置（模型池）")

  // ── 合并写入 platform.yaml ──
  const platformPath = join(configDir, "platform.yaml")
  const existingPlatform = readYamlSafe(platformPath)

  const platformConfig: Record<string, unknown> = {
    ...existingPlatform,
    type: config.platform,
  }
  if (config.platform === "web") {
    // 保留已有的 web 配置（authToken、managementToken 等），仅更新 port 和 host
    const existingWeb = (existingPlatform.web && typeof existingPlatform.web === "object")
      ? existingPlatform.web as Record<string, unknown>
      : {}
    platformConfig.web = {
      ...existingWeb,
      port: config.webPort,
      host: "0.0.0.0",
    }
  }
  writeYaml(platformPath, platformConfig, "平台配置")

  // ── 写入 system.yaml（仅不存在时）──
  if (!existsSync(join(configDir, "system.yaml"))) {
    const systemConfig = {
      systemPrompt: "",
      maxToolRounds: 200,
      stream: true,
    }
    writeYaml(join(configDir, "system.yaml"), systemConfig, "系统配置")
  }

  // ── 写入 storage.yaml（仅不存在时）──
  if (!existsSync(join(configDir, "storage.yaml"))) {
    const storageConfig = {
      type: "json-file",
      dir: "./data/sessions",
    }
    writeYaml(join(configDir, "storage.yaml"), storageConfig, "存储配置")
  }
}

function writeYaml(filepath: string, data: unknown, header: string): void {
  const content = `# ${header}\n\n${stringify(data, { indent: 2 })}`
  writeFileSync(filepath, content, "utf-8")
}
