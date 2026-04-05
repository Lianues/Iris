import { describe, expect, it, vi } from 'vitest';
import { ServiceRegistry } from '../src/extension/service-registry.js';

describe('ServiceRegistry', () => {
  // ---- register / get / has ----

  it('注册服务后可通过 get 获取', () => {
    const registry = new ServiceRegistry();
    const impl = { greet: () => 'hello' };
    registry.register('test.greeter', impl);

    expect(registry.has('test.greeter')).toBe(true);
    expect(registry.get('test.greeter')).toBe(impl);
  });

  it('未注册的服务 get 返回 undefined，has 返回 false', () => {
    const registry = new ServiceRegistry();

    expect(registry.has('nonexistent')).toBe(false);
    expect(registry.get('nonexistent')).toBeUndefined();
  });

  it('getRequired 在服务不存在时抛出错误', () => {
    const registry = new ServiceRegistry();

    expect(() => registry.getRequired('missing')).toThrow('未注册');
  });

  it('getRequired 在服务存在时返回实例', () => {
    const registry = new ServiceRegistry();
    const impl = { value: 42 };
    registry.register('my.service', impl);

    expect(registry.getRequired('my.service')).toBe(impl);
  });

  // ---- 重复注册 ----

  it('重复注册相同 ID 抛出错误', () => {
    const registry = new ServiceRegistry();
    registry.register('dup', { a: 1 });

    expect(() => registry.register('dup', { a: 2 })).toThrow('已注册');
  });

  // ---- dispose / 注销 ----

  it('dispose 后服务不再可用，可重新注册', () => {
    const registry = new ServiceRegistry();
    const disposable = registry.register('temp', { x: 1 });

    expect(registry.has('temp')).toBe(true);

    disposable.dispose();
    expect(registry.has('temp')).toBe(false);
    expect(registry.get('temp')).toBeUndefined();

    // 注销后可重新注册
    registry.register('temp', { x: 2 });
    expect(registry.get<{ x: number }>('temp')?.x).toBe(2);
  });

  it('dispose 多次调用不会报错', () => {
    const registry = new ServiceRegistry();
    const disposable = registry.register('once', {});
    disposable.dispose();
    disposable.dispose(); // 第二次不抛错
    expect(registry.has('once')).toBe(false);
  });

  // ---- list ----

  it('list 返回所有已注册服务的描述信息', () => {
    const registry = new ServiceRegistry();
    registry.register('a', {}, { description: 'Service A', version: '1.0' });
    registry.register('b', {}, { description: 'Service B' });

    const list = registry.list();
    expect(list).toHaveLength(2);
    expect(list.find(d => d.id === 'a')?.version).toBe('1.0');
    expect(list.find(d => d.id === 'b')?.description).toBe('Service B');
  });

  it('list 返回副本，修改不影响内部状态', () => {
    const registry = new ServiceRegistry();
    registry.register('x', {}, { description: 'original' });

    const list = registry.list();
    list[0].description = 'tampered';

    expect(registry.list()[0].description).toBe('original');
  });

  // ---- 事件 ----

  it('onDidRegister 在注册时触发', () => {
    const registry = new ServiceRegistry();
    const listener = vi.fn();
    registry.onDidRegister(listener);

    registry.register('ev.test', { foo: 1 }, { version: '2.0' });

    expect(listener).toHaveBeenCalledOnce();
    expect(listener.mock.calls[0][0]).toEqual({ id: 'ev.test', version: '2.0' });
  });

  it('onDidUnregister 在注销时触发', () => {
    const registry = new ServiceRegistry();
    const listener = vi.fn();
    registry.onDidUnregister(listener);

    const d = registry.register('ev.unreg', {});
    expect(listener).not.toHaveBeenCalled();

    d.dispose();
    expect(listener).toHaveBeenCalledWith('ev.unreg');
  });

  it('事件监听的 Disposable 可取消监听', () => {
    const registry = new ServiceRegistry();
    const listener = vi.fn();
    const sub = registry.onDidRegister(listener);

    sub.dispose();
    registry.register('after.unsub', {});

    expect(listener).not.toHaveBeenCalled();
  });

  // ---- waitFor ----

  it('waitFor 在服务已存在时立即解析', async () => {
    const registry = new ServiceRegistry();
    const impl = { ready: true };
    registry.register('existing', impl);

    const result = await registry.waitFor('existing');
    expect(result).toBe(impl);
  });

  it('waitFor 等待服务注册后解析', async () => {
    const registry = new ServiceRegistry();
    const impl = { delayed: true };

    const promise = registry.waitFor('lazy.service', 5000);

    // 延迟注册
    setTimeout(() => registry.register('lazy.service', impl), 10);

    const result = await promise;
    expect(result).toBe(impl);
  });

  it('waitFor 超时时抛出错误', async () => {
    const registry = new ServiceRegistry();

    await expect(registry.waitFor('never', 50)).rejects.toThrow('超时');
  });
});
