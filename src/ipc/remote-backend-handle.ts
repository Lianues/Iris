/**
 * 远程 BackendHandle
 *
 * 实现 IrisBackendLike 接口，将所有方法调用序列化为 IPC 请求，
 * 将服务端推送的事件分发给本地 listener。
 *
 * 平台层（Console/Telegram/Discord）使用此对象与服务端 Backend 交互，
 * 使用方式与进程内的 BackendHandle 完全相同。
 *
 * 同步/异步阻抗匹配策略：
 *   IrisBackendLike 接口中有部分方法是同步的（如 listModels、switchModel），
 *   但 IPC 天然是异步的。对于这类方法：
 *     - 返回 initCaches() 预加载的缓存值（保证首次调用就有数据）
 *     - 通过 refreshCaches() 后台异步刷新，下次调用时拿到新值
 *     - 不使用 fire-and-forget 修改局部变量（这是无效的）
 */

import { EventEmitter } from 'node:events';
import type { IPCClient } from './client';
import { RemoteToolHandle } from './remote-tool-handle';
import { createLogger } from '../logger';
import {
  Methods, Events, IPC_TO_BACKEND_EVENT,
  type SerializedToolHandle,
} from './protocol';

const logger = createLogger('RemoteBackend');

export class RemoteBackendHandle extends EventEmitter {
  /** 活跃的远程 ToolHandle 缓存 */
  private toolHandles = new Map<string, RemoteToolHandle>();

  constructor(private client: IPCClient) {
    super();
    this.setupNotificationForwarding();
  }

  // ============ IrisBackendLike 必选方法 ============

  async chat(
    sessionId: string,
    text: string,
    images?: unknown[],
    documents?: unknown[],
    platform?: string,
  ): Promise<unknown> {
    // chat 可能涉及多轮工具循环，执行时间不可预估，禁用超时
    return this.client.call(Methods.CHAT, [sessionId, text, images, documents, platform], { timeout: 0 });
  }

  isStreamEnabled(): boolean {
    return this._streamEnabled;
  }

  async clearSession(sessionId: string): Promise<void> {
    await this.client.call(Methods.CLEAR_SESSION, [sessionId]);
  }

  switchModel(modelName: string, platform?: string): { modelName: string; modelId: string } {
    // 同步返回预期结构，异步发送到服务端并刷新缓存
    this.client.call(Methods.SWITCH_MODEL, [modelName, platform])
      .then((r) => {
        if (r && typeof r === 'object') {
          const res = r as { modelName?: string; modelId?: string };
          this._cachedCurrentModelInfo = r;
          // 同时刷新模型列表
          this.refreshCaches();
        }
      })
      .catch((err) => logger.warn(`switchModel 失败: ${err.message}`));
    return { modelName, modelId: modelName };
  }

  listModels(): unknown[] {
    return this._cachedModels;
  }

  async listSessionMetas(): Promise<unknown[]> {
    return (await this.client.call(Methods.LIST_SESSION_METAS)) as unknown[] ?? [];
  }

  abortChat(sessionId: string): void {
    this.client.call(Methods.ABORT_CHAT, [sessionId])
      .catch((err) => logger.warn(`abortChat 失败: ${err.message}`));
  }

  getToolHandle(toolId: string): RemoteToolHandle | undefined {
    return this.toolHandles.get(toolId);
  }

  getToolHandles(sessionId: string): RemoteToolHandle[] {
    return Array.from(this.toolHandles.values()).filter(
      (h) => h.sessionId === sessionId
    );
  }

  // ============ IrisBackendLike 可选方法 ============

  async undo(sessionId: string, scope?: string): Promise<{ assistantText?: string } | null> {
    return (await this.client.call(Methods.UNDO, [sessionId, scope])) as any ?? null;
  }

  async redo(sessionId: string): Promise<{ assistantText?: string } | null> {
    return (await this.client.call(Methods.REDO, [sessionId])) as any ?? null;
  }

  clearRedo(sessionId: string): void {
    this.client.call(Methods.CLEAR_REDO, [sessionId])
      .catch((err) => logger.warn(`clearRedo 失败: ${err.message}`));
  }

  async getHistory(sessionId: string): Promise<unknown[]> {
    return (await this.client.call(Methods.GET_HISTORY, [sessionId])) as unknown[] ?? [];
  }

  listSkills(): unknown[] {
    return this._cachedSkills;
  }

  listModes(): unknown[] {
    return this._cachedModes;
  }

  switchMode(modeName: string): boolean {
    this.client.call(Methods.SWITCH_MODE, [modeName])
      .then(() => this.refreshCaches())
      .catch((err) => logger.warn(`switchMode 失败: ${err.message}`));
    return true;
  }

  async summarize(sessionId: string): Promise<unknown> {
    // summarize 需要遍历全部历史并调用 LLM，可能较慢
    return this.client.call(Methods.SUMMARIZE, [sessionId], { timeout: 0 });
  }

  getToolNames(): string[] {
    return this._cachedToolNames;
  }

  getCurrentModelInfo(): unknown {
    return this._cachedCurrentModelInfo;
  }

  getDisabledTools(): string[] | undefined {
    return this._cachedDisabledTools;
  }

  getActiveSessionId(): string | undefined {
    return undefined;
  }

  async runCommand(cmd: string): Promise<unknown> {
    // 服务端 spawnSync 自带 30s 超时，加上序列化开销可能踩线，给 60s 余量
    return this.client.call(Methods.RUN_COMMAND, [cmd], { timeout: 60_000 });
  }

  resetConfigToDefaults(): unknown {
    this.client.call(Methods.RESET_CONFIG)
      .catch((err) => logger.warn(`resetConfig 失败: ${err.message}`));
    return undefined;
  }

  async getAgentTasks(sessionId: string): Promise<unknown[]> {
    return (await this.client.call(Methods.GET_AGENT_TASKS, [sessionId])) as unknown[] ?? [];
  }

  async getRunningAgentTasks(sessionId: string): Promise<unknown[]> {
    return (await this.client.call(Methods.GET_RUNNING_AGENT_TASKS, [sessionId])) as unknown[] ?? [];
  }

  async getAgentTask(taskId: string): Promise<unknown> {
    return (await this.client.call(Methods.GET_AGENT_TASK, [taskId])) ?? undefined;
  }

  async getToolPolicies(): Promise<Record<string, unknown> | undefined> {
    return (await this.client.call(Methods.GET_TOOL_POLICIES)) as Record<string, unknown> | undefined;
  }

  getCwd(): string {
    return this._cachedCwd;
  }

  setCwd(dirPath: string): void {
    this.client.call(Methods.SET_CWD, [dirPath])
      .then(() => { this._cachedCwd = dirPath; })
      .catch((err) => logger.warn(`setCwd 失败: ${err.message}`));
  }

  // ============ 缓存管理 ============

  /** handshake 时获取的 streamEnabled */
  _streamEnabled = true;

  private _cachedModels: unknown[] = [];
  private _cachedSkills: unknown[] = [];
  private _cachedModes: unknown[] = [];
  private _cachedToolNames: string[] = [];
  private _cachedCurrentModelInfo: unknown = undefined;
  private _cachedDisabledTools: string[] | undefined = undefined;
  private _cachedCwd: string = process.cwd();

  /**
   * 初始化同步缓存。
   *
   * 在连接后必须调用一次，保证所有同步方法（listModels 等）
   * 首次调用时就能返回有效数据。
   */
  async initCaches(): Promise<void> {
    const [models, skills, modes, toolNames, modelInfo, disabledTools, cwd] = await Promise.all([
      this.client.call(Methods.LIST_MODELS).catch(() => []),
      this.client.call(Methods.LIST_SKILLS).catch(() => []),
      this.client.call(Methods.LIST_MODES).catch(() => []),
      this.client.call(Methods.GET_TOOL_NAMES).catch(() => []),
      this.client.call(Methods.GET_CURRENT_MODEL_INFO).catch(() => undefined),
      this.client.call(Methods.GET_DISABLED_TOOLS).catch(() => undefined),
      this.client.call(Methods.GET_CWD).catch(() => process.cwd()),
    ]);
    this._cachedModels = models as unknown[] ?? [];
    this._cachedSkills = skills as unknown[] ?? [];
    this._cachedModes = modes as unknown[] ?? [];
    this._cachedToolNames = toolNames as string[] ?? [];
    this._cachedCurrentModelInfo = modelInfo;
    this._cachedDisabledTools = disabledTools as string[] | undefined;
    this._cachedCwd = (cwd as string) || process.cwd();
  }

  /**
   * 后台异步刷新所有缓存。
   *
   * 用于 switchModel/switchMode 等突变操作后，
   * 下次同步方法调用时能拿到新值。
   */
  private refreshCaches(): void {
    this.initCaches().catch((err) =>
      logger.warn(`刷新缓存失败: ${err.message}`)
    );
  }

  // ============ 事件转发 ============

  private setupNotificationForwarding(): void {
    this.client.onNotification((method, params) => {
      // Handle 事件 → 转发到对应的 RemoteToolHandle
      if (method === Events.HANDLE_STATE) {
        const [handleId, state] = params as [string, string];
        this.toolHandles.get(handleId)?._updateState(state);
        return;
      }
      if (method === Events.HANDLE_OUTPUT) {
        const [handleId, output] = params as [string, string];
        this.toolHandles.get(handleId)?._updateOutput(output);
        return;
      }
      if (method === Events.HANDLE_PROGRESS) {
        const [handleId, progress] = params as [string, unknown];
        this.toolHandles.get(handleId)?._updateProgress(progress);
        return;
      }
      if (method === Events.HANDLE_STREAM) {
        const [handleId, type, data] = params as [string, string, unknown];
        this.toolHandles.get(handleId)?._appendStream(type, data);
        return;
      }

      // Backend 事件 → 转换为本地 EventEmitter 事件
      const backendEvent = IPC_TO_BACKEND_EVENT[method];
      if (!backendEvent) return;

      // tool:execute 特殊处理：创建 RemoteToolHandle
      if (backendEvent === 'tool:execute') {
        const [sessionId, serialized] = params as [string, SerializedToolHandle];
        const handle = new RemoteToolHandle(this.client, serialized);
        handle.sessionId = sessionId;
        this.toolHandles.set(handle.handleId, handle);
        this.emit('tool:execute', sessionId, handle);

        // handle 进入终态时清理
        handle.on('state', (state: string) => {
          if (['done', 'error', 'aborted'].includes(state)) {
            this.toolHandles.delete(handle.handleId);
          }
        });
        return;
      }

      // 通用事件转发
      this.emit(backendEvent, ...params);
    });
  }
}
