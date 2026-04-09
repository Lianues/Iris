import { describe, it, expect } from 'vitest';
import { SafetyEngine } from '../src/safety/engine.js';
import type { SafetyConfig, ToolRiskMetadata } from '../packages/extension-sdk/src/safety.js';

function createEngine(overrides?: Partial<SafetyConfig>): SafetyEngine {
  return new SafetyEngine({ enabled: true, ...overrides });
}

describe('SafetyEngine', () => {
  describe('基础评估', () => {
    it('disabled 时所有工具直接放行', () => {
      const engine = new SafetyEngine({ enabled: false });
      const decision = engine.evaluate('dangerous_tool', { level: 'critical' });

      expect(decision.reviewerCount).toBe(0);
      expect(decision.confirmRequired).toBe(false);
    });

    it('默认模式为 standard（high + critical 需确认）', () => {
      const engine = createEngine();

      expect(engine.evaluate('tool', { level: 'low' }).confirmRequired).toBe(false);
      expect(engine.evaluate('tool', { level: 'medium' }).confirmRequired).toBe(false);
      expect(engine.evaluate('tool', { level: 'high' }).confirmRequired).toBe(true);
      expect(engine.evaluate('tool', { level: 'critical' }).confirmRequired).toBe(true);
    });

    it('无风险声明时默认 level=low', () => {
      const engine = createEngine();
      const decision = engine.evaluate('tool');

      expect(decision.riskLevel).toBe('low');
      expect(decision.reviewerCount).toBe(0);
      expect(decision.confirmRequired).toBe(false);
    });
  });

  describe('review 系数计算', () => {
    it('默认系数：low=0, medium=1, high=2, critical=3（乘数 ×1）', () => {
      const engine = createEngine();

      expect(engine.evaluate('t', { level: 'low' }).reviewerCount).toBe(0);
      expect(engine.evaluate('t', { level: 'medium' }).reviewerCount).toBe(1);
      expect(engine.evaluate('t', { level: 'high' }).reviewerCount).toBe(2);
      expect(engine.evaluate('t', { level: 'critical' }).reviewerCount).toBe(3);
    });

    it('乘数 ×0.5 应向上取整', () => {
      const engine = createEngine({
        reviewIntensity: { multiplier: 0.5 },
      });

      expect(engine.evaluate('t', { level: 'low' }).reviewerCount).toBe(0);      // 0 × 0.5 = 0
      expect(engine.evaluate('t', { level: 'medium' }).reviewerCount).toBe(1);    // 1 × 0.5 = 0.5 → 1
      expect(engine.evaluate('t', { level: 'high' }).reviewerCount).toBe(1);      // 2 × 0.5 = 1
      expect(engine.evaluate('t', { level: 'critical' }).reviewerCount).toBe(2);  // 3 × 0.5 = 1.5 → 2
    });

    it('乘数 ×2 倍增 reviewer 数量', () => {
      const engine = createEngine({
        reviewIntensity: { multiplier: 2 },
      });

      expect(engine.evaluate('t', { level: 'medium' }).reviewerCount).toBe(2);
      expect(engine.evaluate('t', { level: 'high' }).reviewerCount).toBe(4);
      expect(engine.evaluate('t', { level: 'critical' }).reviewerCount).toBe(6);
    });

    it('乘数 ×0 禁用所有 review', () => {
      const engine = createEngine({
        reviewIntensity: { multiplier: 0 },
      });

      expect(engine.evaluate('t', { level: 'critical' }).reviewerCount).toBe(0);
    });

    it('自定义系数覆盖默认', () => {
      const engine = createEngine({
        reviewIntensity: {
          multiplier: 1,
          coefficients: { low: 1, critical: 5 },
        },
      });

      expect(engine.evaluate('t', { level: 'low' }).reviewerCount).toBe(1);
      expect(engine.evaluate('t', { level: 'medium' }).reviewerCount).toBe(1);    // 默认 1
      expect(engine.evaluate('t', { level: 'critical' }).reviewerCount).toBe(5);
    });
  });

  describe('安全模式', () => {
    it('relaxed 模式：仅 critical 需确认', () => {
      const engine = createEngine({ mode: 'relaxed' });

      expect(engine.evaluate('t', { level: 'high' }).confirmRequired).toBe(false);
      expect(engine.evaluate('t', { level: 'critical' }).confirmRequired).toBe(true);
    });

    it('unrestricted 模式：无需确认', () => {
      const engine = createEngine({ mode: 'unrestricted' });

      expect(engine.evaluate('t', { level: 'critical' }).confirmRequired).toBe(false);
    });

    it('自定义模式覆盖同名内置模式被阻止', () => {
      const engine = createEngine({
        mode: 'standard',
        customModes: [
          { name: 'standard', description: '自定义标准', confirm: { medium: true, high: true, critical: true } },
        ],
      });

      // 内置 standard 模式不会被覆盖，medium 仍然不需要确认
      expect(engine.evaluate('t', { level: 'medium' }).confirmRequired).toBe(false);
    });

    it('完全自定义模式', () => {
      const engine = createEngine({
        mode: 'my-paranoid',
        customModes: [
          { name: 'my-paranoid', description: '全部确认', confirm: { low: true, medium: true, high: true, critical: true } },
        ],
      });

      expect(engine.evaluate('t', { level: 'low' }).confirmRequired).toBe(true);
    });

    it('未知模式回退到 standard', () => {
      const engine = createEngine({ mode: 'nonexistent' });

      expect(engine.getActiveMode().name).toBe('standard');
    });
  });

  describe('运行时操作', () => {
    it('setMode 切换模式', () => {
      const engine = createEngine();

      expect(engine.setMode('relaxed')).toBe(true);
      expect(engine.getActiveMode().name).toBe('relaxed');
      expect(engine.evaluate('t', { level: 'high' }).confirmRequired).toBe(false);
    });

    it('setMode 不存在的模式返回 false', () => {
      const engine = createEngine();

      expect(engine.setMode('nonexistent')).toBe(false);
      expect(engine.getActiveMode().name).toBe('standard');
    });

    it('setMultiplier 动态调整乘数', () => {
      const engine = createEngine();

      engine.setMultiplier(3);
      expect(engine.evaluate('t', { level: 'medium' }).reviewerCount).toBe(3);

      engine.setMultiplier(0);
      expect(engine.evaluate('t', { level: 'critical' }).reviewerCount).toBe(0);
    });

    it('setMultiplier 负数钳位为 0', () => {
      const engine = createEngine();
      engine.setMultiplier(-5);
      expect(engine.evaluate('t', { level: 'critical' }).reviewerCount).toBe(0);
    });

    it('listModes 包含内置和自定义模式', () => {
      const engine = createEngine({
        customModes: [{ name: 'custom', confirm: {} }],
      });

      const modes = engine.listModes();
      const names = modes.map(m => m.name);
      expect(names).toContain('standard');
      expect(names).toContain('relaxed');
      expect(names).toContain('unrestricted');
      expect(names).toContain('custom');
    });

    it('isEnabled 反映启用状态', () => {
      expect(new SafetyEngine({ enabled: true }).isEnabled()).toBe(true);
      expect(new SafetyEngine({ enabled: false }).isEnabled()).toBe(false);
      expect(new SafetyEngine().isEnabled()).toBe(false);
    });
  });

  describe('review + confirm 独立性', () => {
    it('review 和 confirm 可以同时生效', () => {
      const engine = createEngine(); // standard mode

      const decision = engine.evaluate('t', { level: 'critical' });
      expect(decision.reviewerCount).toBe(3);         // review 门开
      expect(decision.confirmRequired).toBe(true);     // confirm 门也开
    });

    it('unrestricted + 乘数×0 = 全自动', () => {
      const engine = createEngine({
        mode: 'unrestricted',
        reviewIntensity: { multiplier: 0 },
      });

      const decision = engine.evaluate('t', { level: 'critical' });
      expect(decision.reviewerCount).toBe(0);
      expect(decision.confirmRequired).toBe(false);
    });

    it('confirm 开但 review 关（乘数×0）', () => {
      const engine = createEngine({
        mode: 'standard',
        reviewIntensity: { multiplier: 0 },
      });

      const decision = engine.evaluate('t', { level: 'critical' });
      expect(decision.reviewerCount).toBe(0);           // review 关
      expect(decision.confirmRequired).toBe(true);       // confirm 仍然开
    });
  });
});
