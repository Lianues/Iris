/**
 * ReviewService — 通用 LLM 审阅服务
 *
 * 通过并发 LLM 调用获取结构化审阅结果，支持多种聚合策略。
 * 非安全专用，可用于安全审查、代码审阅、内容评估等任意场景。
 *
 * 通过 ServiceRegistry 注册为 'iris.review'，供插件和核心模块使用。
 */

import type {
  AggregationStrategy,
  ReviewAggregation,
  ReviewDecision,
  ReviewRequest,
  ReviewServiceConfig,
  ReviewServiceLike,
  ReviewVerdict,
} from '@irises/extension-sdk';
import type { LLMRequest } from '@/types';
import type { LLMRouter } from '@/llm/router';
import { createLogger } from '@/logger';
import { extractText } from '@/types';

const log = createLogger('ReviewService');

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_REVIEWER_COUNT = 1;
const DEFAULT_AGGREGATION: AggregationStrategy = 'raw';

/**
 * 构建发给单个 reviewer 的 LLM 请求。
 *
 * 系统指令要求模型以 JSON 格式返回结构化审阅结果。
 */
function buildReviewLLMRequest(req: ReviewRequest): LLMRequest {
  const contextSection = req.context
    ? `\n\n## Additional Context\n${JSON.stringify(req.context, null, 2)}`
    : '';

  return {
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: [
              `## Review Subject: ${req.subject}`,
              '',
              '## Payload',
              '```json',
              JSON.stringify(req.payload, null, 2),
              '```',
              '',
              `## Instruction`,
              req.instruction,
              contextSection,
            ].join('\n'),
          },
        ],
      },
    ],
    systemInstruction: {
      parts: [
        {
          text: [
            'You are a precise review agent. Evaluate the payload according to the given instruction.',
            '',
            'You MUST respond with a single JSON object (no markdown fences, no extra text):',
            '{',
            '  "decision": "approve" | "deny" | "abstain",',
            '  "confidence": <number 0-1>,',
            '  "reason": "<concise explanation>",',
            '  "suggestions": ["<optional improvement suggestion>", ...],',
            '  "risks": ["<optional identified risk>", ...]',
            '}',
            '',
            'Rules:',
            '- "approve" = the payload meets the criteria in the instruction',
            '- "deny" = the payload violates criteria or presents unacceptable risk',
            '- "abstain" = insufficient information to make a confident judgment',
            '- confidence must reflect your actual certainty (0 = no confidence, 1 = absolute certainty)',
            '- suggestions and risks are optional arrays; omit if not applicable',
          ].join('\n'),
        },
      ],
    },
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 1024,
    },
  };
}

/**
 * 解析 LLM 原始文本为 ReviewVerdict。
 * 容忍 markdown fence 包裹和轻微格式偏差。
 */
function parseVerdict(raw: string): ReviewVerdict {
  // 去掉 markdown code fence
  let cleaned = raw.trim();
  const fenceMatch = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  }

  try {
    const parsed = JSON.parse(cleaned);

    const decision = validateDecision(parsed.decision);
    const confidence = typeof parsed.confidence === 'number'
      ? Math.max(0, Math.min(1, parsed.confidence))
      : 0.5;
    const reason = typeof parsed.reason === 'string' ? parsed.reason : 'No reason provided';
    const suggestions = Array.isArray(parsed.suggestions)
      ? parsed.suggestions.filter((s: unknown) => typeof s === 'string')
      : undefined;
    const risks = Array.isArray(parsed.risks)
      ? parsed.risks.filter((s: unknown) => typeof s === 'string')
      : undefined;

    return { decision, confidence, reason, suggestions, risks, rawResponse: raw };
  } catch {
    log.warn('Failed to parse reviewer response as JSON, treating as abstain:', raw.slice(0, 200));
    return {
      decision: 'abstain',
      confidence: 0,
      reason: `Failed to parse LLM response: ${raw.slice(0, 100)}`,
      rawResponse: raw,
    };
  }
}

function validateDecision(value: unknown): ReviewDecision {
  if (value === 'approve' || value === 'deny' || value === 'abstain') {
    return value;
  }
  return 'abstain';
}

/**
 * 将多个 verdict 按策略聚合为最终决定。
 */
function aggregate(verdicts: ReviewVerdict[], strategy: AggregationStrategy): ReviewDecision {
  if (strategy === 'raw') {
    // raw 不做聚合；单 reviewer 时直通其 decision 以避免误导
    return verdicts.length === 1 ? verdicts[0].decision : 'abstain';
  }

  const approves = verdicts.filter(v => v.decision === 'approve').length;
  const denies = verdicts.filter(v => v.decision === 'deny').length;

  switch (strategy) {
    case 'majority':
      if (approves > denies) return 'approve';
      if (denies > approves) return 'deny';
      return 'abstain';

    case 'unanimous':
      if (verdicts.length > 0 && verdicts.every(v => v.decision === 'approve')) return 'approve';
      if (denies > 0) return 'deny';
      return 'abstain';

    case 'any_deny':
      if (denies > 0) return 'deny';
      if (approves > 0) return 'approve';
      return 'abstain';

    default:
      return 'abstain';
  }
}

export class ReviewService implements ReviewServiceLike {
  private router: LLMRouter;
  private config: Required<ReviewServiceConfig>;

  constructor(router: LLMRouter, config?: ReviewServiceConfig) {
    this.router = router;
    this.config = {
      defaultReviewerCount: config?.defaultReviewerCount ?? DEFAULT_REVIEWER_COUNT,
      defaultTimeoutMs: config?.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS,
      defaultAggregation: config?.defaultAggregation ?? DEFAULT_AGGREGATION,
      defaultModel: config?.defaultModel ?? '',
    };
  }

  async review(request: ReviewRequest): Promise<ReviewAggregation> {
    const startTime = Date.now();

    const reviewerCount = Math.max(1, request.reviewerCount ?? this.config.defaultReviewerCount);
    const strategy = request.aggregation ?? this.config.defaultAggregation;
    const timeoutMs = request.timeoutMs ?? this.config.defaultTimeoutMs;
    const model = request.model || this.config.defaultModel || undefined;

    log.debug(`Starting review: subject="${request.subject}", reviewers=${reviewerCount}, strategy=${strategy}`);

    const llmRequest = buildReviewLLMRequest(request);

    // 并发调用 LLM，每个 reviewer 微调 temperature 以增加多样性
    const verdictPromises: Promise<ReviewVerdict>[] = [];
    for (let i = 0; i < reviewerCount; i++) {
      const reviewerRequest = reviewerCount > 1
        ? {
            ...llmRequest,
            generationConfig: {
              ...llmRequest.generationConfig,
              temperature: 0.1 + i * 0.15,
            },
          }
        : llmRequest;
      verdictPromises.push(this.callReviewer(reviewerRequest, model, timeoutMs, i));
    }

    const verdicts = await Promise.all(verdictPromises);
    const decision = aggregate(verdicts, strategy);
    const durationMs = Date.now() - startTime;

    log.debug(`Review complete: subject="${request.subject}", decision=${decision}, duration=${durationMs}ms`);

    return { decision, verdicts, strategy, durationMs };
  }

  private async callReviewer(
    request: LLMRequest,
    model: string | undefined,
    timeoutMs: number,
    index: number,
  ): Promise<ReviewVerdict> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      // Promise.race 作为硬超时兜底（即使 router 不尊重 AbortSignal）
      const llmPromise = this.router.chat(request, model, controller.signal);
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`Reviewer #${index} hard timeout after ${timeoutMs}ms`)), timeoutMs + 1000);
      });

      try {
        const response = await Promise.race([llmPromise, timeoutPromise]);
        const raw = extractText(response.content.parts);
        return parseVerdict(raw);
      } finally {
        clearTimeout(timer);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.warn(`Reviewer #${index} failed: ${message}`);
      return {
        decision: 'abstain',
        confidence: 0,
        reason: `Reviewer error: ${message}`,
      };
    }
  }
}
