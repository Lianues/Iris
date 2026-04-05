import { describe, expect, it, vi } from 'vitest';
import { ConfigContributionRegistry } from '../src/extension/config-contribution-registry.js';
import type { ConfigContribution } from '../packages/extension-sdk/src';

function makeContribution(overrides: Partial<ConfigContribution> & { sectionId: string; title: string }): ConfigContribution {
  return {
    fields: [],
    onLoad: () => ({}),
    onSave: () => {},
    ...overrides,
  };
}

describe('ConfigContributionRegistry', () => {
  // ---- register / get / getAll ----

  it('注册配置贡献后可通过 get 和 getAll 获取', () => {
    const registry = new ConfigContributionRegistry();
    const contrib = makeContribution({ sectionId: 'memory', title: '记忆系统' });
    registry.register(contrib);

    expect(registry.get('memory')).toBe(contrib);
    expect(registry.getAll()).toHaveLength(1);
    expect(registry.getAll()[0].title).toBe('记忆系统');
  });

  it('未注册的 sectionId 返回 undefined', () => {
    const registry = new ConfigContributionRegistry();

    expect(registry.get('nonexistent')).toBeUndefined();
  });

  // ---- 重复注册 ----

  it('重复注册相同 sectionId 抛出错误', () => {
    const registry = new ConfigContributionRegistry();
    registry.register(makeContribution({ sectionId: 'dup', title: 'First' }));

    expect(() => registry.register(makeContribution({ sectionId: 'dup', title: 'Second' }))).toThrow('已注册');
  });

  // ---- dispose ----

  it('dispose 后配置贡献被移除，可重新注册', () => {
    const registry = new ConfigContributionRegistry();
    const disposable = registry.register(makeContribution({ sectionId: 'tmp', title: 'Temp' }));

    expect(registry.get('tmp')).toBeDefined();

    disposable.dispose();
    expect(registry.get('tmp')).toBeUndefined();
    expect(registry.getAll()).toHaveLength(0);

    // 注销后可重新注册
    registry.register(makeContribution({ sectionId: 'tmp', title: 'Temp2' }));
    expect(registry.get('tmp')?.title).toBe('Temp2');
  });

  // ---- getByPlugin ----

  it('getByPlugin 按插件名过滤', () => {
    const registry = new ConfigContributionRegistry();
    registry.register(makeContribution({ pluginName: 'pluginA', sectionId: 'a1', title: 'A1' }));
    registry.register(makeContribution({ pluginName: 'pluginA', sectionId: 'a2', title: 'A2' }));
    registry.register(makeContribution({ pluginName: 'pluginB', sectionId: 'b1', title: 'B1' }));

    expect(registry.getByPlugin('pluginA')).toHaveLength(2);
    expect(registry.getByPlugin('pluginB')).toHaveLength(1);
    expect(registry.getByPlugin('pluginC')).toHaveLength(0);
  });

  // ---- 事件 ----

  it('onDidChange 在注册和注销时都触发', () => {
    const registry = new ConfigContributionRegistry();
    const listener = vi.fn();
    registry.onDidChange(listener);

    const d = registry.register(makeContribution({ sectionId: 'ev', title: 'Event' }));
    expect(listener).toHaveBeenCalledTimes(1);

    d.dispose();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('onDidChange 的 Disposable 可取消监听', () => {
    const registry = new ConfigContributionRegistry();
    const listener = vi.fn();
    const sub = registry.onDidChange(listener);

    sub.dispose();
    registry.register(makeContribution({ sectionId: 'after', title: 'After' }));

    expect(listener).not.toHaveBeenCalled();
  });

  // ---- 多个贡献的综合场景 ----

  it('多个插件注册多个配置分区，getAll 返回全部', () => {
    const registry = new ConfigContributionRegistry();
    registry.register(makeContribution({ sectionId: 'llm', title: 'LLM 配置', pluginName: 'core' }));
    registry.register(makeContribution({ sectionId: 'memory', title: '记忆配置', pluginName: 'memory' }));
    registry.register(makeContribution({ sectionId: 'cron', title: '定时任务', pluginName: 'cron' }));

    const all = registry.getAll();
    expect(all).toHaveLength(3);
    expect(all.map(c => c.sectionId).sort()).toEqual(['cron', 'llm', 'memory']);
  });

  // ---- 字段 schema 完整性 ----

  it('字段 schema 包含完整的类型、默认值、选项和验证规则', () => {
    const registry = new ConfigContributionRegistry();
    registry.register({
      sectionId: 'rich',
      title: 'Rich Config',
      fields: [
        { key: 'name', type: 'string', label: '名称', required: true },
        { key: 'count', type: 'number', label: '数量', default: 10, validation: { min: 1, max: 100 } },
        { key: 'engine', type: 'select', label: '引擎', options: [{ label: 'A', value: 'a' }, { label: 'B', value: 'b' }] },
        { key: 'tags', type: 'multiselect', label: '标签', group: '高级' },
      ],
      onLoad: () => ({ name: 'test', count: 10 }),
      onSave: () => {},
    });

    const contrib = registry.get('rich')!;
    expect(contrib.fields).toHaveLength(4);
    expect(contrib.fields[0].required).toBe(true);
    expect(contrib.fields[1].validation?.max).toBe(100);
    expect(contrib.fields[2].options).toHaveLength(2);
    expect(contrib.fields[3].group).toBe('高级');
  });
});
