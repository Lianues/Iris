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
  types: Array<'console' | 'discord' | 'telegram' | 'web' | 'wxwork'>;
  discord: { token: string };
  telegram: { token: string };
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

/** 子代理配置（对应 sub-agents.yaml） */
export interface SubAgentsConfig {
  /** 自定义子代理类型定义列表（提供时完全替代内置默认） */
  types?: SubAgentTypeDef[];
}
