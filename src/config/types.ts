/**
 * 配置类型定义
 */

import type { OCRConfig } from './ocr';

export interface LLMConfig {
  provider: 'gemini' | 'openai-compatible' | 'claude' | 'openai-responses';
  apiKey: string;
  /** 提供商真实模型 id */
  model: string;
  baseUrl: string;
  /** 模型上下文窗口大小（token 数），用于 TUI 显示占用比例 */
  contextWindow?: number;
  /** 显式声明当前模型是否支持图片输入 */
  supportsVision?: boolean;
  /** 自定义请求头，会覆盖 provider 内置同名 header */
  headers?: Record<string, string>;
  /** 自定义请求体，会深合并到 provider 编码后的最终请求体，支持嵌套参数 */
  requestBody?: Record<string, unknown>;
}

/** 具名模型配置（从 YAML 键名解析出 modelName） */
export interface LLMModelDef extends LLMConfig {
  modelName: string;
}

/** LLM 模型池配置 */
export interface LLMRegistryConfig {
  /** 启动时默认使用的模型名称 */
  defaultModelName: string;
  /** 可用模型列表 */
  models: LLMModelDef[];
}

export interface PlatformConfig {
  /** 启动的平台类型列表（兼容单字符串和数组写法） */
  types: Array<'console' | 'discord' | 'telegram' | 'web' | 'wxwork' | 'lark' | 'qq'>;
  discord: { token: string };
  telegram: {
    token: string;
    /**
     * 是否在 Telegram 输出中展示工具状态。
     * 目的：为后续与飞书对齐的流式 / 审批 / MCP 状态展示预留统一开关。
     */
    showToolStatus?: boolean;
    /** 群聊中是否必须显式 @ 机器人后才响应，默认 true。 */
    groupMentionRequired?: boolean;
  };
  web: {
    port: number;
    host: string;
    /** 全局 API 认证令牌（可选） */
    authToken?: string;
    /** 管理面令牌（可选，启用后 /api/config 需 X-Management-Token） */
    managementToken?: string;
  };
  wxwork: {
    botId: string;
    secret: string;
    /** 是否在流式回复中展示工具执行状态（默认 true） */
    showToolStatus?: boolean;
  };
  lark: {
    /**
     * 飞书自建应用 App ID。
     * 目的：后续 Phase 1 会用它初始化官方 SDK 的 API Client 和 WebSocket Client。
     */
    appId: string;
    /** 飞书自建应用 App Secret，用于调用 OpenAPI 和建立长连接。 */
    appSecret: string;
    /** 可选：Webhook 模式验签 token；当前预留字段，便于后续扩展。 */
    verificationToken?: string;
    /** 可选：Webhook 模式消息解密 key；当前预留字段，便于后续扩展。 */
    encryptKey?: string;
    /** 是否在流式回复中展示工具执行状态（默认 true）。 */
    showToolStatus?: boolean;
  };
  qq: {
    /** NapCat OneBot v11 正向 WebSocket 地址 */
    wsUrl: string;
    /** OneBot access_token（可选，用于鉴权） */
    accessToken?: string;
    /** 机器人自身 QQ 号（用于群聊 @ 判断） */
    selfId: string;
    /** 群聊响应模式：'at' = 只响应 @机器人（默认），'all' = 响应所有消息，'off' = 不响应群聊 */
    groupMode?: 'at' | 'all' | 'off';
    /** 是否在回复中展示工具执行状态（默认 true） */
    showToolStatus?: boolean;
  };
}

export interface StorageConfig {
  type: 'json-file' | 'sqlite';
  dir: string;
  dbPath?: string;
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
}

export interface MemoryConfig {
  /** 是否启用记忆，默认 false */
  enabled: boolean;
  /** 数据库路径，默认 ~/.iris/memory.db */
  dbPath?: string;
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
