/**
 * 内嵌默认配置模板
 *
 * 编译后的独立二进制在 data/configs.example/ 不可用时，
 * 使用这些内嵌内容初始化 ~/.iris/configs/。
 *
 * 注意：修改 data/configs.example/ 后应同步更新此文件。
 */

export const EMBEDDED_CONFIG_DEFAULTS: Record<string, string> = {
  'llm.yaml': `# LLM 配置（模型池）
# defaultModel: 启动时默认使用的模型名称
# rememberPlatformModel: 记住各平台上次使用的模型
# summaryModel: 用于 /compact 上下文压缩的模型名称
# models:       可用模型列表，键名就是模型名称

defaultModel: gemini_flash
rememberPlatformModel: true
# summaryModel: gemini_flash

models:
  gemini_flash:
    provider: gemini
    apiKey: your-api-key-here
    model: gemini-2.0-flash
    baseUrl: https://generativelanguage.googleapis.com/v1beta
    supportsVision: true
    # contextWindow: 1048576
    # autoSummaryThreshold: "80%"
    # headers:
    #   x-custom-header: hello
    # requestBody:
    #   generationConfig:
    #     maxOutputTokens: 32000

  # gpt4o_mini:
  #   provider: openai-compatible
  #   apiKey: your-api-key-here
  #   model: gpt-4o-mini
  #   baseUrl: https://api.openai.com/v1

  # claude_sonnet:
  #   provider: claude
  #   apiKey: your-api-key-here
  #   model: claude-sonnet-4-6
  #   baseUrl: https://api.anthropic.com/v1
  #   promptCaching: true
  #   autoCaching: true
`,

  'platform.yaml': `# 平台配置
# 类型: console | discord | telegram | web | weixin | wxwork | lark | qq
# 注意：lark / telegram 由随包附带的 extensions 注册；discord / qq / wxwork / weixin 为可选 extension，使用前需先安装。
type: console

pairing:
  dmPolicy: pairing
  # admin: "telegram:123456"
  # allowFrom: ["telegram:123"]

web:
  port: 8192
  host: 127.0.0.1
  # authToken: your-secret-token-here
  # managementToken: your-management-token-here
`,

  'storage.yaml': `# 存储配置
# 类型: json-file | sqlite
type: json-file
# dir: ~/.iris/sessions
# dbPath: ~/.iris/iris.db
`,

  'system.yaml': `# 系统配置
systemPrompt: ""
maxToolRounds: 200
stream: true
retryOnError: true
maxRetries: 3
# maxAgentDepth: 3
# defaultMode: code
# logRequests: true
# asyncSubAgents: true
`,

  'tools.yaml': `# 工具配置
read_file:
  autoApprove: true
search_in_files:
  autoApprove: true
  showApprovalView: true
find_files:
  autoApprove: true
list_files:
  autoApprove: true
read_skill:
  autoApprove: true
write_file:
  autoApprove: false
  showApprovalView: true
apply_diff:
  autoApprove: false
  showApprovalView: true
insert_code:
  autoApprove: false
  showApprovalView: true
delete_code:
  autoApprove: false
  showApprovalView: true
delete_file:
  autoApprove: false
create_directory:
  autoApprove: false
shell:
  autoApprove: false
sub_agent:
  autoApprove: false
# autoApproveAll: true
# autoApproveConfirmation: true
# autoApproveDiff: true
# disabledTools:
#   - memory_search
`,

  'memory.yaml': `# 记忆配置
enabled: false
`,

  'sub_agents.yaml': `# 子代理配置
enabled: true
stream: true
types:
  general-purpose:
    enabled: true
    description: "执行需要多步工具操作的复杂子任务。适合承接相对独立的子任务。"
    systemPrompt: "你是一个通用子代理，负责独立完成委派给你的子任务。请专注于完成任务并返回清晰的结果。"
    excludedTools:
      - sub_agent
    stream: true
    parallel: false
    # background: false
    maxToolRounds: 200
  explore:
    enabled: true
    description: "只读搜索和阅读文件、执行查询命令。不做修改，只返回发现的信息。"
    systemPrompt: "你是一个只读探索代理，负责搜索和阅读信息。不要修改任何文件，只返回你发现的内容。"
    allowedTools:
      - read_file
      - search_in_files
      - find_files
      - list_files
      - shell
    stream: true
    parallel: true
    # background: false
    maxToolRounds: 200
`,

  'mcp.yaml': `# MCP 服务器配置
# servers:
#   filesystem:
#     transport: stdio
#     command: npx
#     args: ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/dir"]
`,

  'modes.yaml': `# 模式配置
# 不同模式可定义不同的系统提示词和工具策略
`,

  'ocr.yaml': `# OCR 配置（可选）
# provider: openai-compatible
# apiKey: your-api-key-here
# baseUrl: https://api.openai.com/v1
# model: gpt-4o-mini
`,

  'plugins.yaml': `# 插件配置
# plugins:
#   - name: my-tool
#     enabled: true
`,

  'summary.yaml': `# 上下文压缩配置（/compact 指令）
# 使用默认提示词，通常无需修改
`,
};
