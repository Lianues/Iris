/**
 * 配置类型定义
 */

import type { OCRConfig } from './ocr';
import type { NetConfig } from '../net/types';

/**
 * 对码（Pairing）配置。
 *
 * 原先从 @irises/extension-sdk/pairing 导入，但该 SDK 包需要先构建才能被 TS 解析。
 * 为避免宿主对未构建的 SDK 包产生硬依赖，将此类型内联到宿主代码中。
 * 语义与 packages/extension-sdk/src/pairing/types.ts 中的 PairingConfig 保持一致。
 */
export interface PairingConfig {
  /** DM 策略：pairing = 需要对码（默认）| allowlist = 仅白名单 | open = 任何人 */
  dmPolicy: 'pairing' | 'allowlist' | 'open';
  /** 管理员 ID，格式 <platform>:<userId>（可选，直接指定则跳过首次对码） */
  admin?: string;
  /** 预设白名单，格式 <platform>:<userId>（可选） */
  allowFrom?: string[];
}

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

export interface WebPlatformConfig {
  port: number;
  host: string;
  /** 上次使用的模型名称（自动管理） */
  lastModel?: string;
  /** 全局 API 认证令牌（可选） */
  authToken?: string;
  /** 管理面令牌（可选，启用后 /api/config 需 X-Management-Token） */
  managementToken?: string;
}

export interface PlatformConfig {
  /** 启动的平台类型列表（兼容单字符串和数组写法；支持插件平台注册的自定义平台） */
  types: string[];
  /** 全局对码配置 */
  pairing?: PairingConfig;
  /** 内置 Web 平台配置 */
  web: WebPlatformConfig;
  /** 
   * 扩展平台配置（动态索引）。
   * 
   * 修改原因：平台已迁移到扩展系统，宿主不再为每个扩展平台硬编码类型定义。
   * 扩展运行时通过 context.config.platform[platformName] 获取配置，
   * 由扩展自身负责解析和设置默认值。
   */
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

  /**
   * Shell 工具专用：AI 安全分类器配置。
   * 当命令不在静态白名单/黑名单中时，调用 LLM 判断命令安全性。
   */
  classifier?: {
    /** 是否启用 AI 分类器（false 时非白名单命令走 fallbackPolicy） */
    enabled: boolean;
    /** 分类器使用的模型名称（不填则跟随当前活跃模型） */
    model?: string;
    /** 置信度阈值（0.0~1.0），低于此值视为"不确定"，默认 0.8 */
    confidenceThreshold?: number;
    /** 分类器不确定时的兜底策略，默认 'deny' */
    fallbackPolicy?: 'deny' | 'allow';
    /** 分类器调用超时（ms），默认 8000 */
    timeout?: number;
    /** 安装命令后是否自动评估新工具的安全子命令并加入运行时白名单（默认跟随 enabled） */
    autoLearn?: boolean;
  };
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

/** Skill 调用后对运行时上下文的修改 */
export interface SkillContextModifier {
  /** 临时自动放行的工具名称列表 */
  autoApproveTools?: string[];
  /** 后续 LLM 调用的模型覆盖 */
  modelOverride?: string;
  /** 注入系统提示词的额外文本 */
  systemPromptInjection?: string;
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
  /** Skill 提示词内容（通过 invoke_skill / read_skill 工具按需返回） */
  content: string;
  /**
   * Skill 的路径标识。
   * 对文件系统 Skill，这是 SKILL.md 的绝对路径；
   * 对 system.yaml 内联 Skill，这是形如 inline:<name> 的稳定标识。
   */
  path: string;
  /** @deprecated 不再使用，保留仅为兼容旧配置 */
  enabled?: boolean;

  // ---- 扩展字段（均可选，向后兼容） ----

  /** 激活时自动放行的工具名称列表 */
  allowedTools?: string[];
  /** 模型覆盖（使用此 skill 时切换到指定模型） */
  model?: string;
  /** 执行模式：'inline'（注入对话，默认）或 'fork'（独立子代理） */
  mode?: 'inline' | 'fork';
  /** 命名参数列表（如 ['file', 'branch']） */
  arguments?: string[];
  /** 参数输入提示（如 '<file> [branch]'） */
  argumentHint?: string;
  /** 模型触发条件描述（写入工具声明帮助模型判断何时使用） */
  whenToUse?: string;
  /** 条件激活 glob 模式（仅在模型接触匹配文件后才出现） */
  paths?: string[];
  /** 用户是否可通过 /skill-name 直接调用（默认 true） */
  userInvocable?: boolean;
  /** 是否禁止模型自主调用（默认 false） */
  disableModelInvocation?: boolean;
  /** 预构建的上下文修改器（从 frontmatter 推导） */
  contextModifier?: SkillContextModifier;
}

export interface SystemConfig {
  systemPrompt: string;
  maxToolRounds: number;
  stream: boolean;
  /** 是否启用异步子代理（默认 false） */
  asyncSubAgents?: boolean;
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

  /**
   * 开发模式：源码加载的扩展白名单。
   * 白名单中的扩展将从 src/index.ts 加载，而非使用 manifest 中指定的打包产物（dist/index.mjs）。
   * 适用于本地开发时使用 npm run dev 等热编译工具的场景。
   */
  devSourceExtensions?: string[];

  /**
   * 开发模式：是否将 @irises/extension-sdk 也从源码加载。
   * 启用后会在 SDK 的 dist/ 中生成轻量 shim，将模块解析重定向到 packages/extension-sdk/src/。
   * 需配合 devSourceExtensions 使用，仅在非编译二进制环境下生效。
   */
  devSourceSdk?: boolean;
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

/** 上下文压缩（/compact）配置 */
export interface SummaryConfig {
  /** 总结 AI 的系统提示词 */
  systemPrompt: string;
  /** 追加在对话末尾的用户指令 */
  userPrompt: string;
}

/**
 * 全局配置（进程级，IrisHost 持有）。
 *
 * 多 Agent 配置分层重构：将进程级基础设施配置从 AppConfig 中拆分出来。
 * LLM、OCR、Storage 属于全局独占资源，所有 Agent 共享，不需要每个 Agent 各配一份。
 */
export interface GlobalConfig {
  llm: LLMRegistryConfig;
  ocr?: OCRConfig;
  /** 存储引擎类型选择是进程级决策，Agent 只需独立的路径 */
  storage: StorageConfig;
}

export interface AppConfig {
  [key: string]: unknown;
  llm: LLMRegistryConfig;
  ocr?: OCRConfig;
  platform: PlatformConfig;
  storage: StorageConfig;
  tools: ToolsConfig;
  system: SystemConfig;
  mcp?: MCPConfig;
  /** 用户自定义模式（可选） */
  modes?: import('../modes/types').ModeDefinition[];
  /** 子代理配置（可选，对应 sub-agents.yaml） */
  subAgents?: SubAgentsConfig;
  /**
   * 插件声明列表（可选，对应 plugins.yaml）。全局独占配置，agent 层不可覆盖。
   *
   * 注意：这里的 "plugin" 是 extension 的一种贡献角色，不是独立于 extension 的系统。
   * 每个条目的 name 对应 extensions/ 下一个有 plugin 贡献的 extension。
   * 详见 src/config/plugins.ts 顶部注释。
   */
  plugins?: Array<{ name: string; type?: 'local' | 'npm' | 'inline'; enabled?: boolean; priority?: number; config?: Record<string, unknown> }>;
  /** 上下文压缩配置（对应 summary.yaml） */
  summary: SummaryConfig;
  /** 多端互联配置（对应 net.yaml，可选） */
  net?: NetConfig;
  /** 安全系统配置（对应 safety.yaml，可选） */
  safety?: import('@irises/extension-sdk').SafetyConfig;
}

/** 子代理类型定义（配置文件格式） */
export interface SubAgentTypeDef {
  /** 类型标识（从 YAML 键名解析） */
  name: string;
  /** 是否启用此类型（默认 true）；全局 enabled 为 false 时此字段无效 */
  enabled: boolean;
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
  /** 此类型是否使用流式输出（默认 false）；全局 stream 有值时被覆盖 */
  stream: boolean;
  /** 当前类型的 sub_agent 调用是否可按 parallel 工具参与调度，默认 false */
  parallel: boolean;
  /** 是否默认后台运行（可被调用时的 run_in_background 参数覆盖），默认 false */
  background?: boolean;
}

/** 子代理配置（对应 sub_agents.yaml） */
export interface SubAgentsConfig {
  /** 是否启用子代理功能（默认 true）；设为 false 可一键禁用全部子代理 */
  enabled: boolean;
  /** 全局流式输出开关（设置后覆盖所有类型的 stream 设置；不设置则各类型自行决定） */
  stream?: boolean;
  /** 子代理类型定义列表（来自配置文件，未配置时不启用子代理功能） */
  types?: SubAgentTypeDef[];
}
