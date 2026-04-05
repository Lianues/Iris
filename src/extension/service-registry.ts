/**
 * 服务注册中心实现
 *
 * 全局单例，所有插件共享同一个实例。
 * 在 PluginManager 构造时创建，通过 PluginContext 注入到每个插件。
 */

import { EventEmitter } from 'events';
import type { ServiceRegistryLike, ServiceDescriptor, Disposable } from '@irises/extension-sdk';
import { createLogger } from '../logger';

const logger = createLogger('ServiceRegistry');

export class ServiceRegistry extends EventEmitter implements ServiceRegistryLike {
  private services = new Map<string, { descriptor: ServiceDescriptor; implementation: unknown }>();

  register<T>(id: string, implementation: T, meta?: Omit<ServiceDescriptor, 'id' | 'pluginName'>): Disposable {
    if (this.services.has(id)) {
      throw new Error(`服务 "${id}" 已注册，不可重复注册`);
    }
    const descriptor: ServiceDescriptor = { id, ...meta };
    this.services.set(id, { descriptor, implementation });
    logger.info(`服务已注册: ${id}${meta?.version ? ` (v${meta.version})` : ''}`);
    this.emit('didRegister', descriptor);
    return {
      dispose: () => {
        if (this.services.delete(id)) {
          logger.info(`服务已注销: ${id}`);
          this.emit('didUnregister', id);
        }
      },
    };
  }

  get<T>(id: string): T | undefined {
    return this.services.get(id)?.implementation as T | undefined;
  }

  getRequired<T>(id: string): T {
    const impl = this.get<T>(id);
    if (impl === undefined) {
      throw new Error(`必需的服务 "${id}" 未注册`);
    }
    return impl;
  }

  has(id: string): boolean {
    return this.services.has(id);
  }

  list(): ServiceDescriptor[] {
    return Array.from(this.services.values()).map(entry => ({ ...entry.descriptor }));
  }

  async waitFor<T>(id: string, timeoutMs = 10000): Promise<T> {
    const existing = this.get<T>(id);
    if (existing !== undefined) return existing;

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.off('didRegister', onRegister);
        reject(new Error(`等待服务 "${id}" 超时 (${timeoutMs}ms)`));
      }, timeoutMs);

      const onRegister = (descriptor: ServiceDescriptor) => {
        if (descriptor.id === id) {
          clearTimeout(timer);
          this.off('didRegister', onRegister);
          resolve(this.getRequired<T>(id));
        }
      };

      this.on('didRegister', onRegister);
    });
  }

  onDidRegister(listener: (descriptor: ServiceDescriptor) => void): Disposable {
    this.on('didRegister', listener);
    return { dispose: () => this.off('didRegister', listener) };
  }

  onDidUnregister(listener: (id: string) => void): Disposable {
    this.on('didUnregister', listener);
    return { dispose: () => this.off('didUnregister', listener) };
  }
}
