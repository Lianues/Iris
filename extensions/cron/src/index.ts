/**
 * 定时任务调度插件入口
 *
 * 实现 IrisPlugin 接口：
 * - activate: 注册工具、钩子、初始化调度器、注册 Web 路由和 Settings Tab
 * - deactivate: 停止调度器
 *
 * 配置由 manifest.json 中 configFile 指向的 config.yaml 提供，
 * 通过 ctx.getPluginConfig() 读取。
 */

import * as fs from 'fs';
import * as path from 'path';
import { definePlugin, createPluginLogger } from '@irises/extension-sdk';
// [cron 重构] 删除 PluginEventBusLike import（不再使用 eventBus 广播）
import type { PluginContext, IrisAPI } from '@irises/extension-sdk';
import { CronScheduler } from './scheduler.js';
import {
  manageScheduledTasksTool,
  injectScheduler,
  setCurrentSessionId,
} from './tool.js';
import type { SchedulerConfig } from './types.js';
import { DEFAULT_SCHEDULER_CONFIG } from './types.js';

const logger = createPluginLogger('cron');

// ============ 模块级状态 ============

/** 调度器实例，供 deactivate 和 Web 路由 / Settings Tab 使用 */
let schedulerInstance: CronScheduler | null = null;

// ============ 插件定义 ============

export default definePlugin({
  name: 'cron',
  version: '0.1.0',
  description: '定时任务调度插件 — Cron / Interval / Once 三种调度模式',

  activate(ctx: PluginContext) {
    // 1. 读取插件配置并合并默认值
    const pluginConfig = ctx.getPluginConfig<Partial<SchedulerConfig>>();
    const config = resolveConfig(pluginConfig);

    if (!config.enabled) {
      logger.info('调度器未启用（config.enabled = false）');
      return;
    }

    // 2. 注册 manage_scheduled_tasks 工具
    ctx.registerTool(manageScheduledTasksTool);
    logger.info('manage_scheduled_tasks 工具已注册');

    // 3. 添加钩子：在每次 chat 前捕获当前 sessionId，供工具 handler 使用
    //    onBeforeChat 在 ToolLoop 之前调用，因此工具执行时 currentSessionId 已经是正确的值
    ctx.addHook({
      name: 'cron:capture-session',
      priority: 200,
      onBeforeChat({ sessionId }) {
        setCurrentSessionId(sessionId);
        return undefined; // 不修改用户消息
      },
    });

    // 4. onReady：系统启动完成后初始化调度器和各种注册
    ctx.onReady(async (api) => {
      // [cron 重构] 从 IrisAPI 获取 taskBoard 和 agentName，
      // 替代原有的 agentTaskRegistry + eventBus 注入方式。
      const taskBoard = (api as any).taskBoard ?? null;
      // 多 Agent 配置分层重构：移除 __global__ fallback
      const agentName: string = (api as any).agentName ?? 'master';

      // 创建调度器实例：传入 taskBoard 和 agentName 以启用后台执行模式
      schedulerInstance = new CronScheduler(api, config, taskBoard, agentName);

      // 将调度器实例注入给工具模块
      injectScheduler(schedulerInstance);

      // 监听 backend 的 done 事件，记录会话活跃时间
      // 供投递门控的 skipIfRecentActivity 使用
      api.backend.on('done', (sessionId: string) => {
        schedulerInstance?.recordActivity(sessionId);
      });

      // 启动调度器（从文件恢复任务 + 设置定时器 + 启动文件监听）
      await schedulerInstance.start();

      // 注册 Web API 端点
      registerWebRoutes(api);

      // 注册 Console Settings Tab
      registerSettingsTab(api, ctx);

      logger.info('调度器插件初始化完成');
    });
  },

  async deactivate() {
    if (schedulerInstance) {
      schedulerInstance.stop();
      schedulerInstance = null;
    }
    logger.info('调度器插件已卸载');
  },
});

// ============ Web API 路由注册 ============

/**
 * 注册 5 个 Web API 端点：
 * - GET    /api/plugins/cron/jobs         列出所有任务
 * - POST   /api/plugins/cron/jobs/:id/toggle  启用/禁用任务
 * - DELETE /api/plugins/cron/jobs/:id      删除任务
 * - GET    /api/plugins/cron/runs         列出所有执行记录
 * - GET    /api/plugins/cron/runs/:runId  查看单条执行记录
 */
function registerWebRoutes(api: IrisAPI): void {
  if (!api.registerWebRoute) {
    logger.info('Web 路由注册不可用（非 Web 平台），跳过');
    return;
  }

  // GET — 列出所有任务
  api.registerWebRoute(
    'GET',
    '/api/plugins/cron/jobs',
    async (_req, res) => {
      const jobs = schedulerInstance?.listJobs() ?? [];
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, jobs }));
    },
  );

  // POST — 切换任务的启用/禁用状态
  api.registerWebRoute(
    'POST',
    '/api/plugins/cron/jobs/:id/toggle',
    async (_req, res, params) => {
      if (!schedulerInstance) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: '调度器未初始化' }));
        return;
      }

      const job = schedulerInstance.getJob(params.id);
      if (!job) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: '任务不存在' }));
        return;
      }

      // 切换 enabled 状态
      const result = job.enabled
        ? schedulerInstance.disableJob(params.id)
        : schedulerInstance.enableJob(params.id);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, job: result }));
    },
  );

  // DELETE — 删除任务
  api.registerWebRoute(
    'DELETE',
    '/api/plugins/cron/jobs/:id',
    async (_req, res, params) => {
      if (!schedulerInstance) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: '调度器未初始化' }));
        return;
      }

      const deleted = schedulerInstance.deleteJob(params.id);
      if (!deleted) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: '任务不存在' }));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    },
  );

  // GET — 列出执行记录（按时间倒序，默认最多 50 条）
  api.registerWebRoute(
    'GET',
    '/api/plugins/cron/runs',
    async (_req, res) => {
      const runs = schedulerInstance?.listRuns() ?? [];
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, runs }));
    },
  );

  // GET — 查看单条执行记录
  api.registerWebRoute(
    'GET',
    '/api/plugins/cron/runs/:runId',
    async (_req, res, params) => {
      if (!schedulerInstance) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: '调度器未初始化' }));
        return;
      }
      const record = schedulerInstance.getRunRecord(params.runId);
      if (!record) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: '执行记录不存在' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, record }));
    },
  );

  logger.info('Web API 路由已注册（5 个端点）');
}

// ============ Console Settings Tab 注册 ============

/**
 * 注册 Console Settings Tab
 *
 * 字段分组：
 * - 基础：enabled
 * - 安静时段：quietHoursEnabled, quietHoursStart, quietHoursEnd, quietHoursAllowUrgent
 * - 跳过近期活跃：skipRecentEnabled, skipRecentMinutes
 * - 当前任务：jobsSummary（只读）
 */
function registerSettingsTab(api: IrisAPI, ctx: PluginContext): void {
  // registerConsoleSettingsTab 是可选方法，先检查是否存在
  const registerTab = (api as Record<string, any>).registerConsoleSettingsTab as ((tab: any) => void) | undefined;
  if (!registerTab) {
    logger.info('Console Settings Tab 注册不可用，跳过');
    return;
  }

  registerTab({
    id: 'cron',
    label: '定时任务',
    icon: '⏰',
    fields: [
      // ── 基础 ──
      {
        key: 'enabled',
        label: '启用调度器',
        type: 'toggle',
        defaultValue: true,
        description: '是否启用定时任务调度功能',
      },
      // ── 安静时段 ──
      {
        key: 'quietHoursEnabled',
        label: '启用安静时段',
        type: 'toggle',
        defaultValue: false,
        description: '在安静时段内，非紧急任务将被跳过',
        group: '安静时段',
      },
      {
        key: 'quietHoursStart',
        label: '开始时间',
        type: 'text',
        defaultValue: '23:00',
        description: '安静时段开始时间（HH:MM 格式）',
        group: '安静时段',
      },
      {
        key: 'quietHoursEnd',
        label: '结束时间',
        type: 'text',
        defaultValue: '07:00',
        description: '安静时段结束时间（HH:MM 格式）',
        group: '安静时段',
      },
      {
        key: 'quietHoursAllowUrgent',
        label: '允许紧急任务穿透',
        type: 'toggle',
        defaultValue: true,
        description: '紧急任务是否可以在安静时段内执行',
        group: '安静时段',
      },
      // ── 跳过近期活跃 ──
      {
        key: 'skipRecentEnabled',
        label: '跳过近期活跃会话',
        type: 'toggle',
        defaultValue: true,
        description: '如果目标会话近期有活动则跳过本次投递',
        group: '跳过近期活跃',
      },
      {
        key: 'skipRecentMinutes',
        label: '活跃窗口（分钟）',
        type: 'number',
        defaultValue: 5,
        description: '多少分钟内有活动视为近期活跃',
        group: '跳过近期活跃',
      },
      // ── 当前任务概览 ──
      {
        key: 'jobsSummary',
        label: '当前任务',
        type: 'readonly',
        description: '已注册的定时任务概览',
        group: '当前任务',
      },
    ],

    // 加载当前值（Settings 页面打开时调用）
    onLoad: async () => {
      const cfg =
        schedulerInstance?.getConfig() ?? DEFAULT_SCHEDULER_CONFIG;
      const jobs = schedulerInstance?.listJobs() ?? [];

      // 构建任务列表摘要文本
      const jobsSummary =
        jobs.length === 0
          ? '暂无任务'
          : jobs
              .map(
                (j) =>
                  `${j.enabled ? '✓' : '✗'} ${j.name} (${j.schedule.type})`,
              )
              .join('\n');

      return {
        enabled: cfg.enabled,
        quietHoursEnabled: cfg.quietHours.enabled,
        quietHoursStart: cfg.quietHours.windows[0]?.start ?? '23:00',
        quietHoursEnd: cfg.quietHours.windows[0]?.end ?? '07:00',
        quietHoursAllowUrgent: cfg.quietHours.allowUrgent,
        skipRecentEnabled: cfg.skipIfRecentActivity.enabled,
        skipRecentMinutes: cfg.skipIfRecentActivity.withinMinutes,
        jobsSummary,
      };
    },

    // 保存修改后的值（用户按 S 保存时调用）
    onSave: async (values: Record<string, unknown>) => {
      try {
        // 从表单值构建完整的 SchedulerConfig
        const newConfig: SchedulerConfig = {
          enabled: values.enabled as boolean,
          quietHours: {
            enabled: values.quietHoursEnabled as boolean,
            windows: [
              {
                start: values.quietHoursStart as string,
                end: values.quietHoursEnd as string,
              },
            ],
            allowUrgent: values.quietHoursAllowUrgent as boolean,
          },
          skipIfRecentActivity: {
            enabled: values.skipRecentEnabled as boolean,
            withinMinutes: values.skipRecentMinutes as number,
          },
        };

        // 热更新调度器内存中的配置
        schedulerInstance?.updateConfig(newConfig);

        // 将配置写回 config.yaml 文件
        const extRootDir = ctx.getExtensionRootDir();
        if (extRootDir) {
          const configPath = path.join(extRootDir, 'config.yaml');
          const yaml = buildConfigYaml(newConfig);
          fs.writeFileSync(configPath, yaml, 'utf-8');
          logger.info('配置已写回 config.yaml');
        }

        return { success: true };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`保存配置失败: ${msg}`);
        return { success: false, error: msg };
      }
    },
  });

  logger.info('Console Settings Tab 已注册');
}

// ============ 内部辅助函数 ============

/**
 * 合并插件配置和默认值
 * pluginConfig 来自 ctx.getPluginConfig()（即 config.yaml 解析后的对象）
 */
function resolveConfig(
  pluginConfig?: Partial<SchedulerConfig>,
): SchedulerConfig {
  return {
    enabled: pluginConfig?.enabled ?? DEFAULT_SCHEDULER_CONFIG.enabled,
    quietHours: {
      ...DEFAULT_SCHEDULER_CONFIG.quietHours,
      ...pluginConfig?.quietHours,
    },
    skipIfRecentActivity: {
      ...DEFAULT_SCHEDULER_CONFIG.skipIfRecentActivity,
      ...pluginConfig?.skipIfRecentActivity,
    },
  };
}

/**
 * 将 SchedulerConfig 序列化为 YAML 格式字符串
 * 手动拼接以避免引入外部 YAML 库。
 * @param config 调度器配置
 * @returns YAML 格式的配置字符串
 */
function buildConfigYaml(config: SchedulerConfig): string {
  const lines: string[] = [];

  lines.push('# 定时任务调度插件配置');
  lines.push('#');
  lines.push('# 启用后，LLM 可通过 manage_scheduled_tasks 工具');
  lines.push('# 创建、管理定时任务，实现自动化调度。');
  lines.push('');
  lines.push('# 是否启用调度器');
  lines.push(`enabled: ${config.enabled}`);
  lines.push('');
  lines.push('# 安静时段配置');
  lines.push('# 在安静时段内，非紧急任务将被跳过');
  lines.push('quietHours:');
  lines.push(`  enabled: ${config.quietHours.enabled}`);
  lines.push('  windows:');
  for (const w of config.quietHours.windows) {
    lines.push(`    - start: "${w.start}"`);
    lines.push(`      end: "${w.end}"`);
  }
  lines.push('  # 是否允许紧急任务穿透安静时段');
  lines.push(`  allowUrgent: ${config.quietHours.allowUrgent}`);
  lines.push('');
  lines.push('# 跳过近期活跃会话');
  lines.push('# 如果目标会话在指定分钟内有过活动，则跳过本次投递');
  lines.push('skipIfRecentActivity:');
  lines.push(`  enabled: ${config.skipIfRecentActivity.enabled}`);
  lines.push(
    `  withinMinutes: ${config.skipIfRecentActivity.withinMinutes}`,
  );

  return lines.join('\n') + '\n';
}
