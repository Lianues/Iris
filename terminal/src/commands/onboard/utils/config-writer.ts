/**
 * 配置文件生成器
 * 将用户在 onboard 中的选择写入运行时数据目录中的 configs/*.yaml。
 *
 * 模板文件从安装目录的 data/configs.example/ 读取，
 * 目标目录与主程序保持一致：IRIS_DATA_DIR/configs 或 ~/.iris/configs。
 *
 * 采用合并模式：读取已有配置，追加/更新字段，不丢失用户手动添加的内容。
 *
 * 跳过策略：
 * - LLM 三步（provider / apiKey / model）是一个整体，任何一步跳过则整个模型条目不写入 llm.yaml
 * - platform 跳过则不修改 platform.yaml 的 type 和平台子配置
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { parse, stringify } from "yaml"

/**
 * 内嵌的可选配置文件模板。
 *
 * 当 onboard 以编译后二进制形式运行时，data/configs.example/ 目录不可用，
 * 导致 mcp.yaml / modes.yaml / plugins.yaml 等可选配置文件不会被复制到用户目录。
 * 主程序的兜底初始化逻辑又因为 onboard 已创建了配置目录而被跳过，
 * 最终用户目录中缺少这些可选配置文件。
 *
 * 此处内嵌一份与 src/config/embedded-defaults.ts 中对应的可选模板，
 * 在 exampleDir 不存在时用于补写缺失文件。
 */
const FALLBACK_OPTIONAL_CONFIGS: Record<string, string> = {
  'mcp.yaml': `# MCP 服务器配置\n# servers:\n#   filesystem:\n#     transport: stdio\n#     command: npx\n#     args: ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/dir"]\n`,
  'modes.yaml': `# 模式配置\n# 不同模式可定义不同的系统提示词和工具策略\n`,
  'ocr.yaml': `# OCR 配置（可选）\n# provider: openai-compatible\n# apiKey: your-api-key-here\n# baseUrl: https://api.openai.com/v1\n# model: gpt-4o-mini\n`,
  'plugins.yaml': `# 插件配置\n# plugins:\n#   - name: my-tool\n#     enabled: true\n`,
  'summary.yaml': `# 上下文压缩配置（/compact 指令）\n# 使用默认提示词，通常无需修改\n`,
  'memory.yaml': `# 记忆配置\nenabled: false\n`,
  'sub_agents.yaml': `# 子代理配置\nenabled: true\nstream: true\ntypes:\n  general-purpose:\n    enabled: true\n    description: "执行需要多步工具操作的复杂子任务。适合承接相对独立的子任务。"\n    systemPrompt: "你是一个通用子代理，负责独立完成委派给你的子任务。请专注于完成任务并返回清晰的结果。"\n    excludedTools:\n      - sub_agent\n    stream: true\n    parallel: false\n    maxToolRounds: 200\n  explore:\n    enabled: true\n    description: "只读搜索和阅读文件、执行查询命令。不做修改，只返回发现的信息。"\n    systemPrompt: "你是一个只读探索代理，负责搜索和阅读信息。不要修改任何文件，只返回你发现的内容。"\n    allowedTools:\n      - read_file\n      - search_in_files\n      - find_files\n      - list_files\n      - shell\n    stream: true\n    parallel: true\n    maxToolRounds: 200\n`,
  'tools.yaml': `# 工具配置\nread_file:\n  autoApprove: true\nsearch_in_files:\n  autoApprove: true\n  showApprovalView: true\nfind_files:\n  autoApprove: true\nlist_files:\n  autoApprove: true\nread_skill:\n  autoApprove: true\nread_skill_resource:\n  autoApprove: true\nexecute_skill_script:\n  autoApprove: false\ninvoke_skill:\n  autoApprove: false\nwrite_file:\n  autoApprove: false\n  showApprovalView: true\napply_diff:\n  autoApprove: false\n  showApprovalView: true\ninsert_code:\n  autoApprove: false\n  showApprovalView: true\ndelete_code:\n  autoApprove: false\n  showApprovalView: true\ndelete_file:\n  autoApprove: false\ncreate_directory:\n  autoApprove: false\nshell:\n  autoApprove: false\nsub_agent:\n  autoApprove: false\n`,
}

import { resolveOnboardPlatformOption } from "./platform-catalog.js"
import { resolveRuntimeConfigDir } from "./runtime-paths.js"

export interface OnboardConfig {
  provider: "deepseek" | "gemini" | "openai-compatible" | "openai-responses" | "claude"
  apiKey: string
  model: string
  baseUrl: string
  modelName: string
  platform: string
  platformValues: Record<string, string | number | boolean>
}

export type SkippedSteps = Record<"provider" | "apiKey" | "model" | "platform", boolean>

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

const DEEPSEEK_BASE_URL = PROVIDER_DEFAULTS.deepseek.baseUrl
const DEEPSEEK_MODEL_IDS = ["deepseek-v4-flash", "deepseek-v4-pro"] as const

function normalizeDeepSeekModelId(modelId: unknown): string {
  const value = typeof modelId === "string" ? modelId.trim() : ""
  return (DEEPSEEK_MODEL_IDS as readonly string[]).includes(value)
    ? value
    : DEEPSEEK_MODEL_IDS[0]
}

export const PROVIDER_LABELS: Record<string, string> = {
  deepseek: "DeepSeek",
  gemini: "Google Gemini",
  "openai-compatible": "OpenAI Compatible",
  "openai-responses": "OpenAI Responses",
  claude: "Anthropic Claude",
}

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

export function writeConfigs(installDir: string, config: OnboardConfig, skippedSteps: SkippedSteps): void {
  const configDir = resolveRuntimeConfigDir()
  const exampleDir = join(installDir, "data", "configs.example")

  mkdirSync(configDir, { recursive: true })

  if (existsSync(exampleDir)) {
    const exampleFiles = readdirSync(exampleDir).filter((file) => file.endsWith(".yaml"))
    for (const file of exampleFiles) {
      const target = join(configDir, file)
      if (!existsSync(target)) {
        copyFileSync(join(exampleDir, file), target)
      }
    }
  } else {
    // 编译后二进制模式下 data/configs.example/ 不可用，
    // 使用内嵌模板补写缺失的可选配置文件（mcp.yaml、modes.yaml 等），
    // 避免用户 onboard 后配置目录中缺少这些文件。
    for (const [filename, content] of Object.entries(FALLBACK_OPTIONAL_CONFIGS)) {
      const target = join(configDir, filename)
      if (!existsSync(target)) {
        writeFileSync(target, content, "utf-8")
      }
    }
  }

  const llmSkipped = skippedSteps.provider || skippedSteps.apiKey || skippedSteps.model
  if (!llmSkipped) {
    const llmPath = join(configDir, "llm.yaml")
    const existingLlm = readYamlSafe(llmPath)
    const modelKey = config.modelName || config.provider.replace(/-/g, "_")
    const existingModels = (existingLlm.models && typeof existingLlm.models === "object")
      ? existingLlm.models as Record<string, unknown>
      : {}

    const baseUrl = config.provider === "deepseek" ? DEEPSEEK_BASE_URL : config.baseUrl
    const model = config.provider === "deepseek" ? normalizeDeepSeekModelId(config.model) : config.model
    const llmConfig = {
      ...existingLlm,
      defaultModel: modelKey,
      models: {
        ...existingModels,
        [modelKey]: {
          provider: config.provider,
          apiKey: config.apiKey,
          model,
          baseUrl,
        },
      },
    }
    writeYaml(llmPath, llmConfig, "LLM 配置（模型池）")
  }

  if (!skippedSteps.platform) {
    const platformPath = join(configDir, "platform.yaml")
    const existingPlatform = readYamlSafe(platformPath)
    const platformOption = resolveOnboardPlatformOption(installDir, config.platform)
    const existingSection = (existingPlatform[config.platform] && typeof existingPlatform[config.platform] === "object")
      ? existingPlatform[config.platform] as Record<string, unknown>
      : {}

    const mergedPlatformValues: Record<string, unknown> = {
      ...existingSection,
      ...config.platformValues,
    }

    const platformConfig: Record<string, unknown> = {
      ...existingPlatform,
      type: config.platform,
    }

    if (config.platform === "web") {
      platformConfig.web = {
        ...mergedPlatformValues,
        host: "0.0.0.0",
      }
    } else if (
      Object.keys(mergedPlatformValues).length > 0
      || (platformOption?.panelFields.length ?? 0) > 0
      || Object.keys(existingSection).length > 0
    ) {
      platformConfig[config.platform] = mergedPlatformValues
    }

    writeYaml(platformPath, platformConfig, "平台配置")
  }

  if (!existsSync(join(configDir, "system.yaml"))) {
    writeYaml(join(configDir, "system.yaml"), {
      systemPrompt: "",
      maxToolRounds: 200,
      stream: true,
    }, "系统配置")
  }

  if (!existsSync(join(configDir, "storage.yaml"))) {
    writeYaml(join(configDir, "storage.yaml"), {
      type: "json-file",
    }, "存储配置")
  }
}

function writeYaml(filepath: string, data: unknown, header: string): void {
  const content = `# ${header}\n\n${stringify(data, { indent: 2 })}`
  writeFileSync(filepath, content, "utf-8")
}
