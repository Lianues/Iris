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
  /** 父工具执行 ID（子代理内部工具指向 sub_agent 的 invocationId） */
  parentToolId?: string;
  /** 嵌套深度（顶层=0，子代理内部=1...） */
  depth?: number;
  /** 子工具调用列表（运行时由平台层填充，sub_agent 等嵌套工具的内部调用） */
  children?: ToolInvocation[];
}

/**
 * 工具执行上下文。
 * 由 scheduler 创建并传入 handler，提供进度上报和中止信号。
 */
export interface ToolExecutionContext {
  /** 上报实时进度，scheduler 内部做节流处理 */
  reportProgress?: (data: Record<string, unknown>) => void;
  /** 中止信号 */
  signal?: AbortSignal;
}

export type ToolHandler = (args: Record<string, unknown>, context?: ToolExecutionContext) => Promise<unknown> | AsyncIterable<unknown>;
export type ToolParallelResolver = (args: Record<string, unknown>) => boolean;
export type ToolParallelPolicy = boolean | ToolParallelResolver;

export interface ToolDefinition {
  declaration: FunctionDeclaration;
  handler: ToolHandler;
  parallel?: ToolParallelPolicy;
}


// ============ 工具输出 ============

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

// ============ 工具执行句柄 ============

/**
 * 工具执行双向通道的 SDK 侧接口。
 *
 * 平台扩展通过 `backend.on('tool:execute', (sid, handle) => ...)` 获取 Handle，
 * 之后所有工具相关交互都通过 Handle 完成：
 * - 下行订阅：on('state'/'output'/'progress'/'child'/'done')
 * - 上行控制：abort() / approve() / apply() / send()
 * - 状态查询：getSnapshot() / getOutputHistory() / getChildren()
 */
export interface ToolExecutionHandleLike {
  readonly id: string;
  readonly toolName: string;
  readonly status: ToolStatus;
  readonly parentId?: string;
  readonly depth: number;

  // ── 下行订阅 ──
  on(event: 'state', listener: (status: ToolStatus, prev: ToolStatus) => void): this;
  on(event: 'output', listener: (entry: ToolOutputEntry) => void): this;
  on(event: 'progress', listener: (data: Record<string, unknown>) => void): this;
  on(event: 'child', listener: (childHandle: ToolExecutionHandleLike) => void): this;
  on(event: 'done', listener: (result?: unknown, error?: string) => void): this;
  on(event: 'message', listener: (type: string, data?: unknown) => void): this;
  off(event: string, listener: (...args: any[]) => void): this;

  // ── 上行控制 ──
  /** 终止此工具执行 */
  abort(): void;
  /** 审批此工具执行（一类审批：Y/N 确认） */
  approve(approved: boolean): void;
  /** Diff 预览确认（二类审批） */
  apply(applied: boolean): void;
  /** 通用上行消息通道 */
  send(type: string, data?: unknown): void;

  // ── 查询 ──
  /** 获取当前 ToolInvocation 的快照副本 */
  getSnapshot(): ToolInvocation;
  /** 获取输出历史副本 */
  getOutputHistory(): ToolOutputEntry[];
  /** 获取子 Handle 列表副本 */
  getChildren(): ToolExecutionHandleLike[];
}
