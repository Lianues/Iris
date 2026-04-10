/**
 * 定时任务调度插件 — 类型定义
 *
 * 包含所有共享的接口和类型。
 */

// ============ 调度任务定义 ============

/** 调度类型：cron 表达式 / 固定间隔 / 一次性 */
export type ScheduleType = 'cron' | 'interval' | 'once';

/** 调度配置联合类型 */
export type ScheduleConfig =
  | { type: 'cron'; expression: string }
  | { type: 'interval'; ms: number }
  | { type: 'once'; at: number };

/** 投递配置 */
export interface DeliveryConfig {
  /** 指定目标会话ID，缺省时使用 fallback 策略 */
  sessionId?: string;
  /** 回退策略：始终使用最近活跃的会话 */
  fallback: 'last-active';
}

/** 任务运行状态 */
// 统一使用 'completed' 表示完成，和 cron:result / task-notification / 执行记录保持一致。
// 额外保留历史值 'success' 仅用于兼容旧版持久化文件；新代码不再写入它。
// 新增 'running'：定时任务在后台 ToolLoop 执行中时标记为 running。
export type RunStatus =
  | 'completed' | 'success'
  | 'error' | 'skipped' | 'missed' | 'running';

/** 一个定时任务的完整定义 */
export interface ScheduledJob {
  /** 唯一标识 */
  id: string;
  /** 任务名称 */
  name: string;
  /** 调度配置 */
  schedule: ScheduleConfig;
  /** 任务所属的会话 ID（即投递目标会话） */
  sessionId: string;
  /** 执行指令（发送给 LLM 的提示词） */
  instruction: string;
  /** 投递配置 */
  delivery: DeliveryConfig;
  /** 静默模式：如果没有值得报告的内容则不发送消息 */
  silent: boolean;
  /** 紧急任务：可穿透安静时段 */
  urgent: boolean;
  /**
   * 条件表达式（可选）。
   * 使用 JS 表达式语法，每次触发时求值，结果为 truthy 才执行任务。
   *
   * 可用变量（自动从 GlobalStore 读取）：
   *   agent.xxx   — agent 作用域变量（跨对话持久）
   *   session.xxx — 当前会话变量
   *   global.xxx  — 全局变量
   *   vars.xxx    — agent 的简写（等同 agent.xxx）
   *
   * 内置函数：
   *   random()  — 0-1 随机数
   *   now()     — 当前时间戳（毫秒）
   *   hour()    — 当前小时 (0-23)
   *   day()     — 当前星期 (0=周日, 6=周六)
   *
   * 示例：
   *   "agent.好感度 > 80 && random() < 0.5"
   *   "vars.信任度 >= 60 || vars.好感度 >= 90"
   *   "hour() >= 9 && hour() <= 22 && random() < 0.3"
   */
  condition?: string;
  /** 是否启用 */
  enabled: boolean;
  /** 创建时间戳 */
  createdAt: number;
  /** 创建时所在的会话 ID */
  createdInSession: string;
  /** 上次运行时间 */
  lastRunAt?: number;
  /** 上次运行状态 */
  lastRunStatus?: RunStatus;
  /** 上次运行错误信息 */
  lastRunError?: string;
  /** 当前关联的 TaskBoard 任务 ID（运行时字段；不写入持久化文件） */
  currentTaskId?: string;
}

// ============ 创建/更新参数 ============

/** 创建任务参数 */
export interface CreateJobParams {
  name: string;
  schedule: ScheduleConfig;
  sessionId: string;
  instruction: string;
  delivery?: Partial<DeliveryConfig>;
  silent?: boolean;
  urgent?: boolean;
  condition?: string;
  createdInSession: string;
}

/** 更新任务参数（所有字段可选） */
export interface UpdateJobParams {
  name?: string;
  schedule?: ScheduleConfig;
  instruction?: string;
  delivery?: Partial<DeliveryConfig>;
  silent?: boolean;
  urgent?: boolean;
  condition?: string;
}

// ============ 插件配置 ============

/** 时间窗口（HH:MM 格式） */
export interface TimeWindow {
  start: string;
  end: string;
}

/** 安静时段配置 */
export interface QuietHoursConfig {
  enabled: boolean;
  windows: TimeWindow[];
  allowUrgent: boolean;
}

/** 跳过近期活跃配置 */
export interface SkipRecentActivityConfig {
  enabled: boolean;
  withinMinutes: number;
}

/** 调度器全局配置 */
export interface SchedulerConfig {
  enabled: boolean;
  quietHours: QuietHoursConfig;
  skipIfRecentActivity: SkipRecentActivityConfig;
}

/** 默认配置值 */
export const DEFAULT_SCHEDULER_CONFIG: SchedulerConfig = {
  enabled: true,
  quietHours: {
    enabled: false,
    windows: [{ start: '23:00', end: '07:00' }],
    allowUrgent: true,
  },
  skipIfRecentActivity: {
    enabled: true,
    withinMinutes: 5,
  },
};

// ============ 投递判断结果 ============

/** 投递判断结果 */
export interface DeliveryDecision {
  /** 是否应该跳过 */
  skip: boolean;
  /** 跳过原因 */
  reason?: string;
}

// ============ 后台执行相关类型 ============

// [cron 重构] CronResultPayload 已删除。
// 通知路由改由 CrossAgentTaskBoard 内部处理（emit 事件 → Backend 转发 agent:notification → 平台层渲染）。
// 不再需要 eventBus.fire('cron:result', payload) 的单独载荷类型。

/**
 * 定时任务执行记录（持久化到 cron-runs/ 目录）
 *
 * 每次后台执行完成后保存一条记录，用于回溯查看历史执行情况。
 */
export interface CronRunRecord {
  /** 执行记录 ID（与 taskId 相同） */
  runId: string;
  /** 任务 ID */
  jobId: string;
  /** 任务名称（快照，记录执行时的名称） */
  jobName: string;
  /** 执行的指令 */
  instruction: string;
  /** 执行开始时间（Unix 毫秒时间戳） */
  startTime: number;
  /** 执行结束时间（Unix 毫秒时间戳） */
  endTime: number;
  /** 执行耗时（毫秒） */
  durationMs: number;
  /** 执行状态 */
  status: 'completed' | 'failed' | 'killed';
  /** 最终输出文本（成功时有值） */
  resultText?: string;
  /** 错误信息（失败时有值） */
  error?: string;
}

/**
 * 后台执行配置
 *
 * 控制后台 ToolLoop 的行为参数。
 * 在 SchedulerConfig 中通过 backgroundExecution 字段配置。
 */
export interface CronBackgroundConfig {
  /** 定时任务执行时的系统提示词 */
  systemPrompt: string;
  /** 排除的工具列表（这些工具在定时任务后台执行时不可用） */
  excludeTools: string[];
  /** 后台 ToolLoop 的最大工具轮次，默认 50 */
  maxToolRounds: number;
  /** 单次执行超时时间（毫秒），默认 5 分钟 */
  timeoutMs: number;
  /** 同时运行的最大后台任务数，默认 3 */
  maxConcurrent: number;
  /** 执行记录保留天数，默认 30 */
  retentionDays: number;
  /** 执行记录保留条数上限，默认 100 */
  retentionCount: number;
}

/** 定时任务默认系统提示词 */
export const DEFAULT_CRON_SYSTEM_PROMPT = `你是一个自动化定时任务执行器。

你的职责是执行用户预设的定时任务指令，完成后输出简洁的执行报告。

注意事项：
- 你在后台独立运行，没有用户正在与你对话
- 你的输出将作为通知推送给用户，请保持简洁明了
- 如果任务涉及文件操作，请使用可用的工具完成
- 完成后直接给出结论，不需要寒暄或确认`;

/** 定时任务默认排除工具列表 */
export const DEFAULT_EXCLUDE_TOOLS = ['sub_agent', 'history_search', 'manage_scheduled_tasks'];

/** 后台执行配置默认值 */
export const DEFAULT_BACKGROUND_CONFIG: CronBackgroundConfig = {
  systemPrompt: DEFAULT_CRON_SYSTEM_PROMPT,
  excludeTools: [...DEFAULT_EXCLUDE_TOOLS],
  maxToolRounds: 50,
  timeoutMs: 5 * 60 * 1000,
  maxConcurrent: 3,
  retentionDays: 30,
  retentionCount: 100,
};

