/**
 * 安全系统集成测试
 *
 * 验证完整链路：SafetyEngine → ReviewService → Scheduler 决策
 * 不依赖真实 LLM API，使用 mock LLMRouter。
 */

import { describe, it, expect, vi } from 'vitest';
import { SafetyEngine } from '../src/safety/engine.js';
import { ReviewService } from '../src/review/service.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { executeSingleTool } from '../src/tools/scheduler.js';
import type { SafetyContext } from '../src/tools/scheduler.js';
import type { FunctionCallPart } from '../src/types/message.js';
import type { LLMRouter } from '../src/llm/router.js';
import type { LLMResponse } from '../src/types/llm.js';
import type { SafetyConfig } from '../packages/extension-sdk/src/safety.js';

// ── Mock Helpers ──

function createMockRouter(responses: string[]): LLMRouter {
  let callIndex = 0;
  return {
    chat: vi.fn(async (): Promise<LLMResponse> => {
      const text = responses[callIndex] ?? responses[responses.length - 1];
      callIndex++;
      return { content: { role: 'model', parts: [{ text }] } };
    }),
  } as unknown as LLMRouter;
}

function createFailingRouter(): LLMRouter {
  return {
    chat: vi.fn(async () => { throw new Error('LLM API down'); }),
  } as unknown as LLMRouter;
}

const APPROVE = JSON.stringify({ decision: 'approve', confidence: 0.9, reason: 'Safe operation' });
const DENY = JSON.stringify({ decision: 'deny', confidence: 0.85, reason: 'Destructive operation' });

function makeCall(toolName: string, args: Record<string, unknown> = {}): FunctionCallPart {
  return { functionCall: { name: toolName, args } };
}

function createRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  // 低风险工具
  registry.register({
    declaration: { name: 'read_file', description: 'Read a file' },
    handler: async () => ({ content: 'file content' }),
    risk: { level: 'low' },
  });
  // 中风险工具
  registry.register({
    declaration: { name: 'write_file', description: 'Write a file' },
    handler: async () => ({ success: true }),
    risk: { level: 'medium' },
  });
  // 高风险工具
  registry.register({
    declaration: { name: 'delete_file', description: 'Delete a file' },
    handler: async () => ({ deleted: true }),
    risk: { level: 'high' },
  });
  // 关键风险工具
  registry.register({
    declaration: { name: 'format_disk', description: 'Format disk' },
    handler: async () => ({ formatted: true }),
    risk: { level: 'critical' },
  });
  // 无风险声明的工具（默认 low）
  registry.register({
    declaration: { name: 'echo', description: 'Echo text' },
    handler: async (args) => args,
  });
  return registry;
}

function createSafetyCtx(
  configOverrides?: Partial<SafetyConfig>,
  routerResponses?: string[],
): SafetyContext {
  const engine = new SafetyEngine({ enabled: true, ...configOverrides });
  const router = routerResponses
    ? createMockRouter(routerResponses)
    : createFailingRouter();
  const reviewService = new ReviewService(router, { defaultTimeoutMs: 5000 });
  return { engine, reviewService };
}

const defaultToolsConfig = {
  permissions: {},
  autoApproveAll: true, // 跳过 user confirm 以便测试 review 门
};

// ── Tests ──

describe('安全系统集成测试', () => {
  describe('基础链路', () => {
    it('safety disabled → 工具正常执行', async () => {
      const registry = createRegistry();
      const result = await executeSingleTool(
        makeCall('format_disk'),
        registry,
        undefined, undefined,
        defaultToolsConfig,
        undefined, undefined, undefined, undefined,
        undefined, // safetyCtx = undefined
      );
      expect(result.functionResponse.response.result).toHaveProperty('formatted', true);
    });

    it('safety enabled + low risk → 无 review 直接执行', async () => {
      const registry = createRegistry();
      const ctx = createSafetyCtx();
      const result = await executeSingleTool(
        makeCall('read_file'),
        registry,
        undefined, undefined,
        defaultToolsConfig,
        undefined, undefined, undefined, undefined,
        ctx,
      );
      expect(result.functionResponse.response.result).toHaveProperty('content', 'file content');
    });

    it('无风险声明的工具默认 low → 直接执行', async () => {
      const registry = createRegistry();
      const ctx = createSafetyCtx();
      const result = await executeSingleTool(
        makeCall('echo', { text: 'hello' }),
        registry,
        undefined, undefined,
        defaultToolsConfig,
        undefined, undefined, undefined, undefined,
        ctx,
      );
      expect(result.functionResponse.response.result).toHaveProperty('text', 'hello');
    });
  });

  describe('AI Review 门', () => {
    it('medium risk + reviewer approve → 执行', async () => {
      const registry = createRegistry();
      const ctx = createSafetyCtx({}, [APPROVE]);
      const result = await executeSingleTool(
        makeCall('write_file', { path: '/tmp/test' }),
        registry,
        undefined, undefined,
        defaultToolsConfig,
        undefined, undefined, undefined, undefined,
        ctx,
      );
      expect(result.functionResponse.response.result).toHaveProperty('success', true);
    });

    it('medium risk + reviewer deny + unrestricted → 直接拒绝', async () => {
      const registry = createRegistry();
      const ctx = createSafetyCtx({ mode: 'unrestricted' }, [DENY]);
      const result = await executeSingleTool(
        makeCall('write_file', { path: '/etc/passwd' }),
        registry,
        undefined, undefined,
        defaultToolsConfig,
        undefined, undefined, undefined, undefined,
        ctx,
      );
      expect(result.functionResponse.response).toHaveProperty('error');
      expect(result.functionResponse.response.error).toContain('安全审阅拒绝');
    });

    it('critical risk + 3 reviewers all deny → 拒绝', async () => {
      const registry = createRegistry();
      const ctx = createSafetyCtx(
        { mode: 'unrestricted' }, // 关闭 confirm 门以隔离 review 门
        [DENY, DENY, DENY],
      );
      const result = await executeSingleTool(
        makeCall('format_disk'),
        registry,
        undefined, undefined,
        defaultToolsConfig,
        undefined, undefined, undefined, undefined,
        ctx,
      );
      expect(result.functionResponse.response.error).toContain('安全审阅拒绝');
    });
  });

  describe('Fail-closed', () => {
    it('ReviewService 未注入 → fail-closed', async () => {
      const engine = new SafetyEngine({ enabled: true });
      const ctx: SafetyContext = { engine, reviewService: undefined };
      const registry = createRegistry();
      const result = await executeSingleTool(
        makeCall('write_file'),
        registry,
        undefined, undefined,
        defaultToolsConfig,
        undefined, undefined, undefined, undefined,
        ctx,
      );
      expect(result.functionResponse.response.error).toContain('安全基础设施缺失');
    });

    it('全部 reviewer 失败（LLM API down）→ abstain → fail-closed', async () => {
      const registry = createRegistry();
      // createSafetyCtx with failing router → all reviewers will error → abstain
      const engine = new SafetyEngine({ enabled: true });
      const router = createFailingRouter();
      const reviewService = new ReviewService(router, { defaultTimeoutMs: 2000 });
      const ctx: SafetyContext = { engine, reviewService };
      const result = await executeSingleTool(
        makeCall('write_file'),
        registry,
        undefined, undefined,
        defaultToolsConfig,
        undefined, undefined, undefined, undefined,
        ctx,
      );
      expect(result.functionResponse.response.error).toContain('安全审阅异常');
    });
  });

  describe('动态聚合策略', () => {
    it('critical 使用 any_deny: 1 deny + 2 approve = 拒绝', async () => {
      const registry = createRegistry();
      // critical 默认 3 reviewers, any_deny 策略
      const ctx = createSafetyCtx(
        { mode: 'unrestricted' },
        [DENY, APPROVE, APPROVE],
      );
      const result = await executeSingleTool(
        makeCall('format_disk'),
        registry,
        undefined, undefined,
        defaultToolsConfig,
        undefined, undefined, undefined, undefined,
        ctx,
      );
      expect(result.functionResponse.response.error).toContain('安全审阅拒绝');
    });

    it('high 使用 unanimous: 1 deny + 1 approve = 拒绝', async () => {
      const registry = createRegistry();
      // high 默认 2 reviewers, unanimous 策略
      const ctx = createSafetyCtx(
        { mode: 'unrestricted' },
        [APPROVE, DENY],
      );
      const result = await executeSingleTool(
        makeCall('delete_file'),
        registry,
        undefined, undefined,
        defaultToolsConfig,
        undefined, undefined, undefined, undefined,
        ctx,
      );
      expect(result.functionResponse.response.error).toContain('安全审阅拒绝');
    });

    it('medium 使用 majority: 1 approve = 通过（单 reviewer raw）', async () => {
      const registry = createRegistry();
      // medium 默认 1 reviewer, raw 策略
      const ctx = createSafetyCtx({}, [APPROVE]);
      const result = await executeSingleTool(
        makeCall('write_file'),
        registry,
        undefined, undefined,
        defaultToolsConfig,
        undefined, undefined, undefined, undefined,
        ctx,
      );
      expect(result.functionResponse.response.result).toHaveProperty('success', true);
    });
  });

  describe('内置模式保护', () => {
    it('自定义模式无法覆盖 standard', () => {
      const engine = new SafetyEngine({
        enabled: true,
        mode: 'standard',
        customModes: [
          { name: 'standard', description: '恶意覆盖', confirm: {} }, // 试图清空 confirm
        ],
      });
      // standard 内置模式 high+critical 需要 confirm，恶意覆盖被阻止
      const decision = engine.evaluate('tool', { level: 'high' });
      expect(decision.confirmRequired).toBe(true);
    });
  });

  describe('Review 乘数', () => {
    it('multiplier=0 禁用所有 review → 直接执行', async () => {
      const registry = createRegistry();
      const ctx = createSafetyCtx({
        mode: 'unrestricted',
        reviewIntensity: { multiplier: 0 },
      });
      const result = await executeSingleTool(
        makeCall('format_disk'),
        registry,
        undefined, undefined,
        defaultToolsConfig,
        undefined, undefined, undefined, undefined,
        ctx,
      );
      // multiplier=0 → reviewerCount=0, unrestricted → no confirm → 直接执行
      expect(result.functionResponse.response.result).toHaveProperty('formatted', true);
    });

    it('multiplier=2 → critical 产生 6 reviewers', () => {
      const engine = new SafetyEngine({
        enabled: true,
        reviewIntensity: { multiplier: 2 },
      });
      const decision = engine.evaluate('tool', { level: 'critical' });
      expect(decision.reviewerCount).toBe(6);
    });
  });
});
