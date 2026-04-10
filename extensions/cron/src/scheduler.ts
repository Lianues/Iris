/**
 * 定时任务调度器核心模块
 *
 * 包含：
 * - [croner 迁移] 基于 croner 的 Cron 时间计算工具
 * - CronScheduler 类：内存调度 + setTimeout 驱动 + JSON 持久化
 */

import * as fs from 'fs';
import * as path from 'path';
import { createPluginLogger } from '@irises/extension-sdk';
// [croner 迁移] 用 croner 替换自实现 cron 解析器，避免继续维护手写解析/逐分钟扫描逻辑。
import { Cron } from 'croner';
// [cron 重构] 删除 PluginEventBusLike import（不再使用 eventBus 广播）
import type { IrisAPI } from '@irises/extension-sdk';
import type {
  ScheduledJob,
  SchedulerConfig,
  CreateJobParams,
  UpdateJobParams,
  CronRunRecord,
  CronBackgroundConfig,
  RunStatus,
} from './types.js';
import { DEFAULT_SCHEDULER_CONFIG, DEFAULT_BACKGROUND_CONFIG } from './types.js';
import { shouldSkip } from './delivery-gate.js';

const logger = createPluginLogger('cron');

// ============ UUID 生成 ============

/** 生成 UUID v4 格式的唯一标识符 */
function generateId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// ============ Cron 工具（基于 croner） ============

/**
 * [croner 迁移] 计算 cron 表达式的下一次触发时间。
 * [croner 迁移] 替换自实现的逐分钟扫描解析器，改用 croner 包。
 * [croner 迁移] croner 零依赖、支持 5/6/7 字段、L/W/#、时区、秒级精度。
 */
export function getNextCronTime(expression: string, after?: Date): Date {
  const job = new Cron(expression);
  const next = after ? job.nextRun(after) : job.nextRun();
  if (!next) {
    throw new Error(`未找到匹配的 cron 触发时间: "${expression}"`);
  }
  return next;
}

// ============ CronScheduler 类 ============

/**
 * [Phase 3] scheduler 侧只关心与 TaskBoard 协作所需的最小调度原语，
 * 这里用本地类型描述，避免 cron 插件直接耦合核心模块的完整实现细节。
 */
type TaskBoardScheduleSource =
  | { kind: 'interval'; intervalMs: number }
  | { kind: 'cron'; expression: string };

type TaskBoardScheduleConfig =
  | { type: 'immediate' }
  | { type: 'once'; runAt: number }
  | { type: 'recurring'; nextRunAt: number; source: TaskBoardScheduleSource };

type TaskBoardExecutor = (taskId: string, signal: AbortSignal) => Promise<string | void>;

// [TaskBoard 调度升级对齐] 这里与核心 TaskBoard 的 nextTimeResolver 命名保持一致，
// 避免 cron 插件注册任务时把续调回调写到错误字段，导致 recurring 任务无法自动续排。
// 返回值保留 number | null，方便插件侧在“无法计算下一次时间”时显式放弃续调。
type TaskBoardNextTimeResolver = (source: TaskBoardScheduleSource) => number | null;

/**
 * CrossAgentTaskBoard 的最小接口（面向插件侧使用）。
 *
 * [cron 重构] 替换原 AgentTaskRegistryLike。
 * 避免 cron 插件直接依赖核心模块的 CrossAgentTaskBoard 类型，
 * 只声明 cron 实际需要用到的方法。
 * 运行时由 bootstrap 注入的实际 CrossAgentTaskBoard 实例满足此接口。
 */
interface TaskBoardLike {
  register(input: {
    taskId: string;
    sourceAgent: string;
    sourceSessionId: string;
    targetAgent: string;
    type: 'cron';
    description: string;
    silent?: boolean;
    schedule?: TaskBoardScheduleConfig;
    executor?: TaskBoardExecutor;
    nextTimeResolver?: TaskBoardNextTimeResolver;
  }): {
    taskId: string;
    abortController?: AbortController;
  };
  on?(
    event: 'registered',
    listener: (task: { taskId: string; type: string; executor?: TaskBoardExecutor }) => void,
  ): void;
  off?(
    event: 'registered',
    listener: (task: { taskId: string; type: string; executor?: TaskBoardExecutor }) => void,
  ): void;
  complete(taskId: string, result?: string): void;
  fail(taskId: string, error: string): void;
  kill(taskId: string): void;
  getRunningByTargetAgent(agentName: string): Array<{ taskId: string; type: string }>;
  emitChunkHeartbeat(taskId: string): void;
  updateTokens(taskId: string, tokens: number): void;
}

/** 生成任务 ID（与核心 createTaskId 的格式保持一致） */
let cronTaskCounter = 0;
function createCronTaskId(): string {
  return `cron_task_${++cronTaskCounter}_${Date.now()}`;
}

/**
 * 归一化历史运行状态。
 *
 * 目的：兼容旧版持久化文件中的 `success`，
 * 并统一对外输出为 `completed`，避免前端状态映射出现“任务已结束但仍显示 running”的问题。
 */
function normalizeRunStatus(status?: string): RunStatus | undefined {
  if (!status) return undefined;
  if (status === 'success') return 'completed';
  return status as RunStatus;
}

/**
 * 定时任务调度器
 *
 * 核心机制：
 * - 内存中维护任务 Map 和定时器 Map
 * - CRUD 操作直接改内存，debounce 500ms 写回 JSON 文件
 * - 进程重启时从文件恢复
 * - fs.watchFile 监听外部修改，增量同步
 */
export class CronScheduler {
  /** 所有任务（id → job） */
  private jobs: Map<string, ScheduledJob> = new Map();
  /** 会话最后活跃时间（sessionId → timestamp），供投递门控使用 */
  private lastActivityMap: Map<string, number> = new Map();
  /** 调度器配置 */
  private config: SchedulerConfig;
  /** JSON 持久化文件路径 */
  private filePath: string;
  /** Iris API 引用 */
  private api: IrisAPI;
  /** debounce 持久化定时器 */
  private persistTimer: NodeJS.Timeout | null = null;
  /** 文件监听是否已启动 */
  private fileWatcherActive: boolean = false;
  /** 上次已知的文件修改时间（用于过滤自身写入触发的事件） */
  private lastFileModTime: number = 0;
  /** 调度器是否正在运行 */
  private running: boolean = false;
  /** [cron 重构] 全局任务板（替代原 agentTaskRegistry），用于后台任务注册/生命周期管理 */
  private taskBoard: TaskBoardLike | null = null;
  /** [cron 重构] 当前 Agent 名称，注册任务时标识 sourceAgent / targetAgent */
  // 多 Agent 配置分层重构：默认值从 __global__ 改为 master
  private agentName: string = 'master';
  /** 后台执行配置 */
  private backgroundConfig: CronBackgroundConfig;
  /** 执行记录持久化目录 */
  private runsDir: string;
  /**
   * [Phase 3] 用 WeakMap 跟踪“executor 闭包 → ScheduledJob”，
   * 这样 TaskBoard 在 recurring 任务续调并重新 emit('registered') 时，
   * scheduler 可以把新的 TaskBoard taskId 反向写回到 job.currentTaskId，
   * 从而在 update/disable/delete/stop 时精准 kill 当前关联任务。
   */
  private executorJobMap: WeakMap<TaskBoardExecutor, ScheduledJob> = new WeakMap();
  private readonly handleTaskBoardRegistered = (task: { taskId: string; type: string; executor?: TaskBoardExecutor }) => {
    if (task.type !== 'cron' || !task.executor) return;
    const job = this.executorJobMap.get(task.executor);
    if (!job) return;
    job.currentTaskId = task.taskId;
  };

  /**
   * @param api Iris API 实例（用于投递通知和获取数据目录）
   * @param config 调度器配置（缺省使用默认值）
   * @param taskBoard 全局任务板（可选，不提供时跳过后台执行）
   * @param agentName 当前 Agent 名称（可选，默认 'master'）
   * @param backgroundConfig 后台执行配置（可选，缺省使用默认值）
   */
  constructor(
    api: IrisAPI,
    config?: SchedulerConfig,
    taskBoard?: TaskBoardLike | null,
    agentName?: string,
    backgroundConfig?: Partial<CronBackgroundConfig>,
  ) {
    this.api = api;
    this.config = config ? { ...config } : { ...DEFAULT_SCHEDULER_CONFIG };
    this.taskBoard = taskBoard ?? null;
    // 多 Agent 配置分层重构：默认值从 __global__ 改为 master
    this.agentName = agentName ?? 'master';
    this.backgroundConfig = { ...DEFAULT_BACKGROUND_CONFIG, ...backgroundConfig };

    // 根据 api.dataDir 确定持久化文件路径
    // 单 agent: ~/.iris/cron-jobs.json
    // 多 agent: ~/.iris/agents/<name>/cron-jobs.json
    const dataDir = api.dataDir
      ?? path.join(
        process.env.HOME ?? process.env.USERPROFILE ?? '.',
        '.iris',
      );
    this.filePath = path.join(dataDir, 'cron-jobs.json');
    // 执行记录目录：与 cron-jobs.json 同级的 cron-runs/
    this.runsDir = path.join(dataDir, 'cron-runs');
  }

  // ──────────── 生命周期 ────────────

  /**
   * 启动调度器：从文件恢复任务 → 清理已完结的 once 任务 → 调度所有 enabled 任务 → 启动文件监听
   */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    // 从持久化文件恢复任务
    this.loadFromFile();

    // 在调度之前，先统一处理已完结或已过期的一次性任务。
    // 避免 scheduleNext() 混入业务状态判断。
    this.reconcileJobsOnStartup();

    // [Phase 3] 监听 TaskBoard 的 registered 事件，
    // 用于把 recurring 续调后生成的新 taskId 回写到对应 job.currentTaskId。
    this.taskBoard?.on?.('registered', this.handleTaskBoardRegistered);

    // [Phase 3] 启动时不再自己挂 setTimeout，而是把每个已启用任务注册到 TaskBoard 调度引擎。
    for (const job of this.jobs.values()) {
      if (job.enabled) {
        this.registerJobToTaskBoard(job);
      }
    }

    // 启动文件监听（轮询间隔 2 秒）
    this.startFileWatcher();

    logger.info(`调度器已启动，共 ${this.jobs.size} 个任务`);
  }

  /**
   * 停止调度器：清除所有定时器 → 停止文件监听 → 同步持久化
   */
  stop(): void {
    this.running = false;

    // [Phase 3] 任务的定时器已迁入 TaskBoard，停止时只需 kill 仍关联的 TaskBoard 任务。
    for (const job of this.jobs.values()) {
      if (job.currentTaskId) {
        this.taskBoard?.kill(job.currentTaskId);
        job.currentTaskId = undefined;
      }
    }
    this.taskBoard?.off?.('registered', this.handleTaskBoardRegistered);

    // 停止文件监听
    this.stopFileWatcher();

    // 清除待执行的 debounce 持久化
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }

    // 最后一次同步写入
    this.persistSync();

    logger.info('调度器已停止');
  }

  // ──────────── CRUD 操作 ────────────

  /**
   * 创建新的定时任务
   * @param params 创建参数
   * @returns 创建好的任务对象
   */
  createJob(params: CreateJobParams): ScheduledJob {
    const job: ScheduledJob = {
      id: generateId(),
      name: params.name,
      schedule: params.schedule,
      sessionId: params.sessionId,
      instruction: params.instruction,
      delivery: {
        sessionId: params.delivery?.sessionId,
        fallback: params.delivery?.fallback ?? 'last-active',
      },
      silent: params.silent ?? false,
      urgent: params.urgent ?? false,
      enabled: true,
      createdAt: Date.now(),
      createdInSession: params.createdInSession,
    };

    this.jobs.set(job.id, job);

    // [Phase 3] 如果任务启用则立即注册到 TaskBoard，由 TaskBoard 统一负责后续调度与执行。
    if (job.enabled) {
      this.registerJobToTaskBoard(job);
    }
    this.debouncePersist();

    logger.info(`任务已创建: ${job.name} (${job.id})`);
    return job;
  }

  /**
   * 更新已有任务的属性
   * @param id 任务 ID
   * @param params 要更新的字段
   * @returns 更新后的任务，不存在时返回 null
   */
  updateJob(id: string, params: UpdateJobParams): ScheduledJob | null {
    const job = this.jobs.get(id);
    if (!job) return null;

    // 逐字段合并
    if (params.name !== undefined) job.name = params.name;
    if (params.schedule !== undefined) job.schedule = params.schedule;
    if (params.instruction !== undefined) job.instruction = params.instruction;
    if (params.delivery !== undefined) {
      job.delivery = { ...job.delivery, ...params.delivery };
    }
    if (params.silent !== undefined) job.silent = params.silent;
    if (params.urgent !== undefined) job.urgent = params.urgent;

    // [Phase 3] 更新会改变后续调度/执行语义，因此先 kill 当前关联的 TaskBoard 任务，
    // 再按新配置重新注册，避免旧 executor 继续执行过期参数。
    if (job.currentTaskId) {
      this.taskBoard?.kill(job.currentTaskId);
      job.currentTaskId = undefined;
    }
    if (job.enabled) {
      this.registerJobToTaskBoard(job);
    }
    this.debouncePersist();

    logger.info(`任务已更新: ${job.name} (${id})`);
    return job;
  }

  /**
   * 删除任务
   * @param id 任务 ID
   * @returns 是否成功删除
   */
  deleteJob(id: string): boolean {
    const job = this.jobs.get(id);
    if (!job) return false;

    // [Phase 3] 删除任务时同步 kill 当前关联的 TaskBoard 任务，
    // 避免已经排进 TaskBoard 的调度继续触发已删除 job。
    if (job.currentTaskId) {
      this.taskBoard?.kill(job.currentTaskId);
    }
    this.jobs.delete(id);
    this.debouncePersist();

    logger.info(`任务已删除: ${job.name} (${id})`);
    return true;
  }

  /**
   * 启用任务
   * @param id 任务 ID
   * @returns 启用后的任务，不存在时返回 null，once 已过期时拒绝启用也返回 null
   */
  enableJob(id: string): ScheduledJob | null {
    const job = this.jobs.get(id);
    if (!job) return null;

    // 防止已过期的 once 任务被重新启用。
    // 过期的 once 任务不应再调度，直接拒绝。
    if (job.schedule.type === 'once' && job.schedule.at - Date.now() <= 0) {
      logger.warn(
        `拒绝启用已过期的一次性任务: ${job.name} (${id}), ` +
        `原定时间=${new Date(job.schedule.at).toISOString()}`
      );
      return null;
    }

    job.enabled = true;
    // [Phase 3] 重新启用时重新注册到 TaskBoard，恢复后续调度。
    if (job.currentTaskId) {
      this.taskBoard?.kill(job.currentTaskId);
    }
    this.registerJobToTaskBoard(job);
    this.debouncePersist();

    logger.info(`任务已启用: ${job.name} (${id})`);
    return job;
  }

  /**
   * 禁用任务
   * @param id 任务 ID
   * @returns 禁用后的任务，不存在时返回 null
   */
  disableJob(id: string): ScheduledJob | null {
    const job = this.jobs.get(id);
    if (!job) return null;

    job.enabled = false;
    // [Phase 3] 禁用时必须 kill 现有 TaskBoard 任务，
    // 否则已经排好的下一次触发仍会继续执行。
    if (job.currentTaskId) {
      this.taskBoard?.kill(job.currentTaskId);
      job.currentTaskId = undefined;
    }
    this.debouncePersist();

    logger.info(`任务已禁用: ${job.name} (${id})`);
    return job;
  }

  /** 按 ID 查询单个任务 */
  getJob(id: string): ScheduledJob | undefined {
    return this.jobs.get(id);
  }

  /** 返回所有任务的列表 */
  listJobs(): ScheduledJob[] {
    return Array.from(this.jobs.values());
  }

  /** 获取当前调度器配置 */
  getConfig(): SchedulerConfig {
    return this.config;
  }

  /**
   * 热更新调度器配置
   * 深合并传入的 partial 配置到当前配置。
   * @param newConfig 部分配置（会深合并到现有配置）
   */
  updateConfig(newConfig: Partial<SchedulerConfig>): void {
    if (newConfig.enabled !== undefined) {
      this.config.enabled = newConfig.enabled;
    }
    if (newConfig.quietHours) {
      this.config.quietHours = {
        ...this.config.quietHours,
        ...newConfig.quietHours,
      };
    }
    if (newConfig.skipIfRecentActivity) {
      this.config.skipIfRecentActivity = {
        ...this.config.skipIfRecentActivity,
        ...newConfig.skipIfRecentActivity,
      };
    }
    logger.info('调度器配置已热更新');
  }

  /**
   * 记录会话活跃时间
   * 由插件入口在 backend 'done' 事件中调用，供投递门控的 skipIfRecentActivity 使用。
   * @param sessionId 会话 ID
   */
  recordActivity(sessionId: string): void {
    this.lastActivityMap.set(sessionId, Date.now());
  }

  // ──────────── 调度与执行 ────────────

  /**
   * 启动时统一清理任务状态
   *
   * 在 start() 阶段调用，早于 scheduleNext()。
   * 职责：
   *   - 所有类型的 running 僵尸任务（进程崩溃残留） → 恢复为 error
   *   - 已有终态（success / error）的 once 任务 → 保留原状态，仅确保 enabled=false
   *   - 时间已过期且从未成功执行的 once 任务 → 标记 missed，禁用
   *   - 未过期的 once 任务 → 不做处理，交给 scheduleNext() 正常调度
   *
   * 这样 scheduleNext() 就可以保持纯粹的调度职责，不混入业务状态判断。
   */
  private reconcileJobsOnStartup(): void {
    let changed = false;

    for (const job of this.jobs.values()) {
      // 所有类型的僵尸 running 恢复：进程崩溃时任务还在 running，恢复为 error。
      // cron/interval 任务恢复后仍保持 enabled，下一轮正常调度；once 任务则禁用。
      if (job.lastRunStatus === 'running') {
        job.lastRunStatus = 'error';
        job.lastRunError = '进程重启前任务仍在执行中（僵尸任务恢复）';
        if (job.schedule.type === 'once') {
          job.enabled = false;
        }
        changed = true;
        logger.warn(`僵尸任务恢复: ${job.name} (${job.id}), type=${job.schedule.type}`);
        continue;
      }

      // 以下逻辑仅针对 once 类型
      if (job.schedule.type !== 'once') continue;

      const isExpired = job.schedule.at - Date.now() <= 0;

      // 已有终态（completed / error / missed），不再修改状态，仅确保禁用
      if (isExpired && (job.lastRunStatus === 'completed' || job.lastRunStatus === 'success' || job.lastRunStatus === 'error' || job.lastRunStatus === 'missed')) {
        if (job.enabled) {
          job.enabled = false;
          changed = true;
          logger.info(`一次性任务已完结，确保禁用: ${job.name} (${job.id}), status=${job.lastRunStatus}`);
        }
        continue;
      }

      // 情况 3：已过期但从未执行过（状态为空 / skipped 等），标记 missed 并禁用
      if (isExpired) {
        job.lastRunStatus = 'missed';
        job.lastRunAt = Date.now();
        job.enabled = false;
        changed = true;
        logger.warn(`一次性任务已过期，标记为 missed: ${job.name} (${job.id})`);
        continue;
      }

      // 情况 4：未过期 → 不做处理，交给 scheduleNext() 正常调度
    }

    if (changed) {
      this.debouncePersist();
    }
  }


  /**
   * [Phase 3] 把一个 ScheduledJob 注册到 TaskBoard 调度引擎。
   *
   * scheduler 只负责：
   * 1. 把 cron/interval/once 翻译成 TaskBoard 能理解的 ScheduleConfig
   * 2. 构造 executor 闭包，把原后台执行逻辑折叠进去
   * 3. 保存当前关联的 taskId，便于 update/disable/delete/stop 时精准 kill
   */
  private registerJobToTaskBoard(job: ScheduledJob): void {
    if (!this.taskBoard || !job.enabled || !this.running) return;

    const schedule = this.buildScheduleConfig(job);
    if (!schedule) {
      logger.warn(`任务未注册到 TaskBoard（无有效下次执行时间）: ${job.name} (${job.id})`);
      return;
    }

    const executor: TaskBoardExecutor = async (taskId, signal) => {
      return this.executeCronJob(job, taskId, signal);
    };

    // [Phase 3] 记录 executor → job 的关系，
    // 让 recurring 续调后产生的新 TaskBoard 任务也能回写 currentTaskId。
    this.executorJobMap.set(executor, job);

    // [TaskBoard 调度升级对齐] 计算“下一次执行时间”的回调由插件提供给 TaskBoard。
    const nextTimeResolver: TaskBoardNextTimeResolver | undefined =
      job.schedule.type === 'cron'
        ? (source) => {
            if (source.kind !== 'cron') return null;
            const next = new Cron(source.expression).nextRun();
            return next?.getTime() ?? null;
          }
        : undefined;

    const taskId = createCronTaskId();
    const targetSessionId = job.delivery.sessionId ?? job.sessionId;

    this.taskBoard.register({
      taskId,
      sourceAgent: this.agentName,
      sourceSessionId: targetSessionId,
      targetAgent: this.agentName,
      type: 'cron',
      description: `定时任务: ${job.name}`,
      silent: job.silent,
      // [Phase 3] 调度配置/执行器/续调解析器都交给 TaskBoard，
      // 让 scheduler 从“自己管定时器”退化为“注册任务薄壳”，字段名与核心保持一致。
      schedule,
      executor,
      nextTimeResolver,
    });

    job.currentTaskId = taskId;
    this.debouncePersist();
  }

  /**
   * [Phase 3] 把 cron 插件的调度配置转换成 TaskBoard 的 ScheduleConfig。
   *
   * TaskBoard 不理解 cron 表达式，所以这里提前计算 nextRunAt；
   * 后续 recurring 的续调再通过 nextRunResolver 完成。
   */
  private buildScheduleConfig(job: ScheduledJob): TaskBoardScheduleConfig | null {
    switch (job.schedule.type) {
      case 'cron': {
        const next = new Cron(job.schedule.expression).nextRun();
        if (!next) return null;
        return {
          type: 'recurring',
          nextRunAt: next.getTime(),
          source: { kind: 'cron', expression: job.schedule.expression },
        };
      }
      case 'interval':
        return {
          type: 'recurring',
          nextRunAt: Date.now() + job.schedule.ms,
          source: { kind: 'interval', intervalMs: job.schedule.ms },
        };
      case 'once': {
        const delayMs = job.schedule.at - Date.now();
        if (delayMs <= 0) return null;
        return { type: 'once', runAt: job.schedule.at };
      }
    }
  }

  /**
   * [Phase 3] executor 闭包调用的核心执行逻辑。
   *
   * 这里保留原 scheduler 的业务行为：投递门控、并发检查、
   * ToolLoop 构建、LLM 调用、执行记录保存、状态更新。
   * 区别只是“什么时候触发、下一次怎么排”已经交给 TaskBoard。
   */
  private async executeCronJob(job: ScheduledJob, taskId: string, signal: AbortSignal): Promise<string | void> {
    const currentJob = this.jobs.get(job.id) ?? job;

    // [Phase 3] 如果任务在等待期间被禁用/删除，TaskBoard 可能仍尝试触发 executor；
    // 这里再做一次运行时守卫，保证不会执行已失效 job。
    if (!currentJob.enabled) {
      logger.info(`任务已禁用，跳过执行: ${currentJob.name} (${currentJob.id})`);
      return;
    }

    const decision = shouldSkip(currentJob, this.config, this.lastActivityMap);
    if (decision.skip) {
      currentJob.lastRunAt = Date.now();
      currentJob.lastRunStatus = 'skipped';
      if (currentJob.schedule.type === 'once') {
        currentJob.enabled = false;
      }
      currentJob.currentTaskId = undefined;
      logger.info(`任务被跳过: ${currentJob.name} — ${decision.reason}`);
      this.debouncePersist();
      return;
    }

    const cronRunning = this.taskBoard
      ? this.taskBoard.getRunningByTargetAgent(this.agentName)
        .filter((task) => task.type === 'cron' && task.taskId !== taskId)
      : [];
    if (cronRunning.length >= this.backgroundConfig.maxConcurrent) {
      currentJob.lastRunAt = Date.now();
      currentJob.lastRunStatus = 'skipped';
      currentJob.lastRunError = `并发后台任务数已达上限 (${this.backgroundConfig.maxConcurrent})`;
      if (currentJob.schedule.type === 'once') {
        currentJob.enabled = false;
      }
      currentJob.currentTaskId = undefined;
      logger.warn(`任务被跳过（并发上限）: ${currentJob.name}`);
      this.debouncePersist();
      return;
    }

    currentJob.lastRunAt = Date.now();
    currentJob.lastRunStatus = 'running';
    currentJob.lastRunError = undefined;
    if (currentJob.schedule.type === 'once') {
      currentJob.enabled = false;
    }
    currentJob.currentTaskId = taskId;
    this.debouncePersist();

    await this.runCronJobInBackground(currentJob, taskId, signal);
  }

  // ──────────── 后台执行 ────────────

  /**
   * 在后台独立执行一个定时任务（fire-and-forget）
   *
   * [cron 重构] 使用 taskBoard 替代 agentTaskRegistry，删除 silent prompt 注入和 fireCronResult 调用。
   * 核心流程：
   * 1. 通过 IrisAPI.createToolLoop 创建独立的 ToolLoop（定时任务专用系统提示词 + 过滤后的工具集）
   * 2. 构建流式 LLMCaller（回调指向 taskBoard）
   * 3. 执行 ToolLoop.run()
   * 4. 保存执行记录
   * （通知路由由 taskBoard.complete/fail 内部自动处理）
   */
  private async runCronJobInBackground(
    job: ScheduledJob,
    taskId: string,
    signal?: AbortSignal,
  ): Promise<void> {
    const startTime = Date.now();
    const board = this.taskBoard!;

    // 设置执行超时：超时后通过 AbortController 中止 ToolLoop
    const timeoutHandle = setTimeout(() => {
      board.kill(taskId);
      logger.warn(`后台任务超时 (${this.backgroundConfig.timeoutMs}ms): ${job.name}`);
    }, this.backgroundConfig.timeoutMs);
    // 超时定时器不应阻止进程退出
    if (timeoutHandle.unref) timeoutHandle.unref();

    try {
      // ---- 构建工具集：按配置排除不适用的工具 ----
      const cronTools = this.backgroundConfig.excludeTools.length > 0
        ? (this.api.tools.createFiltered?.(this.backgroundConfig.excludeTools) ?? this.api.tools)
        : this.api.tools;

      // ---- 构建系统提示词 ----
      const systemPrompt = this.backgroundConfig.systemPrompt;

      // ---- 通过 IrisAPI.createToolLoop 创建 ToolLoop 实例 ----
      // 使用核心 ToolLoop 替代手写简化版循环，获得完整的重试、abort 清理、钩子支持
      // IrisAPI 已声明 createToolLoop?()，直接使用类型安全的调用
      if (typeof this.api.createToolLoop !== 'function') {
        throw new Error('IrisAPI.createToolLoop 不可用，无法执行后台任务');
      }
      const toolLoop = this.api.createToolLoop({
        tools: cronTools,
        systemPrompt,
        maxRounds: this.backgroundConfig.maxToolRounds,
      });

      // ---- 构建 LLMCaller：流式调用，回调指向 taskBoard 以驱动心跳和 token 计数 ----
      // LLMRouterLike 已声明 chat?() 和 chatStream?()，直接使用类型安全的调用
      const router = this.api.router;
      const callLLM = async (request: any, modelName?: string, sig?: AbortSignal) => {
        if (router.chatStream) {
          const parts: any[] = [];
          let usageMetadata: any;
          for await (const chunk of router.chatStream(request, modelName, sig)) {
            board.emitChunkHeartbeat(taskId);
            if (chunk.partsDelta && chunk.partsDelta.length > 0) {
              for (const part of chunk.partsDelta) {
                parts.push(part);
              }
            } else {
              if (chunk.textDelta) parts.push({ text: chunk.textDelta });
              if (chunk.functionCalls) {
                for (const fc of chunk.functionCalls) parts.push(fc);
              }
            }
            if (chunk.usageMetadata) {
              usageMetadata = chunk.usageMetadata;
              const tokens = usageMetadata.totalTokenCount ?? usageMetadata.candidatesTokenCount ?? 0;
              if (tokens > 0) {
                board.updateTokens(taskId, tokens);
              }
            }
          }
          if (parts.length === 0) parts.push({ text: '' });
          const content: any = { role: 'model', parts, createdAt: Date.now() };
          if (usageMetadata) content.usageMetadata = usageMetadata;
          return content;
        }
        // 回退到非流式调用
        if (!router.chat) {
          throw new Error('LLMRouter 既不支持 chatStream 也不支持 chat，无法调用 LLM');
        }
        const response = await router.chat(request, modelName, sig);
        return response.content;
      };

      // ---- 构建用户消息并执行 ToolLoop ----
      const history: any[] = [];
      // [cron 重构] 不再拼接 silent 的 [no-report] 指示，直接使用原始 instruction
      const userInstruction = job.instruction;
      history.push({ role: 'user', parts: [{ text: userInstruction }] });

      // 调用核心 ToolLoop.run()
      const result = await toolLoop.run(history, callLLM, { signal });

      const endTime = Date.now();
      const durationMs = endTime - startTime;
      const finalText = result.text ?? '';
      const loopError = result.error;

      // ---- 处理结果 ----

      if (result.aborted) {
        // 被中止
        board.kill(taskId);
        job.lastRunStatus = 'error';
        job.lastRunError = '后台任务被中止';
        this.saveRunRecord({
          runId: taskId, jobId: job.id, jobName: job.name,
          instruction: job.instruction, startTime, endTime,
          durationMs, status: 'killed',
        });
        // [cron 重构] 删除 fireCronResult 调用——通知路由由 taskBoard.kill() 内部自动处理
        logger.info(`后台任务被中止: ${job.name} (taskId=${taskId})`);

      } else if (loopError) {
        // 执行失败
        board.fail(taskId, loopError);
        job.lastRunStatus = 'error';
        job.lastRunError = loopError;
        this.saveRunRecord({
          runId: taskId, jobId: job.id, jobName: job.name,
          instruction: job.instruction, startTime, endTime,
          durationMs, status: 'failed', error: loopError,
        });
        // [cron 重构] 删除 fireCronResult 调用
        logger.error(`后台任务失败: ${job.name} (taskId=${taskId}), error="${loopError}"`);

      } else {
        // [cron 重构] 成功：直接调用 board.complete()，
        // silent 模式的通知控制已由 TaskBoard 内部的 silent 标记处理。
        board.complete(taskId, finalText);
        job.lastRunStatus = 'completed';
        job.lastRunError = undefined;
        this.saveRunRecord({
          runId: taskId, jobId: job.id, jobName: job.name,
          instruction: job.instruction, startTime, endTime,
          durationMs, status: 'completed', resultText: finalText,
        });

        logger.info(`后台任务完成: ${job.name} (taskId=${taskId}), duration=${durationMs}ms`);
      }

    } catch (err) {
      // 意外错误捕获（防御性编码）
      const endTime = Date.now();
      const durationMs = endTime - startTime;
      const errorMsg = err instanceof Error ? err.message : String(err);
      board.fail(taskId, errorMsg);
      job.lastRunStatus = 'error';
      job.lastRunError = errorMsg;
      this.saveRunRecord({
        runId: taskId, jobId: job.id, jobName: job.name,
        instruction: job.instruction, startTime, endTime,
        durationMs, status: 'failed', error: errorMsg,
      });
      // [cron 重构] 删除 fireCronResult 调用
      logger.error(`后台任务异常: ${job.name} (taskId=${taskId}), error="${errorMsg}"`);
    } finally {
      job.currentTaskId = undefined;
      clearTimeout(timeoutHandle);
      this.debouncePersist();
      this.cleanupOldRuns();
    }
  }

  // ──────────── 执行记录持久化 ────────────

  /**
   * 保存一条执行记录到 cron-runs/ 目录
   *
   * 文件名格式：<jobId>_<timestamp>.json
   */
  private saveRunRecord(record: CronRunRecord): void {
    try {
      if (!fs.existsSync(this.runsDir)) {
        fs.mkdirSync(this.runsDir, { recursive: true });
      }
      const filename = `${record.jobId}_${record.startTime}.json`;
      const filePath = path.join(this.runsDir, filename);
      fs.writeFileSync(filePath, JSON.stringify(record, null, 2), 'utf-8');
    } catch (err) {
      logger.warn(`保存执行记录失败: ${err}`);
    }
  }

  /**
   * 清理过期的执行记录
   *
   * 清理策略：超过 retentionDays 或总数超过 retentionCount 的记录被删除。
   */
  private cleanupOldRuns(): void {
    try {
      if (!fs.existsSync(this.runsDir)) return;

      const files = fs.readdirSync(this.runsDir)
        .filter(f => f.endsWith('.json'))
        .sort(); // 按文件名（含时间戳）排序

      const now = Date.now();
      const retentionMs = this.backgroundConfig.retentionDays * 24 * 60 * 60 * 1000;
      let deleted = 0;

      // 先按时间清理
      for (const file of files) {
        // 从文件名提取时间戳：<jobId>_<timestamp>.json
        const match = file.match(/_([\d]+)\.json$/);
        if (match) {
          const timestamp = parseInt(match[1], 10);
          if (now - timestamp > retentionMs) {
            try {
              fs.unlinkSync(path.join(this.runsDir, file));
              deleted++;
            } catch { /* 忽略单文件删除失败 */ }
          }
        }
      }

      // 再按数量清理（删除最早的）
      const remaining = fs.readdirSync(this.runsDir)
        .filter(f => f.endsWith('.json'))
        .sort();
      if (remaining.length > this.backgroundConfig.retentionCount) {
        const toDelete = remaining.slice(0, remaining.length - this.backgroundConfig.retentionCount);
        for (const file of toDelete) {
          try {
            fs.unlinkSync(path.join(this.runsDir, file));
            deleted++;
          } catch { /* 忽略 */ }
        }
      }

      if (deleted > 0) {
        logger.info(`清理了 ${deleted} 条过期执行记录`);
      }
    } catch (err) {
      logger.warn(`清理执行记录失败: ${err}`);
    }
  }

  /**
   * 获取执行记录列表（按时间倒序）
   *
   * 供 Web API 端点调用。
   */
  listRuns(limit: number = 50): CronRunRecord[] {
    try {
      if (!fs.existsSync(this.runsDir)) return [];

      const files = fs.readdirSync(this.runsDir)
        .filter(f => f.endsWith('.json'))
        .sort()
        .reverse() // 最新的在前
        .slice(0, limit);

      const records: CronRunRecord[] = [];
      for (const file of files) {
        try {
          const raw = fs.readFileSync(path.join(this.runsDir, file), 'utf-8');
          records.push(JSON.parse(raw));
        } catch { /* 忽略解析失败的文件 */ }
      }
      return records;
    } catch {
      return [];
    }
  }

  /**
   * 获取单条执行记录
   *
   * @param runId 执行记录 ID（即 taskId）
   */
  getRunRecord(runId: string): CronRunRecord | null {
    try {
      if (!fs.existsSync(this.runsDir)) return null;

      // 遍历查找包含该 runId 的记录文件
      const files = fs.readdirSync(this.runsDir).filter(f => f.endsWith('.json'));
      for (const file of files) {
        try {
          const raw = fs.readFileSync(path.join(this.runsDir, file), 'utf-8');
          const record: CronRunRecord = JSON.parse(raw);
          if (record.runId === runId) return record;
        } catch { /* 忽略 */ }
      }
      return null;
    } catch {
      return null;
    }
  }



  // ──────────── 持久化 ────────────

  /**
   * 防抖持久化：500ms 内的多次调用合并为一次实际写入
   */
  private debouncePersist(): void {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
    }
    this.persistTimer = setTimeout(() => {
      this.persistSync();
      this.persistTimer = null;
    }, 500);
  }

  /**
   * 同步写入持久化文件
   * 将内存中的 jobs Map 序列化为 JSON 写入 cron-jobs.json
   *
   * 写入前检查文件是否被外部修改过（mtime 比较）。
   * 如果检测到外部修改，先调用 onFileChanged() 同步外部变更到内存，再写入。
   */
  private persistSync(): void {
    try {
      // 确保目录存在
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // 写入前检测外部修改：如果文件的 mtime 比我们上次记录的更新，
      // 说明有外部编辑（用户手动修改、其他进程写入等）。
      // 必须先同步外部变更到内存，否则盲写会覆盖外部修改。
      if (fs.existsSync(this.filePath)) {
        try {
          const stat = fs.statSync(this.filePath);
          if (stat.mtimeMs > this.lastFileModTime) {
            this.onFileChanged();
          }
        } catch { /* stat 失败时跳过检测，继续写入 */ }
      }

      const data = JSON.stringify(Array.from(this.jobs.values()), null, 2);
      fs.writeFileSync(this.filePath, data, 'utf-8');

      // 记录写入后的修改时间，避免 fs.watchFile 自触发
      try {
        const stat = fs.statSync(this.filePath);
        this.lastFileModTime = stat.mtimeMs;
      } catch {
        // 忽略 stat 失败
      }
    } catch (err) {
      logger.error(`持久化写入失败: ${err}`);
    }
  }

  /**
   * 从持久化文件加载任务到内存
   * 文件不存在或解析失败时静默跳过。
   */
  private loadFromFile(): void {
    try {
      if (!fs.existsSync(this.filePath)) {
        logger.info('持久化文件不存在，从空白状态启动');
        return;
      }

      const raw = fs.readFileSync(this.filePath, 'utf-8');
      const parsed: ScheduledJob[] = JSON.parse(raw);

      for (const job of parsed) {
        job.lastRunStatus = normalizeRunStatus(job.lastRunStatus);
        this.jobs.set(job.id, job);
      }

      // 记录当前文件修改时间
      try {
        const stat = fs.statSync(this.filePath);
        this.lastFileModTime = stat.mtimeMs;
      } catch {
        // 忽略
      }

      logger.info(`从文件恢复了 ${parsed.length} 个任务`);
    } catch (err) {
      logger.error(`从文件加载任务失败: ${err}`);
    }
  }

  // ──────────── 文件监听 ────────────

  /**
   * 启动 fs.watchFile 文件轮询监听（间隔 2 秒）
   * 检测到外部修改时调用 onFileChanged 进行增量同步。
   */
  private startFileWatcher(): void {
    try {
      fs.watchFile(this.filePath, { interval: 2000 }, (curr) => {
        // 仅当文件修改时间晚于上次已知时间时才触发同步
        if (curr.mtimeMs > this.lastFileModTime) {
          this.onFileChanged();
        }
      });
      this.fileWatcherActive = true;
    } catch (err) {
      logger.warn(`启动文件监听失败: ${err}`);
    }
  }

  /** 停止文件监听 */
  private stopFileWatcher(): void {
    if (this.fileWatcherActive) {
      try {
        fs.unwatchFile(this.filePath);
      } catch {
        // 忽略
      }
      this.fileWatcherActive = false;
    }
  }

  /**
   * 文件变更回调：读取文件内容，与内存做 diff，增量同步
   *
   * 处理三种情况：
   * - 文件中有而内存中没有的任务 → 新增
   * - 文件中有且内容不同的任务 → 更新
   * - 内存中有而文件中没有的任务 → 删除
   */
  private shouldRescheduleAfterFileSync(existing: ScheduledJob, incoming: ScheduledJob): boolean {
    // 文件同步时，只有“调度相关字段”变化才应该清定时器并重新排程。
    // lastRunStatus / lastRunAt / lastRunError 属于运行时状态，它们变化时如果也重排定时器，
    // 会把同一次执行重新排出一个新 timer，进而造成重复触发。
    return (
      existing.enabled !== incoming.enabled
      || JSON.stringify(existing.schedule) !== JSON.stringify(incoming.schedule)
    );
  }

  private syncJobInPlace(target: ScheduledJob, source: ScheduledJob): void {
    // 不直接替换 Map 里的对象，而是原地同步。
    // 原因：定时器回调、后台执行流程、以及其他引用都可能还持有这个对象。
    // 如果直接 this.jobs.set(id, source)，旧引用上的 running 状态就与新对象脱节，
    // 最终会出现“一个任务被不同对象各自执行一遍”的并发错误。

    // 先删除 source 中已经不存在的可选字段，避免旧错误信息残留。
    for (const key of Object.keys(target) as Array<keyof ScheduledJob>) {
      if (!(key in source)) {
        delete (target as unknown as Record<string, unknown>)[key as string];
      }
    }

    Object.assign(target, source);
  }

  private onFileChanged(): void {
    try {
      if (!fs.existsSync(this.filePath)) return;

      const raw = fs.readFileSync(this.filePath, 'utf-8');
      const parsed: ScheduledJob[] = JSON.parse(raw);

      for (const job of parsed) {
        job.lastRunStatus = normalizeRunStatus(job.lastRunStatus);
      }

      // 更新已知修改时间
      try {
        const stat = fs.statSync(this.filePath);
        this.lastFileModTime = stat.mtimeMs;
      } catch {
        // 忽略
      }

      const newIds = new Set(parsed.map((j) => j.id));
      const currentIds = new Set(this.jobs.keys());

      // 删除：内存中有但文件中没有的任务
      for (const id of currentIds) {
        if (!newIds.has(id)) {
          const existing = this.jobs.get(id);
          // [Phase 3] 文件同步删除任务时同步 kill TaskBoard 里的当前任务，
          // 避免已经排好的执行继续落到内存中已不存在的 job 上。
          if (existing?.currentTaskId) {
            this.taskBoard?.kill(existing.currentTaskId);
          }
          this.jobs.delete(id);
          logger.info(`文件同步: 删除任务 ${id}`);
        }
      }

      // 新增或更新
      for (const job of parsed) {
        const existing = this.jobs.get(job.id);
        if (!existing) {
          // 新增
          this.jobs.set(job.id, job);
          if (job.enabled) this.registerJobToTaskBoard(job);
          logger.info(`文件同步: 新增任务 ${job.name} (${job.id})`);
        } else {
          // 对比序列化后的字符串来检测是否有变化
          const shouldReschedule = this.shouldRescheduleAfterFileSync(existing, job);
          const existingStr = JSON.stringify(existing);
          const newStr = JSON.stringify(job);
          if (existingStr !== newStr) {
            // 原地同步，保持所有闭包和执行路径都指向同一个权威对象。
            this.syncJobInPlace(existing, job);

            // 只有调度相关字段变化时才重排定时器。
            if (shouldReschedule) {
              // [Phase 3] 文件同步触发调度变更时，通过 kill + 重新注册切换到新配置。
              if (existing.currentTaskId) {
                this.taskBoard?.kill(existing.currentTaskId);
                existing.currentTaskId = undefined;
              }
              if (existing.enabled && this.running) {
                this.registerJobToTaskBoard(existing);
              }
            }
            logger.info(`文件同步: 更新任务 ${job.name} (${job.id})`);
          }
        }
      }

      logger.info(`文件同步完成，当前共 ${this.jobs.size} 个任务`);
    } catch (err) {
      logger.error(`文件同步失败: ${err}`);
    }
  }
}
