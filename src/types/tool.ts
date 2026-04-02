/**
 * 工具类型定义
 *
 * 定义 LLM 可调用的工具（函数）的声明和处理器。
 * 声明格式遵循 Gemini FunctionDeclaration 规范。
 */

/** 函数声明（供 LLM 识别的工具描述） */
export interface FunctionDeclaration {
  name: string;
  description: string;
  /** JSON Schema 参数描述，LLM 格式层按 provider 需要做降级后透传给 API */
  parameters?: {
    type: 'object';
    properties: Record<string, Record<string, unknown>>;
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
  /** 关联的会话 ID（多会话并发时用于事件路由） */
  sessionId?: string;
  /**
   * 执行中的实时进度信息（由 handler yield 的中间值填充）。
   * 通用结构，各工具自行定义内容。
   * 例如 sub_agent: { tokens: number, frame: number }
   */
  progress?: Record<string, unknown>;
}

/** 状态变更事件载荷 */
export interface ToolStateChangeEvent {
  invocation: ToolInvocation;
  previousStatus: ToolStatus;
}

/**
 * 工具执行器类型。
 *
 * handler 可以返回以下两种类型之一：
 * - Promise<unknown>：普通一次性返回（现有所有工具的默认行为，完全向后兼容）
 * - AsyncIterable<unknown>：generator 模式，yield 中间值作为进度更新，
 *   最后一个 yield 的值作为最终结果。
 *   中间值会被推送到 ToolStateManager 的 progress 字段，
 *   通过 tool:update 事件实时转发到前端。
 */
export type ToolHandler = (args: Record<string, unknown>) => Promise<unknown> | AsyncIterable<unknown>;

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
