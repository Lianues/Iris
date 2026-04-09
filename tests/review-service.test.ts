import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ReviewService } from '../src/review/service.js';
import type { LLMRouter } from '../src/llm/router.js';
import type { LLMResponse } from '../src/types/llm.js';
import type { ReviewRequest } from '../packages/extension-sdk/src/review.js';

/**
 * 构造一个返回指定 JSON 文本的 mock LLMRouter。
 */
function createMockRouter(responses: string[]): LLMRouter {
  let callIndex = 0;
  return {
    chat: vi.fn(async (): Promise<LLMResponse> => {
      const text = responses[callIndex] ?? responses[responses.length - 1];
      callIndex++;
      return {
        content: {
          role: 'model',
          parts: [{ text }],
        },
      };
    }),
  } as unknown as LLMRouter;
}

/** 构造一个总是抛出错误的 mock LLMRouter */
function createFailingRouter(error: string): LLMRouter {
  return {
    chat: vi.fn(async () => { throw new Error(error); }),
  } as unknown as LLMRouter;
}

/** 构造一个永远不返回（模拟超时）的 mock LLMRouter */
function createHangingRouter(): LLMRouter {
  return {
    chat: vi.fn(() => new Promise<never>(() => { /* never resolves */ })),
  } as unknown as LLMRouter;
}

const APPROVE_JSON = JSON.stringify({
  decision: 'approve',
  confidence: 0.95,
  reason: 'Looks safe',
  suggestions: ['Consider logging'],
  risks: [],
});

const DENY_JSON = JSON.stringify({
  decision: 'deny',
  confidence: 0.88,
  reason: 'Destructive operation without backup',
  risks: ['Data loss'],
});

const ABSTAIN_JSON = JSON.stringify({
  decision: 'abstain',
  confidence: 0.3,
  reason: 'Insufficient context',
});

function baseRequest(overrides?: Partial<ReviewRequest>): ReviewRequest {
  return {
    subject: 'test-review',
    payload: { tool: 'rm', args: { path: '/tmp/test' } },
    instruction: 'Evaluate if this operation is safe.',
    ...overrides,
  };
}

describe('ReviewService', () => {
  describe('单 reviewer 基础流程', () => {
    it('应正确解析 approve 结果', async () => {
      const router = createMockRouter([APPROVE_JSON]);
      const service = new ReviewService(router);

      const result = await service.review(baseRequest());

      expect(result.verdicts).toHaveLength(1);
      expect(result.verdicts[0].decision).toBe('approve');
      expect(result.verdicts[0].confidence).toBe(0.95);
      expect(result.verdicts[0].reason).toBe('Looks safe');
      expect(result.verdicts[0].suggestions).toEqual(['Consider logging']);
      expect(result.strategy).toBe('raw');
      // raw 策略 + 单 reviewer → 直通 decision
      expect(result.decision).toBe('approve');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('应正确解析 deny 结果', async () => {
      const router = createMockRouter([DENY_JSON]);
      const service = new ReviewService(router);

      const result = await service.review(baseRequest());

      expect(result.verdicts[0].decision).toBe('deny');
      expect(result.verdicts[0].risks).toEqual(['Data loss']);
      expect(result.decision).toBe('deny');
    });

    it('应容忍 markdown code fence 包裹的 JSON', async () => {
      const wrapped = '```json\n' + APPROVE_JSON + '\n```';
      const router = createMockRouter([wrapped]);
      const service = new ReviewService(router);

      const result = await service.review(baseRequest());

      expect(result.verdicts[0].decision).toBe('approve');
    });

    it('JSON 解析失败时应降级为 abstain', async () => {
      const router = createMockRouter(['This is not JSON at all']);
      const service = new ReviewService(router);

      const result = await service.review(baseRequest());

      expect(result.verdicts[0].decision).toBe('abstain');
      expect(result.verdicts[0].confidence).toBe(0);
      expect(result.verdicts[0].rawResponse).toContain('This is not JSON');
    });

    it('无效 decision 值应降级为 abstain', async () => {
      const invalid = JSON.stringify({ decision: 'maybe', confidence: 0.5, reason: 'Unsure' });
      const router = createMockRouter([invalid]);
      const service = new ReviewService(router);

      const result = await service.review(baseRequest());

      expect(result.verdicts[0].decision).toBe('abstain');
    });

    it('confidence 应被钳位到 [0, 1]', async () => {
      const over = JSON.stringify({ decision: 'approve', confidence: 1.5, reason: 'Very sure' });
      const under = JSON.stringify({ decision: 'deny', confidence: -0.5, reason: 'Very unsure' });
      const router = createMockRouter([over, under]);
      const service = new ReviewService(router);

      const r1 = await service.review(baseRequest());
      expect(r1.verdicts[0].confidence).toBe(1);

      const r2 = await service.review(baseRequest());
      expect(r2.verdicts[0].confidence).toBe(0);
    });
  });

  describe('多 reviewer 聚合', () => {
    it('majority 策略：approve 多数', async () => {
      const router = createMockRouter([APPROVE_JSON, DENY_JSON, APPROVE_JSON]);
      const service = new ReviewService(router);

      const result = await service.review(baseRequest({
        reviewerCount: 3,
        aggregation: 'majority',
      }));

      expect(result.verdicts).toHaveLength(3);
      expect(result.decision).toBe('approve');
      expect(result.strategy).toBe('majority');
    });

    it('majority 策略：deny 多数', async () => {
      const router = createMockRouter([DENY_JSON, DENY_JSON, APPROVE_JSON]);
      const service = new ReviewService(router);

      const result = await service.review(baseRequest({
        reviewerCount: 3,
        aggregation: 'majority',
      }));

      expect(result.decision).toBe('deny');
    });

    it('majority 策略：平票返回 abstain', async () => {
      const router = createMockRouter([APPROVE_JSON, DENY_JSON]);
      const service = new ReviewService(router);

      const result = await service.review(baseRequest({
        reviewerCount: 2,
        aggregation: 'majority',
      }));

      expect(result.decision).toBe('abstain');
    });

    it('unanimous 策略：全部 approve', async () => {
      const router = createMockRouter([APPROVE_JSON, APPROVE_JSON, APPROVE_JSON]);
      const service = new ReviewService(router);

      const result = await service.review(baseRequest({
        reviewerCount: 3,
        aggregation: 'unanimous',
      }));

      expect(result.decision).toBe('approve');
    });

    it('unanimous 策略：一票 deny 即 deny', async () => {
      const router = createMockRouter([APPROVE_JSON, DENY_JSON, APPROVE_JSON]);
      const service = new ReviewService(router);

      const result = await service.review(baseRequest({
        reviewerCount: 3,
        aggregation: 'unanimous',
      }));

      expect(result.decision).toBe('deny');
    });

    it('any_deny 策略：一票否决', async () => {
      const router = createMockRouter([APPROVE_JSON, APPROVE_JSON, DENY_JSON]);
      const service = new ReviewService(router);

      const result = await service.review(baseRequest({
        reviewerCount: 3,
        aggregation: 'any_deny',
      }));

      expect(result.decision).toBe('deny');
    });

    it('any_deny 策略：全部 approve', async () => {
      const router = createMockRouter([APPROVE_JSON, APPROVE_JSON]);
      const service = new ReviewService(router);

      const result = await service.review(baseRequest({
        reviewerCount: 2,
        aggregation: 'any_deny',
      }));

      expect(result.decision).toBe('approve');
    });

    it('raw 策略 + 多 reviewer → decision 为 abstain', async () => {
      const router = createMockRouter([APPROVE_JSON, DENY_JSON]);
      const service = new ReviewService(router);

      const result = await service.review(baseRequest({
        reviewerCount: 2,
        aggregation: 'raw',
      }));

      expect(result.decision).toBe('abstain');
      expect(result.verdicts).toHaveLength(2);
      expect(result.verdicts[0].decision).toBe('approve');
      expect(result.verdicts[1].decision).toBe('deny');
    });
  });

  describe('错误处理', () => {
    it('LLM 调用失败时应降级为 abstain', async () => {
      const router = createFailingRouter('API rate limit exceeded');
      const service = new ReviewService(router);

      const result = await service.review(baseRequest());

      expect(result.verdicts[0].decision).toBe('abstain');
      expect(result.verdicts[0].reason).toContain('API rate limit exceeded');
    });

    it('部分 reviewer 失败不影响其他 reviewer', async () => {
      // 第一个成功返回 approve，第二个抛异常，第三个成功返回 approve
      let callCount = 0;
      const router = {
        chat: vi.fn(async () => {
          callCount++;
          if (callCount === 2) throw new Error('Network error');
          return {
            content: { role: 'model', parts: [{ text: APPROVE_JSON }] },
          };
        }),
      } as unknown as LLMRouter;

      const service = new ReviewService(router);
      const result = await service.review(baseRequest({
        reviewerCount: 3,
        aggregation: 'majority',
      }));

      expect(result.verdicts).toHaveLength(3);
      const decisions = result.verdicts.map(v => v.decision);
      expect(decisions).toContain('approve');
      expect(decisions).toContain('abstain');
      // 2 approve + 1 abstain → majority approve
      expect(result.decision).toBe('approve');
    });

    it('超时时应降级为 abstain', async () => {
      const router = createHangingRouter();
      const service = new ReviewService(router);

      const result = await service.review(baseRequest({ timeoutMs: 500 }));

      expect(result.verdicts[0].decision).toBe('abstain');
      expect(result.verdicts[0].reason).toContain('error');
    }, 10_000);
  });

  describe('边界条件', () => {
    it('reviewerCount <= 0 应钳位为 1', async () => {
      const router = createMockRouter([APPROVE_JSON]);
      const service = new ReviewService(router);

      const result = await service.review(baseRequest({ reviewerCount: 0 }));
      expect(result.verdicts).toHaveLength(1);

      const result2 = await service.review(baseRequest({ reviewerCount: -5 }));
      expect(result2.verdicts).toHaveLength(1);
    });

    it('空 payload 应正常处理', async () => {
      const router = createMockRouter([APPROVE_JSON]);
      const service = new ReviewService(router);

      const result = await service.review(baseRequest({ payload: {} }));
      expect(result.verdicts).toHaveLength(1);
    });

    it('指定 model 应透传给 router', async () => {
      const router = createMockRouter([APPROVE_JSON]);
      const service = new ReviewService(router);

      await service.review(baseRequest({ model: 'gpt-4o' }));

      expect(router.chat).toHaveBeenCalledWith(
        expect.any(Object),
        'gpt-4o',
        expect.any(Object),
      );
    });

    it('默认配置应可通过构造函数覆盖', async () => {
      const router = createMockRouter([APPROVE_JSON, APPROVE_JSON, APPROVE_JSON]);
      const service = new ReviewService(router, {
        defaultReviewerCount: 3,
        defaultAggregation: 'unanimous',
        defaultModel: 'claude-sonnet',
      });

      const result = await service.review(baseRequest());

      expect(result.verdicts).toHaveLength(3);
      expect(result.strategy).toBe('unanimous');
      expect(router.chat).toHaveBeenCalledWith(
        expect.any(Object),
        'claude-sonnet',
        expect.any(Object),
      );
    });

    it('多 reviewer 应使用不同 temperature 以增加多样性', async () => {
      const router = createMockRouter([APPROVE_JSON, APPROVE_JSON, APPROVE_JSON]);
      const service = new ReviewService(router);

      await service.review(baseRequest({ reviewerCount: 3, aggregation: 'majority' }));

      const calls = (router.chat as ReturnType<typeof vi.fn>).mock.calls;
      const temps = calls.map((c: unknown[]) => (c[0] as { generationConfig?: { temperature?: number } }).generationConfig?.temperature);

      // 3 个 reviewer 应有不同的 temperature
      expect(new Set(temps).size).toBe(3);
      // 第一个应是 0.1（基础值）
      expect(temps[0]).toBeCloseTo(0.1, 2);
    });
  });
});
