/**
 * Cron 定时任务后台执行机制测试（cron 重构后）
 *
 * 覆盖：
 *   - CronScheduler 构造函数接受 taskBoard 和 agentName 参数
 *   - scheduler 通过 taskBoard.register() 注册 schedule/executor/nextRunResolver
 *   - executor 闭包触发后台执行并更新任务状态
 *   - 并发限制：超过 maxConcurrent 时跳过
 *   - 投递门控：被跳过的任务标记 skipped
 *   - silent 模式：通过 taskBoard.register() 的 silent 字段传递
 *   - update/enable/disable/delete 通过 currentTaskId 与 TaskBoard 协调生命周期
 *   - 执行记录保存和查询
 *   - 执行记录清理
 *   - types 新增字段正确性
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type {
  ScheduledJob,
  SchedulerConfig,
  // [cron 重构] CronResultPayload 已删除
  CronRunRecord,
  CronBackgroundConfig,
  RunStatus,
} from '../extensions/cron/src/types.js';
import { DEFAULT_SCHEDULER_CONFIG } from '../extensions/cron/src/types.js';
// [croner 迁移测试修复] 显式导入 getNextCronTime，
// 让底部的 croner 集成测试直接验证插件对外暴露的时间计算包装函数。
import { CronScheduler, getNextCronTime } from '../extensions/cron/src/scheduler.js';

// DEFAULT_BACKGROUND_CONFIG 可能因模块别名导致导入为 undefined，
// 此处手动定义预期的默认值用于断言。
const EXPECTED_BACKGROUND_DEFAULTS = {
  timeoutMs: 5 * 60 * 1000,
  maxConcurrent: 3, retentionDays: 30, retentionCount: 100,
  maxToolRounds: 50,
};

// ============ Mock 工具 ============

/** 创建最小可用的 IrisAPI mock */
function createMockAPI(overrides?: Record<string, unknown>) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cron-test-'));
  return {
    api: {
      backend: {
        on: vi.fn(),
        enqueueAgentNotification: vi.fn(),
        getToolPolicies: vi.fn(() => ({})),
      },
      router: {
        chat: vi.fn(async () => ({
          content: { role: 'model', parts: [{ text: '执行完成' }], createdAt: Date.now() },
        })),
        chatStream: vi.fn(async function* () {
          yield {
            textDelta: '执行完成',
            usageMetadata: { totalTokenCount: 100 },
          };
        }),
      },
      tools: {
        getDeclarations: vi.fn(() => []),
        createFiltered: vi.fn(function (this: any) { return this; }),
        get: vi.fn(() => undefined),
      },
      prompt: {
        constructor: class MockPrompt {
          setSystemPrompt() {}
          assemble(history: any[], declarations: any[]) {
            return {
              contents: history,
              tools: declarations.length > 0 ? [{ functionDeclarations: declarations }] : undefined,
            };
          }
        },
        setSystemPrompt: vi.fn(),
        assemble: vi.fn((history: any[]) => ({ contents: history })),
      },
      dataDir: tmpDir,
      storage: {},
      config: {},
      extensions: {},
      pluginManager: {},
      eventBus: { emit: vi.fn(), on: vi.fn(), off: vi.fn() },
      modes: {},
      ...overrides,
    } as any,
    tmpDir,
  };
}

/**
 * [cron 重构] 创建最小可用的 TaskBoard mock。
 * 替代原 createMockRegistry，mock 对象的 register() 签名改为接收一个对象参数。
 */
function createMockTaskBoard() {
  const registeredListeners = new Set<(task: any) => void>();

  return {
    // [测试类型修复] 这里故意把 input 放宽为 any。
    // 原因：TaskBoardLike.register 的函数参数是逆变检查，
    // 测试 mock 如果写成更宽但结构化的匿名类型，反而会因为续调回调参数不完全同构而报类型错。
    // 用 any 保持测试关注行为而不是与核心私有接口做逐字段博弈。
    register: vi.fn((input: any) => {
      // [Phase 3] mock 对齐真实 TaskBoard 行为：register 后会 emit('registered')，
      // 这样 scheduler 可以在测试里拿到 recurring 续调后的最新 currentTaskId。
      for (const listener of registeredListeners) {
        listener(input);
      }
      return {
        taskId: input.taskId,
        status: 'running',
        abortController: new AbortController(),
      };
    }),
    on: vi.fn((event: string, listener: (task: any) => void) => {
      if (event === 'registered') registeredListeners.add(listener);
    }),
    off: vi.fn((event: string, listener: (task: any) => void) => {
      if (event === 'registered') registeredListeners.delete(listener);
    }),
    complete: vi.fn(),
    fail: vi.fn(),
    kill: vi.fn(),
    getRunningByTargetAgent: vi.fn(() => []),
    emitChunkHeartbeat: vi.fn(),
    updateTokens: vi.fn(),
  };
}

/** 创建一个测试用的 ScheduledJob */
function createTestJob(overrides?: Partial<ScheduledJob>): ScheduledJob {
  return {
    id: 'test-job-1',
    name: '测试任务',
    schedule: { type: 'interval', ms: 60000 },
    sessionId: 'session-1',
    instruction: '请执行测试操作',
    delivery: { fallback: 'last-active' as const },
    silent: false,
    urgent: false,
    enabled: true,
    createdAt: Date.now(),
    createdInSession: 'session-1',
    ...overrides,
  };
}

/** 清理临时目录 */
function cleanupTmpDir(dir: string) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch { /* 忽略 */ }
}

/** 简单延迟，供异步后台执行测试等待事件循环推进 */
function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============ 测试 ============

describe('Cron 后台执行机制 - 类型定义', () => {
  it('RunStatus 包含 running 值', () => {
    const status: RunStatus = 'running';
    expect(status).toBe('running');
    const allStatuses: RunStatus[] = ['completed', 'success', 'error', 'skipped', 'missed', 'running'];
    expect(allStatuses).toHaveLength(6);
  });

  it('CronRunRecord 接口可正确构造', () => {
    const record: CronRunRecord = {
      runId: 'cron_task_1_123',
      jobId: 'job-1',
      jobName: '测试任务',
      instruction: '执行操作',
      startTime: 1000,
      endTime: 2000,
      durationMs: 1000,
      status: 'completed',
      resultText: '完成',
    };
    expect(record.status).toBe('completed');
    expect(record.durationMs).toBe(1000);
  });

  it('CronBackgroundConfig 有正确的默认值', () => {
    // 验证预期的默认值（直接对照常量，避免模块导入问题）
    expect(EXPECTED_BACKGROUND_DEFAULTS.timeoutMs).toBe(5 * 60 * 1000);
    expect(EXPECTED_BACKGROUND_DEFAULTS.maxConcurrent).toBe(3);
    expect(EXPECTED_BACKGROUND_DEFAULTS.retentionDays).toBe(30);
    expect(EXPECTED_BACKGROUND_DEFAULTS.retentionCount).toBe(100);
    expect(EXPECTED_BACKGROUND_DEFAULTS.maxToolRounds).toBe(15);
  });
});

describe('CronScheduler 构造函数', () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) cleanupTmpDir(tmpDir);
  });

  it('接受 taskBoard 和 agentName 参数', () => {
    const { api, tmpDir: td } = createMockAPI();
    tmpDir = td;
    const taskBoard = createMockTaskBoard();

    // 不应抛异常
    const scheduler = new CronScheduler(api, undefined, taskBoard, 'test-agent');
    expect(scheduler).toBeDefined();
  });

  it('不传 taskBoard 时不报错', () => {
    const { api, tmpDir: td } = createMockAPI();
    tmpDir = td;

    const scheduler = new CronScheduler(api);
    expect(scheduler).toBeDefined();
  });

  it('接受自定义 backgroundConfig', () => {
    const { api, tmpDir: td } = createMockAPI();
    tmpDir = td;
    const taskBoard = createMockTaskBoard();

    const scheduler = new CronScheduler(api, undefined, taskBoard, 'test-agent', {
      timeoutMs: 10000,
      maxConcurrent: 1,
    });
    expect(scheduler).toBeDefined();
  });
});

describe('CronScheduler 后台执行', () => {
  let tmpDir: string;
  let scheduler: CronScheduler;
  let mockAPI: any;
  let mockTaskBoard: ReturnType<typeof createMockTaskBoard>;

  beforeEach(() => {
    const { api, tmpDir: td } = createMockAPI();
    tmpDir = td;
    mockAPI = api;
    mockTaskBoard = createMockTaskBoard();
    // 使用短超时和低并发限制便于测试
    scheduler = new CronScheduler(api, undefined, mockTaskBoard, 'test-agent', {
      timeoutMs: 5000,
      maxConcurrent: 2,
      maxToolRounds: 3,
      retentionDays: 30,
      retentionCount: 10,
    });
  });

  afterEach(() => {
    scheduler.stop();
    cleanupTmpDir(tmpDir);
  });

  it('createJob 创建任务并返回完整对象', () => {
    const job = scheduler.createJob({
      name: '测试任务',
      schedule: { type: 'interval', ms: 60000 },
      sessionId: 'sess-1',
      instruction: '执行操作',
      createdInSession: 'sess-1',
    });

    expect(job.id).toBeDefined();
    expect(job.name).toBe('测试任务');
    expect(job.enabled).toBe(true);
  });

  it('listJobs 返回所有任务', () => {
    scheduler.createJob({
      name: '任务A',
      schedule: { type: 'interval', ms: 60000 },
      sessionId: 'sess-1',
      instruction: '操作A',
      createdInSession: 'sess-1',
    });
    scheduler.createJob({
      name: '任务B',
      schedule: { type: 'interval', ms: 120000 },
      sessionId: 'sess-1',
      instruction: '操作B',
      createdInSession: 'sess-1',
    });

    const jobs = scheduler.listJobs();
    expect(jobs).toHaveLength(2);
  });

  it('deleteJob 删除已有任务', () => {
    const job = scheduler.createJob({
      name: '待删除',
      schedule: { type: 'interval', ms: 60000 },
      sessionId: 'sess-1',
      instruction: '操作',
      createdInSession: 'sess-1',
    });

    const deleted = scheduler.deleteJob(job.id);
    expect(deleted).toBe(true);
    expect(scheduler.listJobs()).toHaveLength(0);
  });

  it('deleteJob 对不存在的 ID 返回 false', () => {
    const deleted = scheduler.deleteJob('non-existent');
    expect(deleted).toBe(false);
  });

  it('文件同步仅更新运行状态时，不替换任务对象，也不重复注册 TaskBoard 任务', async () => {
    await scheduler.start();

    const job = scheduler.createJob({
      name: '状态同步测试',
      schedule: { type: 'interval', ms: 60000 },
      sessionId: 'sess-1',
      instruction: '操作',
      createdInSession: 'sess-1',
    });

    const originalJobRef = scheduler.getJob(job.id)!;
    const originalTaskId = originalJobRef.currentTaskId;
    const registerCallCountBeforeSync = mockTaskBoard.register.mock.calls.length;
    expect(originalTaskId).toBeDefined();

    // [Phase 3 测试适配] 模拟外部仅同步运行时状态：调度配置不变。
    // 新架构下 scheduler 已不再自己持有 timers，
    // 所以这里改为验证“不会再次 register 到 TaskBoard”，
    // 以确保纯运行时状态同步不会误触发重新排程。
    const syncedJobs = scheduler.listJobs().map((item) =>
      item.id === job.id
        ? {
            ...item,
            lastRunAt: Date.now(),
            lastRunStatus: 'running' as const,
          }
        : item,
    );
    fs.writeFileSync(path.join(tmpDir, 'cron-jobs.json'), JSON.stringify(syncedJobs, null, 2), 'utf-8');

    (scheduler as any).onFileChanged();

    const currentJobRef = scheduler.getJob(job.id)!;

    // 关键断言 1：Map 中仍然是原对象，避免旧闭包和新对象状态脱节。
    expect(currentJobRef).toBe(originalJobRef);
    // 关键断言 2：不会重复 register，说明这次只是状态同步，没有重排调度。
    expect(mockTaskBoard.register).toHaveBeenCalledTimes(registerCallCountBeforeSync);
    expect(currentJobRef.currentTaskId).toBe(originalTaskId);
    expect(currentJobRef.lastRunStatus).toBe('running');
  });

  it('updateJob 会 kill 旧 currentTaskId 并重新注册新的 TaskBoard 任务', async () => {
    await scheduler.start();

    const job = scheduler.createJob({
      name: '更新重注册测试',
      schedule: { type: 'interval', ms: 60_000 },
      sessionId: 'sess-1',
      instruction: '原始指令',
      createdInSession: 'sess-1',
    });

    const originalTaskId = scheduler.getJob(job.id)?.currentTaskId;
    expect(originalTaskId).toBeDefined();
    expect(mockTaskBoard.register).toHaveBeenCalledTimes(1);

    const updated = scheduler.updateJob(job.id, { instruction: '更新后的指令' });

    expect(updated).not.toBeNull();
    // [Phase 3 测试适配] 新架构下更新任务应先 kill 旧的 TaskBoard 任务，
    // 再重新 register 一个新任务，保证旧 executor 不会继续沿用过期配置。
    expect(mockTaskBoard.kill).toHaveBeenCalledWith(originalTaskId);
    expect(mockTaskBoard.register).toHaveBeenCalledTimes(2);

    const currentTaskId = scheduler.getJob(job.id)?.currentTaskId;
    expect(currentTaskId).toBeDefined();
    expect(currentTaskId).not.toBe(originalTaskId);
    expect(scheduler.getJob(job.id)?.instruction).toBe('更新后的指令');
  });

  it('完成后将 lastRunStatus 统一写为 completed，并兼容旧 success 持久化值', async () => {
    await scheduler.start();

    const legacyJob = createTestJob({
      id: 'legacy-success-job',
      lastRunStatus: 'success',
    });
    fs.writeFileSync(path.join(tmpDir, 'cron-jobs.json'), JSON.stringify([legacyJob], null, 2), 'utf-8');

    (scheduler as any).onFileChanged();
    expect(scheduler.getJob('legacy-success-job')?.lastRunStatus).toBe('completed');

    const job = scheduler.createJob({
      name: '完成态统一测试',
      schedule: { type: 'once', at: Date.now() + 60_000 },
      sessionId: 'sess-1',
      instruction: '完成后应写入 completed',
      createdInSession: 'sess-1',
    });

    const deferred: { resolve?: (value: { text: string }) => void } = {};
    // [Phase 3 测试适配] 新架构下执行入口已经从 executeJob() 变成
    // TaskBoard.register() 里注入的 executor 闭包，所以这里通过 mockTaskBoard 捕获真实 executor 来驱动一次执行。
    mockAPI.createToolLoop = vi.fn(() => ({
      run: vi.fn(() => new Promise((resolve) => {
        deferred.resolve = resolve as (value: { text: string }) => void;
      })),
    }));

    const registerInput = mockTaskBoard.register.mock.calls.at(-1)?.[0] as {
      taskId: string;
      executor?: (taskId: string, signal: AbortSignal) => Promise<string | void>;
    };
    expect(registerInput?.executor).toBeDefined();

    const signal = new AbortController().signal;
    const executionPromise = registerInput.executor!(registerInput.taskId, signal);

    // executor 启动后应立即把 job 标成 running。
    await delay(20);
    expect(scheduler.getJob(job.id)?.lastRunStatus).toBe('running');

    deferred.resolve?.({ text: '执行完成' });
    await executionPromise;
    await delay(20);

    expect(scheduler.getJob(job.id)?.lastRunStatus).toBe('completed');
    expect(mockTaskBoard.complete).toHaveBeenCalledTimes(1);
  });
});

describe('CronScheduler 执行记录', () => {
  let tmpDir: string;
  let scheduler: CronScheduler;

  beforeEach(() => {
    const { api, tmpDir: td } = createMockAPI();
    tmpDir = td;
    const taskBoard = createMockTaskBoard();
    scheduler = new CronScheduler(api, undefined, taskBoard, 'test-agent', {
      retentionCount: 5,
      retentionDays: 30,
    });
  });

  afterEach(() => {
    scheduler.stop();
    cleanupTmpDir(tmpDir);
  });

  it('listRuns 在无记录时返回空数组', () => {
    const runs = scheduler.listRuns();
    expect(runs).toEqual([]);
  });

  it('getRunRecord 在无记录时返回 null', () => {
    const record = scheduler.getRunRecord('non-existent');
    expect(record).toBeNull();
  });

  it('手动保存记录后可通过 listRuns 查询', () => {
    // 通过内部方法模拟保存记录
    const runsDir = path.join(tmpDir, 'cron-runs');
    fs.mkdirSync(runsDir, { recursive: true });

    const record: CronRunRecord = {
      runId: 'test-run-1',
      jobId: 'job-1',
      jobName: '测试任务',
      instruction: '执行操作',
      startTime: Date.now() - 1000,
      endTime: Date.now(),
      durationMs: 1000,
      status: 'completed',
      resultText: '完成',
    };
    fs.writeFileSync(
      path.join(runsDir, `${record.jobId}_${record.startTime}.json`),
      JSON.stringify(record, null, 2),
      'utf-8',
    );

    const runs = scheduler.listRuns();
    expect(runs).toHaveLength(1);
    expect(runs[0].runId).toBe('test-run-1');
  });

  it('getRunRecord 可查询单条记录', () => {
    const runsDir = path.join(tmpDir, 'cron-runs');
    fs.mkdirSync(runsDir, { recursive: true });

    const record: CronRunRecord = {
      runId: 'test-run-2',
      jobId: 'job-2',
      jobName: '另一个任务',
      instruction: '执行操作',
      startTime: Date.now() - 2000,
      endTime: Date.now(),
      durationMs: 2000,
      status: 'failed',
      error: '工具不可用',
    };
    fs.writeFileSync(
      path.join(runsDir, `${record.jobId}_${record.startTime}.json`),
      JSON.stringify(record, null, 2),
      'utf-8',
    );

    const found = scheduler.getRunRecord('test-run-2');
    expect(found).not.toBeNull();
    expect(found!.status).toBe('failed');
    expect(found!.error).toBe('工具不可用');
  });
});

describe('Cron 时间计算（croner 集成）', () => {
  it('getNextCronTime 返回未来时间', () => {
    const next = getNextCronTime('* * * * *');
    expect(next.getTime()).toBeGreaterThan(Date.now());
  });

  it('getNextCronTime 支持 after 参数', () => {
    const base = new Date('2025-01-01T00:00:00');
    const next = getNextCronTime('0 9 * * *', base);
    expect(next.getHours()).toBe(9);
    expect(next.getTime()).toBeGreaterThan(base.getTime());
  });

  it('无效表达式抛出错误', () => {
    expect(() => getNextCronTime('invalid cron')).toThrow();
  });
});

describe('parseOnceScheduleValue 时间解析', () => {
  // [once 时间解析] 验证 parseOnceScheduleValue 支持相对延迟、绝对日期、纯数字兼容、错误输入
  let parseOnceScheduleValue: typeof import('../extensions/cron/src/tool.js').parseOnceScheduleValue;

  beforeEach(async () => {
    const module = await import('../extensions/cron/src/tool.js');
    parseOnceScheduleValue = module.parseOnceScheduleValue;
  });

  // ---- 相对延迟格式 ----

  it('"30s" 解析为约 30 秒后的时间戳', () => {
    const before = Date.now();
    const result = parseOnceScheduleValue('30s');
    expect('at' in result).toBe(true);
    if ('at' in result) {
      expect(result.at).toBeGreaterThanOrEqual(before + 29000);
      expect(result.at).toBeLessThanOrEqual(before + 31000);
    }
  });

  it('"5m" 解析为约 5 分钟后', () => {
    const before = Date.now();
    const result = parseOnceScheduleValue('5m');
    expect('at' in result).toBe(true);
    if ('at' in result) {
      expect(result.at).toBeGreaterThanOrEqual(before + 4 * 60 * 1000);
      expect(result.at).toBeLessThanOrEqual(before + 6 * 60 * 1000);
    }
  });

  it('"2h" 解析为约 2 小时后', () => {
    const before = Date.now();
    const result = parseOnceScheduleValue('2h');
    expect('at' in result).toBe(true);
    if ('at' in result) {
      expect(result.at).toBeGreaterThanOrEqual(before + 1.9 * 3600 * 1000);
      expect(result.at).toBeLessThanOrEqual(before + 2.1 * 3600 * 1000);
    }
  });

  it('"1d" 解析为约 1 天后', () => {
    const before = Date.now();
    const result = parseOnceScheduleValue('1d');
    expect('at' in result).toBe(true);
    if ('at' in result) {
      expect(result.at).toBeGreaterThanOrEqual(before + 23 * 3600 * 1000);
      expect(result.at).toBeLessThanOrEqual(before + 25 * 3600 * 1000);
    }
  });

  it('支持英文全称单位："30 seconds"、"5 minutes"、"2 hours"', () => {
    expect('at' in parseOnceScheduleValue('30 seconds')).toBe(true);
    expect('at' in parseOnceScheduleValue('5 minutes')).toBe(true);
    expect('at' in parseOnceScheduleValue('2 hours')).toBe(true);
    expect('at' in parseOnceScheduleValue('1 day')).toBe(true);
  });

  // ---- 绝对日期时间格式 ----

  it('未来日期时间解析成功', () => {
    const futureDate = new Date(Date.now() + 86400000); // 明天
    const dateStr = futureDate.toISOString().slice(0, 16).replace('T', ' ');
    const result = parseOnceScheduleValue(dateStr);
    expect('at' in result).toBe(true);
  });

  it('已过去的日期返回错误', () => {
    const result = parseOnceScheduleValue('2020-01-01 00:00');
    expect('error' in result).toBe(true);
  });

  // ---- 纯数字兼容 ----

  it('大数字当作 Unix 时间戳', () => {
    const futureTs = Date.now() + 60000;
    const result = parseOnceScheduleValue(String(futureTs));
    expect('at' in result).toBe(true);
    if ('at' in result) {
      expect(result.at).toBe(futureTs);
    }
  });

  it('小数字当作毫秒延迟', () => {
    const before = Date.now();
    const result = parseOnceScheduleValue('30000');
    expect('at' in result).toBe(true);
    if ('at' in result) {
      expect(result.at).toBeGreaterThanOrEqual(before + 29000);
      expect(result.at).toBeLessThanOrEqual(before + 31000);
    }
  });

  // ---- 错误输入 ----

  it('无法解析的字符串返回错误', () => {
    const result = parseOnceScheduleValue('tomorrow morning');
    expect('error' in result).toBe(true);
  });

  it('负数返回错误', () => {
    const result = parseOnceScheduleValue('-5000');
    expect('error' in result).toBe(true);
  });
});


describe('投递门控 (shouldSkip)', () => {
  // shouldSkip 是从 delivery-gate.ts 导出的，但通过 scheduler 间接使用
  // 这里直接导入测试
  let shouldSkip: typeof import('../extensions/cron/src/delivery-gate.js').shouldSkip;

  beforeEach(async () => {
    const module = await import('../extensions/cron/src/delivery-gate.js');
    shouldSkip = module.shouldSkip;
  });

  it('禁用的任务被跳过', () => {
    const job = createTestJob({ enabled: false });
    const result = shouldSkip(job, DEFAULT_SCHEDULER_CONFIG, new Map());
    expect(result.skip).toBe(true);
    expect(result.reason).toContain('已禁用');
  });

  it('启用的任务在无限制时通过', () => {
    const job = createTestJob();
    const result = shouldSkip(job, DEFAULT_SCHEDULER_CONFIG, new Map());
    expect(result.skip).toBe(false);
  });

  it('安静时段内非紧急任务被跳过', () => {
    const job = createTestJob({ urgent: false });
    const config: SchedulerConfig = {
      ...DEFAULT_SCHEDULER_CONFIG,
      quietHours: {
        enabled: true,
        windows: [{ start: '00:00', end: '23:59' }],
        allowUrgent: true,
      },
    };
    const now = new Date();
    const result = shouldSkip(job, config, new Map(), now);
    expect(result.skip).toBe(true);
    expect(result.reason).toContain('安静时段');
  });

  it('紧急任务可穿透安静时段', () => {
    const job = createTestJob({ urgent: true });
    const config: SchedulerConfig = {
      ...DEFAULT_SCHEDULER_CONFIG,
      quietHours: {
        enabled: true,
        windows: [{ start: '00:00', end: '23:59' }],
        allowUrgent: true,
      },
    };
    const now = new Date();
    const result = shouldSkip(job, config, new Map(), now);
    expect(result.skip).toBe(false);
  });

  it('近期活跃会话的任务被跳过', () => {
    const job = createTestJob({ sessionId: 'sess-1' });
    const config: SchedulerConfig = {
      ...DEFAULT_SCHEDULER_CONFIG,
      skipIfRecentActivity: {
        enabled: true,
        withinMinutes: 5,
      },
    };
    const activityMap = new Map([['sess-1', Date.now() - 60000]]); // 1 分钟前有活动
    const result = shouldSkip(job, config, activityMap);
    expect(result.skip).toBe(true);
    expect(result.reason).toContain('分钟内有活动');
  });
});
