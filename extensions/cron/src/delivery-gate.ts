/**
 * 投递策略判断模块
 *
 * 实现四层投递门控：
 * 1. 任务自身属性（enabled / silent 等）
 * 2. 用户全局偏好（quietHours / skipIfRecentActivity）
 * 3. 条件变量检查（conditionKey → GlobalStore）
 * 4. agent 自主判断（通过 silent 模式的 prompt 注入实现，不在此处理）
 */

import type {
  ScheduledJob,
  SchedulerConfig,
  DeliveryDecision,
  TimeWindow,
} from './types.js';
import type { GlobalStoreLike } from '@irises/extension-sdk';

/**
 * 解析 HH:MM 格式的时间字符串，返回今天对应的分钟数（0-1439）
 * @param time HH:MM 格式字符串
 * @returns 从 00:00 开始计算的分钟数
 */
function parseTimeToMinutes(time: string): number {
  const parts = time.split(':');
  const hours = parseInt(parts[0], 10);
  const minutes = parseInt(parts[1], 10);
  if (isNaN(hours) || isNaN(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    throw new Error(`无效的时间格式: "${time}"，应为 HH:MM`);
  }
  return hours * 60 + minutes;
}

/**
 * 判断当前时间是否在指定的时间窗口内
 * 正确处理跨午夜的情况（如 23:00 - 07:00）
 * @param now 当前时间
 * @param window 时间窗口
 * @returns 是否在窗口内
 */
function isInTimeWindow(now: Date, window: TimeWindow): boolean {
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const startMinutes = parseTimeToMinutes(window.start);
  const endMinutes = parseTimeToMinutes(window.end);

  if (startMinutes <= endMinutes) {
    // 不跨午夜：如 09:00 - 17:00
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  } else {
    // 跨午夜：如 23:00 - 07:00，即 23:00-23:59 或 00:00-06:59
    return currentMinutes >= startMinutes || currentMinutes < endMinutes;
  }
}

/**
 * 检查当前时间是否在安静时段内
 * @param config 调度器配置
 * @param now 当前时间（可注入，方便测试）
 * @returns 是否在安静时段
 */
function isInQuietHours(config: SchedulerConfig, now: Date): boolean {
  if (!config.quietHours.enabled) return false;
  for (const window of config.quietHours.windows) {
    if (isInTimeWindow(now, window)) {
      return true;
    }
  }
  return false;
}

/**
 * 检查目标会话是否有近期活动
 * @param config 调度器配置
 * @param sessionId 目标会话 ID
 * @param lastActivityMap 会话最后活跃时间映射
 * @param now 当前时间戳
 * @returns 是否有近期活动
 */
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

/**
 * 主入口：判断是否应该跳过本次任务投递
 *
 * 判断顺序：
 * 1. 任务未启用 → 跳过
 * 2. 安静时段检查（urgent 可穿透）
 * 3. 近期活跃检查
 * 4. 条件变量检查（conditionKey → GlobalStore）
 *
 * @param job 待投递的任务
 * @param config 调度器配置
 * @param lastActivityMap 会话最后活跃时间映射
 * @param globalStore 全局变量存储（可选，用于 conditionKey 检查）
 * @param now 当前时间（可注入，方便测试）
 * @returns 投递判断结果
 */
export function shouldSkip(
  job: ScheduledJob,
  config: SchedulerConfig,
  lastActivityMap: Map<string, number>,
  globalStore?: GlobalStoreLike,
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
    // urgent 任务可以穿透安静时段
    if (job.urgent && config.quietHours.allowUrgent) {
      // 紧急任务允许穿透，不跳过
    } else {
      return {
        skip: true,
        reason: `当前处于安静时段，任务 "${job.name}" 被跳过`,
      };
    }
  }

  // 第三层（用户全局偏好）：近期活跃检查
  const targetSessionId = job.delivery.sessionId ?? job.sessionId;
  if (hasRecentActivity(config, targetSessionId, lastActivityMap, currentTimestamp)) {
    return {
      skip: true,
      reason: `会话 ${targetSessionId} 在 ${config.skipIfRecentActivity.withinMinutes} 分钟内有活动，跳过任务 "${job.name}"`,
    };
  }

  // 第四层：条件变量检查
  if (job.conditionKey && globalStore) {
    const conditionValue = globalStore.get(job.conditionKey);
    if (!conditionValue) {
      return {
        skip: true,
        reason: `条件变量 "${job.conditionKey}" 为 ${conditionValue === undefined ? '未定义' : String(conditionValue)}，跳过任务 "${job.name}"`,
      };
    }
  }

  // 全部通过，允许投递
  return { skip: false };
}
