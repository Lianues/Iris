/**
 * 配置类型定义
 */

export interface LLMConfig {
  provider: 'gemini' | 'openai-compatible' | 'claude';
  apiKey: string;
  model: string;
  baseUrl: string;
  /** 模型上下文窗口大小（token 数），用于 TUI 显示占用比例 */
  contextWindow?: number;
  /** 自定义请求头，会覆盖 provider 内置同名 header */
  headers?: Record<string, string>;
  /** 自定义请求体，会深合并到 provider 编码后的最终请求体，支持嵌套参数 */
  requestBody?: Record<string, unknown>;
}

/** 三层 LLM 配置：primary 必填，secondary/light 可选（未配置时自动向上回退） */
export interface TieredLLMConfig {
  primary: LLMConfig;
  secondary?: LLMConfig;
  light?: LLMConfig;
}

export interface PlatformConfig {
  type: 'console' | 'discord' | 'telegram' | 'web';
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
}

export interface StorageConfig {
  type: 'json-file' | 'sqlite';
  dir: string;
  dbPath?: string;
}

export interface SystemConfig {
  systemPrompt: string;
  maxToolRounds: number;
  stream: boolean;
  /** 子代理最大嵌套深度，默认 3 */
  maxAgentDepth: number;
  /** 默认模式名称（可选，需与 modes 中定义的名称对应） */
  defaultMode?: string;
}

export interface MemoryConfig {
  /** 是否启用记忆，默认 false */
  enabled: boolean;
  /** 数据库路径，默认 ./data/memory.db */
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
  llm: TieredLLMConfig;
  platform: PlatformConfig;
  storage: StorageConfig;
  system: SystemConfig;
  memory?: MemoryConfig;
  mcp?: MCPConfig;
  /** 用户自定义模式（可选） */
  modes?: import('../modes/types').ModeDefinition[];
}
