/**
 * IrisAPI 远程代理
 *
 * 为 `iris attach` 模式提供 Console 平台需要的 IrisAPI 子集，
 * 将方法调用通过 IPC 转发到服务端。
 *
 * Console 实际使用的 API 子属性：
 *   1. api.setLogLevel()
 *   2. api.getConsoleSettingsTabs()
 *   3. api.agentNetwork
 *   4. api.listAgents()
 *   5. api.configManager (readEditableConfig, updateEditableConfig)
 *   6. api.router (removeCurrentModelRequestBodyKeys, patchCurrentModelRequestBody)
 *
 * 同步/异步阻抗匹配策略：
 *   同步方法通过 initCaches() 预加载，后续调用返回缓存值。
 *   fire-and-forget 操作均带日志记录，不静默吞错。
 */

import type { IPCClient } from './client';
import { Methods } from './protocol';
import { createLogger } from '../logger';

const logger = createLogger('RemoteApiProxy');

/**
 * 创建远程 IrisAPI 代理对象。
 *
 * 返回一个符合 Console 平台消费模式的对象，并提供 initCaches()
 * 方法用于预加载同步方法需要的数据。
 */
export function createRemoteApiProxy(client: IPCClient, agentName: string = '__remote__'): Record<string, any> {
  // 缓存存储
  let _cachedSettingsTabs: unknown[] = [];
  let _cachedAgents: unknown[] = [];
  let _cachedPeers: string[] = [];

  const proxy: Record<string, any> = {
    setLogLevel(level: unknown): void {
      client.call(Methods.API_SET_LOG_LEVEL, [level])
        .catch((err) => logger.warn(`setLogLevel 失败: ${err.message}`));
    },

    getConsoleSettingsTabs(): unknown[] {
      return _cachedSettingsTabs;
    },

    listAgents(): unknown[] {
      return _cachedAgents;
    },

    agentNetwork: {
      selfName: agentName,

      listPeers(): string[] {
        return _cachedPeers;
      },

      getPeerDescription(name: string): string | undefined {
        // 这是罕见调用，同步接口无法跨进程，返回 undefined
        return undefined;
      },

      getPeerBackendHandle(_name: string): unknown {
        // 跨进程不支持获取 peer 的 BackendHandle
        return undefined;
      },
    },

    configManager: {
      async readEditableConfig(): Promise<unknown> {
        return client.call(Methods.API_CONFIG_MANAGER_READ);
      },

      async updateEditableConfig(...args: unknown[]): Promise<unknown> {
        return client.call(Methods.API_CONFIG_MANAGER_UPDATE, args);
      },
    },

    router: {
      removeCurrentModelRequestBodyKeys(...args: unknown[]): void {
        client.call(Methods.API_ROUTER_REMOVE_REQUEST_BODY_KEYS, args)
          .catch((err) => logger.warn(`removeCurrentModelRequestBodyKeys 失败: ${err.message}`));
      },

      patchCurrentModelRequestBody(...args: unknown[]): void {
        client.call(Methods.API_ROUTER_PATCH_REQUEST_BODY, args)
          .catch((err) => logger.warn(`patchCurrentModelRequestBody 失败: ${err.message}`));
      },
    },

    /**
     * 预加载同步方法需要的缓存数据。
     * 在创建后调用一次，保证 getConsoleSettingsTabs/listAgents/listPeers
     * 首次调用时就能返回有效数据。
     */
    async initCaches(): Promise<void> {
      const [tabs, agents, peers] = await Promise.all([
        client.call(Methods.API_GET_CONSOLE_SETTINGS_TABS).catch(() => []),
        client.call(Methods.API_LIST_AGENTS).catch(() => []),
        client.call(Methods.API_AGENT_NETWORK_LIST_PEERS).catch(() => []),
      ]);
      _cachedSettingsTabs = tabs as unknown[] ?? [];
      _cachedAgents = agents as unknown[] ?? [];
      _cachedPeers = peers as string[] ?? [];
    },
  };

  return proxy;
}
