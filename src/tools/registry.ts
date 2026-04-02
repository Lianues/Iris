/**
 * 工具注册中心
 *
 * 管理所有 LLM 可调用的工具。
 * 支持注册、注销、执行、查询工具声明。
 */

import { ToolDefinition, FunctionDeclaration } from '../types';
import { createLogger } from '../logger';

const logger = createLogger('ToolRegistry');

export class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();

  /** 注册工具 */
  register(tool: ToolDefinition): void {
    if (this.tools.has(tool.declaration.name)) {
      logger.warn(`工具 "${tool.declaration.name}" 已存在，将被覆盖`);
    }
    this.tools.set(tool.declaration.name, tool);
  }

  /** 批量注册 */
  registerAll(tools: ToolDefinition[]): void {
    for (const tool of tools) {
      this.register(tool);
    }
  }

  /** 注销工具 */
  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  /** 获取工具定义 */
  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  /**
   * 执行工具。
   * 返回值可能是 Promise<unknown>（普通工具）或 AsyncIterable<unknown>（generator 工具）。
   * 调用方（scheduler）负责检测并处理 AsyncIterable。
   */
  execute(name: string, args: Record<string, unknown>): Promise<unknown> | AsyncIterable<unknown> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`工具未找到: ${name}`);
    }
    return tool.handler(args);
}

  /** 获取所有工具的函数声明（供 LLM 使用） */
  getDeclarations(): FunctionDeclaration[] {
    return Array.from(this.tools.values()).map(t => t.declaration);
  }

  /** 列出已注册的工具名称 */
  listTools(): string[] {
    return Array.from(this.tools.keys());
  }

  /** 已注册工具数量 */
  get size(): number {
    return this.tools.size;
  }

  /** 创建仅包含指定工具的子注册表 */
  createSubset(names: string[]): ToolRegistry {
    const sub = new ToolRegistry();
    for (const name of names) {
      const tool = this.tools.get(name);
      if (tool) sub.register(tool);
    }
    return sub;
  }

  /** 创建排除指定工具的子注册表 */
  createFiltered(excludeNames: string[]): ToolRegistry {
    const exclude = new Set(excludeNames);
    const sub = new ToolRegistry();
    for (const [name, tool] of this.tools) {
      if (!exclude.has(name)) sub.register(tool);
    }
    return sub;
  }
}
