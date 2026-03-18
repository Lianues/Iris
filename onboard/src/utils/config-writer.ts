/**
 * 配置文件生成器
 * 将用户在 onboard 中的选择写入 data/configs/*.yaml
 *
 * 采用合并模式：读取已有配置，追加/更新字段，不丢失用户手动添加的内容。
 *
 * 跳过策略：用户在 onboard 中主动跳过的步骤，其对应字段不会写入配置文件。
 * - LLM 三步（provider / apiKey / model）是一个整体，任何一步跳过则整个模型条目不写入 llm.yaml
 * - platform 跳过则不修改 platform.yaml 的 type 和平台子配置
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
  platform: "console" | "web" | "wxwork" | "telegram" | "lark"
  webPort: number
  /** 企业微信 Bot ID（platform === 'wxwork' 时使用） */
  wxworkBotId: string
  /** 企业微信 Bot Secret（platform === 'wxwork' 时使用） */
  wxworkSecret: string
  /** Telegram Bot Token（platform === 'telegram' 时使用） */
  telegramToken: string
  /** 飞书 App ID（platform === 'lark' 时使用） */
  larkAppId: string
  /** 飞书 App Secret（platform === 'lark' 时使用） */
  larkAppSecret: string
}

/** 各步骤的跳过状态 */
export type SkippedSteps = Record<"provider" | "apiKey" | "model" | "platform", boolean>

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
 * - llm.yaml：仅在 LLM 三步（provider/apiKey/model）全部未跳过时才写入模型条目
 * - platform.yaml：仅在 platform 步骤未跳过时才写入 type 和对应平台配置
 * - system.yaml / storage.yaml：仅在不存在时写入默认值（不受跳过影响）
 */
export function writeConfigs(irisDir: string, config: OnboardConfig, skippedSteps: SkippedSteps): void {
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
  // LLM 配置是一个整体：provider + apiKey + model 三步全部完成才有意义。
  // 任何一步跳过都意味着用户没有提供完整的模型信息，此时不写入模型条目，
  // 保留已有文件原样，避免写入半成品配置导致启动失败。
  const llmSkipped = skippedSteps.provider || skippedSteps.apiKey || skippedSteps.model
  if (!llmSkipped) {
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
  }

  // ── 合并写入 platform.yaml ──
  // platform 跳过时不修改 type 和平台子配置，保留已有文件原样。
  if (!skippedSteps.platform) {
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
    if (config.platform === "wxwork") {
      // 保留已有的 wxwork 配置（showToolStatus 等），仅更新 botId 和 secret
      const existingWxwork = (existingPlatform.wxwork && typeof existingPlatform.wxwork === "object")
        ? existingPlatform.wxwork as Record<string, unknown>
        : {}
      platformConfig.wxwork = {
        ...existingWxwork,
        botId: config.wxworkBotId,
        secret: config.wxworkSecret,
      }
    }
    if (config.platform === "telegram") {
      // 保留已有的 telegram 配置（showToolStatus 等），仅更新 token
      const existingTg = (existingPlatform.telegram && typeof existingPlatform.telegram === "object")
        ? existingPlatform.telegram as Record<string, unknown>
        : {}
      platformConfig.telegram = {
        ...existingTg,
        token: config.telegramToken,
      }
    }
    if (config.platform === "lark") {
      // 保留已有的 lark 配置（showToolStatus 等），仅更新 appId 和 appSecret
      const existingLark = (existingPlatform.lark && typeof existingPlatform.lark === "object")
        ? existingPlatform.lark as Record<string, unknown>
        : {}
      platformConfig.lark = {
        ...existingLark,
        appId: config.larkAppId,
        appSecret: config.larkAppSecret,
      }
    }
    writeYaml(platformPath, platformConfig, "平台配置")
  }

  // ── 写入 system.yaml（仅不存在时）──
  // 基础配置文件不受跳过影响，始终确保存在
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
