/**
 * Iris Cron CLI 子命令。
 *
 * 直接管理 cron extension 的运行时配置和任务文件：
 * - 配置：{dataDir}/configs/cron.yaml
 * - 任务：{dataDir}/extension-data/cron/cron-jobs.json
 *
 * 运行中的 cron extension 会监听 cron-jobs.json，因此任务增删启停通常会在短时间内同步。
 * cron.yaml 配置修改是持久化配置；当前运行中的调度器是否立即应用取决于运行时热重载。
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Cron } from 'croner';
import { parse as parseYAML, stringify as stringifyYAML } from 'yaml';
import { atomicWriteJsonFileSync, atomicWriteTextFileSync, withFileLockSync } from './config/file-lock';

export type CronCliScope =
  | { kind: 'global' }
  | { kind: 'agent'; agentName: string };

export interface CronCliResult {
  ok: boolean;
  message: string;
  exitCode?: number;
}

export interface CronCliRunOptions {
  /** 测试/嵌入场景可显式指定数据目录；不传时使用 IRIS_DATA_DIR 或 ~/.iris。 */
  dataDir?: string;
}

type ScheduleConfig =
  | { type: 'cron'; expression: string }
  | { type: 'interval'; ms: number }
  | { type: 'once'; at: number };

interface ScheduledJob {
  id: string;
  name: string;
  schedule: ScheduleConfig;
  sessionId: string;
  instruction: string;
  delivery: { sessionId?: string; fallback: 'last-active' };
  silent: boolean;
  urgent: boolean;
  condition?: string;
  allowedTools?: string[];
  excludeTools?: string[];
  enabled: boolean;
  createdAt: number;
  createdInSession: string;
  lastRunAt?: number;
  lastRunStatus?: string;
  lastRunError?: string;
}

interface CronYaml {
  enabled?: boolean;
  quietHours?: {
    enabled?: boolean;
    windows?: Array<{ start: string; end: string }>;
    allowUrgent?: boolean;
  };
  skipIfRecentActivity?: {
    enabled?: boolean;
    withinMinutes?: number;
  };
  backgroundExecution?: Record<string, unknown>;
  [key: string]: unknown;
}

interface ParsedArgs {
  scope: CronCliScope;
  rest: string[];
}

interface AddOptions {
  scheduleType?: 'cron' | 'interval' | 'once';
  scheduleValue?: string;
  instruction?: string;
  sessionId?: string;
  silent?: boolean;
  urgent?: boolean;
  condition?: string;
  allowedTools?: string[];
  excludeTools?: string[];
  enabled?: boolean;
}

const CRON_CLI_SUBCOMMANDS = new Set([
  'status',
  'config',
  'list', 'ls',
  'get', 'show',
  'add', 'create',
  'remove', 'delete', 'rm',
  'enable',
  'disable',
  'help', '-h', '--help',
]);

const HELP_TEXT = `Iris Cron 定时任务命令

用法:
  iris cron status [--global | --agent <name>]
  iris cron config show|enable|disable [--global | --agent <name>]
  iris cron list [--global | --agent <name>]
  iris cron get <id-or-name> [--global | --agent <name>]
  iris cron add <name> --type <cron|interval|once> --value <expr|duration> --instruction <text> [options]
  iris cron remove <id-or-name> [--global | --agent <name>]
  iris cron enable <id-or-name> [--global | --agent <name>]
  iris cron disable <id-or-name> [--global | --agent <name>]

范围:
  --global, -g              使用全局 ~/.iris/ 的 cron 配置和任务（默认）
  --agent <name>, -A <name> 使用指定 Agent 的 cron 配置和任务

add 选项:
  --type, -t <type>         cron | interval | once
  --value, -v <value>       cron 表达式、间隔或一次性时间
  --instruction, -i <text>  任务触发时交给后台 Agent 执行的指令
  --session <id>            投递目标 sessionId（默认 cron-cli）
  --silent                  静默任务，只发轻量通知/记录，不触发主会话回复
  --urgent                  紧急任务，可穿透安静时段
  --condition <expr>        条件表达式
  --allow-tools <a,b>       工具白名单
  --exclude-tools <a,b>     工具黑名单
  --disabled                创建后保持禁用

时间值:
  interval: 支持毫秒数或 30s / 5m / 2h / 1d
  once:     支持 30s / 5m / 2h / 1d 或 2026-04-03 17:30
  cron:     建议用引号包裹，例如 "0 9 * * 1-5"

示例:
  iris cron config enable
  iris cron add morning --type cron --value "0 9 * * *" --instruction "生成一条早安问候" --silent
  iris cron add check --type interval --value 30m --instruction "检查项目状态并总结"
  iris cron add reminder --type once --value 10m --instruction "提醒我喝水"
  iris cron list
  iris cron disable morning
`;

export function isCronCliSubcommand(value: string | undefined): boolean {
  return !!value && CRON_CLI_SUBCOMMANDS.has(value);
}

export async function runCronCli(args: string[], options: CronCliRunOptions = {}): Promise<CronCliResult> {
  const subcommand = args[0];
  const rest = args.slice(1);

  if (!subcommand || subcommand === 'help' || subcommand === '-h' || subcommand === '--help') {
    return { ok: true, message: HELP_TEXT };
  }

  try {
    switch (subcommand) {
      case 'status':
        return runStatus(rest, options);
      case 'config':
        return runConfig(rest, options);
      case 'list':
      case 'ls':
        return runList(rest, options);
      case 'get':
      case 'show':
        return runGet(rest, options);
      case 'add':
      case 'create':
        return runAdd(rest, options);
      case 'remove':
      case 'delete':
      case 'rm':
        return runRemove(rest, options);
      case 'enable':
        return runSetJobEnabled(rest, true, options);
      case 'disable':
        return runSetJobEnabled(rest, false, options);
      default:
        return { ok: false, message: `未知 cron 子命令: ${subcommand}\n\n${HELP_TEXT}`, exitCode: 2 };
    }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err), exitCode: 1 };
  }
}

function runStatus(args: string[], options: CronCliRunOptions): CronCliResult {
  const { scope } = parseScopeArgs(args);
  const target = resolveCronTarget(scope, options);
  const config = readCronConfig(target.configPath);
  const jobs = readJobs(target.jobsPath);

  return {
    ok: true,
    message: [
      `Cron 状态（scope: ${describeScope(scope)}）:`,
      `  scheduler enabled: ${config.enabled !== false}`,
      `  quietHours: ${config.quietHours?.enabled === true ? 'enabled' : 'disabled'}`,
      `  jobs: ${jobs.length} (${jobs.filter((job) => job.enabled).length} enabled)`,
      `  config: ${target.configPath}`,
      `  jobsFile: ${target.jobsPath}`,
    ].join('\n'),
  };
}

function runConfig(args: string[], options: CronCliRunOptions): CronCliResult {
  const { scope, rest } = parseScopeArgs(args);
  const configAction = extractPositional(rest)[0] ?? 'show';
  const target = resolveCronTarget(scope, options);
  const config = readCronConfig(target.configPath);

  if (configAction === 'show') {
    return {
      ok: true,
      message: [
        `Cron 配置（scope: ${describeScope(scope)}）:`,
        `  enabled: ${config.enabled !== false}`,
        `  quietHours.enabled: ${config.quietHours?.enabled === true}`,
        `  skipIfRecentActivity.enabled: ${config.skipIfRecentActivity?.enabled !== false}`,
        `  file: ${target.configPath}`,
      ].join('\n'),
    };
  }

  if (configAction !== 'enable' && configAction !== 'disable') {
    return { ok: false, message: `未知 cron config 子命令: ${configAction}（支持 show/enable/disable）`, exitCode: 2 };
  }

  return withFileLockSync(target.configPath, () => {
    const latestConfig = readCronConfig(target.configPath);
    latestConfig.enabled = configAction === 'enable';
    writeCronConfig(target.configPath, latestConfig);
    return {
      ok: true,
      message: [
        `已${latestConfig.enabled ? '启用' : '禁用'} cron 调度器配置。`,
        `file: ${target.configPath}`,
        '提示：如果 Iris 已经在运行，配置文件监听器会尝试自动热重载。',
      ].join('\n'),
    };
  });
}

function runList(args: string[], options: CronCliRunOptions): CronCliResult {
  const { scope } = parseScopeArgs(args);
  const target = resolveCronTarget(scope, options);
  const jobs = readJobs(target.jobsPath);

  if (jobs.length === 0) {
    return { ok: true, message: `当前 scope（${describeScope(scope)}）没有定时任务。\njobsFile: ${target.jobsPath}` };
  }

  const lines = [`定时任务（scope: ${describeScope(scope)}）:`, `jobsFile: ${target.jobsPath}`, ''];
  for (const job of jobs) {
    lines.push(formatJobSummary(job));
  }
  return { ok: true, message: lines.join('\n') };
}

function runGet(args: string[], options: CronCliRunOptions): CronCliResult {
  const { scope, rest } = parseScopeArgs(args);
  const key = extractPositional(rest)[0]?.trim();
  if (!key) return { ok: false, message: '缺少任务 ID 或名称。', exitCode: 2 };

  const target = resolveCronTarget(scope, options);
  const jobs = readJobs(target.jobsPath);
  const job = findJob(jobs, key);
  if (!job) return { ok: false, message: `未找到任务：${key}`, exitCode: 1 };

  return {
    ok: true,
    message: [
      `${job.name}:`,
      `  id: ${job.id}`,
      `  enabled: ${job.enabled}`,
      `  schedule: ${formatSchedule(job.schedule)}`,
      `  sessionId: ${job.sessionId}`,
      `  silent: ${job.silent}`,
      `  urgent: ${job.urgent}`,
      ...(job.condition ? [`  condition: ${job.condition}`] : []),
      ...(job.allowedTools?.length ? [`  allowedTools: ${job.allowedTools.join(', ')}`] : []),
      ...(job.excludeTools?.length ? [`  excludeTools: ${job.excludeTools.join(', ')}`] : []),
      `  instruction: ${job.instruction}`,
      `  createdAt: ${new Date(job.createdAt).toISOString()}`,
      ...(job.lastRunAt ? [`  lastRunAt: ${new Date(job.lastRunAt).toISOString()}`] : []),
      ...(job.lastRunStatus ? [`  lastRunStatus: ${job.lastRunStatus}`] : []),
      ...(job.lastRunError ? [`  lastRunError: ${job.lastRunError}`] : []),
    ].join('\n'),
  };
}

function runAdd(args: string[], options: CronCliRunOptions): CronCliResult {
  const { scope, rest } = parseScopeArgs(args);
  const { addOptions, positional } = parseAddArgs(rest);
  const name = positional[0]?.trim();
  if (!name) return { ok: false, message: '缺少任务名称。\n\n' + HELP_TEXT, exitCode: 2 };
  if (!addOptions.scheduleType) return { ok: false, message: '缺少 --type。\n\n' + HELP_TEXT, exitCode: 2 };
  if (!addOptions.scheduleValue) return { ok: false, message: '缺少 --value。\n\n' + HELP_TEXT, exitCode: 2 };
  if (!addOptions.instruction) return { ok: false, message: '缺少 --instruction。\n\n' + HELP_TEXT, exitCode: 2 };
  const scheduleType = addOptions.scheduleType;
  const scheduleValue = addOptions.scheduleValue;
  const instruction = addOptions.instruction;

  const target = resolveCronTarget(scope, options);
  return withFileLockSync(target.jobsPath, () => {
    const jobs = readJobs(target.jobsPath);
    const now = Date.now();
    const sessionId = addOptions.sessionId ?? 'cron-cli';
    const job: ScheduledJob = {
      id: createJobId(),
      name,
      schedule: parseSchedule(scheduleType, scheduleValue),
      sessionId,
      instruction,
      delivery: { sessionId, fallback: 'last-active' },
      silent: addOptions.silent ?? false,
      urgent: addOptions.urgent ?? false,
      condition: addOptions.condition,
      allowedTools: addOptions.allowedTools?.length ? addOptions.allowedTools : undefined,
      excludeTools: (!addOptions.allowedTools?.length && addOptions.excludeTools?.length) ? addOptions.excludeTools : undefined,
      enabled: addOptions.enabled ?? true,
      createdAt: now,
      createdInSession: sessionId,
    };

    jobs.push(removeUndefined(job));
    writeJobs(target.jobsPath, jobs);
    return {
      ok: true,
      message: [
        `已创建定时任务：${job.name}`,
        `  id: ${job.id}`,
        `  schedule: ${formatSchedule(job.schedule)}`,
        `  enabled: ${job.enabled}`,
        `  jobsFile: ${target.jobsPath}`,
      ].join('\n'),
    };
  });
}

function runRemove(args: string[], options: CronCliRunOptions): CronCliResult {
  const { scope, rest } = parseScopeArgs(args);
  const key = extractPositional(rest)[0]?.trim();
  if (!key) return { ok: false, message: '缺少任务 ID 或名称。', exitCode: 2 };

  const target = resolveCronTarget(scope, options);
  return withFileLockSync(target.jobsPath, () => {
    const jobs = readJobs(target.jobsPath);
    const job = findJob(jobs, key);
    if (!job) return { ok: false, message: `未找到任务：${key}`, exitCode: 1 };

    writeJobs(target.jobsPath, jobs.filter((item) => item.id !== job.id));
    return { ok: true, message: `已删除定时任务：${job.name} (${job.id})\njobsFile: ${target.jobsPath}` };
  });
}

function runSetJobEnabled(args: string[], enabled: boolean, options: CronCliRunOptions): CronCliResult {
  const { scope, rest } = parseScopeArgs(args);
  const key = extractPositional(rest)[0]?.trim();
  if (!key) return { ok: false, message: '缺少任务 ID 或名称。', exitCode: 2 };

  const target = resolveCronTarget(scope, options);
  return withFileLockSync(target.jobsPath, () => {
    const jobs = readJobs(target.jobsPath);
    const job = findJob(jobs, key);
    if (!job) return { ok: false, message: `未找到任务：${key}`, exitCode: 1 };

    job.enabled = enabled;
    writeJobs(target.jobsPath, jobs);
    return { ok: true, message: `已${enabled ? '启用' : '禁用'}定时任务：${job.name} (${job.id})\njobsFile: ${target.jobsPath}` };
  });
}

function parseScopeArgs(args: string[]): ParsedArgs {
  let scope: CronCliScope = { kind: 'global' };
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--global' || arg === '-g') {
      scope = { kind: 'global' };
      continue;
    }
    if (arg === '--agent' || arg === '-A') {
      const agentName = args[++i];
      if (!agentName) throw new Error(`${arg} 需要 Agent 名称`);
      scope = { kind: 'agent', agentName };
      continue;
    }
    if (arg.startsWith('--agent=')) {
      const agentName = arg.slice('--agent='.length).trim();
      if (!agentName) throw new Error('--agent 需要 Agent 名称');
      scope = { kind: 'agent', agentName };
      continue;
    }
    rest.push(arg);
  }
  return { scope, rest };
}

function parseAddArgs(args: string[]): { addOptions: AddOptions; positional: string[] } {
  const addOptions: AddOptions = {};
  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--') {
      positional.push(...args.slice(i + 1));
      break;
    }
    if (arg === '--type' || arg === '-t') {
      addOptions.scheduleType = normalizeScheduleType(requireValue(args, ++i, arg));
      continue;
    }
    if (arg.startsWith('--type=')) {
      addOptions.scheduleType = normalizeScheduleType(arg.slice('--type='.length));
      continue;
    }
    if (arg === '--value' || arg === '-v') {
      addOptions.scheduleValue = requireValue(args, ++i, arg);
      continue;
    }
    if (arg.startsWith('--value=')) {
      addOptions.scheduleValue = arg.slice('--value='.length);
      continue;
    }
    if (arg === '--instruction' || arg === '-i') {
      addOptions.instruction = requireValue(args, ++i, arg);
      continue;
    }
    if (arg.startsWith('--instruction=')) {
      addOptions.instruction = arg.slice('--instruction='.length);
      continue;
    }
    if (arg === '--session') {
      addOptions.sessionId = requireValue(args, ++i, arg);
      continue;
    }
    if (arg.startsWith('--session=')) {
      addOptions.sessionId = arg.slice('--session='.length);
      continue;
    }
    if (arg === '--condition') {
      addOptions.condition = requireValue(args, ++i, arg);
      continue;
    }
    if (arg.startsWith('--condition=')) {
      addOptions.condition = arg.slice('--condition='.length);
      continue;
    }
    if (arg === '--allow-tools') {
      addOptions.allowedTools = parseCsv(requireValue(args, ++i, arg));
      continue;
    }
    if (arg.startsWith('--allow-tools=')) {
      addOptions.allowedTools = parseCsv(arg.slice('--allow-tools='.length));
      continue;
    }
    if (arg === '--exclude-tools') {
      addOptions.excludeTools = parseCsv(requireValue(args, ++i, arg));
      continue;
    }
    if (arg.startsWith('--exclude-tools=')) {
      addOptions.excludeTools = parseCsv(arg.slice('--exclude-tools='.length));
      continue;
    }
    if (arg === '--silent') {
      addOptions.silent = true;
      continue;
    }
    if (arg === '--urgent') {
      addOptions.urgent = true;
      continue;
    }
    if (arg === '--disabled') {
      addOptions.enabled = false;
      continue;
    }
    positional.push(arg);
  }

  return { addOptions, positional };
}

function extractPositional(args: string[]): string[] {
  const { rest } = parseScopeArgs(args);
  return rest.filter((arg) => !arg.startsWith('-'));
}

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value) throw new Error(`${flag} 需要值`);
  return value;
}

function normalizeScheduleType(value: string): AddOptions['scheduleType'] {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'cron' || normalized === 'interval' || normalized === 'once') return normalized;
  throw new Error(`不支持的调度类型: ${value}（支持 cron / interval / once）`);
}

function parseSchedule(type: 'cron' | 'interval' | 'once', value: string): ScheduleConfig {
  if (type === 'cron') {
    const expression = value.trim();
    if (!expression) throw new Error('cron 表达式不能为空');
    try {
      const nextRun = new Cron(expression).nextRun();
      if (!nextRun) throw new Error('无法计算下一次触发时间');
    } catch (err) {
      throw new Error(`无效 cron 表达式: ${expression}（${err instanceof Error ? err.message : String(err)}）`);
    }
    return { type: 'cron', expression };
  }
  if (type === 'interval') {
    const ms = parseDurationMs(value);
    if (ms <= 0) throw new Error(`无效 interval 值: ${value}`);
    return { type: 'interval', ms };
  }
  return { type: 'once', at: parseOnceAt(value) };
}

function parseDurationMs(value: string): number {
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const match = trimmed.match(/^(\d+(?:\.\d+)?)\s*(s|sec|second|seconds|m|min|minute|minutes|h|hr|hour|hours|d|day|days)$/i);
  if (!match) throw new Error(`无法解析时间间隔: ${value}`);
  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  if (unit.startsWith('s')) return Math.round(amount * 1000);
  if (unit === 'm' || unit.startsWith('min')) return Math.round(amount * 60 * 1000);
  if (unit.startsWith('h')) return Math.round(amount * 60 * 60 * 1000);
  if (unit.startsWith('d')) return Math.round(amount * 24 * 60 * 60 * 1000);
  throw new Error(`无法解析时间单位: ${unit}`);
}

function parseOnceAt(value: string): number {
  const trimmed = value.trim();
  if (/^\d+(?:\.\d+)?\s*(s|sec|second|seconds|m|min|minute|minutes|h|hr|hour|hours|d|day|days)$/i.test(trimmed)) {
    return Date.now() + parseDurationMs(trimmed);
  }
  if (/^\d+$/.test(trimmed)) {
    const numeric = Number(trimmed);
    return numeric > 1577836800000 ? numeric : Date.now() + numeric;
  }
  const normalized = trimmed.replace(/^(\d{4}-\d{2}-\d{2})\s+/, '$1T');
  const parsed = Date.parse(normalized);
  if (Number.isNaN(parsed)) throw new Error(`无法解析 once 时间: ${value}`);
  if (parsed <= Date.now()) throw new Error(`once 时间已经过去: ${value}`);
  return parsed;
}

function parseCsv(value: string): string[] {
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function getRuntimeDataDir(options: CronCliRunOptions): string {
  return path.resolve(options.dataDir || process.env.IRIS_DATA_DIR || path.join(os.homedir(), '.iris'));
}

function resolveCronTarget(scope: CronCliScope, options: CronCliRunOptions): { configPath: string; jobsPath: string } {
  const dataDir = getRuntimeDataDir(options);
  const rootDir = scope.kind === 'global'
    ? dataDir
    : resolveAgentDataDir(path.join(dataDir, 'agents.yaml'), dataDir, scope.agentName);
  return {
    configPath: path.join(rootDir, 'configs', 'cron.yaml'),
    jobsPath: path.join(rootDir, 'extension-data', 'cron', 'cron-jobs.json'),
  };
}

function resolveAgentDataDir(manifestPath: string, dataDir: string, agentName: string): string {
  if (!fs.existsSync(manifestPath)) return path.join(dataDir, 'agents', agentName);
  try {
    const manifest = parseYAML(fs.readFileSync(manifestPath, 'utf-8')) as any;
    const agent = manifest?.agents?.[agentName];
    if (agent?.dataDir && typeof agent.dataDir === 'string') return path.resolve(agent.dataDir);
  } catch {
    // agents.yaml 解析失败时使用默认路径，避免 CLI 因无关配置阻塞全局操作。
  }
  return path.join(dataDir, 'agents', agentName);
}

function readCronConfig(filePath: string): CronYaml {
  if (!fs.existsSync(filePath)) return defaultCronConfig();
  const raw = parseYAML(fs.readFileSync(filePath, 'utf-8')) as unknown;
  if (raw === undefined || raw === null) return defaultCronConfig();
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`cron.yaml 格式无效，应为对象: ${filePath}`);
  return { ...defaultCronConfig(), ...(raw as CronYaml) };
}

function writeCronConfig(filePath: string, config: CronYaml): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const output = `# 定时任务调度插件配置\n\n${stringifyYAML(config, { indent: 2 })}`;
  atomicWriteTextFileSync(filePath, output);
}

function defaultCronConfig(): CronYaml {
  return {
    enabled: true,
    quietHours: {
      enabled: false,
      windows: [{ start: '23:00', end: '07:00' }],
      allowUrgent: true,
    },
    skipIfRecentActivity: {
      enabled: false,
      withinMinutes: 5,
    },
  };
}

function readJobs(filePath: string): ScheduledJob[] {
  if (!fs.existsSync(filePath)) return [];
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as unknown;
  if (!Array.isArray(parsed)) throw new Error(`cron-jobs.json 格式无效，应为数组: ${filePath}`);
  return parsed.filter((item): item is ScheduledJob => !!item && typeof item === 'object' && typeof (item as any).id === 'string');
}

function writeJobs(filePath: string, jobs: ScheduledJob[]): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  atomicWriteJsonFileSync(filePath, jobs);
}

function findJob(jobs: ScheduledJob[], key: string): ScheduledJob | undefined {
  const byId = jobs.find((job) => job.id === key);
  if (byId) return byId;
  const byName = jobs.filter((job) => job.name === key);
  if (byName.length > 1) {
    throw new Error(`任务名称 "${key}" 匹配到多个任务，请改用 ID。`);
  }
  return byName[0];
}

function createJobId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `cron_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function formatJobSummary(job: ScheduledJob): string {
  const enabled = job.enabled ? '✓' : '✗';
  const status = job.lastRunStatus ? ` · last=${job.lastRunStatus}` : '';
  return `${enabled} ${job.name} (${job.id}) · ${formatSchedule(job.schedule)}${status}`;
}

function formatSchedule(schedule: ScheduleConfig): string {
  if (schedule.type === 'cron') return `cron ${schedule.expression}`;
  if (schedule.type === 'interval') return `interval ${schedule.ms}ms`;
  return `once ${new Date(schedule.at).toISOString()}`;
}

function removeUndefined<T extends object>(value: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) out[key] = entry;
  }
  return out as T;
}

function describeScope(scope: CronCliScope): string {
  return scope.kind === 'global' ? '全局 ~/.iris' : `Agent ${scope.agentName}`;
}
