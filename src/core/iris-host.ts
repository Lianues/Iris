/**
 * IrisHost — 多 Agent 管理器
 *
 * 进程内唯一实例，统一管理所有 IrisCore（Agent）的生命周期。
 * 消除了原 runSingleAgent / runMultiAgent 的分叉：
 *   - 没有配置 agents.yaml → 自动创建一个默认 Core（N=1）
 *   - 配置了 agents.yaml  → 每个 Agent 一个 Core（N≥1）
 *
 * agentNetwork 通过 IrisCoreOptions.agentNetwork 在 spawnAgent 时注入，
 * 不再事后通过 monkey-patch 修改 irisAPI。
 *
 * 热重载通过 BackendHandle.swap() 实现，Platform 层零感知。
 */

import { IrisCore } from './iris-core';
import type { IrisCoreOptions, AgentNetworkProvider } from './iris-core';
import { CrossAgentTaskBoard } from './cross-agent-task-board';
import { IPCServer } from '../ipc/server';
import { isMultiAgentEnabled, loadAgentDefinitions, resolveAgentPaths } from '../agents';
import type { AgentDefinition } from '../agents';

export class IrisHost {
  /** 所有活跃的 Core 实例 */
  readonly cores = new Map<string, IrisCore>();

  /** 每个 Core 对应的 IPC 服务器 */
  readonly ipcServers = new Map<string, IPCServer>();

  /** 共享任务板（所有 Core 共用） */
  readonly taskBoard = new CrossAgentTaskBoard();

  /** Agent 定义列表（start 时加载） */
  private agentDefs: AgentDefinition[] = [];

  /** 幂等 shutdown */
  private shutdownPromise: Promise<void> | null = null;

  // ============ start() ============

  /**
   * 加载 Agent 定义，为每个 Agent 创建并启动 IrisCore。
   * 没有定义时自动创建一个默认 Core。
   */
  async start(): Promise<void> {
    this.agentDefs = isMultiAgentEnabled() ? loadAgentDefinitions() : [];

    if (this.agentDefs.length === 0) {
      // N=0 → 一个默认 Core
      await this.spawnAgent({ name: '__global__' });
    } else {
      // N≥1 → 每个 Agent 一个 Core
      for (const def of this.agentDefs) {
        console.log(`[Iris] 正在初始化 Agent: ${def.name}...`);
        await this.spawnAgent(def);
      }
    }
  }

  // ============ Agent 动态管理 ============

  /**
   * 运行时创建并启动一个新的 IrisCore。
   * 多 Agent 模式下自动注入 agentNetwork。
   */
  async spawnAgent(def: { name: string; description?: string; dataDir?: string }): Promise<IrisCore> {
    if (this.cores.has(def.name)) {
      throw new Error(`Agent "${def.name}" 已存在`);
    }

    const options: IrisCoreOptions = {
      agentName: def.name === '__global__' ? undefined : def.name,
      taskBoard: this.taskBoard,
    };

    // 如果是已定义的 Agent，解析其专属路径
    if (def.name !== '__global__') {
      const agentDef = this.agentDefs.find(d => d.name === def.name) ?? def as AgentDefinition;
      options.agentPaths = resolveAgentPaths(agentDef);
      options.agentName = def.name;
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

    // 先关闭旧的 IPC Server（释放端口和 lock 文件）
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
   * 获取默认 Core（第一个）。单 Agent 模式下就是唯一的那个。
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
    // 先关闭 IPC 服务器
    const ipcShutdownTasks = [...this.ipcServers.values()].map(s => s.stop());
    await Promise.allSettled(ipcShutdownTasks);
    this.ipcServers.clear();

    // 再关闭所有 Core
    const shutdownTasks = [...this.cores.values()].map(core =>
      core.shutdown()
    );
    await Promise.allSettled(shutdownTasks);
  }

  // ============ 内部方法 ============

  /**
   * 为指定 Agent 构建 agentNetwork 提供者。
   * 使用闭包引用 this.cores，listPeers() 每次调用时动态计算。
   */
  private buildAgentNetwork(selfName: string): AgentNetworkProvider {
    return {
      selfName,
      listPeers: () => [...this.cores.keys()].filter(k => k !== selfName),
      getPeerDescription: (name: string) => {
        if (name === '__global__') return '全局 AI';
        return this.agentDefs.find(d => d.name === name)?.description;
      },
      getPeerBackend: (name: string) => this.cores.get(name)?.backend,
      getPeerBackendHandle: (name: string) => this.cores.get(name)?.backendHandle,
    };
  }
}
