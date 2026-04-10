/**
 * 定时任务调度插件 — 默认配置模板
 *
 * 通过 ctx.ensureConfigFile() 在首次运行时释放到用户配置目录。
 * 用户可手动编辑此文件来调整插件行为。
 */

import { DEFAULT_CRON_SYSTEM_PROMPT } from './types.js';

/**
 * 生成默认配置模板 YAML 字符串。
 *
 * 使用函数而非静态字符串，是因为 systemPrompt 默认值在 types.ts 中维护，
 * 这里动态嵌入可以保证模板与代码中的默认值始终一致。
 */
export function buildDefaultConfigTemplate(): string {
  // 将多行 systemPrompt 转为 YAML block scalar（每行缩进 4 个空格）
  const promptYaml = DEFAULT_CRON_SYSTEM_PROMPT
    .split('\n')
    .map((line) => `    ${line}`)
    .join('\n');

  return `# ============================================================
# 定时任务调度插件配置
# ============================================================
#
# 启用后，LLM 可通过 manage_scheduled_tasks 工具
# 创建、管理定时任务，实现自动化调度。
#
# 修改后保存即可生效，无需重启。

# 是否启用调度器
enabled: true

# ────────────────────────────────────────
# 后台执行配置
# ────────────────────────────────────────
# 定时任务触发后会在后台独立拉起一个 agent 执行指令，
# 以下参数控制这个后台执行环境的行为。
backgroundExecution:

  # 定时任务执行时的系统提示词
  # 定义后台 agent 的角色和行为准则
  systemPrompt: |
${promptYaml}

  # 排除的工具列表
  # 这些工具在定时任务后台执行时不可用。
  # 默认排除：
  #   - sub_agent: 没有父会话上下文，子代理无意义
  #   - history_search: 需要 sessionId，定时任务没有活跃会话
  #   - manage_scheduled_tasks: 防止后台 agent 自行修改/删除定时任务
  # 设置为空数组 [] 可开放所有工具。
  excludeTools:
    - sub_agent
    - history_search
    - manage_scheduled_tasks

  # 工具循环最大轮次
  # 单次定时任务执行中 LLM 最多可进行的工具调用轮次。
  # 超过此轮次后强制结束并返回当前结果。
  maxToolRounds: 50

  # 单次执行超时时间（毫秒），超时后任务被中止
  # 默认 5 分钟 = 300000
  timeoutMs: 300000

  # 同时运行的最大后台任务数
  # 超过此数量的任务会被跳过（标记为 skipped）
  maxConcurrent: 3

  # 执行记录保留天数
  retentionDays: 30

  # 执行记录保留条数上限
  retentionCount: 100

# ────────────────────────────────────────
# 安静时段配置
# ────────────────────────────────────────
# 在安静时段内，非紧急任务将被跳过
quietHours:
  enabled: false
  windows:
    - start: "23:00"
      end: "07:00"
  # 是否允许紧急任务穿透安静时段
  allowUrgent: true

# ────────────────────────────────────────
# 跳过近期活跃会话
# ────────────────────────────────────────
# 如果目标会话在指定分钟内有过活动，则跳过本次投递
skipIfRecentActivity:
  enabled: false
  withinMinutes: 5
`;
}
