/**
 * MCP 管理器
 *
 * 管理多个 MCP 服务器连接，将 MCP 工具转换为 Iris ToolDefinition 格式。
 */

import { MCPConfig } from '../config/types';
import { ToolDefinition } from '../types';
import { MCPClient } from './client';
import { MCPServerInfo } from './types';
import { createLogger } from '../logger';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { dereferenceSync } = require('dereference-json-schema');

const logger = createLogger('MCPManager');

export class MCPManager {
  private clients: MCPClient[] = [];

  constructor(config: MCPConfig) {
    for (const [name, serverCfg] of Object.entries(config.servers)) {
      // enabled 默认 true
      if (serverCfg.enabled === false) {
        logger.info(`MCP 服务器 "${name}" 已禁用，跳过`);
        continue;
      }
      this.clients.push(new MCPClient(name, serverCfg));
    }
  }

  /** 并行连接所有服务器（失败不中断） */
  async connectAll(): Promise<void> {
    if (this.clients.length === 0) return;
    logger.info(`正在连接 ${this.clients.length} 个 MCP 服务器...`);
    await Promise.allSettled(this.clients.map(c => c.connect()));

    const connected = this.clients.filter(c => c.status === 'connected').length;
    logger.info(`MCP 连接完成: ${connected}/${this.clients.length} 成功`);
  }

  /** 获取所有已连接服务器的工具（转换为 ToolDefinition） */
  getTools(): ToolDefinition[] {
    const tools: ToolDefinition[] = [];

    for (const client of this.clients) {
      if (client.status !== 'connected') continue;

      for (const sdkTool of client.toolList) {
        const safeName = sanitizeName(client.serverName);
        const safeToolName = sanitizeName(sdkTool.name);
        const qualifiedName = `mcp__${safeName}__${safeToolName}`;
        const originalName = sdkTool.name;

        tools.push({
          declaration: {
            name: qualifiedName,
            description: sdkTool.description || `MCP tool: ${originalName}`,
            parameters: convertInputSchema(sdkTool.inputSchema),
          },
          handler: async (args: Record<string, unknown>) => {
            return client.callTool(originalName, args);
          },
        });
      }
    }

    return tools;
  }

  /** 获取所有服务器的状态信息 */
  getServerInfo(): MCPServerInfo[] {
    return this.clients.map(c => ({
      name: c.serverName,
      status: c.status,
      toolCount: c.toolList.length,
      error: c.error,
    }));
  }

  /** 热重载：断开旧连接，用新配置重新连接 */
  async reload(config: MCPConfig): Promise<void> {
    await this.disconnectAll();
    this.clients = [];
    for (const [name, serverCfg] of Object.entries(config.servers)) {
      if (serverCfg.enabled === false) {
        logger.info(`MCP 服务器 "${name}" 已禁用，跳过`);
        continue;
      }
      this.clients.push(new MCPClient(name, serverCfg));
    }
    await this.connectAll();
  }

  /** 并行断开所有连接 */
  async disconnectAll(): Promise<void> {
    await Promise.allSettled(this.clients.map(c => c.disconnect()));
    logger.info('所有 MCP 连接已断开');
  }
}

/**
 * 将 MCP inputSchema（JSON Schema）转换为 Iris 工具声明的 parameters 格式
 *
 * 用 dereference-json-schema 将 $ref 引用内联展开后直接透传，
 * 保留完整的 JSON Schema 特性（anyOf、additionalProperties 等）。
 */
function convertInputSchema(schema: Record<string, unknown>): {
  type: 'object';
  properties: Record<string, Record<string, unknown>>;
  required?: string[];
} | undefined {
  // 展开所有 $ref 引用
  let resolved: Record<string, any>;
  try {
    resolved = dereferenceSync(schema) as Record<string, any>;
  } catch {
    // dereference 失败时（如循环引用），使用原始 schema
    resolved = schema as Record<string, any>;
  }

  const props = resolved.properties as Record<string, any> | undefined;
  if (!props || typeof props !== 'object') return undefined;

  // 清理已展开后残留的 $defs/definitions（不需要发给 LLM）
  const { $defs, definitions, ...clean } = resolved;

  return clean as {
    type: 'object';
    properties: Record<string, Record<string, unknown>>;
    required?: string[];
  };
}

/** 将名称中非 [a-zA-Z0-9_] 的字符替换为下划线（兼容 Gemini 函数名规范） */
function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, '_');
}
