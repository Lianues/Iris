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
  /** 父工具执行 ID（子代理内部工具指向 sub_agent 的 invocationId） */
  parentToolId?: string;
  /** 嵌套深度（顶层=0，子代理内部=1，子代理的子代理=2...） */
  depth?: number;
}

/** 工具执行的输出条目（累积式日志流） */
export interface ToolOutputEntry {
  /** 输出类型 */
  type: 'stdout' | 'stderr' | 'log' | 'chat' | 'data';
  /** 输出内容 */
  content: string;
  /** 结构化数据（可选） */
  data?: Record<string, unknown>;
  /** 时间戳 */
  timestamp: number;
}

/** 状态变更事件载荷 */
export interface ToolStateChangeEvent {
  invocation: ToolInvocation;
  previousStatus: ToolStatus;
}

/**
 * 工具执行上下文。
 *
 * 由 scheduler 创建并传入 handler，提供进度上报和中止信号。
 * handler 无需了解 ToolStateManager、invocation ID 或任何基础设施细节，
 * 只需调用 reportProgress 即可推送实时进度到前端。
 *
 * 设计参考：FastMCP 的 Context.report_progress 模式。
 */
export interface ToolExecutionContext {
  /**
   * 用户是否已手动批准此次工具调用。
   *
   * 由 scheduler 在用户通过 TUI Y/N 确认、或命令匹配 allowPatterns 时设置为 true。
   * shell 工具检测到此标记后，跳过 AI 分类器判定（仅保留 deny 黑名单硬拦截），
   * 尊重用户的明确授权意图。
   */
  approvedByUser?: boolean;
  /**
   * 请求用户通过 TUI Y/N 弹窗进行交互式确认。
   *
   * 由 scheduler 在可交互上下文中提供。handler 在执行过程中发现需要用户确认时调用：
   *   - 返回 true：用户批准，handler 可继续执行
   *   - 返回 false：用户拒绝
   *   - 为 undefined 时表示当前上下文不支持交互审批（如 cross-agent 后台会话）
   *
   * 典型用途：shell/bash 工具在 AI 分类器拒绝后调用此方法弹出 Y/N 确认。
   */
  requestApproval?: () => Promise<boolean>;
  /**
   * 上报实时进度。调用后进度数据会写入 ToolInvocation.progress，
   * 通过 Handle 的 progress 事件推送到前端渲染。
   * scheduler 内部做节流处理，handler 可高频调用而不会造成渲染压力。
   * 未提供时（如 CLI 场景无 ToolStateManager）为 undefined。
   */
  reportProgress?: (data: Record<string, unknown>) => void;
  /** 中止信号，handler 可用于检查是否需要提前终止 */
  signal?: AbortSignal;
  /** 当前工具的 invocation ID（handler 可用于关联） */
  invocationId?: string;
  /**
   * 追加输出内容到输出流。
   * 与 reportProgress 不同：
   * - reportProgress 是「状态快照」语义（覆盖式），用于 spinner/进度条
   * - appendOutput 是「日志追加」语义（累积式），用于展示工具输出
   */
  appendOutput?: (entry: Omit<ToolOutputEntry, 'timestamp'>) => void;
  /**
   * 监听平台端发来的上行消息。返回取消监听的函数。
   * 用于双向通信场景（如交互式 shell 输入）。
   */
  onMessage?: (listener: (type: string, data?: unknown) => void) => (() => void);
}

/**
 * 工具执行器类型。
 *
 * handler 接收 args 和可选的 ToolExecutionContext。
 * 返回 Promise<unknown>（普通工具）或 AsyncIterable<unknown>（generator 工具）。
 * 已有工具无需关注第二个参数，完全向后兼容。
 */
export type ToolHandler = (args: Record<string, unknown>, context?: ToolExecutionContext) => Promise<unknown> | AsyncIterable<unknown>;

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
