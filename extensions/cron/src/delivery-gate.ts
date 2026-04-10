/**
 * 投递策略判断模块
 *
 * 实现四层投递门控：
 * 1. 任务自身属性（enabled）
 * 2. 用户全局偏好（quietHours / skipIfRecentActivity）
 * 3. 条件表达式求值（condition → JS 表达式 + GlobalStore 变量）
 * 4. agent 自主判断（通过 silent 模式的 prompt 注入实现，不在此处理）
 */

import type {
  ScheduledJob,
  SchedulerConfig,
  DeliveryDecision,
  TimeWindow,
} from './types.js';
import type { GlobalStoreLike } from '@irises/extension-sdk';
import { createPluginLogger } from '@irises/extension-sdk';

const logger = createPluginLogger('cron', 'condition');

// ============ 时间工具 ============

function parseTimeToMinutes(time: string): number {
  const parts = time.split(':');
  const hours = parseInt(parts[0], 10);
  const minutes = parseInt(parts[1], 10);
  if (isNaN(hours) || isNaN(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    throw new Error(`无效的时间格式: "${time}"，应为 HH:MM`);
  }
  return hours * 60 + minutes;
}

function isInTimeWindow(now: Date, window: TimeWindow): boolean {
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const startMinutes = parseTimeToMinutes(window.start);
  const endMinutes = parseTimeToMinutes(window.end);
  if (startMinutes <= endMinutes) {
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  } else {
    return currentMinutes >= startMinutes || currentMinutes < endMinutes;
  }
}

function isInQuietHours(config: SchedulerConfig, now: Date): boolean {
  if (!config.quietHours.enabled) return false;
  for (const window of config.quietHours.windows) {
    if (isInTimeWindow(now, window)) return true;
  }
  return false;
}

function hasRecentActivity(
  config: SchedulerConfig,
  sessionId: string,
  lastActivityMap: Map<string, number>,
  now: number,
): boolean {
  if (!config.skipIfRecentActivity.enabled) return false;
  const lastActivity = lastActivityMap.get(sessionId);
  if (lastActivity === undefined) return false;
  const thresholdMs = config.skipIfRecentActivity.withinMinutes * 60 * 1000;
  return (now - lastActivity) < thresholdMs;
}

// ============ 条件表达式求值 ============

/**
 * 求值条件表达式。
 *
 * 为表达式注入以下上下文变量：
 *   agent   / vars  — agent 作用域变量（跨对话持久）
 *   session         — 当前会话变量
 *   global          — 全局变量（非作用域前缀）
 *   random()        — 0-1 随机数
 *   now()           — 当前时间戳（毫秒）
 *   hour()          — 当前小时 (0-23)
 *   day()           — 当前星期 (0=周日, 6=周六)
 *   Math / Date     — 标准库
 *
 * @returns 求值结果：{ pass: boolean, detail: string }
 */
function evaluateCondition(
  expression: string,
  globalStore: GlobalStoreLike,
  agentName: string,
  sessionId?: string,
): { pass: boolean; detail: string } {
  // 构建各作用域的变量快照
  const agentVars = globalStore.agent(agentName).getAll();
  const sessionVars = sessionId
    ? globalStore.session(sessionId).getAll()
    : {};
  // 全局变量：只取不带作用域前缀的 key
  const globalVars: Record<string, unknown> = {};
  for (const key of globalStore.keys()) {
    if (!key.startsWith('@')) {
      globalVars[key] = globalStore.get(key);
    }
  }

  try {
    // 用 new Function 构建沙箱表达式求值器
    const fn = new Function(
      'agent', 'session', 'global', 'vars',
      'random', 'now', 'hour', 'day',
      'Math', 'Date',
      `"use strict"; return (${expression})`,
    );

    const result = fn(
      agentVars,
      sessionVars,
      globalVars,
      agentVars, // vars = agent 的简写
      () => Math.random(),
      () => Date.now(),
      () => new Date().getHours(),
      () => new Date().getDay(),
      Math,
      Date,
    );

    return { pass: !!result, detail: `表达式求值结果: ${result}` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`条件表达式求值失败: "${expression}", error: ${msg}`);
    return { pass: false, detail: `表达式错误: ${msg}` };
  }
}

// ============ 主入口 ============

/**
 * 主入口：判断是否应该跳过本次任务投递
 *
 * 判断顺序：
 * 1. 任务未启用 → 跳过
 * 2. 安静时段检查（urgent 可穿透）
 * 3. 近期活跃检查
 * 4. 条件表达式求值（condition → JS 表达式）
 */
export function shouldSkip(
  job: ScheduledJob,
  config: SchedulerConfig,
  lastActivityMap: Map<string, number>,
  context?: {
    globalStore?: GlobalStoreLike;
    agentName?: string;
  },
  now?: Date,
): DeliveryDecision {
  const currentDate = now ?? new Date();
  const currentTimestamp = currentDate.getTime();

  // 第一层：任务自身属性
  if (!job.enabled) {
    return { skip: true, reason: `任务 "${job.name}" 已禁用` };
  }

  // 第二层：安静时段检查
  if (isInQuietHours(config, currentDate)) {
    if (job.urgent && config.quietHours.allowUrgent) {
      // 紧急任务允许穿透
    } else {
      return {
        skip: true,
        reason: `当前处于安静时段，任务 "${job.name}" 被跳过`,
      };
    }
  }

  // 第三层：近期活跃检查
  const targetSessionId = job.delivery.sessionId ?? job.sessionId;
  if (hasRecentActivity(config, targetSessionId, lastActivityMap, currentTimestamp)) {
    return {
      skip: true,
      reason: `会话 ${targetSessionId} 在 ${config.skipIfRecentActivity.withinMinutes} 分钟内有活动，跳过任务 "${job.name}"`,
    };
  }

  // 第四层：条件表达式求值
  if (job.condition && context?.globalStore) {
    const { pass, detail } = evaluateCondition(
      job.condition,
      context.globalStore,
      context.agentName ?? 'master',
      targetSessionId,
    );
    if (!pass) {
      return {
        skip: true,
        reason: `条件未满足: "${job.condition}" — ${detail}，跳过任务 "${job.name}"`,
      };
    }
  }

  // 全部通过
  return { skip: false };
}
