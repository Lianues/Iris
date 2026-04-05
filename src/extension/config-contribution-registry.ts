/**
 * 配置贡献注册中心实现
 *
 * 全局单例，所有插件共享同一个实例。
 * 在 PluginManager 构造时创建，通过 PluginContext 注入到每个插件。
 */

import { EventEmitter } from 'events';
import type { ConfigContributionRegistryLike, ConfigContribution, Disposable } from '@irises/extension-sdk';
import { createLogger } from '../logger';

const logger = createLogger('ConfigContributions');

export class ConfigContributionRegistry extends EventEmitter implements ConfigContributionRegistryLike {
  private contributions = new Map<string, ConfigContribution>();

  register(contribution: ConfigContribution): Disposable {
    const { sectionId } = contribution;
    if (this.contributions.has(sectionId)) {
      throw new Error(`配置分区 "${sectionId}" 已注册，不可重复注册`);
    }
    this.contributions.set(sectionId, contribution);
    logger.info(`配置贡献已注册: ${sectionId} (${contribution.title})`);
    this.emit('didChange');
    return {
      dispose: () => {
        if (this.contributions.delete(sectionId)) {
          logger.info(`配置贡献已注销: ${sectionId}`);
          this.emit('didChange');
        }
      },
    };
  }

  getAll(): ConfigContribution[] {
    return Array.from(this.contributions.values());
  }

  get(sectionId: string): ConfigContribution | undefined {
    return this.contributions.get(sectionId);
  }

  getByPlugin(pluginName: string): ConfigContribution[] {
    return this.getAll().filter(c => c.pluginName === pluginName);
  }

  onDidChange(listener: () => void): Disposable {
    this.on('didChange', listener);
    return { dispose: () => this.off('didChange', listener) };
  }
}
