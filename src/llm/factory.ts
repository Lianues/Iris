/**
 * LLM 工厂函数
 *
 * 根据配置创建对应的 LLMProvider 实例或 LLMRouter。
 * 供启动和热重载时复用。
 */

import type { LLMProviderLike } from './providers/base';
import { LLMRouter } from './router';
import { LLMConfig, LLMRegistryConfig } from '../config/types';
import type { LLMProviderFactoryRegistry } from '../bootstrap/extensions';

/**
 * 根据 LLMConfig 创建 Provider 实例。
 * 逻辑已修改：仅从注册表中查找工厂函数，删除了冗余的 switch-case 路径，实现单一信息源。
 */
export function createLLMFromConfig(config: LLMConfig, registry?: Pick<LLMProviderFactoryRegistry, 'get'>): LLMProviderLike {
  const factory = registry?.get(config.provider);
  if (!factory) {
    throw new Error(`未注册的 LLM provider: ${config.provider}`);
  }
  return factory(config);
}

/** 根据模型池配置创建路由器 */
export function createLLMRouter(config: LLMRegistryConfig, currentModelName?: string, registry?: Pick<LLMProviderFactoryRegistry, 'get'>): LLMRouter {
  const router = new LLMRouter({
    defaultModelName: config.defaultModelName,
    models: config.models.map(model => ({
      modelName: model.modelName,
      provider: createLLMFromConfig(model, registry),
      config: model,
    })),
  });

  if (currentModelName && router.hasModel(currentModelName)) {
    router.setCurrentModel(currentModelName);
  }

  return router;
}
