/**
 * manage_scheduled_tasks 工具定义
 *
 * 为 LLM 提供定时任务的 CRUD 操作接口。
 * scheduler 实例和当前 sessionId 通过外部注入。
 */

import { createPluginLogger } from '@irises/extension-sdk';
import type { ToolDefinition } from '@irises/extension-sdk';
import type { CronScheduler } from './scheduler.js';
import type { ScheduleConfig, CreateJobParams, UpdateJobParams } from './types.js';

// ============ once 时间解析 ============

/**
 * [once 时间解析] 解析 once 类型的 schedule_value，支持两种写法：
 *
 * 1. 相对延迟：如 "30s" / "5m" / "2h" / "1d"
 *    支持的单位：s(秒) m(分) h(时) d(天)
 *    解析后加上 Date.now() 得到绝对时间戳。
 *
 * 2. 绝对日期时间：如 "2026-04-03 17:30" / "2026-04-03T17:30:00"
 *    使用本地时区解析为 Date 对象，取 getTime()。
 *
 * 返回值：Unix 毫秒时间戳，或 null 表示解析失败。
 *
 * 设计目的：避免 LLM 直接填 Unix 时间戳（容易填错，如把延迟毫秒数当时间戳），
 * 改为让 LLM 用人类可读的格式表达意图，由代码负责转换。
 */
export function parseOnceScheduleValue(value: string): { at: number } | { error: string } {
  const trimmed = value.trim();

  // ---- 尝试相对延迟格式：数字 + 单位（如 30s, 5m, 2h, 1d） ----
  const relativeMatch = trimmed.match(/^(\d+(?:\.\d+)?)\s*(s|sec|second|seconds|m|min|minute|minutes|h|hr|hour|hours|d|day|days)$/i);
  if (relativeMatch) {
    const amount = parseFloat(relativeMatch[1]);
    const unit = relativeMatch[2].toLowerCase();

    let ms: number;
    if (unit.startsWith('s')) {
      ms = amount * 1000;
    } else if (unit.startsWith('m') && !unit.startsWith('mi')) {
      // 'm' 但排除 'mi'（minute 已在 minute 分支）
      ms = amount * 60 * 1000;
    } else if (unit.startsWith('mi')) {
      ms = amount * 60 * 1000;
    } else if (unit.startsWith('h')) {
      ms = amount * 3600 * 1000;
    } else if (unit.startsWith('d')) {
      ms = amount * 86400 * 1000;
    } else {
      return { error: `无法识别的时间单位: "${unit}"` };
    }

    if (ms <= 0) {
      return { error: `延迟时间必须为正数: "${trimmed}"` };
    }

    return { at: Date.now() + Math.round(ms) };
  }

  // ---- 纯数字判断（必须在 Date.parse 之前，因为 Date.parse 会把纯数字串误解析为日期） ----
  if (/^-?\d+$/.test(trimmed)) {
    const numeric = parseInt(trimmed, 10);
    if (numeric <= 0) {
      return { error: `无效的数值: "${trimmed}"，应为正数` };
    }
    // 大于 2020-01-01 的毫秒数 → 当作 Unix 时间戳
    if (numeric > 1577836800000) {
      return { at: numeric };
    }
    // 小数字 → 当作毫秒延迟
    return { at: Date.now() + numeric };
  }

  // ---- 尝试绝对日期时间格式 ----
  // 支持: "2026-04-03 17:30" / "2026-04-03T17:30:00" / "2026-04-03 17:30:00" 等
  // Date.parse 对 "YYYY-MM-DD HH:mm" 格式在部分引擎下可能解析为 UTC，
  // 这里手动把空格替换为 T 以确保一致的本地时区解析行为。
  const normalized = trimmed.replace(/^(\d{4}-\d{2}-\d{2})\s+/, '$1T');
  const parsed = Date.parse(normalized);
  if (!isNaN(parsed)) {
    const now = Date.now();
    if (parsed <= now) {
      return { error: `指定的时间已经过去: "${trimmed}"` };
    }
    return { at: parsed };
  }

  return { error: `无法解析的 once 时间值: "${trimmed}"。支持的格式：相对延迟（如 "30s", "5m", "2h"）或绝对日期（如 "2026-04-03 17:30"）` };
}


const logger = createPluginLogger('cron', 'tool');

// ============ 模块级状态（由插件入口注入） ============

/** 调度器实例引用，由 injectScheduler 设置 */
let scheduler: CronScheduler | null = null;

/** 当前 turn 所属的 sessionId，由 setCurrentSessionId 在每次 chat 前设置 */
let currentSessionId: string = 'default';

/**
 * 注入调度器实例
 * 由插件入口在 onReady 中调用。
 * @param s CronScheduler 实例
 */
export function injectScheduler(s: CronScheduler): void {
  scheduler = s;
}

/**
 * 设置当前 turn 的 sessionId
 * 由插件入口通过 onBeforeChat 钩子在每次 chat 前调用。
 * @param sid 会话 ID
 */
export function setCurrentSessionId(sid: string): void {
  currentSessionId = sid;
}

// ============ 工具定义 ============

/**
 * manage_scheduled_tasks 工具
 *
 * 支持的操作：create / update / delete / enable / disable / list / get
  * 支持三种调度模式：cron 表达式 / 固定间隔（毫秒） / 一次性定时
 */
export const manageScheduledTasksTool: ToolDefinition = {
  declaration: {
    name: 'manage_scheduled_tasks',
    description:
      '管理定时调度任务。支持创建（create）、更新（update）、删除（delete）、启用（enable）、禁用（disable）、列出（list）和查询（get）定时任务。\n' +
      '调度模式：\n' +
      '- cron: cron 表达式，如 "0 9 * * 1-5"（工作日每天早上9点）\n' +
      '- interval: 固定间隔毫秒数，如 "60000"\n' +
      '- once: 一次性定时，支持相对延迟（如 "30s", "5m", "2h"）或绝对日期时间（如 "2026-04-03 17:30"）\n' +
      '任务触发后会在后台独立拉起一个 agent 执行预设的 instruction 指令（拥有独立的工具调用能力）。\n' +
      '执行完成后的行为取决于 silent 参数：\n' +
      '  - silent=false（默认）：执行结果作为通知注入当前会话，由主 agent 处理并回复用户。\n' +
      '  - silent=true：仅向各前端平台广播一条轻量通知（任务名+结果摘要），不触发主 agent 处理，不占用对话。\n' +
      '两种模式下，执行记录都会持久化保存。',

    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['create', 'update', 'delete', 'enable', 'disable', 'list', 'get'],
          description: '操作类型：create（创建）、update（更新）、delete（删除）、enable（启用）、disable（禁用）、list（列出所有）、get（查询详情）',
        },
        name: {
          type: 'string',
          description: '任务名称（create / update 时使用）',
        },
        schedule_type: {
          type: 'string',
          enum: ['cron', 'interval', 'once'],
          description: '调度类型：cron（cron 表达式）、interval（固定间隔毫秒）、once（一次性定时）',
        },
        schedule_value: {
          type: 'string',
          description:
            '调度参数值，根据 schedule_type 不同而不同：\n' +
            '- cron: cron 表达式，如 "0 9 * * 1-5"\n' +
            '- interval: 间隔毫秒数，如 "60000"\n' +
            '- once: 相对延迟如 "30s"、"5m"、"2h"、"1d"，或绝对日期时间如 "2026-04-03 17:30"',
        },
        instruction: {
          type: 'string',
          description: '任务触发时执行的指令文本',
        },
        job_id: {
          type: 'string',
          description: '任务 ID（update / delete / enable / disable / get 时使用）',
        },
        silent: {
          type: 'boolean',
          description: '是否静默执行（不触发主会话回复，仅发通知）',
        },
        urgent: {
          type: 'boolean',
          description: '是否为紧急任务（可穿透安静时段）',
        },
        condition: {
          type: 'string',
          description:
            '条件表达式（可选）。JS 语法，触发时求值，truthy 才执行。\n' +
            '可用变量（从 GlobalStore 自动读取）：\n' +
            '  agent.xxx / vars.xxx — agent 作用域（跨对话持久）\n' +
            '  session.xxx — 当前会话变量\n' +
            '  global.xxx — 全局变量\n' +
            '内置函数：\n' +
            '  random() — 0-1 随机数\n' +
            '  now() — 时间戳(ms)  hour() — 当前小时  day() — 星期\n' +
            '示例：\n' +
            '  "agent.好感度 > 80 && random() < 0.5"\n' +
            '  "vars.信任度 >= 60 || vars.好感度 >= 90"\n' +
            '  "hour() >= 9 && hour() <= 22"',
        },
      },
      required: ['action'],
    },
  },

  // 任务管理操作不可并行执行
  parallel: false,

  handler: async (args: Record<string, unknown>) => {
    // 检查调度器是否已注入
    if (!scheduler) {
      return { error: '调度器尚未初始化，请稍后重试' };
    }

    const action = args.action as string;

    switch (action) {
      // ────── 创建任务 ──────
      case 'create': {
        const name = args.name as string | undefined;
        const scheduleType = args.schedule_type as string | undefined;
        const scheduleValue = args.schedule_value as string | undefined;
        const instruction = args.instruction as string | undefined;

        // 校验必填参数
        if (!name || !scheduleType || !scheduleValue || !instruction) {
          return {
            error:
              'create 操作需要以下参数：name, schedule_type, schedule_value, instruction',
          };
        }

        // 根据调度类型构建 ScheduleConfig
        let schedule: ScheduleConfig;
        switch (scheduleType) {
          case 'cron':
            schedule = { type: 'cron', expression: scheduleValue };
            break;
          case 'interval': {
            const ms = parseInt(scheduleValue, 10);
            if (isNaN(ms) || ms <= 0) {
              return { error: `无效的间隔值: "${scheduleValue}"，应为正整数毫秒数` };
            }
            schedule = { type: 'interval', ms };
            break;
          }
          case 'once': {
            // [once 时间解析] 用 parseOnceScheduleValue 支持相对延迟和绝对日期，
            // 替代旧的 parseInt 直接解析时间戳（LLM 经常填错）。
            const result = parseOnceScheduleValue(scheduleValue);
            if ('error' in result) {
              return { error: result.error };
            }
            schedule = { type: 'once', at: result.at };
            break;
          }
          default:
            return { error: `不支持的调度类型: "${scheduleType}"` };
        }

        // 自动填充 sessionId / delivery / createdInSession
        const params: CreateJobParams = {
          name,
          schedule,
          sessionId: currentSessionId,
          instruction,
          delivery: {
            sessionId: currentSessionId,
            fallback: 'last-active',
          },
          silent: (args.silent as boolean) ?? false,
          urgent: (args.urgent as boolean) ?? false,
          condition: args.condition as string | undefined,
          createdInSession: currentSessionId,
        };

        const job = scheduler.createJob(params);
        logger.info(`工具调用: 创建任务 "${job.name}" (${job.id})`);

        return {
          success: true,
          job: {
            id: job.id,
            name: job.name,
            schedule: job.schedule,
            instruction: job.instruction,
            silent: job.silent,
            urgent: job.urgent,
            condition: job.condition,
            enabled: job.enabled,
            createdAt: new Date(job.createdAt).toISOString(),
          },
        };
      }

      // ────── 更新任务 ──────
      case 'update': {
        const jobId = args.job_id as string | undefined;
        if (!jobId) {
          return { error: 'update 操作需要 job_id 参数' };
        }

        // 收集所有可更新的字段
        const updateParams: UpdateJobParams = {};
        if (args.name !== undefined) updateParams.name = args.name as string;
        if (args.instruction !== undefined)
          updateParams.instruction = args.instruction as string;
        if (args.silent !== undefined) updateParams.silent = args.silent as boolean;
        if (args.urgent !== undefined) updateParams.urgent = args.urgent as boolean;
        if (args.condition !== undefined) updateParams.condition = args.condition as string;

        // 如果同时提供了调度类型和值，则更新调度配置
        if (args.schedule_type && args.schedule_value) {
          const st = args.schedule_type as string;
          const sv = args.schedule_value as string;
          switch (st) {
            case 'cron':
              updateParams.schedule = { type: 'cron', expression: sv };
              break;
            case 'interval':
              updateParams.schedule = { type: 'interval', ms: parseInt(sv, 10) };
              break;
            case 'once': {
              // [once 时间解析] update 时也走同一套解析逻辑
              const result = parseOnceScheduleValue(sv);
              if ('error' in result) {
                return { error: result.error };
              }
              updateParams.schedule = { type: 'once', at: result.at };
              break;
            }

          }
        }

        const updated = scheduler.updateJob(jobId, updateParams);
        if (!updated) {
          return { error: `未找到任务: ${jobId}` };
        }

        logger.info(`工具调用: 更新任务 "${updated.name}" (${jobId})`);
        return { success: true, job: updated };
      }

      // ────── 删除任务 ──────
      case 'delete': {
        const jobId = args.job_id as string | undefined;
        if (!jobId) {
          return { error: 'delete 操作需要 job_id 参数' };
        }

        const deleted = scheduler.deleteJob(jobId);
        if (!deleted) {
          return { error: `未找到任务: ${jobId}` };
        }

        logger.info(`工具调用: 删除任务 ${jobId}`);
        return { success: true, message: `任务 ${jobId} 已删除` };
      }

      // ────── 启用任务 ──────
      case 'enable': {
        const jobId = args.job_id as string | undefined;
        if (!jobId) {
          return { error: 'enable 操作需要 job_id 参数' };
        }

        const enabled = scheduler.enableJob(jobId);
        if (!enabled) {
          return { error: `未找到任务: ${jobId}` };
        }

        logger.info(`工具调用: 启用任务 "${enabled.name}" (${jobId})`);
        return { success: true, job: enabled };
      }

      // ────── 禁用任务 ──────
      case 'disable': {
        const jobId = args.job_id as string | undefined;
        if (!jobId) {
          return { error: 'disable 操作需要 job_id 参数' };
        }

        const disabled = scheduler.disableJob(jobId);
        if (!disabled) {
          return { error: `未找到任务: ${jobId}` };
        }

        logger.info(`工具调用: 禁用任务 "${disabled.name}" (${jobId})`);
        return { success: true, job: disabled };
      }

      // ────── 列出所有任务 ──────
      case 'list': {
        const jobs = scheduler.listJobs();
        return {
          success: true,
          count: jobs.length,
          jobs: jobs.map((j) => ({
            id: j.id,
            name: j.name,
            schedule: j.schedule,
            enabled: j.enabled,
            silent: j.silent,
            urgent: j.urgent,
            lastRunAt: j.lastRunAt
              ? new Date(j.lastRunAt).toISOString()
              : null,
            lastRunStatus: j.lastRunStatus ?? null,
          })),
        };
      }

      // ────── 查询单个任务 ──────
      case 'get': {
        const jobId = args.job_id as string | undefined;
        if (!jobId) {
          return { error: 'get 操作需要 job_id 参数' };
        }

        const job = scheduler.getJob(jobId);
        if (!job) {
          return { error: `未找到任务: ${jobId}` };
        }

        return { success: true, job };
      }

      // ────── 未知操作 ──────
      default:
        return { error: `不支持的操作类型: "${action}"` };
    }
  },
};
