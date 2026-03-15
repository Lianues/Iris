/**
 * 工具类型定义
 *
 * 定义 LLM 可调用的工具（函数）的声明和处理器。
 * 声明格式遵循 Gemini FunctionDeclaration 规范。
 */

/** JSON Schema 参数描述 */
export interface ParameterSchema {
  type: string;
  description?: string;
  enum?: string[];
  items?: ParameterSchema;
  properties?: Record<string, ParameterSchema>;
  required?: string[];
}

/** 函数声明（供 LLM 识别的工具描述） */
export interface FunctionDeclaration {
  name: string;
  description: string;
  parameters?: {
    type: 'object';
    properties: Record<string, ParameterSchema>;
    required?: string[];
  };
}

/** 工具调用状态 */
export type ToolStatus =
  | 'streaming'          // AI 正在输出工具调用的参数（参数可能不完整）
  | 'queued'             // AI 输出完毕，工具在队列中等待执行
  | 'awaiting_approval'  // 工具需要用户手动批准才能执行（autoExec 为 false 时）
  | 'executing'          // 工具的 handler 正在运行
  | 'awaiting_apply'     // 工具已生成变更预览，等待用户审阅并应用
  | 'success'            // 终态：执行成功
  | 'warning'            // 终态：部分成功
  | 'error';             // 终态：执行失败、超时、被取消或拒绝

/** 终态集合（可在多处复用） */
export const TERMINAL_TOOL_STATUSES: ReadonlySet<ToolStatus> = new Set([
  'success', 'warning', 'error',
]);

/** 单次工具调用实例 */
export interface ToolInvocation {
  /** 调用唯一标识 */
  id: string;
  /** 工具名称 */
  toolName: string;
  /** 调用参数（streaming 阶段可能不完整） */
  args: Record<string, unknown>;
  /** 当前状态 */
  status: ToolStatus;
  /** 执行结果（success / warning 时有值） */
  result?: unknown;
  /** 错误信息（error 时有值） */
  error?: string;
  /** 创建时间戳 */
  createdAt: number;
  /** 最后状态更新时间戳 */
  updatedAt: number;
}

/** 状态变更事件载荷 */
export interface ToolStateChangeEvent {
  invocation: ToolInvocation;
  previousStatus: ToolStatus;
}

/** 工具执行器类型 */
export type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;

/** 按本次调用参数判定工具是否可并行执行 */
export type ToolParallelResolver = (args: Record<string, unknown>) => boolean;

/** 工具并行策略 */
export type ToolParallelPolicy = boolean | ToolParallelResolver;

/** 完整的工具定义 = 声明 + 执行器 */
export interface ToolDefinition {
  declaration: FunctionDeclaration;
  handler: ToolHandler;
  /**
   * 是否允许与相邻的同样标记为 parallel 的工具并行执行。
   * 可以是固定布尔值，也可以按本次调用参数动态判定。
   * 默认 false（串行）。仅适用于可以安全并行的调用。
   */
  parallel?: ToolParallelPolicy;
}
