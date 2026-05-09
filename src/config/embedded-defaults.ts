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
# 类型: console | web | telegram | discord | weixin | wxwork | lark | qq | headless
# 注意：console / web / telegram / cron 由随包附带的 extensions 注册；lark / discord / qq / wxwork / weixin 为可选 extension，使用前需先安装。
# headless 表示仅启动 Core / IPC，不启动 TUI / GUI / Bot 平台。
# headless 的别名：core / none / daemon。也可通过环境变量临时覆盖：IRIS_PLATFORM=headless
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
#
# 会话数据的持久化后端，支持两种模式：
#
# json-file（默认）：
#   - 每个会话一个 .json 文件，存放在 dir 目录下
#   - 可直接阅读/编辑 JSON 文件，适合小规模使用
#
# sqlite：
#   - 单个 SQLite 数据库文件，WAL 模式，天然支持并发
#   - 大量会话时性能更优

# 类型: json-file | sqlite
type: json-file

# 会话数据目录（默认 ~/.iris/sessions/，type 为 json-file 时使用）
# dir: ~/.iris/sessions

# SQLite 数据库路径（默认 ~/.iris/iris.db，type 为 sqlite 时使用）
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

# 扩展发现范围（仅控制 workspace 源；embedded 与 installed 不受影响）：
#   - embedded：发行包/源码仓库自带（在 extensions/embedded.json 中声明），始终参与发现，
#               要关闭某个 embedded 扩展请到 plugins.yaml 写 enabled: false。
#   - installed：~/.iris/extensions/ 下用户主动安装的，始终参与发现。
#   - workspace：源码仓库 <projectRoot>/extensions/ 中**非 embedded** 的"额外"扩展，
#               默认 **不参与发现**；下面打开后还可用 workspaceAllowlist 收窄。
extensions:
  loadWorkspaceExtensions: false
  workspaceAllowlist: []
  #   - virtual-lover
  #   - sillytavern

# 开发模式：在已被发现的扩展中，哪些用源码入口（src/index.ts）而不是 dist/index.mjs。
# 仅在非编译二进制下生效。
# devSourceExtensions:
#   - cron
#   - memory
# devSourceSdk: true

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
  classifier:
    enabled: true
bash:
  autoApprove: false
  classifier:
    enabled: true
sub_agent:
  autoApprove: false
manage_variables:
  autoApprove: true
# autoApproveAll: true
# autoApproveConfirmation: true
# autoApproveDiff: true
# disabledTools:
#   - memory_search
`,

  'memory.yaml': `# 记忆插件配置
#
# 启用后，LLM 可通过 memory_search / memory_add / memory_update / memory_delete 工具
# 读写长期记忆，实现跨会话的信息持久化。
#
# 存储后端：SQLite + FTS5 全文检索
# 数据库文件默认存放在数据目录下的 memory.db

# 是否启用记忆
enabled: false

# 数据库路径（相对于数据目录，或绝对路径）
# dbPath: ./memory.db

# ── 自动提取（对话结束后自动从对话中提取值得记住的信息）──
autoExtract: true
# 每 N 轮对话后提取一次
extractInterval: 1

# ── 智能检索（每轮对话前自动注入相关记忆到上下文）──
autoRecall: true
# 每轮注入记忆的最大大小（字节）
maxContextBytes: 20480
# 会话级记忆注入总上限（字节）
sessionBudgetBytes: 61440

# ── 跨会话归纳（定期整理合并冗余记忆）──
consolidation:
  enabled: true
  # 两次归纳之间的最小间隔（小时）
  minHours: 24
  # 触发归纳的最少新会话数
  minSessions: 3
`,

  'delivery.yaml': `# 主动投递配置
#
# bindings 用于把“业务插件要发给谁”和“具体平台目标”解耦。
# 例如 virtual-lover 可以只引用 binding: lover-main，而不关心 Telegram chat_id。

bindings:
  # lover-main:
  #   label: Lover Telegram
  #   platform: telegram
  #   target:
  #     kind: chat
  #     id: "123456789"
  #     # Telegram 话题/Forum topic 可填写 threadId
  #     # threadId: "1"
  #   # policy: lover-default
  #   enabled: true

policies:
  # lover-default:
  #   label: Lover proactive default policy
  #   enabled: true
  #   cooldownMinutes: 180
  #   maxPerDay: 3
  #   quietHours:
  #     enabled: true
  #     allowUrgent: false
  #     windows:
  #       - start: "23:30"
  #         end: "07:30"
  #   skipIfRecentActivity:
  #     enabled: true
  #     withinMinutes: 10
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
      - bash
    stream: true
    parallel: true
    # background: false
    maxToolRounds: 200
`,

  // mcp.yaml: 由 mcp 扩展通过 ensureConfigFile 自行管理

  'modes.yaml': `# 模式配置
# 不同模式可定义不同的系统提示词和工具策略
# 通过 /mode 命令切换模式
#
# 每个模式支持以下字段：
#   description    - 模式描述（供人类和 LLM 了解用途）
#   systemPrompt   - 该模式的系统提示词（覆盖默认提示词）
#   tools          - 工具过滤规则
#     include      - 白名单：仅允许这些工具（优先于 exclude）
#     exclude      - 黑名单：排除这些工具

# code:
#   description: "代码开发模式"
#   systemPrompt: "你是一个专注于代码开发的 AI 助手。"
#   tools:
#     exclude: [memory_add, memory_delete]
#
# readonly:
#   description: "只读分析模式"
#   tools:
#     include: [read_file, search_in_files, find_files, list_files, memory_search, get_current_time]
`,

  'ocr.yaml': `# OCR 配置（可选）
#
# 当主模型不支持图片输入（supportsVision: false）时，
# Iris 会调用这里配置的 vision 模型提取图片中的文字和内容，
# 再把提取结果作为文本注入主对话模型的上下文。
#
# 何时需要配置：
#   - 主模型是纯文本模型，但用户会上传图片
#   - 主模型本身支持图片输入时，通常不需要配置 OCR
#
# 删除整个文件或注释掉所有字段即可关闭 OCR 回退。

# provider: openai-compatible    # 当前仅支持 openai-compatible
# apiKey: your-api-key-here      # OCR 模型的 API Key
# baseUrl: https://api.openai.com/v1  # API 基地址
# model: gpt-4o-mini             # 推荐使用轻量 vision 模型
`,

  // plugins.yaml — 插件覆盖配置（可选）。
  //
  // 全局 ~/.iris/configs/plugins.yaml：
  //   只能控制 installed (~/.iris/extensions/) + embedded 扩展。
  //   列出 agent-installed 或不存在的扩展会被 warn 后忽略。
  //
  // Agent ~/.iris/agents/<id>/configs/plugins.yaml：
  //   1) 控制本 agent 的 agent-installed 扩展（~/.iris/agents/<id>/extensions/）；
  //   2) 可覆盖全局可见扩展的 enabled / priority / config（按 name 浅合并）。
  //   不允许出现 type=npm 的条目（npm 类扩展只能在全局声明）。
  'plugins.yaml': `# 插件覆盖配置（仅在需要时填写）
# 全局层只能控制 installed + embedded；agent 层管 agent-installed 并可覆盖全局。
# 详见 src/config/plugins.ts 顶部注释。
plugins:
#   - name: memory
#     enabled: false    # 禁用自动发现的插件
#   - name: my-tool
#     priority: 100
#     config:
#       apiKey: "xxx"
`,

  'summary.yaml': `# 上下文压缩配置（/compact 指令）
# 使用默认提示词，通常无需修改
`,

  'cloudflare.yaml': `# Cloudflare 管理配置
# 用于通过 Web GUI 管理 DNS 记录和 SSL 设置
#
# API Token 解析优先级：apiToken > apiTokenEnv > apiTokenFile
# 三者都不配置则视为未配置 Cloudflare

# 方式一：直接填写 API Token（不推荐，明文存储）
# apiToken: your-cloudflare-api-token

# 方式二：从环境变量读取（推荐）
# apiTokenEnv: IRIS_CF_API_TOKEN

# 方式三：从文件读取（绝对路径，或相对于配置目录）
# apiTokenFile: /etc/iris/cf-token.txt

# Zone ID（不填则自动选择账号下的第一个 zone）
# zoneId: auto
`,
};
