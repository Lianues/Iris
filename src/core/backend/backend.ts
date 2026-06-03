/**
 * 后端核心服务
 *
 * 封装全部业务逻辑，通过公共方法和事件与平台层交互。
 *
 * 平台层调用 Backend 的方法（chat / clearSession / listSessionMetas 等），
 * Backend 通过事件（response / stream:start / stream:chunk / stream:end / tool:execute）
 * 将结果推送给平台层。
 *
 * Backend 不知道任何平台的存在。
 *
 * 队列化改造说明：
 *   - chat() 从"直接执行 turn"改为"用户消息入队"
 *   - 所有消息源（用户输入、异步子代理通知）统一通过 MessageQueue 入队
 *   - drainQueue() 按优先级逐条取出消息，通过 TurnLock 防止同 session 并发
 *   - executeTurn() 包装原有 handleMessage() 逻辑，在 finally 中释放锁并触发下一轮排空
 *   - 用户消息 priority='user'（高），子代理通知 priority='notification'（低）
 *   - 保证用户输入永远优先于后台通知被处理
 */

import { TypedEventEmitter } from '../typed-event-emitter';
import type { BackendEvents } from './types';
import { agentContext } from '../../logger';
import * as path from 'path';
import * as fs from 'fs';
import { spawnSync, type SpawnSyncReturns } from 'child_process';
import { loadSkillsFromFilesystemWithDiagnostics } from '../../config/skill-loader';
import type { LLMConfig, ToolsConfig, ToolPolicyConfig, SkillDefinition, SkillDiagnostic } from '../../config/types';
import type { SummaryConfig } from '../../config/types';
import { updatePlatformLastModel } from '../../config/platform';
import { LLMRouter } from '../../llm/router';
import { isDocumentMimeType } from '../../llm/vision';
import type { PluginHook } from '../../extension';
import { StorageProvider, SessionMeta } from '../../storage/base';
import { ToolRegistry } from '../../tools/registry';
import { ToolStateManager } from '../../tools/state';
import { PromptAssembler } from '../../prompt/assembler';
import { ModeRegistry, ModeDefinition, applyToolFilter } from '../../modes';
import { supportsVision as llmSupportsVision, supportsNativePDF, supportsNativeOffice } from '../../llm/vision';
import { ToolLoop, ToolLoopConfig, LLMCaller } from '../tool-loop';
import { createLogger } from '../../logger';
import { sanitizeHistory } from '../history-sanitizer';
import { estimateTokenCount } from 'tokenx';
import { extractText, isTextPart, isInlineDataPart } from '../../types';
import type { Content, Part, UsageMetadata } from '../../types';
import { summarizeHistory } from '../summarizer';
import { resetConfigToDefaults as doResetConfigToDefaults } from '../../config/index';
import { MessageQueue } from '../message-queue';
import type { QueuedMessage } from '../message-queue';
import { TurnLock } from '../turn-lock';
import { StreamingToolExecutor } from '../../tools/streaming-executor';
import type { CrossAgentTaskBoard, TaskRecord } from '../cross-agent-task-board';
import { ToolExecutionHandle } from '../../tools/handle';
import { buildToolDiffPreview } from '../../tools/diff-preview';

import type { BackendConfig, ImageInput, DocumentInput, AudioInput, VideoInput, UndoScope, UndoOperationResult, RedoOperationResult, NotificationPayload, RewindCheckpoint, RewindOperationResult, RewindTargetMode } from './types';
import { dataDir as defaultDataDir } from '../../paths';
import { FileHistoryManager } from './file-history';
import { buildMinimalParts, estimateMultimodalTokens } from './media';
import { maybeAddCallmeTrailerToGitCommit, type CallmeAttributionConfig } from '../../git/callme';
import { buildNonInteractiveEnv } from '../../tools/internal/non-interactive-command';
import { prepareHistoryForLLM, preparePartsForLLM } from './history';
import { callLLMStream } from './stream';
import { UndoRedoManager } from './undo-redo';
import { buildPluginHookConfig } from './plugins';
import type { AutoEditSessionState } from '../../auto-edit';
import { AutoEditManager } from '../../auto-edit';

import { sessionContext, getSessionCwd, setSessionCwd, getRememberedCwd, getActiveSessionId, clearSessionCwd } from './session-context';
import type { SessionExecutionContext } from './session-context';
import { AgentsMdManager, type AgentsMdReloadResult } from '../agents-md';

const logger = createLogger('Backend');
const RUN_COMMAND_TIMEOUT_MS = 30000;

export function formatRunCommandFailureMessage(
  result: Pick<SpawnSyncReturns<string>, 'status' | 'signal' | 'error'>,
  timeoutMs = RUN_COMMAND_TIMEOUT_MS,
): string {
  const error = result.error as NodeJS.ErrnoException | undefined;
  if (error) {
    const code = typeof error.code === 'string' ? error.code : undefined;
    const signal = result.signal ? `（signal: ${result.signal}）` : '';
    if (code === 'ETIMEDOUT') {
      return `命令执行超时（${timeoutMs}ms），进程已被终止${signal}`;
    }
    return `命令执行失败: ${error.message}${signal}`;
  }

  if (result.signal) {
    return `命令被信号终止: ${result.signal}`;
  }

  return `命令执行失败 (exit code: ${result.status ?? 'unknown'})`;
}

function skillSignature(skill: SkillDefinition): string {
  return JSON.stringify({
    name: skill.name,
    path: skill.path,
    description: skill.description,
    mode: skill.mode,
    whenToUse: skill.whenToUse,
    argumentHint: skill.argumentHint,
    disableModelInvocation: skill.disableModelInvocation,
    allowedTools: skill.allowedTools,
    model: skill.model,
    content: skill.content,
    resources: skill.resources?.map(item => ({
      relativePath: item.relativePath,
      sha256: item.sha256,
      textReadable: item.textReadable,
      maybeExecutable: item.maybeExecutable,
    })),
  });
}

/**
 * 解析合并后的 <task-notification> XML 文本为结构化数据。
 *
 * 子代理完成后生成的 XML 格式固定（由 sub-agent/index.ts 的 buildNotificationXML 产生），
 * 使用简单的正则提取各字段，无需引入 XML 解析器。
 */
function parseNotificationPayloads(mergedText: string): NotificationPayload[] {
  const payloads: NotificationPayload[] = [];
  const blockRegex = /<task-notification>([\s\S]*?)<\/task-notification>/g;
  let match;
  while ((match = blockRegex.exec(mergedText)) !== null) {
    const xml = match[1];
    const taskId = xml.match(/<task-id>([\s\S]*?)<\/task-id>/)?.[1]?.trim() ?? '';
    const status = xml.match(/<status>([\s\S]*?)<\/status>/)?.[1]?.trim() ?? '';
    const description = xml.match(/<summary>([\s\S]*?)<\/summary>/)?.[1]?.trim() ?? '';
    const result = xml.match(/<result>([\s\S]*?)<\/result>/)?.[1]?.trim();
    const error = xml.match(/<error>([\s\S]*?)<\/error>/)?.[1]?.trim();
    payloads.push({ taskId, status, description, result, error });
  }
  return payloads;
}

// ============ Backend 类 ============

export class Backend extends TypedEventEmitter<BackendEvents> {
  private router: LLMRouter;
  private storage: StorageProvider;
  private tools: ToolRegistry;
  private prompt: PromptAssembler;
  private stream: boolean;
  private modeRegistry?: ModeRegistry;
  private defaultMode?: string;
  private currentLLMConfig?: LLMConfig;
  private summaryModelName?: string;
  private summaryConfig?: SummaryConfig;

  private configDir?: string;
  private globalConfigDir?: string;
  private rememberPlatformModel: boolean;
  private toolLoop: ToolLoop;
  private toolLoopConfig: ToolLoopConfig;
  private toolState: ToolStateManager;
  private callmeConfig?: CallmeAttributionConfig;
  private autoEdit = new AutoEditManager();
  private isPlanModeActive?: (sessionId: string | undefined) => boolean;

  /** 每个 sessionId 的 AbortController，用于中止正在进行的 chat */
  private activeAbortControllers = new Map<string, AbortController>();

  /** Undo/Redo 管理器 */
  private undoRedo = new UndoRedoManager();

  /** Rewind 代码快照管理器 */
  private fileHistory: FileHistoryManager;

  /** 每个 session 最近一次 LLM 调用的 totalTokenCount（用于自动总结阈值判断） */
  private lastSessionTokens = new Map<string, number>();

  /** 每个 session 的 AGENTS.md 项目指令缓存。 */
  private agentsMd = new AgentsMdManager();

  /** 插件钩子列表 */
  private pluginHooks: PluginHook[] = [];
  /** Skill 定义列表 */
  private skills: SkillDefinition[] = [];
  /** Skill 加载/解析诊断 */
  private skillDiagnostics: SkillDiagnostic[] = [];
  /** 最近一次 Skill 文件系统重载上下文，用于 TUI 手动 refresh。 */
  private skillReloadContext?: { dataDir: string; inlineSkills?: SkillDefinition[] };
  /**
   * Skill 目录变化时的回调。
   * 由外部（bootstrap）设置，用于在 Skill 热重载后重建 read_skill 工具声明。
   */
  private _onSkillsChanged?: () => void;

  // ============ 队列化新增成员 ============

  /**
   * 统一消息队列。
   * 所有消息源（用户输入、异步子代理通知）统一入队，
   * 由 drainQueue() 按优先级逐条取出处理。
   */
  private messageQueue: MessageQueue;

  /**
   * Per-session turn 锁。
   * 防止同一 session 并发执行多个 turn。
   * 不同 session 之间互不影响，可以并行。
   */
  private turnLock: TurnLock;

  /**
   * drainQueue 重入守卫。
   *
   * EventEmitter.emit() 同步调用监听器。如果 drainQueue 内部操作
   * 触发了 'enqueued' 或 'released' 事件，监听器会同步递归调用
   * drainQueue，导致无限递归直至栈溢出。
   *
   * 此标志防止重入：正在 drain 时，新的触发被安全忽略——
   * 消息已在队列中不会丢失，当前循环或下一次非递归触发会处理它。
   */
  private _draining = false;

  /** 全局任务板（由 bootstrap 注入，替代原 per-Agent AgentTaskRegistry） */
  private taskBoard?: CrossAgentTaskBoard;
  /** setTaskBoard 注册的监听器清理函数（防止热重载泄漏） */
  private taskBoardCleanup?: () => void;
  /** per-session meta 写队列，避免各类元数据更新互相覆盖。 */
  private metaUpdateLocks = new Map<string, Promise<void>>();

  /**
   * 待合并的异步子代理通知（per-session）。
   * 当存在多个并行异步任务时，先完成的任务通知暂存于此，
   * 等全部任务完成后合并为一条消息统一交给 LLM 处理。
   */
  private pendingNotifications = new Map<string, string[]>();

  constructor(
    router: LLMRouter,
    storage: StorageProvider,
    tools: ToolRegistry,
    toolState: ToolStateManager,
    prompt: PromptAssembler,
    config?: BackendConfig,
    modeRegistry?: ModeRegistry,
  ) {
    super();
    this.router = router;
    this.storage = storage;
    this.tools = tools;
    this.toolState = toolState;
    this.prompt = prompt;
    this.stream = config?.stream ?? false;
    this.modeRegistry = modeRegistry;
    this.defaultMode = config?.defaultMode;
    this.currentLLMConfig = config?.currentLLMConfig;
    this.summaryModelName = config?.summaryModelName;
    this.summaryConfig = config?.summaryConfig;

    this.configDir = config?.configDir;
    this.globalConfigDir = config?.globalConfigDir;
    this.rememberPlatformModel = config?.rememberPlatformModel ?? true;
    this.callmeConfig = config?.callme;
    this.isPlanModeActive = config?.isPlanModeActive;
    this.fileHistory = new FileHistoryManager(config?.dataDir ?? defaultDataDir);
    if (config?.skills) {
      this.skills = config.skills;
    }
    this.skillDiagnostics = config?.skillDiagnostics ?? [];

    this.toolLoopConfig = {
      maxRounds: config?.maxToolRounds ?? 200,
      toolsConfig: config?.toolsConfig ?? { permissions: {} },
      retryOnError: config?.retryOnError ?? true,
      maxRetries: config?.maxRetries ?? 3,
    };
    this.toolLoop = new ToolLoop(tools, prompt, this.toolLoopConfig, toolState);

    // 转发工具状态事件
    this.setupToolStateForwarding();

    // ---- 队列化初始化 ----
    // 创建消息队列和 turn 锁，并监听事件以实现自动调度。
    this.messageQueue = new MessageQueue();
    this.turnLock = new TurnLock();

    // 消息入队后自动尝试排空队列
    this.messageQueue.on('enqueued', () => this.drainQueue());
    // turn 结束释放锁后，再检查队列是否有待处理消息（如异步子代理通知）
    this.turnLock.on('released', () => this.drainQueue());
  }

  // ============ 公共 API（平台层调用） ============

  /** 设置插件钩子（由 bootstrap 在插件加载后调用） */
  setPluginHooks(hooks: PluginHook[]): void {
    this.pluginHooks = hooks;
    const hookConfig = buildPluginHookConfig(hooks);
    this.toolLoopConfig.beforeToolExec = hookConfig.beforeToolExec;
    this.toolLoopConfig.afterToolExec = hookConfig.afterToolExec;
    this.toolLoopConfig.beforeLLMCall = hookConfig.beforeLLMCall;
    this.toolLoopConfig.afterLLMCall = hookConfig.afterLLMCall;
  }

  private async enqueueMetaUpdate<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.metaUpdateLocks.get(sessionId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(fn);
    const settled = current.then(() => undefined, () => undefined);
    this.metaUpdateLocks.set(sessionId, settled);
    try {
      return await current;
    } finally {
      if (this.metaUpdateLocks.get(sessionId) === settled) {
        this.metaUpdateLocks.delete(sessionId);
      }
    }
  }



  /**
   * 注入全局任务板，将 board 生命周期事件转发为 BackendEvents。
   * 替代原 setAgentTaskRegistry，使用 CrossAgentTaskBoard 替代 per-Agent AgentTaskRegistry。
   */
  setTaskBoard(board: CrossAgentTaskBoard): void {
    // 清理旧 board 的监听器（防止热重载时泄漏）
    this.taskBoardCleanup?.();

    this.taskBoard = board;

    // 转发 board 生命周期事件为 agent:notification。
    // 注意：board 事件名与 task.status 不完全对应（registered→running），
    // 此处统一使用事件名作为 status，保持语义清晰。
    // TaskRecord 使用 sourceSessionId（发起方会话 ID）作为事件路由目标。
    //
    // [职责分离] 第 6 个参数 taskType 区分 'sub_agent' 和 'delegate'。
    // 前端据此把委派任务和异步子代理分开计数/渲染，互不干扰。
    // 通知合并逻辑也只看 sub_agent 类型的 running 任务，
    // 避免委派任务（由另一个 Agent 执行、不会回到本 backend 的队列）
    // 阻塞子代理通知的合并与发送。
    // [cron 重构] 所有 emit 追加 task.silent 参数（第 6 个位置），
    // 让平台层可以区分 silent 任务（仅渲染通知卡片）和非 silent 任务（LLM 会回复，不需重复渲染）。
    // agent:notification 只负责状态变更（驱动 StatusBar），不携带结果内容。
    // 结果内容由独立的 task:result 事件广播（见下方 onTaskResult）。
    const onRegistered = (task: TaskRecord) => {
      this.emit('agent:notification', task.sourceSessionId, task.taskId, 'registered', task.description, task.type, task.silent);
    };
    const onCompleted = (task: TaskRecord) => {
      this.emit('agent:notification', task.sourceSessionId, task.taskId, 'completed', task.description, task.type, task.silent);
    };
    const onFailed = (task: TaskRecord) => {
      this.emit('agent:notification', task.sourceSessionId, task.taskId, 'failed', task.description, task.type, task.silent);
    };
    const onKilled = (task: TaskRecord) => {
      this.emit('agent:notification', task.sourceSessionId, task.taskId, 'killed', task.description, task.type, task.silent);
    };

    board.on('registered', onRegistered);
    board.on('completed', onCompleted);
    board.on('failed', onFailed);
    board.on('killed', onKilled);

    // 转发任务的实时 token 更新事件。
    // 平台层（如 Console StatusBar）通过此事件展示后台任务的 token 消耗。
    const onTokenUpdate = (task: TaskRecord) => {
      this.emit('agent:notification', task.sourceSessionId, task.taskId, 'token-update', String(task.totalTokens ?? 0), task.type, task.silent);
    };
    board.on('token-update', onTokenUpdate);

    // 转发任务的 chunk 心跳事件。
    // 平台层用此事件驱动 spinner 动画帧——只有数据真正流动时 spinner 才转。
    const onChunkHeartbeat = (task: TaskRecord) => {
      this.emit('agent:notification', task.sourceSessionId, task.taskId, 'chunk-heartbeat', '', task.type, task.silent);
    };
    board.on('chunk-heartbeat', onChunkHeartbeat);

    // 轻量级结果广播：所有终态任务都 emit task:result，不绑定 silent。
    // 三层通知体系的最轻量级通道，平台层自行决定是否消费（如渲染通知卡片、推送消息）。
    const onTaskResult = (task: TaskRecord) => {
      this.emit('task:result',
        task.sourceSessionId, task.taskId, task.status,
        task.description, task.type, task.silent,
        task.result ?? task.error,
      );
    };
    board.on('task:result', onTaskResult);

    this.taskBoardCleanup = () => {
      board.off('registered', onRegistered);
      board.off('completed', onCompleted);
      board.off('failed', onFailed);
      board.off('killed', onKilled);
      board.off('token-update', onTokenUpdate);
      board.off('chunk-heartbeat', onChunkHeartbeat);
      board.off('task:result', onTaskResult);
    };
  }

  /**
   * 释放 Backend 挂载在外部对象上的监听器。
   * IrisCore 热重载/销毁时调用，避免旧 Backend 继续监听全局 TaskBoard 事件。
   */
  dispose(): void {
    this.taskBoardCleanup?.();
    this.taskBoardCleanup = undefined;
    this.taskBoard = undefined;
  }

  /**
   * 发送消息。
   *
   * 改造说明：
   *   改造前——直接调用 handleMessage()，阻塞到 turn 结束。
   *   改造后——执行插件钩子后将消息入队，drainQueue() 自动调度执行。
   *   返回的 Promise 在该消息对应的 turn 完成后 resolve（通过监听 done 事件），
   *   因此 await chat() 的行为与改造前一致——等到 turn 结束才返回。
   *   这保证了所有平台层的 await backend.chat() 调用无需修改。
   */
  async chat(sessionId: string, text: string, images?: ImageInput[], documents?: DocumentInput[], platformName?: string, audio?: AudioInput[], video?: VideoInput[]): Promise<void> {
    // 插件钩子: onBeforeChat（可修改用户消息文本）
    // 注意：钩子在入队前执行，确保修改后的文本被队列存储。
    for (const hook of this.pluginHooks) {
      try {
        const hookResult = await hook.onBeforeChat?.({ sessionId, text });
        if (hookResult) text = hookResult.text;
      } catch (err) {
        logger.warn(`插件钩子 "${hook.name}" onBeforeChat 执行失败:`, err);
      }
    }

    // 将用户消息入队（高优先级）。
    // drainQueue() 会被 'enqueued' 事件自动触发。
    const turnId = this.messageQueue.enqueueUser({
      sessionId,
      text,
      images,
      documents,
      audio,
      video,
      platformName,
    });

    // 返回一个 Promise，在本条消息对应的 turn 完成后 resolve。
    //
    // 用 turnId（而非 sessionId）配对 done 事件，避免同一 session 上
    // 其他 turn（如异步子代理 notification turn）的 done 事件将本
    // Promise 错误 resolve。
    return new Promise<void>((resolve) => {
      const onDone = (_sid: string, _dur: number, doneTurnId?: string) => {
        if (doneTurnId !== turnId) return;
        this.removeListener('done', onDone);
        resolve();
      };
      this.on('done', onDone);
    });
  }

  /**
   * 异步子代理通知入队。
   *
   * 供异步子代理完成后调用（通过 bootstrap 注入到 sub_agent 工具的依赖中）。
   * 通知以低优先级入队，保证用户输入永远先被处理。
   *
   * @param sessionId 通知所属的会话 ID
   * @param notificationText task-notification XML 文本
   */
  enqueueAgentNotification(sessionId: string, notificationText: string): void {
    this.messageQueue.enqueueNotification({
      sessionId,
      text: notificationText,
    });
  }

  /**
   * 中止指定会话正在进行的 chat。
   */
  abortChat(sessionId: string): void {
    const controller = this.activeAbortControllers.get(sessionId);
    if (controller && !controller.signal.aborted) {
      controller.abort();
      logger.info(`abortChat: session=${sessionId}`);
    }

    // 同步触发该会话内所有活跃工具的工具级 AbortSignal。
    // 会话级 signal 负责中止 ToolLoop；工具级 signal 让正在运行的 handler
    // （尤其是 shell/bash 这类外部进程工具）可以立即收到中止并更新 UI 状态。
    for (const handle of this.toolState.getHandlesBySession(sessionId)) {
      handle.abort();
    }

    // Esc/停止应同时中止该会话发起的后台任务（异步 sub_agent / delegate）。
    // 否则前台 turn 已停止，但后台任务仍会继续跑并在稍后推送通知。
    this.taskBoard?.killAllBySourceSession(sessionId);
  }

  /** 清空指定会话 */
  async clearSession(sessionId: string): Promise<void> {
    await this.storage.clearHistory(sessionId);
    await this.fileHistory.clearSession(sessionId);
    this.undoRedo.clearRedo(sessionId);
    this.lastSessionTokens.delete(sessionId);
    this.agentsMd.clear(sessionId);
    // 清空该会话在队列中的残留消息（如未处理的异步子代理通知）
    this.messageQueue.clearSession(sessionId);
    // 中止该会话发起的后台任务（异步 sub_agent / delegate）。
    this.taskBoard?.killAllBySourceSession(sessionId);
    // 清空该会话暂存的待合并通知
    this.pendingNotifications.delete(sessionId);
    // 清除该会话的 turn 锁记录
    this.turnLock.clear(sessionId);
    // 清空会话级 Auto Edit 状态
    this.autoEdit.clear(sessionId);
    this.emit('auto-edit:update', sessionId, false);

    for (const hook of this.pluginHooks) {
      try {
        await hook.onSessionClear?.({ sessionId });
      } catch (err) {
        logger.warn(`插件钩子 "${hook.name}" onSessionClear 执行失败:`, err);
      }
    }
  }

  /** 获取指定会话的历史消息 */
  async getHistory(sessionId: string): Promise<Content[]> {
    return this.storage.getHistory(sessionId);
  }

  /** 获取指定会话的元数据 */
  async getMeta(sessionId: string): Promise<SessionMeta | null> {
    return this.storage.getMeta(sessionId);
  }

  /** 获取所有会话元数据列表 */
  async listSessionMetas(): Promise<SessionMeta[]> {
    return this.storage.listSessionMetas();
  }

  /** 获取所有会话 ID */
  async listSessions(): Promise<string[]> {
    return this.storage.listSessions();
  }

  /** 截断会话历史 */
  async truncateHistory(sessionId: string, keepCount: number): Promise<void> {
    await this.storage.truncateHistory(sessionId, keepCount);
  }

  /**
   * 压缩当前会话的上下文。
   */
  async summarize(sessionId: string, signal?: AbortSignal): Promise<string> {
    if (!this.turnLock.tryAcquire(sessionId)) {
      throw new Error('当前会话正在生成中，无法压缩上下文');
    }

    const abortController = new AbortController();
    const abortFromParent = () => abortController.abort();
    if (signal?.aborted) {
      abortController.abort();
    } else {
      signal?.addEventListener('abort', abortFromParent, { once: true });
    }

    this.activeAbortControllers.set(sessionId, abortController);
    try {
      const execCtx: SessionExecutionContext = {
        sessionId,
        cwd: getRememberedCwd(sessionId),
      };
      return await sessionContext.run(execCtx, () =>
        agentContext.run('main', () =>
          this.summarizeUnlocked(sessionId, abortController.signal)
        )
      );
    } finally {
      signal?.removeEventListener('abort', abortFromParent);
      this.activeAbortControllers.delete(sessionId);
      this.turnLock.release(sessionId);
    }
  }

  private getSummaryModelConfig(): LLMConfig | undefined {
    try {
      return this.router.getModelConfig(this.summaryModelName);
    } catch {
      return this.currentLLMConfig;
    }
  }

  private async summarizeUnlocked(sessionId: string, signal?: AbortSignal): Promise<string> {
    const history = await this.storage.getHistory(sessionId);
    if (history.length === 0) {
      throw new Error('当前会话没有历史消息');
    }

    let startIndex = 0;
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].isSummary) {
        startIndex = i;
        break;
      }
    }

    const toSummarize = history.slice(startIndex);
    if (toSummarize.length < 2) {
      throw new Error('消息过少，无需压缩');
    }

    const preparedHistory = prepareHistoryForLLM(toSummarize, this.getSummaryModelConfig());

    const summaryText = await summarizeHistory(
      this.router,
      preparedHistory,
      this.summaryModelName,
      this.summaryConfig,
      { stream: this.stream, signal },
    );

    const now = Date.now();
    const fullText = `[Context Summary]\n\n${summaryText}`;
    const estimatedTokens = estimateTokenCount(fullText);

    const summaryContent: Content = {
      role: 'user',
      parts: [{ text: fullText }],
      isSummary: true,
      createdAt: now,
      ...(estimatedTokens > 0 ? { usageMetadata: { promptTokenCount: estimatedTokens } } : {}),
    };
    await this.storage.addMessage(sessionId, summaryContent);
    this.lastSessionTokens.set(sessionId, estimatedTokens);

    this.undoRedo.clearRedo(sessionId);
    const agentsReload = await this.agentsMd.reload(sessionId, getSessionCwd());
    if (!agentsReload.ok) {
      logger.warn(`compact 后重载 AGENTS.md 失败: ${agentsReload.error ?? agentsReload.message}`);
    }
    return summaryText;
  }

  /** 清空指定会话的 redo 栈 */
  clearRedo(sessionId: string): void {
    this.undoRedo.clearRedo(sessionId);
  }

  async undo(sessionId: string, scope: UndoScope = 'last-turn'): Promise<UndoOperationResult | null> {
    // 当该 session 正在执行 turn（包括 notification turn）时，拒绝 undo。
    // 目的：防止 undo 的 truncateHistory 与 turn 中的 addMessage/updateLastMessage
    // 交错执行，导致 history 数据损坏。
    // 平台层的 busy 标志在 notification turn 期间为 false，无法可靠拦截，
    // 所以在 Backend 层用 turnLock 做最终守卫。
    if (this.turnLock.isActive(sessionId)) return null;
    const history = await this.storage.getHistory(sessionId);
    const range = this.undoRedo.resolveUndoRange(history, scope);
    if (!range) return null;

    const removed = history.slice(range.removeStart);
    await this.storage.truncateHistory(sessionId, range.removeStart);
    this.undoRedo.pushRedoGroup(sessionId, removed);

    const summary = this.undoRedo.summarizeGroup(removed);
    return {
      scope,
      removed,
      removedCount: removed.length,
      userText: summary.userText,
      assistantText: summary.assistantText,
    };
  }

  async listRewindCheckpoints(sessionId: string): Promise<RewindCheckpoint[]> {
    const history = await this.storage.getHistory(sessionId);
    const checkpoints = this.undoRedo.listRewindCheckpoints(sessionId, history);
    await Promise.all(checkpoints.map(async (checkpoint) => {
      try {
        const stats = await this.fileHistory.getDiffStats(sessionId, checkpoint.id);
        if (!stats) return;
        checkpoint.codeChangeSummary = stats;
        checkpoint.canRestoreCode = stats.filesChanged.length > 0;
      } catch (err) {
        logger.warn(`读取代码回溯快照失败，已按仅对话显示: ${err instanceof Error ? err.message : String(err)}`);
      }
    }));
    return checkpoints;
  }

  async rewind(
    sessionId: string,
    checkpointId: string,
    mode: RewindTargetMode = 'conversation',
  ): Promise<RewindOperationResult | null> {
    // 与 undo/redo 同理：turn 执行期间拒绝 rewind，防止 truncateHistory 与写入交错。
    if (this.turnLock.isActive(sessionId)) return null;
    if (mode !== 'conversation' && mode !== 'code' && mode !== 'both') return null;

    const history = await this.storage.getHistory(sessionId);
    const range = this.undoRedo.resolveRewindRange(sessionId, history, checkpointId);
    if (!range) return null;

    let filesRestored: string[] | undefined;
    if (mode === 'code' || mode === 'both') {
      filesRestored = await this.fileHistory.rewind(sessionId, checkpointId);
    }

    const shouldRewindConversation = mode === 'conversation' || mode === 'both';
    const removed = shouldRewindConversation ? history.slice(range.removeStart) : [];
    if (shouldRewindConversation) {
      if (removed.length === 0) return null;
      await this.storage.truncateHistory(sessionId, range.removeStart);
      this.undoRedo.clearRedo(sessionId);
      this.lastSessionTokens.delete(sessionId);
      this.messageQueue.clearSession(sessionId);
      this.pendingNotifications.delete(sessionId);
      this.taskBoard?.killAllBySourceSession(sessionId);
    }

    return {
      checkpoint: range.checkpoint,
      mode,
      keepCount: shouldRewindConversation ? range.removeStart : history.length,
      removed,
      removedCount: removed.length,
      restoredInputText: shouldRewindConversation ? range.checkpoint.userText : '',
      filesRestored,
      codeChanged: filesRestored ? filesRestored.length > 0 : undefined,
    };
  }

  async redo(sessionId: string): Promise<RedoOperationResult | null> {
    // 与 undo 同理：turn 执行期间拒绝 redo，防止并发写入 history。
    if (this.turnLock.isActive(sessionId)) return null;
    const restored = this.undoRedo.popRedoGroup(sessionId);
    if (!restored) return null;

    for (const content of restored) {
      await this.addMessage(sessionId, content, { clearRedo: false });
    }

    const summary = this.undoRedo.summarizeGroup(restored);
    return {
      restored,
      restoredCount: restored.length,
      userText: summary.userText,
      assistantText: summary.assistantText,
    };
  }

  async addMessage(sessionId: string, content: Content, options?: { clearRedo?: boolean }): Promise<void> {
    if (options?.clearRedo !== false) {
      this.undoRedo.clearRedo(sessionId);
    }
    await this.storage.addMessage(sessionId, content);
  }

  setCwd(dirPath: string): void {
    const currentCwd = getSessionCwd();
    const resolved = path.resolve(currentCwd, dirPath);
    if (!fs.existsSync(resolved)) {
      throw new Error(`目录不存在: ${resolved}`);
    }
    const stat = fs.statSync(resolved);
    if (!stat.isDirectory()) {
      throw new Error(`不是目录: ${resolved}`);
    }
    const sid = getActiveSessionId();
    if (sid) setSessionCwd(sid, resolved);
    logger.info(`工作目录已切换: ${resolved}`);
  }

  getCwd(): string {
    return getSessionCwd();
  }

  async reloadAgentsMd(sessionId: string): Promise<AgentsMdReloadResult> {
    return this.agentsMd.reload(sessionId, getRememberedCwd(sessionId));
  }

  runCommand(cmd: string): { output: string; cwd: string } {
    const trimmed = cmd.trim();

    const cdMatch = trimmed.match(/^cd\s+(.+)$/i);
    if (cdMatch) {
      const target = cdMatch[1].trim().replace(/^["']|["']$/g, '');
      this.setCwd(target);
      const cwd = getSessionCwd();
      return { output: `已切换到: ${cwd}`, cwd };
    }

    const shellKind = process.platform === 'win32' ? 'cmd' : 'bash';
    let command = maybeAddCallmeTrailerToGitCommit(trimmed, shellKind, this.callmeConfig);
    if (command !== trimmed) {
      logger.info(`已按 /callme 配置为 /sh git commit 注入链接署名: ${trimmed.slice(0, 100)}`);
    } else {
      command = trimmed;
    }

    const result = spawnSync(command, {
      cwd: getSessionCwd(),
      encoding: 'utf-8',
      timeout: RUN_COMMAND_TIMEOUT_MS,
      windowsHide: true,
      shell: true,
      env: buildNonInteractiveEnv(
        process.env,
        process.platform === 'win32' ? 'powershell' : 'bash',
      ),
    });

    const stdout = (result.stdout as string)?.trimEnd() || '';
    const stderr = (result.stderr as string)?.trimEnd() || '';
    const combined = [stdout, stderr].filter(Boolean).join('\n');

    if (result.status !== 0) {
      const failureMessage = formatRunCommandFailureMessage(result);
      const abnormalTermination = result.status === null || !!result.error || !!result.signal;
      throw new Error(combined && abnormalTermination ? `${combined}\n${failureMessage}` : (combined || failureMessage));
    }
    return { output: combined, cwd: getSessionCwd() };
  }

  getToolNames(): string[] {
    return this.tools.getDeclarations().map(d => d.name);
  }

  getDisabledTools(): string[] {
    return this.toolLoopConfig.toolsConfig.disabledTools ?? [];
  }

  getTools(): ToolRegistry {
    return this.tools;
  }

  getStorage(): StorageProvider {
    return this.storage;
  }

  getRouter(): LLMRouter {
    return this.router;
  }

  getPrompt(): PromptAssembler {
    return this.prompt;
  }

  getActiveSessionId(): string | undefined {
    return getActiveSessionId();
  }

  getModeRegistry(): ModeRegistry | undefined {
    return this.modeRegistry;
  }

  /** 获取消息队列引用（供外部查询队列状态） */
  getMessageQueue(): MessageQueue {
    return this.messageQueue;
  }

  /** 获取 turn 锁引用（供外部查询 turn 状态） */
  getTurnLock(): TurnLock {
    return this.turnLock;
  }

  // ============ 后台任务查询（只读，委托 taskBoard） ============

  /**
   * 将 TaskRecord 映射为平台层 AgentTaskInfoLike 兼容格式。
   * TaskRecord 使用 sourceSessionId，平台层期望 sessionId。
   */
  private mapTaskForPlatform(t: TaskRecord) {
    return { taskId: t.taskId, sessionId: t.sourceSessionId, description: t.description, status: t.status, startTime: t.startTime, endTime: t.endTime };
  }

  /** 获取指定 session 发起的所有后台任务（平台兼容格式） */
  getAgentTasks(sessionId: string) {
    return (this.taskBoard?.getBySourceSession?.(sessionId) ?? []).map(t => this.mapTaskForPlatform(t));
  }

  /** 获取指定 session 发起的正在运行的后台任务（平台兼容格式） */
  getRunningAgentTasks(sessionId: string) {
    return (this.taskBoard?.getRunningBySourceSession(sessionId) ?? []).map(t => this.mapTaskForPlatform(t));
  }

  /** 按 taskId 查询单个后台任务（平台兼容格式） */
  getAgentTask(taskId: string) {
    const t = this.taskBoard?.get(taskId);
    return t ? this.mapTaskForPlatform(t) : undefined;
  }

  // ============ Skill 管理 ============

  setOnSkillsChanged(callback: () => void): void {
    this._onSkillsChanged = callback;
  }

  setSkillReloadContext(dataDir: string, inlineSkills?: SkillDefinition[]): void {
    this.skillReloadContext = { dataDir, inlineSkills };
  }

  refreshSkillsFromFilesystem(): void {
    if (!this.skillReloadContext) return;
    this.reloadSkillsFromFilesystem(this.skillReloadContext.dataDir, this.skillReloadContext.inlineSkills);
  }

  listSkills(): { name: string; path: string; description?: string; mode?: string; whenToUse?: string; argumentHint?: string; disableModelInvocation?: boolean; skillUri?: string; resources?: SkillDefinition['resources']; source?: SkillDefinition['source'] }[] {
    return this.skills.map(s => ({
      name: s.name,
      path: s.path,
      description: s.description,
      mode: s.mode,
      whenToUse: s.whenToUse,
      argumentHint: s.argumentHint,
      disableModelInvocation: s.disableModelInvocation,
      skillUri: s.skillUri,
      resources: s.resources,
      source: s.source,
    }));
  }

  getSkillDiagnostics(): SkillDiagnostic[] {
    return [...this.skillDiagnostics];
  }

  getSkillProtectedRoots(): string[] {
    return Array.from(new Set(this.skills.map(s => s.canonicalBasePath).filter((value): value is string => typeof value === 'string' && value.length > 0)));
  }

  getSkillsLoadReport(): { loaded: Array<{ skill: SkillDefinition; diagnostics: SkillDiagnostic[] }>; skipped: SkillDiagnostic[] } {
    const byName = new Map<string, SkillDiagnostic[]>();
    const skipped: SkillDiagnostic[] = [];
    for (const diagnostic of this.skillDiagnostics) {
      if (diagnostic.skillName && this.skills.some(s => s.name === diagnostic.skillName)) {
        const current = byName.get(diagnostic.skillName) ?? [];
        current.push(diagnostic);
        byName.set(diagnostic.skillName, current);
      } else {
        skipped.push(diagnostic);
      }
    }
    return {
      loaded: this.skills.map(skill => ({ skill, diagnostics: byName.get(skill.name) ?? [] })),
      skipped,
    };
  }

  getSkillByPath(skillPath: string): SkillDefinition | undefined {
    return this.skills.find(s => s.path === skillPath);
  }

  getSkillByName(name: string): SkillDefinition | undefined {
    return this.skills.find(s => s.name === name);
  }

  reloadSkillsFromFilesystem(dataDir: string, inlineSkills?: SkillDefinition[]): void {
    const loaded = loadSkillsFromFilesystemWithDiagnostics(dataDir);
    const fsSkills: SkillDefinition[] = loaded.skills;
    const diagnostics = loaded.diagnostics;

    const merged = new Map<string, SkillDefinition>();
    for (const s of fsSkills) merged.set(s.name, s);
    if (inlineSkills) {
      for (const s of inlineSkills) merged.set(s.name, s);
    }

    const newSkills = Array.from(merged.values());
    const oldSignature = this.skills.map(skillSignature).sort().join('\0');
    const newSignature = newSkills.map(skillSignature).sort().join('\0');
    const oldDiagnostics = JSON.stringify(this.skillDiagnostics);
    const newDiagnostics = JSON.stringify(diagnostics);

    this.skills = newSkills;
    this.skillDiagnostics = diagnostics;
    if (oldSignature !== newSignature || oldDiagnostics !== newDiagnostics) {
      this._onSkillsChanged?.();
    }
  }

  // ============ Mode 管理 ============

  listModes(): { name: string; description?: string; current: boolean }[] {
    if (!this.modeRegistry) return [];
    return this.modeRegistry.getAll().map(m => ({
      name: m.name,
      description: m.description,
      current: m.name === this.defaultMode,
    }));
  }

  switchMode(name: string): boolean {
    if (!this.modeRegistry) return false;
    const mode = this.modeRegistry.get(name);
    if (!mode) return false;
    this.defaultMode = name;
    logger.info(`Mode 已切换: ${name}`);
    return true;
  }

  getCurrentMode(): string | undefined {
    return this.defaultMode;
  }

  getCurrentModelName(): string {
    return this.router.getCurrentModelName();
  }

  getCurrentModelInfo() {
    return this.router.getCurrentModelInfo();
  }

  listModels() {
    return this.router.listModels();
  }

  switchModel(modelName: string, platformName?: string) {
    const info = this.router.setCurrentModel(modelName);
    this.currentLLMConfig = this.router.getCurrentConfig();
    logger.info(`当前模型已切换: ${info.modelName} -> ${info.modelId}`);

    if (platformName && this.rememberPlatformModel && this.configDir) {
      try {
        updatePlatformLastModel(this.globalConfigDir ?? this.configDir, platformName, info.modelName);
      } catch (err) {
        logger.warn(`持久化平台模型失败 (${platformName}):`, err);
      }
    }

    this.emitModelsChanged();
    return info;
  }

  /** 获取指定工具的双向通道 Handle */
  getToolHandle(toolId: string): ToolExecutionHandle | undefined {
    return this.toolState.getHandle(toolId);
  }

  /** 生成指定工具调用的 diff 审批预览。 */
  getToolDiffPreview(toolId: string): ReturnType<typeof buildToolDiffPreview> {
    const handle = this.toolState.getHandle(toolId);
    if (!handle) {
      throw new Error(`未找到工具调用: ${toolId}`);
    }
    const invocation = handle.getSnapshot();
    const cwd = invocation.sessionId ? getRememberedCwd(invocation.sessionId) : getSessionCwd();
    return buildToolDiffPreview(invocation, { cwd });
  }

  /** 获取指定会话的所有工具 Handle */
  getToolHandles(sessionId: string): ToolExecutionHandle[] {
    return this.toolState.getHandlesBySession(sessionId);
  }

  enableAutoEdit(sessionId: string): AutoEditSessionState {
    const state = this.autoEdit.enable(sessionId);
    this.emit('auto-edit:update', sessionId, state.active);
    return state;
  }

  disableAutoEdit(sessionId: string): AutoEditSessionState {
    const state = this.autoEdit.disable(sessionId);
    this.emit('auto-edit:update', sessionId, state.active);
    return state;
  }

  toggleAutoEdit(sessionId: string): AutoEditSessionState {
    const state = this.autoEdit.toggle(sessionId);
    this.emit('auto-edit:update', sessionId, state.active);
    return state;
  }

  getAutoEditState(sessionId: string | undefined): AutoEditSessionState | null {
    return this.autoEdit.getState(sessionId);
  }

  isAutoEditActive(sessionId: string | undefined): boolean {
    return this.autoEdit.isActive(sessionId);
  }

  getToolsConfig(): ToolsConfig {
    // [配置修复] 暴露完整 toolsConfig，而不只是 permissions。
    // 目的：让 sub_agent / 后台执行链继承 autoApproveAll、autoApproveDiff、disabledTools 等全局开关，
    // 避免父级已授权但子代理丢失全局工具策略。
    return this.toolLoopConfig.toolsConfig;
  }

  getToolPolicies(): Record<string, ToolPolicyConfig> {
    return this.toolLoopConfig.toolsConfig.permissions;
  }

  /** 获取指定会话最近一次 LLM 调用的 token 数量 */
  getLastSessionTokens(sessionId: string): number | undefined {
    return this.lastSessionTokens.get(sessionId);
  }

  /** 获取所有会话的 token 数量快照 */
  getAllSessionTokens(): Record<string, number> {
    const result: Record<string, number> = {};
    for (const [k, v] of this.lastSessionTokens) {
      result[k] = v;
    }
    return result;
  }

  isStreamEnabled(): boolean {
    return this.stream;
  }

  private emitModelsChanged(): void {
    this.emit('models:changed', '__global__', this.router.listModels(), this.router.getCurrentModelInfo());
  }

  // ============ 热重载 ============

  reloadLLM(newRouter: LLMRouter): void {
    this.router = newRouter;
    this.currentLLMConfig = newRouter.getCurrentConfig();
    const modelsDesc = newRouter.listModels()
      .map(model => `${model.current ? '*' : '-'}${model.modelName}=${model.modelId}`)
      .join(' ');
    logger.info(`LLM 已热重载: [${modelsDesc}]`);
    this.emitModelsChanged();
  }

  reloadConfig(opts: {
    stream?: boolean;
    maxToolRounds?: number;
    retryOnError?: boolean;
    maxRetries?: number;
    toolsConfig?: ToolsConfig;
    systemPrompt?: string;
    currentLLMConfig?: LLMConfig;
    callme?: CallmeAttributionConfig;
    skills?: SkillDefinition[];
  }): void {
    if (opts.stream !== undefined) this.stream = opts.stream;
    if (opts.maxToolRounds !== undefined) this.toolLoopConfig.maxRounds = opts.maxToolRounds;
    if (opts.toolsConfig !== undefined) this.toolLoopConfig.toolsConfig = opts.toolsConfig;
    if (opts.retryOnError !== undefined) this.toolLoopConfig.retryOnError = opts.retryOnError;
    if (opts.maxRetries !== undefined) this.toolLoopConfig.maxRetries = opts.maxRetries;
    if (opts.systemPrompt !== undefined) this.prompt.replaceSystemPromptText(opts.systemPrompt);
    if ('callme' in opts) this.callmeConfig = opts.callme;
    if ('currentLLMConfig' in opts) this.currentLLMConfig = opts.currentLLMConfig;
    if ('skills' in opts) {
      this.skills = opts.skills ?? [];
      this._onSkillsChanged?.();
    }
    logger.info(`配置已热重载: stream=${this.stream} maxToolRounds=${this.toolLoopConfig.maxRounds} toolPolicies=${Object.keys(this.toolLoopConfig.toolsConfig.permissions).length}`);
  }

  resetConfigToDefaults(): { success: boolean; message: string } {
    return doResetConfigToDefaults();
  }

  // ============ 队列调度 ============

  /**
   * 自动排空消息队列。
   *
   * 遍历队列，对每条消息检查其 session 是否有活跃 turn：
   *   - 无活跃 turn → 获取锁，fire-and-forget 启动 executeTurn()
   *   - 有活跃 turn → 消息留在队列，记入 busySessions 使后续
   *     dequeue 自动跳过，避免反复取出同一 session 的消息
   *
   * 重入保护：
   *   EventEmitter.emit() 同步调用监听器。drainQueue 由 'enqueued'
   *   和 'released' 事件触发，如果内部操作再次 emit 这些事件，会形成
   *   同步递归。_draining 标志阻止重入——消息已在队列中不会丢失，
   *   当前循环会处理它，或 turn 结束后的 'released' 事件触发新一轮 drain。
   */
  private drainQueue(): void {
    if (this._draining) return;
    this._draining = true;
    try {
      // 记录本轮已确认为忙碌的 session。
      // dequeue 会跳过这些 session，直接取其他 session 的消息，
      // 避免反复取出→放回同一 session 的消息造成空转。
      const busySessions = new Set<string>();

      while (true) {
        const msg = this.messageQueue.dequeue(undefined, busySessions);
        if (!msg) break;

        if (!this.turnLock.tryAcquire(msg.sessionId)) {
          // 该 session 正在执行 turn。
          // 用 requeue 放回（不触发 emit、不覆盖时间戳），
          // 消息等 turn 结束后 'released' 事件触发新一轮 drain 处理。
          this.messageQueue.requeue(msg);
          busySessions.add(msg.sessionId);
          continue;
        }

        // fire-and-forget 启动 turn。
        // executeTurn 的 finally 释放 turnLock → emit 'released' → 触发 drainQueue。
        void this.executeTurn(msg);
      }
    } finally {
      this._draining = false;
    }
  }

  /**
   * 执行一个 turn（从队列取出的消息到 LLM 响应完成）。
   *
   * 包装原有 handleMessage() 逻辑，在 finally 中释放 turn 锁。
   * 锁释放后 turnLock emit 'released' 事件，触发 drainQueue()
   * 检查该 session 是否有更多待处理消息。
   *
   * 通知批量合并：
   *   当存在多个并行异步子代理时，先完成的任务通知被暂存（pendingNotifications），
   *   不触发 LLM 调用。直到该 session 所有异步任务都完成后，将所有通知合并为
   *   一条 user 消息，只调用一次 LLM。
   */
  private async executeTurn(msg: QueuedMessage): Promise<void> {
    const startTime = Date.now();
    const abortController = new AbortController();
    this.activeAbortControllers.set(msg.sessionId, abortController);

    try {
      // ---- 通知批量合并逻辑 ----
      // 当该 session 有多个并行异步子代理时，先完成的通知暂存，
      // 等全部任务完成后合并为一条消息统一交给 LLM。
      let mergedNotificationText: string | undefined;
      if (msg.mode === 'task-notification') {
        // 1. 将当前通知追加到暂存列表
        const pending = this.pendingNotifications.get(msg.sessionId) ?? [];
        pending.push(msg.text);
        this.pendingNotifications.set(msg.sessionId, pending);

        // 2. 检查该 session 是否还有运行中的异步子代理任务
        // [职责分离] 只看 sub_agent 类型。delegate 类型的委派任务完成后
        // 通知推到另一个 Agent 的 backend，不会回到本 session 的队列，
        // 不应阻塞子代理通知的合并与发送。
        const running = (this.taskBoard?.getRunningBySourceSession(msg.sessionId) ?? [])
          .filter(t => t.type === 'sub_agent');
        if (running.length > 0) {
          // 还有子代理任务在跑 → 暂存通知，释放锁，等下一个通知到来时再检查
          logger.info(
            `通知已暂存 (${pending.length} 条)，等待剩余 ${running.length} 个任务完成: session=${msg.sessionId}`,
          );
          return; // finally 释放锁 → turnLock 'released' → drainQueue
        }

        // 3. 所有任务已完成 → 从队列中提取可能还积压的通知（多个任务几乎同时完成时）
        const queuedNotifications = this.messageQueue.drainSessionNotifications(msg.sessionId);
        for (const qm of queuedNotifications) {
          pending.push(qm.text);
        }

        // 4. 清空暂存，合并所有通知文本
        this.pendingNotifications.delete(msg.sessionId);
        mergedNotificationText = pending.join('\n\n');
        logger.info(`合并 ${pending.length} 条通知，统一处理: session=${msg.sessionId}`);
      }

      // 将通知 XML 解析为结构化数据，发送给前端渲染折叠区块。
      // 在 turn:start 之前 emit，确保前端先收到 payloads 再开始 stream 渲染。
      if (mergedNotificationText) {
        const payloads = parseNotificationPayloads(mergedNotificationText);
        if (payloads.length > 0) {
          this.emit('notification:payloads', msg.sessionId, payloads);
        }
      }

      // 通知平台层本轮 turn 的类型（chat / task-notification），
      // 平台可据此对后续流式事件做差异化渲染。
      this.emit('turn:start', msg.sessionId, msg.turnId, msg.mode);

      if (msg.mode === 'task-notification') {
        // ---- task-notification 路径（异步子代理完成通知） ----
        // 注入 agentContext='main'，使主 LLM turn 内的工具执行日志
        // 都带 [Module|main] 前缀，与子代理的 [Module|taskId] 区分。
        const execCtx: SessionExecutionContext = {
          sessionId: msg.sessionId,
          cwd: getRememberedCwd(msg.sessionId),
        };
        await sessionContext.run(execCtx, () =>
          agentContext.run('main', () =>
            this.handleNotificationTurn(msg.sessionId, mergedNotificationText!, msg.turnId, abortController.signal)
          )
        );
      } else {
        // ---- 普通用户消息路径 ----
        // 同上，注入 agentContext='main'。
        const execCtx: SessionExecutionContext = {
          sessionId: msg.sessionId,
          cwd: getRememberedCwd(msg.sessionId),
        };
        await sessionContext.run(execCtx, () =>
          agentContext.run('main', () =>
            this.handleMessage(msg.sessionId, msg.text, msg.turnId, abortController.signal, msg.images, msg.documents, msg.platformName, msg.audio, msg.video)
          )
        );
      }
    } catch (err) {
      if (abortController.signal.aborted) {
        logger.info(`turn 已被中止 (session=${msg.sessionId})`);
      } else {
        const errorMsg = err instanceof Error ? err.message : String(err);
        logger.error(`turn 执行失败 (session=${msg.sessionId}):`, err);
        this.emit('error', msg.sessionId, errorMsg);
      }
      this.emit('done', msg.sessionId, Date.now() - startTime, msg.turnId);
    } finally {
      this.activeAbortControllers.delete(msg.sessionId);
      // 释放 turn 锁 -> turnLock emit 'released' -> 触发 drainQueue()
      this.turnLock.release(msg.sessionId);
    }
  }

  // ============ 核心流程 ============

  private getAutoSummaryThreshold(): number | undefined {
    const config = this.currentLLMConfig;
    if (!config?.autoSummaryThreshold) return undefined;
    const raw = config.autoSummaryThreshold;
    if (typeof raw === 'number') return raw > 0 ? raw : undefined;
    if (typeof raw === 'string') {
      const trimmed = raw.trim();
      if (trimmed.endsWith('%')) {
        const percent = parseFloat(trimmed);
        if (!isNaN(percent) && percent > 0 && config.contextWindow && config.contextWindow > 0) {
          return Math.floor(config.contextWindow * percent / 100);
        }
      }
      const num = parseFloat(trimmed);
      return !isNaN(num) && num > 0 ? num : undefined;
    }
    return undefined;
  }

  /**
   * 处理 task-notification 消息（异步子代理完成通知，可能已合并多条）的精简路径。
   *
   * 跳过用户消息专有步骤（sanitize、auto-compact、undo/redo、token 统计、
   * meta 更新、插件钩子），直接以 user-role Content 注入 LLM 历史触发 ToolLoop。
   *
   * @param notificationText 通知文本，可能包含多个 <task-notification> XML（由 executeTurn 合并）
   */
  private async handleNotificationTurn(sessionId: string, notificationText: string, turnId: string, signal?: AbortSignal): Promise<void> {
    this.toolState.clearSession(sessionId);

    const storedHistory = await this.storage.getHistory(sessionId);
    const history = prepareHistoryForLLM(storedHistory, this.currentLLMConfig);

    // 将通知作为 user-role message 加入历史并持久化（不占用 undo 栈、不计 token）。
    // 在原始 XML 前追加引导前缀，告诉主 LLM 这不是用户说的话，而是后台任务完成的通知。
    const count = (notificationText.match(/<task-notification>/g) || []).length;
    const prefix = count > 1
      ? `后台子代理完成了 ${count} 个任务：\n`
      : `后台子代理完成了一个任务：\n`;
    const wrappedText = prefix + notificationText;
    const notificationContent: Content = {
      role: 'user',
      parts: [{ text: wrappedText }],
      createdAt: Date.now(),
    };
    history.push(notificationContent);
    await this.storage.addMessage(sessionId, notificationContent);

    // 委托公共核心执行 ToolLoop + 结果处理
    await this.runTurnCore({
      sessionId,
      turnId,
      history,
      signal,
      // notification 路径跳过所有用户消息专有后置步骤
      updateMeta: false,
      runAfterChatHooks: false,
      postCompact: false,
    });
  }

  private async handleMessage(sessionId: string, text: string, turnId: string, signal?: AbortSignal, images?: ImageInput[], documents?: DocumentInput[], platformName?: string, audio?: AudioInput[], video?: VideoInput[]): Promise<void> {
    // 清除本会话上一轮残留的工具调用记录
    this.toolState.clearSession(sessionId);

    // 构建用户消息 parts — hook 优先，兜底最小化处理
    let storedUserParts: Part[] | undefined;
    for (const hook of this.pluginHooks) {
      try {
        const result = await hook.onProcessUserMedia?.({
          sessionId,
          text,
          images,
          documents,
          audio,
          video,
          capabilities: {
            supportsVision: llmSupportsVision(this.currentLLMConfig),
            supportsNativePDF: supportsNativePDF(this.currentLLMConfig),
            supportsNativeOffice: supportsNativeOffice(this.currentLLMConfig),
          },
        });
        if (result) {
          storedUserParts = result.parts;
          break;
        }
      } catch (err) {
        logger.warn(`插件钩子 "${hook.name}" onProcessUserMedia 执行失败:`, err);
      }
    }
    if (!storedUserParts) {
      storedUserParts = buildMinimalParts(text, images, documents, audio, video);
    }
    const llmUserParts = preparePartsForLLM(storedUserParts, this.currentLLMConfig);

    // 1. 加载历史并追加用户消息
    let storedHistory = await this.storage.getHistory(sessionId);

    // 1.1 历史兜底清理（notification 路径不需要——通知消息结构简单不会产生异常历史）
    const beforeSanitize = storedHistory.length;
    const sanitizeAppended = sanitizeHistory(storedHistory);
    const keptFromOriginal = storedHistory.length - sanitizeAppended.length;
    if (keptFromOriginal !== beforeSanitize || sanitizeAppended.length > 0) {
      if (keptFromOriginal < beforeSanitize) {
        await this.storage.truncateHistory(sessionId, keptFromOriginal);
      }
      for (const msg of sanitizeAppended) {
        await this.storage.addMessage(sessionId, msg);
      }
      logger.info(`历史兜底清理: session=${sessionId}, ${beforeSanitize} -> ${storedHistory.length} 条`);
    }

    // 1.2 自动上下文压缩（pre-message，notification 路径不需要）
    const autoThreshold = this.getAutoSummaryThreshold();
    if (autoThreshold && storedHistory.length > 0) {
      const lastTokens = this.lastSessionTokens.get(sessionId) ?? 0;
      if (lastTokens > 0) {
        const estUser = (estimateTokenCount(extractText(storedUserParts) || '')) + estimateMultimodalTokens(storedUserParts);
        if (lastTokens + estUser > autoThreshold) {
          logger.info(`Auto-compact (pre-message): ${lastTokens} + ${estUser} > ${autoThreshold}`);
          try {
            const summaryText = await this.summarizeUnlocked(sessionId, signal);
            this.emit('auto-compact', sessionId, summaryText);
            storedHistory = await this.storage.getHistory(sessionId);
          } catch (err) {
            logger.warn('Auto-compact (pre-message) failed:', err);
          }
        }
      }
    }

    const history = prepareHistoryForLLM(storedHistory, this.currentLLMConfig);
    const isNewSession = storedHistory.length === 0;

    history.push({ role: 'user', parts: llmUserParts });

    // 2. 新用户消息会让 redo 失效
    this.undoRedo.clearRedo(sessionId);
    const userTextForTokens = extractText(storedUserParts);
    const textTokens = userTextForTokens ? estimateTokenCount(userTextForTokens) : 0;
    const multimodalTokens = estimateMultimodalTokens(storedUserParts);
    const estimatedUserTokens = textTokens + multimodalTokens;
    const userCreatedAt = Date.now();
    const storedUserContent: Content = {
      role: 'user',
      parts: storedUserParts,
      createdAt: userCreatedAt,
      ...(estimatedUserTokens > 0 ? { usageMetadata: { promptTokenCount: estimatedUserTokens } } : {}),
    };
    await this.storage.addMessage(sessionId, storedUserContent);
    const rewindCheckpointId = this.undoRedo.makeRewindCheckpointId(storedHistory.length, storedUserContent);
    try {
      await this.fileHistory.makeSnapshot(sessionId, rewindCheckpointId);
    } catch (err) {
      logger.warn(`创建代码回溯快照失败，已跳过: session=${sessionId}: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (isNewSession) {
      await this.updateSessionMeta(sessionId, storedUserParts, true, platformName);
      for (const hook of this.pluginHooks) {
        try {
          await hook.onSessionCreate?.({ sessionId });
        } catch (err) {
          logger.warn(`插件钩子 "${hook.name}" onSessionCreate 执行失败:`, err);
        }
      }
    }
    if (estimatedUserTokens > 0) this.emit('user:token', sessionId, estimatedUserTokens);
    this.lastSessionTokens.set(sessionId, (this.lastSessionTokens.get(sessionId) ?? 0) + estimatedUserTokens);

    // 3. 委托公共核心执行 ToolLoop + 结果处理
    await this.runTurnCore({
      sessionId,
      turnId,
      history,
      signal,
      // 用户消息路径的后置步骤全部启用
      updateMeta: true,
      runAfterChatHooks: true,
      postCompact: true,
      storedUserParts,
      platformName,
    });
  }

  // ============ Turn 公共核心（提取自 handleMessage/handleNotificationTurn 的重复代码） ============

  /**
   * Turn 核心执行逻辑：构建 callLLM → 创建 ToolLoop → 运行 → 处理结果。
   *
   * handleMessage 和 handleNotificationTurn 在前置准备（历史加载、sanitize、
   * auto-compact、undo/redo、token 统计）和后置处理（meta 更新、插件钩子、
   * post-compact）上存在差异，但中间的 LLM 调用 + ToolLoop + 结果处理完全相同。
   *
   * 提取此方法消除约 80 行重复代码，差异通过 options 对象控制。
   */
  private async runTurnCore(options: {
    sessionId: string;
    turnId: string;
    history: Content[];
    signal?: AbortSignal;
    /** 是否在 turn 结束后更新 session 元数据（handleMessage: true, notification: false） */
    updateMeta: boolean;
    /** 是否执行 onAfterChat 插件钩子（handleMessage: true, notification: false） */
    runAfterChatHooks: boolean;
    /** 是否在 turn 结束后检查 post-response auto-compact（handleMessage: true, notification: false） */
    postCompact: boolean;
    /** 用户消息 parts（仅 handleMessage 路径提供，用于 meta 更新） */
    storedUserParts?: Part[];
    /** 平台名称（仅 handleMessage 路径提供，用于 meta 更新） */
    platformName?: string;
  }): Promise<void> {
    const { sessionId, turnId, history, signal } = options;
    const startTime = Date.now();

    // 1. 构建 per-request 额外上下文（例如 mode system prompt）。
    const extraParts: Part[] = [];
    const mode = this.resolveMode();
    if (mode?.systemPrompt) {
      extraParts.unshift({ text: mode.systemPrompt });
    }
    const agentsMdState = await this.agentsMd.ensureLoaded(sessionId, getSessionCwd());
    if (agentsMdState.part) {
      extraParts.push(agentsMdState.part);
    }
    const planModeActive = this.isPlanModeActive?.(sessionId) === true;
    const autoEditActive = this.autoEdit.isActive(sessionId);
    const runtimeApprovalContext = {
      sessionId,
      cwd: getSessionCwd(),
      autoEditActive,
      planModeActive,
      isAutoEditActive: (sid: string | undefined) => this.autoEdit.isActive(sid),
      isPlanModeActive: (sid: string | undefined) => this.isPlanModeActive?.(sid) === true,
      trackFileEdit: (toolName: string, args: Record<string, unknown>) => this.fileHistory.trackToolEdit(sessionId, getSessionCwd(), toolName, args),
    };

    // 2. 构建 LLM 调用函数
    let lastCallTotalTokens = 0;

    // 流式模式下创建 StreamingToolExecutor，在 LLM 流式输出过程中
    // 通过 onFunctionCallReady 回调提前启动工具执行。
    // 每轮 ToolLoop 循环需要一个新的 executor（因为每轮的工具调用是独立的）。
    let streamingExecutor: StreamingToolExecutor | undefined;

    const callLLM: LLMCaller = async (request, modelName, callSignal) => {
      let content: Content;
      if (this.stream) {
        // 每轮 LLM 调用创建新的 StreamingToolExecutor
        streamingExecutor = new StreamingToolExecutor(
          requestTools, this.toolState, this.toolLoopConfig.toolsConfig,
          callSignal, this.toolLoopConfig.beforeToolExec, this.toolLoopConfig.afterToolExec,
          (attachments) => { this.emit('attachments', sessionId, attachments); },
          runtimeApprovalContext,
          sessionId,
        );

        content = await callLLMStream(this.router, this, sessionId, request, modelName, callSignal,
          // 流式中每产生一个完整的 functionCall 就通知 executor 提前启动
          (call) => streamingExecutor!.addTool(call),
        );
        if (content.usageMetadata?.totalTokenCount) lastCallTotalTokens = content.usageMetadata.totalTokenCount;
        await new Promise<void>(resolve => setTimeout(resolve, 0));
      } else {
        const response = await this.router.chat(request, modelName, callSignal);
        content = response.content;
        content.modelName = modelName || this.router.getCurrentModelName();
        content.createdAt = Date.now();
        if (response.usageMetadata) {
          content.usageMetadata = response.usageMetadata;
          this.emit('usage', sessionId, response.usageMetadata);
          if (response.usageMetadata.totalTokenCount) lastCallTotalTokens = response.usageMetadata.totalTokenCount;
        }
      }
      return content;
    };

    // 3. 解析模式工具过滤 + 全局禁用工具
    let requestTools = mode?.tools ? applyToolFilter(mode, this.tools) : this.tools;
    const disabled = this.toolLoopConfig.toolsConfig.disabledTools;
    if (disabled && disabled.length > 0) {
      requestTools = requestTools.createFiltered(disabled);
    }

    let loop = this.toolLoop;
    if (mode?.tools || (disabled && disabled.length > 0)) {
      loop = new ToolLoop(requestTools, this.prompt, this.toolLoopConfig, this.toolState);
    }

    // 4. 执行工具循环
    const result = await loop.run(history, callLLM, {
      sessionId,
      extraParts,
      // 流式模式下注入 StreamingToolExecutor。
      // callLLM 每次被调用时会创建新的 executor，这里通过 getter 获取最新的实例。
      get streamingToolExecutor() { return streamingExecutor; },
      onMessageAppend: (content) => this.storage.addMessage(sessionId, content),
      onModelContent: (content) => { this.emit('assistant:content', sessionId, content); },
      onAttachments: (attachments) => {
        this.emit('attachments', sessionId, attachments);
      },
      signal,
      runtimeApprovalContext,
      onRetry: (attempt, maxRetries, error) => {
        this.emit('retry', sessionId, attempt, maxRetries, error);
      },
    });

    // 5. 处理 abort
    if (result.aborted) {
      await this.storage.truncateHistory(sessionId, result.history.length);
      this.emit('done', sessionId, Date.now() - startTime, turnId);
      return;
    }

    // 6. 处理错误
    if (result.error) {
      this.emit('error', sessionId, result.error);
      this.emit('done', sessionId, Date.now() - startTime, turnId);
      return;
    }

    // 7. 补 fallback model 消息
    const hasFinalModelMessage = result.history[result.history.length - 1]?.role === 'model';
    let appendedFallbackModel = false;
    if (!hasFinalModelMessage && result.text) {
      const fallbackContent: Content = {
        role: 'model',
        parts: [{ text: result.text }],
        modelName: this.router.getCurrentModelName(),
      };
      result.history.push(fallbackContent);
      await this.storage.addMessage(sessionId, fallbackContent);
      this.emit('assistant:content', sessionId, fallbackContent);
      appendedFallbackModel = true;
    }

    // 8. 将耗时写入最后一条 model 消息
    const durationMs = Date.now() - startTime;
    for (let i = result.history.length - 1; i >= 0; i--) {
      if (result.history[i].role === 'model') {
        result.history[i].durationMs = durationMs;
        break;
      }
    }
    await this.storage.updateLastMessage(sessionId, (content) => {
      if (content.role === 'model') {
        content.durationMs = durationMs;
      }
      return content;
    });

    // 9. 条件后置步骤：更新会话元数据（仅用户消息路径）
    if (options.updateMeta && options.storedUserParts) {
      await this.updateSessionMeta(sessionId, options.storedUserParts, false, options.platformName);
    }

    // 10. 条件后置步骤：插件 onAfterChat 钩子（仅用户消息路径）
    let finalText = result.text;
    if (options.runAfterChatHooks && finalText) {
      for (const hook of this.pluginHooks) {
        try {
          const hookResult = await hook.onAfterChat?.({ sessionId, content: finalText });
          if (hookResult) finalText = hookResult.content;
        } catch (err) {
          logger.warn(`插件钩子 "${hook.name}" onAfterChat 执行失败:`, err);
        }
      }
    }

    // 11. 非流式模式：发送最终文本
    if ((!this.stream || appendedFallbackModel) && finalText) {
      this.emit('response', sessionId, finalText);
    }
    this.emit('done', sessionId, durationMs, turnId);

    // 12. 更新 session token 追踪
    if (lastCallTotalTokens > 0) {
      this.lastSessionTokens.set(sessionId, lastCallTotalTokens);
    }

    // 13. 条件后置步骤：post-response auto-compact（仅用户消息路径）
    if (options.postCompact) {
      const autoThreshold = this.getAutoSummaryThreshold();
      if (autoThreshold && lastCallTotalTokens > autoThreshold) {
        logger.info(`Auto-compact (post-response): ${lastCallTotalTokens} > ${autoThreshold}`);
        try {
          const summaryText = await this.summarizeUnlocked(sessionId, signal);
          this.emit('auto-compact', sessionId, summaryText);
        } catch (err) {
          logger.warn('Auto-compact (post-response) failed:', err);
        }
      }
    }
  }

  // ============ 工具事件转发 ============

  private setupToolStateForwarding(): void {
    // Handle 被创建时，通知平台层
    this.toolState.on('handle:created', (handle: ToolExecutionHandle) => {
      const sid = handle.getSnapshot().sessionId;
      if (!sid) return;
      this.emit('tool:execute', sid, handle);
    });
  }

  // ============ 模式解析 ============

  private resolveMode(): ModeDefinition | undefined {
    if (!this.defaultMode || !this.modeRegistry) return undefined;
    return this.modeRegistry.get(this.defaultMode);
  }

  // ============ 会话元数据 ============

  private async updateSessionMeta(sessionId: string, userParts: Part[], isNewSession: boolean, platformName?: string): Promise<void> {
    await this.enqueueMetaUpdate(sessionId, async () => {
      const now = new Date().toISOString();
      const cwd = getSessionCwd();

      const buildInitialMeta = (): SessionMeta => {
        const hasDocuments = userParts.some(p =>
          (isTextPart(p) && p.text?.startsWith('[Document: ')) ||
          (isInlineDataPart(p) && isDocumentMimeType(p.inlineData.mimeType))
        );
        const hasImages = userParts.some(p =>
          isInlineDataPart(p) && !isDocumentMimeType(p.inlineData.mimeType)
        );
        const titleText = userParts.reduce((result, part) => {
          if (isTextPart(part)) {
            const text = part.text ?? '';
            // 跳过扩展生成的标记文本（如坐标映射、文档标签、OCR 标记等）
            if (text.startsWith('[') || text.startsWith('[[')) {
              return result;
            }
            return result + text;
          }

          return result;
        }, '').trim();
        const fallbackTitle = hasImages ? '图片消息' : (hasDocuments ? '文档消息' : '新对话');
        const title = titleText.slice(0, 100) || fallbackTitle;
        return {
          id: sessionId,
          title,
          cwd,
          createdAt: now,
          updatedAt: now,
          platforms: platformName ? [platformName] : [],
        };
      };

      await this.storage.updateMeta(sessionId, (current) => {
        const meta = current ?? (isNewSession ? buildInitialMeta() : undefined);
        if (!meta) return undefined;
        meta.updatedAt = now;
        if (!meta.createdAt) meta.createdAt = now;
        if (!meta.title) meta.title = buildInitialMeta().title;
        if (meta.cwd !== cwd) meta.cwd = cwd;
        if (platformName) {
          const platforms = meta.platforms ?? [];
          if (!platforms.includes(platformName)) {
            platforms.push(platformName);
          }
          meta.platforms = platforms;
        }
        return meta;
      });
    });

  }
}
