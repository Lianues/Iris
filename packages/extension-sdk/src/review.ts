/**
 * Review service types for Iris agent review infrastructure.
 *
 * ReviewService is general-purpose LLM review infrastructure, not tied to safety.
 * It can be used for safety review, code review, content moderation,
 * decision validation, or any scenario requiring structured LLM evaluation.
 */

/** 结果聚合策略 */
export type AggregationStrategy =
  | 'majority'    // 多数决：approve 票数 > deny 票数
  | 'unanimous'   // 全票通过：全部 approve 才算通过
  | 'any_deny'    // 任一否决：任一 deny 即最终 deny
  | 'raw';        // 不聚合，返回全部原始结果，由调用方自行判断

/** 审阅决定 */
export type ReviewDecision = 'approve' | 'deny' | 'abstain';

/** 审阅请求 */
export interface ReviewRequest {
  /** 审阅主题/标识（用于日志和追踪） */
  subject: string;
  /** 待审阅的结构化数据 */
  payload: Record<string, unknown>;
  /** 审阅指令（告诉 reviewer 应关注什么、评判标准） */
  instruction: string;
  /** 并发 reviewer 数量（默认 1） */
  reviewerCount?: number;
  /** 聚合策略（默认 'raw'） */
  aggregation?: AggregationStrategy;
  /** 指定模型名称（不指定则使用 router 默认模型） */
  model?: string;
  /** 单个 reviewer 超时时间（毫秒，默认 30000） */
  timeoutMs?: number;
  /** 附加上下文（透传给 reviewer 的参考信息） */
  context?: Record<string, unknown>;
}

/** 单个 reviewer 的审阅结果 */
export interface ReviewVerdict {
  /** 审阅决定 */
  decision: ReviewDecision;
  /** 置信度（0 ~ 1） */
  confidence: number;
  /** 决定理由 */
  reason: string;
  /** 改进建议 */
  suggestions?: string[];
  /** 识别到的风险点 */
  risks?: string[];
  /** 原始 LLM 响应（调试用） */
  rawResponse?: string;
}

/** 聚合后的审阅结果 */
export interface ReviewAggregation {
  /** 最终决定（由聚合策略决定；strategy 为 'raw' 时固定为 'abstain'） */
  decision: ReviewDecision;
  /** 各 reviewer 的详细结果 */
  verdicts: ReviewVerdict[];
  /** 使用的聚合策略 */
  strategy: AggregationStrategy;
  /** 总耗时（毫秒） */
  durationMs: number;
}

/** ReviewService 配置 */
export interface ReviewServiceConfig {
  /** 默认并发 reviewer 数量（默认 1） */
  defaultReviewerCount?: number;
  /** 默认超时时间（毫秒，默认 30000） */
  defaultTimeoutMs?: number;
  /** 默认聚合策略（默认 'raw'） */
  defaultAggregation?: AggregationStrategy;
  /** 默认模型名称（不指定则使用 router 当前模型） */
  defaultModel?: string;
}

/** ReviewService 的 SDK 侧接口（通过 ServiceRegistry 暴露） */
export interface ReviewServiceLike {
  /** 提交审阅请求，返回聚合后的审阅结果 */
  review(request: ReviewRequest): Promise<ReviewAggregation>;
}
