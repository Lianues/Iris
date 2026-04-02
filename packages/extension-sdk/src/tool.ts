export interface FunctionDeclaration {
  name: string;
  description: string;
  parameters?: {
    type: 'object';
    properties: Record<string, Record<string, unknown>>;
    required?: string[];
  };
}

export type ToolStatus =
  | 'streaming'
  | 'queued'
  | 'awaiting_approval'
  | 'executing'
  | 'awaiting_apply'
  | 'success'
  | 'warning'
  | 'error';

export interface ToolInvocation {
  id: string;
  toolName: string;
  args: Record<string, unknown>;
  status: ToolStatus;
  result?: unknown;
  error?: string;
  createdAt: number;
  updatedAt: number;
  /** 关联的会话 ID（多会话并发时用于事件路由） */
  sessionId?: string;
  /**
   * 执行中的实时进度信息（由 handler yield 的中间值填充）。
   * 通用结构，各工具自行定义内容。
   * 例如 sub_agent: { tokens: number, frame: number }
   */
  progress?: Record<string, unknown>;
}

export type ToolHandler = (args: Record<string, unknown>) => Promise<unknown> | AsyncIterable<unknown>;
export type ToolParallelResolver = (args: Record<string, unknown>) => boolean;
export type ToolParallelPolicy = boolean | ToolParallelResolver;

export interface ToolDefinition {
  declaration: FunctionDeclaration;
  handler: ToolHandler;
  parallel?: ToolParallelPolicy;
}
