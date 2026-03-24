/**
 * MCP 模块入口
 */

export { MCPClient } from './client';
export { MCPManager } from './manager';
export type { MCPClientStatus, MCPServerInfo } from './types';
export type { MCPToolResult } from './client';

import { MCPConfig } from '../config/types';
import { MCPManager } from './manager';

/** 工厂函数：创建 MCP 管理器 */
export function createMCPManager(config: MCPConfig): MCPManager {
  return new MCPManager(config);
}
