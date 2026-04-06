/**
 * IrisHost — 多 Agent 管理器
 *
 * MCP 共享：多 Agent 模式下，MCP 配置相同的 Agent 共享同一个 MCPManager 实例。
 * 进程内唯一实例，统一管理所有 IrisCore（Agent）的生命周期。
 *
 * 多 Agent 配置分层重构：
 *   - 不再有单 Agent 特殊路径和 __global__ 匿名实体。
 *   - 系统永远以 agent 为单位运行，至少有一个 master agent。
 *   - 全局配置（llm/ocr/storage）由 IrisHost 加载一次，通过
 *     loadAgentConfig 与各 agent 的覆盖配置合并后传入 IrisCore。
 *   - ensureDefaultAgent() 确保 agents.yaml 存在且至少包含 master。
 *   - 移除 isMultiAgentEnabled / enabled 开关。
 *
 * agentNetwork 通过 IrisCoreOptions.agentNetwork 在 spawnAgent 时注入，
 * 不再事后通过 monkey-patch 修改 irisAPI。
 *
 * 热重载通过 BackendHandle.swap() 实现，Platform 层零感知。
 */

import { IrisCore } from './iris-core';
import type { IrisCoreOptions, AgentNetworkProvider } from './iris-core';
import { CrossAgentTaskBoard } from './cross-agent-task-board';
import { createMCPManager, MCPManager } from '../mcp';
import { IPCServer } from '../ipc/server';
import { loadAgentDefinitions, resolveAgentPaths, ensureDefaultAgent } from '../agents';
import { loadGlobalConfig, loadAgentConfig } from '../config';
import type { GlobalConfigResult } from '../config';
import { parseMCPConfig } from '../config/mcp';
import type { MCPConfig } from '../config/types';
import type { AgentDefinition } from '../agents';

export class IrisHost {
  /** 所有活跃的 Core 实例 */
  readonly cores = new Map<string, IrisCore>();

  /** 每个 Core 对应的 IPC 服务器 */
  readonly ipcServers = new Map<string, IPCServer>();

  /** 每个 Core 对应的 Net 服务器（WS→TCP 桥接） */
  readonly netServers = new Map<string, any>();

  /** 每个 Core 对应的 Relay 节点客户端 */
  readonly relayNodes = new Map<string, any>();

  /** 共享任务板（所有 Core 共用） */
  readonly taskBoard = new CrossAgentTaskBoard();

  /** Agent 定义列表（start 时加载） */
  private agentDefs: AgentDefinition[] = [];

  /** 全局配置结果（多 Agent 配置分层重构：加载一次，所有 agent 共享） */
  private globalConfigResult!: GlobalConfigResult;

  /**
   * MCP 共享：全局 MCP 配置创建的共享 MCPManager 实例。
   * 当多个 Agent 的 MCP 配置与全局相同时，共用此实例而非各自创建。
   * 生命周期由 IrisHost 统一管理（start 时 connectAll，shutdown 时 disconnectAll）。
   */
  private sharedMCPManager?: MCPManager;

  /** MCP 共享：全局 MCP 配置快照，用于和每个 agent 的配置比较决定是否共享 */
  private globalMCPConfig?: MCPConfig;

  /** 幂等 shutdown */
  private shutdownPromise: Promise<void> | null = null;

  // ============ start() ============

  /**
   * 加载 Agent 定义，为每个 Agent 创建并启动 IrisCore。
   *
   * 多 Agent 配置分层重构：
   *   1. 加载全局配置（一次）
   *   2. 确保 agents.yaml 存在且至少包含 master agent
   *   3. 为每个 agent 分层合并配置并创建 IrisCore
   */
  async start(): Promise<void> {
    // 1. 加载全局配置（多 Agent 配置分层重构：全局配置只加载一次）
    this.globalConfigResult = loadGlobalConfig();

    // MCP 共享：从全局 raw 解析出 MCP 配置，有配置时预创建共享 MCPManager。
    // 后续 spawnAgent 会把每个 agent 的 resolvedConfig.mcp 与此比较，
    // 相同则注入共享实例，不同则让 Core 自建。
    this.globalMCPConfig = parseMCPConfig(this.globalConfigResult.raw.mcp);
    if (this.globalMCPConfig) {
      this.sharedMCPManager = createMCPManager(this.globalMCPConfig);
      // 只连接一次，所有配置相同的 Agent 共用这些连接
      await this.sharedMCPManager.connectAll();
      console.log('[Iris] 已创建共享 MCPManager（全局 MCP 配置）');
    }

    // 2. 确保 agents.yaml + master agent 存在
    ensureDefaultAgent();

    // 3. 加载所有 agent 定义
    this.agentDefs = loadAgentDefinitions();

    // 4. 为每个 agent 创建 Core
    for (const def of this.agentDefs) {
      console.log(`[Iris] 正在初始化 Agent: ${def.name}...`);
      await this.spawnAgent(def);
    }
  }

  // ============ Agent 动态管理 ============

  /**
   * 运行时创建并启动一个新的 IrisCore。
   *
   * 多 Agent 配置分层重构：
   *   - 不再有 __global__ 特殊分支，所有 agent 都有明确名称。
   *   - 通过 loadAgentConfig 分层合并全局配置 + agent 覆盖。
   *   - resolvedConfig 传入 IrisCore，避免 agent 自行加载。
   */
  async spawnAgent(def: { name: string; description?: string; dataDir?: string }): Promise<IrisCore> {
    if (this.cores.has(def.name)) {
      throw new Error(`Agent "${def.name}" 已存在`);
    }

    // 解析 agent 专属路径
    const agentDef = this.agentDefs.find(d => d.name === def.name) ?? def as AgentDefinition;
    const agentPaths = resolveAgentPaths(agentDef);

    // 多 Agent 配置分层重构：分层合并全局配置 + agent 覆盖 → 最终 AppConfig
    const resolvedConfig = loadAgentConfig(this.globalConfigResult, agentPaths);

    const options: IrisCoreOptions = {
      agentName: def.name,
      agentPaths,
      resolvedConfig,
      taskBoard: this.taskBoard,
    };

    // MCP 共享：比较该 agent 的 MCP 配置与全局配置是否一致。
    // 一致时注入 sharedMCPManager，Core 将复用而非自建。
    // 不一致时（agent 有自定义覆盖）不传，Core 走原有的 createMCPManager 路径。
    if (this.sharedMCPManager && mcpConfigEqual(this.globalMCPConfig, resolvedConfig.mcp)) {
      options.sharedMCPManager = this.sharedMCPManager;
    }

    // 多 Agent 模式下注入 agentNetwork（通过构造参数，不再事后 patch）
    if (this.agentDefs.length > 1 || this.cores.size > 0) {
      options.agentNetwork = this.buildAgentNetwork(def.name);
    }

    const core = new IrisCore(options);
    await core.start();
    this.cores.set(def.name, core);

    // 为该 Core 启动 IPC 服务器
    await this.startIPCServer(def.name, core);

    return core;
  }

  /**
   * 为指定 Core 启动 IPC 服务器。
   */
  private async startIPCServer(agentName: string, core: IrisCore): Promise<void> {
    try {
      const { dataDir } = await import('../paths');
      const server = new IPCServer({
        backend: core.backend,
        api: core.irisAPI,
        agentName,
        dataDir,
      });
      const port = await server.start();
      this.ipcServers.set(agentName, server);
      console.log(`[Iris] IPC 服务已启动: 127.0.0.1:${port} (agent=${agentName})`);

      // Net 多端互联：启动 WS 桥接服务器
      const netConfig = core.config?.net;
      if (netConfig?.enabled && netConfig?.token) {
        try {
          const { NetServer } = await import('../net/server');
          const netServer = new NetServer({ ipcPort: port, config: netConfig, agentName });
          await netServer.start();
          this.netServers.set(agentName, netServer);
          console.log(`[Iris] Net 服务已启动: ${netConfig.host ?? '0.0.0.0'}:${netConfig.port ?? 9100} (agent=${agentName})`);
        } catch (err) {
          console.warn(`[Iris] Net 服务启动失败 (agent=${agentName}):`, (err as Error).message);
        }
      }

      // Net 多端互联：注册到中继服务器
      const relayConfig = netConfig?.relay;
      if (relayConfig?.url && relayConfig?.nodeId && relayConfig?.token) {
        try {
          const { RelayNodeClient } = await import('../net/relay-node');
          const relayNode = new RelayNodeClient({ ipcPort: port, relay: relayConfig });
          relayNode.start();
          this.relayNodes.set(agentName, relayNode);
          console.log(`[Iris] Relay 节点已注册: nodeId=${relayConfig.nodeId} → ${relayConfig.url} (agent=${agentName})`);
        } catch (err) {
          console.warn(`[Iris] Relay 节点启动失败 (agent=${agentName}):`, (err as Error).message);
        }
      }
    } catch (err) {
      console.warn(`[Iris] IPC 服务启动失败 (agent=${agentName}):`, (err as Error).message);
    }
  }

  /**
   * 热重载一个 Agent：创建新 Core → BackendHandle.swap → 关闭旧 Core 内部资源。
   * Platform 层持有的 BackendHandle 不变，零感知。
   */
  async reloadAgent(name: string): Promise<IrisCore> {
    const oldCore = this.cores.get(name);
    if (!oldCore) {
      throw new Error(`Agent "${name}" 不存在，无法 reload`);
    }

    const handle = oldCore.backendHandle;

    // 先关闭旧的 Net 服务和 Relay 节点（释放端口）
    const oldNetServer = this.netServers.get(name);
    if (oldNetServer) {
      await oldNetServer.stop().catch((err: Error) =>
        console.warn(`[Iris] 关闭旧 Net Server 失败 (agent=${name}):`, err.message)
      );
      this.netServers.delete(name);
    }
    const oldRelayNode = this.relayNodes.get(name);
    if (oldRelayNode) {
      oldRelayNode.stop();
      this.relayNodes.delete(name);
    }

    // 关闭旧的 IPC Server（释放端口和 lock 文件）
    const oldIpcServer = this.ipcServers.get(name);
    if (oldIpcServer) {
      await oldIpcServer.stop().catch((err: Error) =>
        console.warn(`[Iris] 关闭旧 IPC Server 失败 (agent=${name}):`, err.message)
      );
      this.ipcServers.delete(name);
    }

    // 从 cores Map 中移除旧 Core（防止新 Core spawn 时重名报错）
    this.cores.delete(name);
    this.taskBoard.unregisterBackend(name);

    // 创建新 Core
    const def = this.agentDefs.find(d => d.name === name) ?? { name };
    const newCore = await this.spawnAgent(def);

    // 用新 Backend 替换 Handle 的底层实现（事件监听自动迁移）
    handle.swap(newCore.backend);

    // 关闭旧 Core 的内部资源（MCP、SkillWatcher 等）
    await oldCore.shutdown();

    return newCore;
  }

  /**
   * 运行时销毁一个 Agent。
   */
  async destroyAgent(name: string): Promise<void> {
    const core = this.cores.get(name);
    if (!core) return;

    // 关闭 Net 服务和 Relay 节点
    const netServer = this.netServers.get(name);
    if (netServer) {
      await netServer.stop().catch((err: Error) =>
        console.warn(`[Iris] 关闭 Net Server 失败 (agent=${name}):`, err.message)
      );
      this.netServers.delete(name);
    }
    const relayNode = this.relayNodes.get(name);
    if (relayNode) {
      relayNode.stop();
      this.relayNodes.delete(name);
    }

    // 关闭对应的 IPC Server
    const ipcServer = this.ipcServers.get(name);
    if (ipcServer) {
      await ipcServer.stop().catch((err: Error) =>
        console.warn(`[Iris] 关闭 IPC Server 失败 (agent=${name}):`, err.message)
      );
      this.ipcServers.delete(name);
    }

    await core.shutdown();
    this.cores.delete(name);
    this.taskBoard.unregisterBackend(name);
  }

  /**
   * 获取指定 Agent 的 Core 实例。
   */
  getCore(name: string): IrisCore | undefined {
    return this.cores.get(name);
  }

  /**
   * 获取默认 Core（第一个）。
   */
  getDefaultCore(): IrisCore {
    const first = this.cores.values().next();
    if (first.done) throw new Error('No cores available');
    return first.value;
  }

  /**
   * 列出所有 Core 名称。
   */
  listCoreNames(): string[] {
    return [...this.cores.keys()];
  }

  /**
   * 获取 Agent 定义列表。
   */
  getAgentDefs(): AgentDefinition[] {
    return this.agentDefs;
  }

  /**
   * 是否多 Agent 模式。
   */
  isMultiAgent(): boolean {
    return this.cores.size > 1;
  }

  // ============ shutdown() — 幂等 ============

  /**
   * 关闭所有 Core。幂等：多次调用返回同一个 Promise。
   */
  shutdown(): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise;
    this.shutdownPromise = this.doShutdown();
    return this.shutdownPromise;
  }

  private async doShutdown(): Promise<void> {
    // 先关闭 Net 服务器和 Relay 节点
    const netShutdownTasks = [...this.netServers.values()].map(s => s.stop().catch(() => {}));
    await Promise.allSettled(netShutdownTasks);
    this.netServers.clear();
    for (const node of this.relayNodes.values()) {
      try { node.stop(); } catch {}
    }
    this.relayNodes.clear();

    // 关闭 IPC 服务器
    const ipcShutdownTasks = [...this.ipcServers.values()].map(s => s.stop());
    await Promise.allSettled(ipcShutdownTasks);
    this.ipcServers.clear();

    // 再关闭所有 Core
    const shutdownTasks = [...this.cores.values()].map(core =>
      core.shutdown()
    );
    await Promise.allSettled(shutdownTasks);

    // MCP 共享：断开共享 MCPManager 的所有连接。
    // 各 Core 的 shutdown 不会 disconnect 共享实例（_mcpOwned === false），
    // 所以必须在 Host 层统一清理。
    if (this.sharedMCPManager) {
      await this.sharedMCPManager.disconnectAll().catch(() => { /* 忽略 */ });
      this.sharedMCPManager = undefined;
    }
  }

  // ============ 内部方法 ============

  /**
   * 为指定 Agent 构建 agentNetwork 提供者。
   * 使用闭包引用 this.cores，listPeers() 每次调用时动态计算。
   *
   * 多 Agent 配置分层重构：移除 __global__ 特判。
   */
  private buildAgentNetwork(selfName: string): AgentNetworkProvider {
    return {
      selfName,
      listPeers: () => [...this.cores.keys()].filter(k => k !== selfName),
      getPeerDescription: (name: string) => {
        // 多 Agent 配置分层重构：移除 __global__ 特判，所有 agent 都有明确名称
        return this.agentDefs.find(d => d.name === name)?.description;
      },
      getPeerBackend: (name: string) => this.cores.get(name)?.backend,
      getPeerBackendHandle: (name: string) => this.cores.get(name)?.backendHandle,
      // 分层配置修复：console 切换 Agent 后需要获取目标 Agent 的 IrisAPI
      // （含 configManager），以便重建 settingsController。
      getPeerAPI: (name: string) => this.cores.get(name)?.irisAPI as Record<string, unknown> | undefined,
    };
  }
}

// ============ 工具函数 ============

/**
 * 深度比较两个 MCPConfig 是否相同。
 *
 * MCP 共享：IrisHost 用此函数判断 agent 的 MCP 配置是否与全局一致。
 * 相同时注入 sharedMCPManager，不同时让 Core 自建。
 *
 * 两个 undefined 视为相同（都没有 MCP 配置）。
 * 使用 JSON.stringify 做值比较，对于纯 JSON 结构的配置对象足够可靠。
 */
export function mcpConfigEqual(
  a: MCPConfig | undefined,
  b: MCPConfig | undefined,
): boolean {
  if (a === undefined && b === undefined) return true;
  if (a === undefined || b === undefined) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}
