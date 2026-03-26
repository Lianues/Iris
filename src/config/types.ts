/**
 * 配置类型定义
 */

import type { OCRConfig } from './ocr';
import type { PairingConfig } from '../platforms/pairing/types';

export interface LLMConfig {
  provider: string;
  apiKey: string;
  /** 提供商真实模型 id */
  model: string;
  baseUrl: string;
  /** 模型上下文窗口大小（token 数），用于 TUI 显示占用比例 */
  contextWindow?: number;
  /** 显式声明当前模型是否支持图片输入 */
  supportsVision?: boolean;
  /**
   * 自动上下文压缩阈值（token 数超过此值时自动执行 /compact）
   * 支持绝对值（如 100000）或 contextWindow 百分比（如 "80%"）
   * 不设置则不自动压缩
   */
  autoSummaryThreshold?: number | string;
  /** 自定义请求头，会覆盖 provider 内置同名 header */
  headers?: Record<string, string>;
  /** 自定义请求体，会深合并到 provider 编码后的最终请求体，支持嵌套参数 */
  requestBody?: Record<string, unknown>;
  /**
   * [仅 Claude] 启用 Anthropic Prompt Caching（手动缓存断点）。
   *
   * 启用后，会在请求体的关键位置注入 cache_control: { type: "ephemeral" } 标记，
   * 遵循 Anthropic 的缓存前缀层级：
   *   1. tools    — 最后一个工具定义
   *   2. system   — 系统指令（转换为 content-block 数组）
   *   3. messages — 最后一条用户消息的最后一个内容块
   *
   * 最多使用 3 个断点（Anthropic 允许最多 4 个）。
   * 缓存读取仅需基础输入 token 价格的 10%。
   *
   * 仅在 provider 为 "claude" 时生效，其他 provider 忽略此选项。
   * 默认值：false
   */
  promptCaching?: boolean;
  /**
   * [仅 Claude] 启用 Anthropic 自动提示词缓存。
   *
   * 启用后，会在请求体顶层添加 cache_control: { type: "ephemeral" } 字段。
   * 服务端会自动将缓存断点放置在最后一个可缓存的内容块上，
   * 并随对话增长自动前移。不注入逐块标记。
   *
   * 可单独使用，也可与 promptCaching（显式断点）组合使用。
   * 组合使用时，自动断点占用 4 个可用槽位中的 1 个。
   * 仅在 provider 为 "claude" 时生效，其他 provider 忽略此选项。
   * 默认值：false
   */
  autoCaching?: boolean;
  [key: string]: unknown;
}

/** 具名模型配置（从 YAML 键名解析出 modelName） */
export interface LLMModelDef extends LLMConfig {
  modelName: string;
}

/** LLM 模型池配置 */
export interface LLMRegistryConfig {
  /** 启动时默认使用的模型名称 */
  defaultModelName: string;
  /** 是否记住各平台上次使用的模型（重启后自动恢复），默认 true */
  rememberPlatformModel?: boolean;
  /** 用于 /compact 上下文压缩的模型名称（需指向 models 中的某个模型，不填则使用 defaultModel） */
  summaryModelName?: string;
  /** 可用模型列表 */
  models: LLMModelDef[];
}

export interface PlatformConfig {
  /** 启动的平台类型列表（兼容单字符串和数组写法；支持插件平台注册的自定义平台） */
  types: string[];
  /** 全局对码配置 */
  pairing?: PairingConfig;
  discord: {
    token: string;
    /** 上次使用的模型名称（自动管理，rememberPlatformModel 启用时写入） */
    lastModel?: string;
    /** 对码配置（已与全局合并，由 parsePlatformConfig 填充默认值） */
    pairing?: PairingConfig;
  };
  telegram: {
    token: string;
    /** 上次使用的模型名称（自动管理） */
    lastModel?: string;
    /**
     * 是否在 Telegram 输出中展示工具状态。
     * 目的：为后续与飞书对齐的流式 / 审批 / MCP 状态展示预留统一开关。
     */
    showToolStatus?: boolean;
    /** 群聊中是否必须显式 @ 机器人后才响应，默认 true。 */
    groupMentionRequired?: boolean;
    /** 对码配置（已与全局合并，由 parsePlatformConfig 填充默认值） */
    pairing?: PairingConfig;
  };
  web: {
    port: number;
    host: string;
    /** 上次使用的模型名称（自动管理） */
    lastModel?: string;
    /** 全局 API 认证令牌（可选） */
    authToken?: string;
    /** 管理面令牌（可选，启用后 /api/config 需 X-Management-Token） */
    managementToken?: string;
  };
  wxwork: {
    botId: string;
    secret: string;
    /** 上次使用的模型名称（自动管理） */
    lastModel?: string;
    /** 是否在流式回复中展示工具执行状态（默认 true） */
    showToolStatus?: boolean;
    /** 对码配置（已与全局合并，由 parsePlatformConfig 填充默认值） */
    pairing?: PairingConfig;
  };
  lark: {
    /**
     * 飞书自建应用 App ID。
     * 目的：后续 Phase 1 会用它初始化官方 SDK 的 API Client 和 WebSocket Client。
     */
    appId: string;
    /** 飞书自建应用 App Secret，用于调用 OpenAPI 和建立长连接。 */
    appSecret: string;
    /** 上次使用的模型名称（自动管理） */
    lastModel?: string;
    /** 可选：Webhook 模式验签 token；当前预留字段，便于后续扩展。 */
    verificationToken?: string;
    /** 可选：Webhook 模式消息解密 key；当前预留字段，便于后续扩展。 */
    encryptKey?: string;
    /** 是否在流式回复中展示工具执行状态（默认 true）。 */
    showToolStatus?: boolean;
    /** 对码配置（已与全局合并，由 parsePlatformConfig 填充默认值） */
    pairing?: PairingConfig;
  };
  weixin: {
    /** ilink Bot Token（扫码登录后获取） */
    botToken?: string;
    /** 上次使用的模型名称（自动管理） */
    lastModel?: string;
    /** 可选：覆盖 API 基地址（默认 https://ilinkai.weixin.qq.com） */
    baseUrl?: string;
    /** 是否在回复中展示工具执行状态（默认 true） */
    showToolStatus?: boolean;
    /** 对码配置（已与全局合并，由 parsePlatformConfig 填充默认值） */
    pairing?: PairingConfig;
  };
  qq: {
    /** NapCat OneBot v11 正向 WebSocket 地址 */
    wsUrl: string;
    /** 上次使用的模型名称（自动管理） */
    lastModel?: string;
    /** OneBot access_token（可选，用于鉴权） */
    accessToken?: string;
    /** 机器人自身 QQ 号（用于群聊 @ 判断） */
    selfId: string;
    /** 群聊响应模式：'at' = 只响应 @机器人（默认），'all' = 响应所有消息，'off' = 不响应群聊 */
    groupMode?: 'at' | 'all' | 'off';
    /** 是否在回复中展示工具执行状态（默认 true） */
    showToolStatus?: boolean;
    /** 对码配置（已与全局合并，由 parsePlatformConfig 填充默认值） */
    pairing?: PairingConfig;
  };
  [key: string]: unknown;
}

export interface StorageConfig {
  type: string;
  dir: string;
  dbPath?: string;
  [key: string]: unknown;
}

export interface ToolPolicyConfig {
  /** 工具执行前是否自动批准（无需用户确认），默认 false */
  autoApprove: boolean;
  /**
   * Shell 工具专用：命令模式匹配列表。
   *
   * 支持的模式语法（allowPatterns / denyPatterns 通用）：
   *   - `*`   匹配任意字符序列
   *   - `**`  同 `*`（语义等价，兼容习惯写法）
   *   - `?`   匹配单个字符
   *   - `/regex/flags`  以 `/` 包裹的字符串按正则表达式解析
   *
   * 判定优先级（从高到低）：
   *   1. denyPatterns  — 匹配则 **必须手动确认**（即使 autoApprove: true）
   *   2. allowPatterns — 匹配则 **自动执行**（即使 autoApprove: false）
   *   3. autoApprove   — 以上都不匹配时的兜底策略
   */
  /** Console TUI 专用：是否显示 diff 审批视图。apply_diff、write_file、search_in_files.replace 默认 true */
  showApprovalView?: boolean;

  allowPatterns?: string[];
  denyPatterns?: string[];
}

export interface ToolsConfig {
  /** 工具防御性参数限制（可选，缺省使用内置默认值） */
  limits?: Partial<import('../tools/tool-limits').ToolLimitsConfig>;
  /** 全局：跳过所有审批（一类 + 二类），最高优先级 */
  autoApproveAll?: boolean;
  /** 全局：跳过所有一类审批（Y/N 确认） */
  autoApproveConfirmation?: boolean;
  /** 全局：跳过所有二类审批（diff 预览） */
  autoApproveDiff?: boolean;
  /**
   * 按工具名称定义执行策略。
   * 未配置的工具视为不允许执行。
   */
  permissions: Record<string, ToolPolicyConfig>;
  /** 被禁用的工具名称列表（不会发送给 LLM） */
  disabledTools?: string[];
}

/** Skill 定义（按需加载的提示词模块） */
export interface SkillDefinition {
  /**
   * Skill 名称。
   * 命名规则：仅允许 ASCII 字母、数字、下划线、连字符，最长 64 字符。
   * 正则：^[a-zA-Z0-9_-]{1,64}$
   */
  name: string;
  /** Skill 描述 */
  description?: string;
  /** Skill 提示词内容（通过 read_skill 工具按需返回） */
  content: string;
  /**
   * Skill 的路径标识。
   * 对文件系统 Skill，这是 SKILL.md 的绝对路径；
   * 对 system.yaml 内联 Skill，这是形如 inline:<name> 的稳定标识。
   */
  path: string;
  /** @deprecated 不再使用，保留仅为兼容旧配置 */
  enabled?: boolean;
}

export interface SystemConfig {
  systemPrompt: string;
  maxToolRounds: number;
  stream: boolean;
  /** LLM 调用报错时是否自动重试，默认 true */
  retryOnError: boolean;
  /** 自动重试最大次数，默认 3 */
  maxRetries: number;
  /** 子代理最大嵌套深度，默认 3 */
  maxAgentDepth: number;
  /** 默认模式名称（可选，需与 modes 中定义的名称对应） */
  defaultMode?: string;
  /** 是否记录 LLM 请求日志到文件，默认 false */
  logRequests?: boolean;
  /** Skill 定义列表（可选） */
  skills?: SkillDefinition[];
  /**
   * @deprecated 旧版 Skill 拼接注入引导词模板。
   *
   * 该字段仅为兼容旧配置保留，当前 Skill 已改为通过 read_skill 工具按需读取，
   * 不再拼接到用户消息末尾，因此此字段不再生效。
   *
   * 历史格式中用 {{SKILL}} 占位符标记 Skill 内容的插入位置。
   *
   * 读取旧配置时仍接受该字段，但运行时忽略。
   */
  skillPreamble?: string;
}

export interface MemoryConfig {
  /** 是否启用记忆，默认 false */
  enabled: boolean;
  /** 记忆提供商类型，默认 sqlite */
  type?: string;
  /** 数据库路径，默认 ~/.iris/memory.db */
  dbPath?: string;
  [key: string]: unknown;
}

export interface MCPServerConfig {
  transport: 'stdio' | 'sse' | 'streamable-http';
  command?: string;        // stdio
  args?: string[];         // stdio
  env?: Record<string, string>;  // stdio
  cwd?: string;            // stdio
  url?: string;            // sse / streamable-http
  headers?: Record<string, string>;  // sse / streamable-http
  timeout?: number;        // 通用，默认 30000
  enabled?: boolean;       // 通用，默认 true
}

export interface MCPConfig {
  servers: Record<string, MCPServerConfig>;
}

export interface ComputerUseConfig {
  /** 是否启用 Computer Use，默认 false */
  enabled: boolean;
  /** 执行环境: browser | screen */
  environment: 'browser' | 'screen';
  /** 屏幕/浏览器视口宽度（像素），推荐 1440 */
  screenWidth?: number;
  /** 屏幕/浏览器视口高度（像素），推荐 900 */
  screenHeight?: number;
  /** 操作后等待 UI 更新的延迟（毫秒），默认由环境实现自行控制 */
  postActionDelay?: number;
  /** 截图格式，默认 'png' */
  screenshotFormat?: 'png' | 'jpeg';
  /** JPEG 质量（1-100），仅 jpeg 格式时有效 */
  screenshotQuality?: number;
  /** 浏览器环境：是否无头模式，默认 false */
  headless?: boolean;
  /** 浏览器环境：初始 URL */
  initialUrl?: string;
  /** 浏览器环境：搜索引擎 URL */
  searchEngineUrl?: string;
  /** 浏览器环境：是否高亮鼠标位置 */
  highlightMouse?: boolean;
  /**
   * screen 环境：目标窗口选择器。
   *
   * 字符串形式：按标题子串匹配（兼容旧配置）。
   * 对象形式：支持 hwnd / title / exactTitle / processName / processId / className 多条件筛选。
   *
   * 仅作为启动时首次绑定的条件，绑定后锁定到窗口句柄。
   * 运行时可通过 /window 指令切换。
   * 不设置则为全屏模式。
   */
  targetWindow?: string | WindowSelector;
  /**
   * screen 环境：是否启用后台操作模式（仅窗口模式下有效）。
   * 启用后通过 PostMessage + PrintWindow 在后台操作窗口，不需要窗口在前台。
   * 对原生 Win32 应用（记事本、资源管理器等）兼容性较好，
   * 对 DirectX / GPU 加速窗口（浏览器、游戏等）可能截到黑屏或不响应操作。
   * 默认 false。
   */
  backgroundMode?: boolean;
  /**
   * 发送给 LLM 时保留截图的最近轮次数。
   * 超出此数量的旧轮次中，Computer Use 工具结果的截图会被剥离以节省 token。
   * 默认 3，与 Gemini 官方示例一致。设为 0 表示不保留任何截图，设为 Infinity 表示全部保留。
   */
  maxRecentScreenshots?: number;
  /**
   * 各环境下的工具策略。
   * 未配置时使用内置默认策略。配置后覆盖对应环境的默认策略。
   *
   * 三个层级（按当前运行环境自动选择一个）：
   *   - browser：Playwright 浏览器环境
   *   - screen：桌面全屏 / 窗口前台模式
   *   - background：桌面窗口后台模式（screen + backgroundMode）
   */
  environmentTools?: {
    browser?: CUToolPolicy;
    screen?: CUToolPolicy;
    background?: CUToolPolicy;
  };
}

/**
 * 窗口选择器（对象形式）。
 *
 * hwnd 优先级最高：填了 hwnd 就直接定位到该窗口，忽略其他字段。
 * 其他字段同时存在时取交集（全部匹配才选中）。
 */
export interface WindowSelector {
  /**
   * 窗口句柄（十六进制字符串，如 "0x001A0B2C"）。
   * 优先级最高，填了就直接定位，忽略其他所有字段。
   * 可通过 /window 指令查看。注意 HWND 在窗口关闭或重启后会变。
   */
  hwnd?: string;
  /** 标题子串匹配（不区分大小写） */
  title?: string;
  /** 标题精确匹配（区分大小写） */
  exactTitle?: string;
  /** 进程名称匹配（不含 .exe 后缀，不区分大小写） */
  processName?: string;
  /** 进程 ID 精确匹配。注意 PID 在进程重启后会变。 */
  processId?: number;
  /** 窗口类名匹配（精确匹配） */
  className?: string;
}

/**
 * Computer Use 单环境工具策略。
 * exclude 和 include 互斥，同时配置时 include 优先。
 */
export interface CUToolPolicy {
  /**
   * 工具白名单：仅启用列出的工具。
   * 优先于 exclude。
   */
  include?: string[];
  /**
   * 工具黑名单：排除列出的工具，其余全部启用。
   */
  exclude?: string[];
}

/** 上下文压缩（/compact）配置 */
export interface SummaryConfig {
  /** 总结 AI 的系统提示词 */
  systemPrompt: string;
  /** 追加在对话末尾的用户指令 */
  userPrompt: string;
}

export interface AppConfig {
  llm: LLMRegistryConfig;
  ocr?: OCRConfig;
  platform: PlatformConfig;
  storage: StorageConfig;
  tools: ToolsConfig;
  system: SystemConfig;
  memory?: MemoryConfig;
  mcp?: MCPConfig;
  /** 用户自定义模式（可选） */
  modes?: import('../modes/types').ModeDefinition[];
  /** 子代理配置（可选，对应 sub-agents.yaml） */
  subAgents?: SubAgentsConfig;
  /** Computer Use 配置（可选，对应 computer_use.yaml） */
  computerUse?: ComputerUseConfig;
  /** 插件配置（可选，对应 plugins.yaml） */
  plugins?: Array<{ name: string; type?: 'local' | 'npm'; enabled?: boolean; priority?: number; config?: Record<string, unknown> }>;
  /** 上下文压缩配置（对应 summary.yaml） */
  summary: SummaryConfig;
}

/** 子代理类型定义（配置文件格式） */
export interface SubAgentTypeDef {
  /** 类型标识（从 YAML 键名解析） */
  name: string;
  /** 面向主 LLM 的用途说明 */
  description: string;
  /** 子代理的系统提示词 */
  systemPrompt: string;
  /** 工具白名单（与 excludedTools 互斥，优先） */
  allowedTools?: string[];
  /** 工具黑名单 */
  excludedTools?: string[];
  /** 固定使用的模型名称；不填时跟随当前活动模型 */
  modelName?: string;
  /** 最大工具执行轮次 */
  maxToolRounds: number;
  /** 当前类型的 sub_agent 调用是否可按 parallel 工具参与调度，默认 false */
  parallel: boolean;
}

/** 子代理配置（对应 sub_agents.yaml） */
export interface SubAgentsConfig {
  /** 子代理类型定义列表（来自配置文件，未配置时不启用子代理功能） */
  types?: SubAgentTypeDef[];
}
