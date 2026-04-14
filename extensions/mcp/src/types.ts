/**
 * MCP 扩展类型定义（自包含，不依赖核心类型）
 */

/** MCP 客户端连接状态 */
export type MCPClientStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

/** MCP 服务器运行时信息 */
export interface MCPServerInfo {
  name: string;
  status: MCPClientStatus;
  toolCount: number;
  error?: string;
}

/** 单个 MCP 服务器配置 */
export interface MCPServerConfig {
  transport: 'stdio' | 'sse' | 'streamable-http';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  headers?: Record<string, string>;
  timeout?: number;
  enabled?: boolean;
}

/** MCP 配置 */
export interface MCPConfig {
  servers: Record<string, MCPServerConfig>;
}
