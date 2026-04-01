export interface ConfigFileMeta {
  filename: string
  label: string
  description: string
}

/**
 * 预定义的配置文件元数据，按建议浏览顺序排列。
 * 文件名对应 ~/.iris/configs/ 和 data/configs.example/ 下的 YAML 文件。
 */
export const CONFIG_FILE_META: ConfigFileMeta[] = [
  { filename: "system.yaml", label: "系统配置", description: "系统提示词、工具轮次、流式输出、重试策略等核心参数" },
  { filename: "llm.yaml", label: "模型配置", description: "默认模型、模型池定义、提供商参数" },
  { filename: "tools.yaml", label: "工具配置", description: "工具防御参数、审批策略、Shell 白名单/黑名单" },
  { filename: "platform.yaml", label: "平台配置", description: "运行平台类型及各平台参数（console / web / telegram 等）" },
  { filename: "storage.yaml", label: "存储配置", description: "会话存储类型和数据路径" },
  { filename: "mcp.yaml", label: "MCP 服务器", description: "外部 MCP 服务器连接配置" },
  { filename: "modes.yaml", label: "模式配置", description: "自定义模式的提示词和工具策略" },
  { filename: "ocr.yaml", label: "OCR 配置", description: "图片文字识别回退模型" },
  { filename: "plugins.yaml", label: "插件配置", description: "插件加载与参数配置" },
  { filename: "sub_agents.yaml", label: "子代理配置", description: "子代理类型定义与参数" },
  { filename: "summary.yaml", label: "上下文压缩", description: "/compact 指令的系统提示词与用户提示词" },
]

const metaMap = new Map(CONFIG_FILE_META.map((m) => [m.filename, m]))

export function getConfigFileMeta(filename: string): ConfigFileMeta {
  return metaMap.get(filename) ?? {
    filename,
    label: filename.replace(/\.ya?ml$/, ""),
    description: "YAML 配置文件",
  }
}
