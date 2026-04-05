/**
 * Backend 公共类型、接口与常量
 */

import type { LLMConfig, ToolsConfig, SkillDefinition, SummaryConfig } from '../../config/types';
import type { OCRProvider } from '../../ocr';
import type { Part, Content, UsageMetadata, ToolInvocation, ToolAttachment } from '../../types';
import type { ToolExecutionHandle } from '../../tools/handle';

// ============ 常量 ============

export const IMAGE_UNAVAILABLE_NOTICE = (count: number) => (
  count > 1
    ? `[用户发送了 ${count} 张图片，但当前模型无法查看图片内容]`
    : '[用户发送了 1 张图片，但当前模型无法查看图片内容]'
);

export const DOCUMENT_UNAVAILABLE_NOTICE = (count: number) => (
  count > 1
    ? `[用户发送了 ${count} 个文档，但当前模型无法查看文档内容]`
    : '[用户发送了 1 个文档，但当前模型无法查看文档内容]'
);

/** Backend 内部最多保留多少组 redo 历史。与 Console 旧实现保持一致。 */
export const MAX_REDO_HISTORY_GROUPS = 200;

// ============ Undo/Redo 类型 ============

/**
 * undo 的粒度。
 *
 * - last-visible-message：撤销最后一个"可见消息单元"。
 *   - 若历史末尾是 assistant 回复，则会删除整段 assistant 回复（含中间 tool response）。
 *   - 若历史末尾是普通 user 消息，则只删除该 user 消息。
 * - last-turn：撤销最后一轮完整交互。
 *   - 若历史末尾是 assistant 回复，则同时删除其前面的 user 消息。
 *   - 若历史末尾是普通 user 消息，则退化为只删除该 user 消息。
 */
export type UndoScope = 'last-visible-message' | 'last-turn';

export interface UndoOperationResult {
  scope: UndoScope;
  removed: Content[];
  removedCount: number;
  userText: string;
  assistantText: string;
}

export interface RedoOperationResult {
  restored: Content[];
  restoredCount: number;
  userText: string;
  assistantText: string;
}

// ============ 输入类型 ============

export interface ImageInput {
  mimeType: string;
  data: string;
}

export type { DocumentInput } from '../../media/document-extract.js';

// ============ 配置与事件 ============

export interface BackendConfig {
  /** 工具执行最大轮次 */
  maxToolRounds?: number;
  /** LLM 调用报错时是否自动重试 */
  retryOnError?: boolean;
  /** 自动重试最大次数 */
  maxRetries?: number;
  /** 工具执行策略配置 */
  toolsConfig?: ToolsConfig;
  /** 是否启用流式输出 */
  stream?: boolean;
  /** 默认模式名称 */
  defaultMode?: string;
  /** 当前活动模型配置（用于 vision 能力判定） */
  currentLLMConfig?: LLMConfig;
  /** OCR 服务（当主模型不支持 vision 时回退使用） */
  ocrService?: OCRProvider;
  /** 用于 /compact 上下文压缩的模型名称（需在 LLMRouter 中已注册） */
  summaryModelName?: string;
  /** 上下文压缩提示词配置 */
  summaryConfig?: SummaryConfig;
  /** Skill 定义列表 */
  skills?: SkillDefinition[];
  /** 配置目录路径（用于 rememberPlatformModel 写回 platform.yaml） */
  configDir?: string;
  /** 是否记住各平台上次使用的模型 */
  rememberPlatformModel?: boolean;
  /** 是否启用异步子代理（默认 false，向后兼容） */
  asyncSubAgents?: boolean;
}

/** 异步子代理通知的结构化数据（由 Backend 解析 <task-notification> XML 后生成） */
export interface NotificationPayload {
  taskId: string;
  status: string;
  description: string;
  result?: string;
  error?: string;
}

export interface BackendEvents {
  /** 非流式最终回复 */
  'response': (sessionId: string, text: string) => void;
  /** 流式段开始 */
  'stream:start': (sessionId: string) => void;
  /** 流式结构化 part 增量（按顺序） */
  'stream:parts': (sessionId: string, parts: Part[]) => void;
  /** 流式文本块 */
  'stream:chunk': (sessionId: string, chunk: string) => void;
  /** 流式段结束 */
  'stream:end': (sessionId: string, usage?: UsageMetadata) => void;
  /**
   * 新工具执行启动。
   *
   * 平台层通过此事件获取工具的双向通道（Handle），
   * 之后所有工具相关的交互（状态变化、输出流、审批、终止）都通过 Handle 完成。
   * 替代原有的 tool:update + approveTool + applyTool 碎片化模式。
   */
  'tool:execute': (sessionId: string, handle: ToolExecutionHandle) => void;
  /** 处理出错 */
  'error': (sessionId: string, error: string) => void;
  /** Token 用量（每轮 LLM 调用后发出） */
  'usage': (sessionId: string, usage: UsageMetadata) => void;
  /** LLM 调用重试（attempt 从 1 开始，maxRetries 为允许的最大重试次数） */
  'retry': (sessionId: string, attempt: number, maxRetries: number, error: string) => void;
  /** 用户输入折算后的 token 数（估算值） */
  'user:token': (sessionId: string, tokenCount: number) => void;
  /** 当前回合完成（统一耗时来源；turnId 可用于区分用户 turn 与 notification turn） */
  'done': (sessionId: string, durationMs: number, turnId?: string) => void;
  /**
   * 回合开始（在 handleMessage / handleNotificationTurn 之前 emit）。
   *
   * 平台层可通过 mode 区分用户消息 turn 和异步子代理 notification turn，
   * 从而对 notification turn 产生的后续事件做差异化渲染。
   */
  'turn:start': (sessionId: string, turnId: string, mode: 'chat' | 'task-notification') => void;
  /** 一轮模型输出完成后的完整内容（结构化） */
  'assistant:content': (sessionId: string, content: Content) => void;
  /** 自动上下文压缩完成（阈值触发） */
  'auto-compact': (sessionId: string, summaryText: string) => void;
  /**
   * 工具执行产生的附件（例如 MCP 生图结果）。
   *
   * 这里是平台层的旁路通道：附件不进入 LLM 上下文，
   * 由具体平台自己决定如何发送给用户。
   */
  'attachments': (sessionId: string, attachments: ToolAttachment[]) => void;
  /**
   * 异步子代理状态通知（供平台层展示后台任务状态）。
   *
   * 当异步子代理注册/完成/失败/被中止时，Backend emit 此事件让平台层得知。
   * status 取值：'registered' | 'completed' | 'failed' | 'killed' | 'token-update' | 'chunk-heartbeat'
   * 职责：驱动 StatusBar 计数、spinner、token 动画等 UI 状态。
   * 不携带结果内容——结果内容由 task:result 事件单独广播。
   */
  'agent:notification': (sessionId: string, taskId: string, status: string, summary: string, taskType?: string, silent?: boolean) => void;
  /**
   * 轻量级任务结果广播（所有任务终态时 emit，不绑定 silent）。
   *
   * 三层通知体系中的最轻量级通道：
   *   - task:result：广播结果内容，平台层自行决定是否渲染（如 silent cron 的通知卡片）
   *   - agent:notification：状态变更，驱动 StatusBar / spinner / token UI
   *   - pushNotification：重量级，注入 MessageQueue 触发 LLM turn
   *
   * @param sessionId     发起方会话 ID
   * @param taskId        任务 ID
   * @param status        终态：'completed' | 'failed' | 'killed'
   * @param description   任务描述（注册时的 description）
   * @param taskType      任务类型：'sub_agent' | 'delegate' | 'cron'
   * @param silent        是否为静默任务
   * @param result        执行结果文本（completed 时）或错误信息（failed 时）
   */
  'task:result': (sessionId: string, taskId: string, status: string, description: string, taskType?: string, silent?: boolean, result?: string) => void;
  /** 异步子代理通知的结构化内容（在 turn:start 之前 emit，供前端展示折叠通知区块） */
  'notification:payloads': (sessionId: string, payloads: NotificationPayload[]) => void;
}
