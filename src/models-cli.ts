/**
 * Iris 模型配置 CLI 子命令。
 *
 * `iris models` 保持原有 TUI；当带有 list/add/get/remove/default 等子命令时，
 * 走这里的纯 CLI 流程，直接修改 Iris 运行时 llm.yaml。
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { parse as parseYAML, stringify as stringifyYAML } from 'yaml';
import { atomicWriteTextFileSync, withFileLockSync } from './config/file-lock';

export type ModelsCliScope =
  | { kind: 'global' }
  | { kind: 'agent'; agentName: string };

export interface ModelsCliResult {
  ok: boolean;
  message: string;
  exitCode?: number;
}

export interface ModelsCliRunOptions {
  /** 测试/嵌入场景可显式指定数据目录；不传时使用 IRIS_DATA_DIR 或 ~/.iris。 */
  dataDir?: string;
}

interface ParsedArgs {
  scope: ModelsCliScope;
  rest: string[];
}

interface ModelEntry {
  provider?: string;
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  contextWindow?: number;
  supportsVision?: boolean;
  [key: string]: unknown;
}

interface LlmYaml {
  defaultModel?: string;
  summaryModel?: string;
  rememberPlatformModel?: boolean;
  models?: Record<string, ModelEntry | null>;
  [key: string]: unknown;
}

interface AddOptions {
  provider?: string;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  contextWindow?: number;
  supportsVision?: boolean;
  setDefault: boolean;
}

const MODEL_CLI_SUBCOMMANDS = new Set([
  'list', 'ls',
  'get', 'show',
  'add', 'update',
  'remove', 'delete', 'rm',
  'default', 'set-default',
  'help', '-h', '--help',
]);

const PROVIDER_DEFAULTS: Record<string, { model: string; baseUrl: string; contextWindow: number }> = {
  deepseek: {
    model: 'deepseek-v4-flash',
    baseUrl: 'https://api.deepseek.com/v1',
    contextWindow: 1000000,
  },
  gemini: {
    model: 'gemini-2.0-flash',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    contextWindow: 1048576,
  },
  'openai-compatible': {
    model: 'gpt-4o',
    baseUrl: 'https://api.openai.com/v1',
    contextWindow: 128000,
  },
  'openai-responses': {
    model: 'gpt-4o',
    baseUrl: 'https://api.openai.com/v1',
    contextWindow: 128000,
  },
  claude: {
    model: 'claude-sonnet-4-6',
    baseUrl: 'https://api.anthropic.com/v1',
    contextWindow: 200000,
  },
};

const HELP_TEXT = `Iris 模型配置命令

用法:
  iris models list [--global | --agent <name>]
  iris models get <name> [--global | --agent <name>]
  iris models add <name> --provider <provider> --model <model-id> [options]
  iris models remove <name> [--global | --agent <name>]
  iris models default <name> [--global | --agent <name>]

说明:
  不带子命令的 iris models 会打开原有 TUI 模型配置界面。
  默认写入 ~/.iris/configs/llm.yaml；加 --agent <name> 写入 Agent 覆盖层。

范围:
  --global, -g              写入全局 ~/.iris/configs/llm.yaml（默认）
  --agent <name>, -A <name> 写入指定 Agent 的 configs/llm.yaml

add/update 选项:
  --provider, -p <provider> deepseek | gemini | openai-compatible | openai-responses | claude | 自定义 provider
  --model, -m <model-id>    提供商真实模型 ID
  --api-key, -k <key>       API Key
  --base-url, -b <url>      Base URL（deepseek 会固定为内置默认地址）
  --context-window <n>      上下文窗口大小（用于上下文占用显示）
  --supports-vision <bool>  是否支持图片输入：true/false
  --default, -d             添加后设为 defaultModel

示例:
  iris models list
  iris models add kimi --provider openai-compatible --model kimi-k2 --api-key sk-xxx --base-url https://api.moonshot.cn/v1 --default
  iris models add claude_main -p claude -m claude-sonnet-4-6 -k sk-ant-xxx
  iris models default kimi
  iris models remove old_model
`;
export function isModelsCliSubcommand(value: string | undefined): boolean {
  return !!value && MODEL_CLI_SUBCOMMANDS.has(value);
}

export async function runModelsCli(args: string[], options: ModelsCliRunOptions = {}): Promise<ModelsCliResult> {
  const subcommand = args[0];
  const rest = args.slice(1);

  if (!subcommand || subcommand === 'help' || subcommand === '-h' || subcommand === '--help') {
    return { ok: true, message: HELP_TEXT };
  }

  try {
    switch (subcommand) {
      case 'list':
      case 'ls':
        return runList(rest, options);
      case 'get':
      case 'show':
        return runGet(rest, options);
      case 'add':
      case 'update':
        return runAdd(rest, options);
      case 'remove':
      case 'delete':
      case 'rm':
        return runRemove(rest, options);
      case 'default':
      case 'set-default':
        return runSetDefault(rest, options);
      default:
        return { ok: false, message: `未知 models 子命令: ${subcommand}\n\n${HELP_TEXT}`, exitCode: 2 };
    }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err), exitCode: 1 };
  }
}

function runList(args: string[], options: ModelsCliRunOptions): ModelsCliResult {
  const { scope } = parseScopeArgs(args);
  const target = resolveLlmTarget(scope, options);
  const effective = readEffectiveLlmConfig(scope, options);
  const models = Object.entries(effective.models ?? {})
    .filter(([, model]) => !!model && typeof model === 'object' && !Array.isArray(model));

  if (models.length === 0) {
    return { ok: true, message: `当前 scope（${describeScope(scope)}）未配置模型。\nfile: ${target.filePath}` };
  }

  const defaultModel = resolveDefaultModel(effective);
  const lines = [`模型列表（scope: ${describeScope(scope)}）:`, `file: ${target.filePath}`, ''];
  for (const [name, model] of models) {
    lines.push(formatModelSummary(name, model as ModelEntry, defaultModel === name));
  }
  return { ok: true, message: lines.join('\n') };
}

function runGet(args: string[], options: ModelsCliRunOptions): ModelsCliResult {
  const { scope, rest } = parseScopeArgs(args);
  const name = normalizeModelName(extractPositional(rest)[0]);
  if (!name) return { ok: false, message: '缺少模型名称。', exitCode: 2 };

  const effective = readEffectiveLlmConfig(scope, options);
  const model = effective.models?.[name];
  if (!model || typeof model !== 'object' || Array.isArray(model)) {
    return { ok: false, message: `未找到模型：${name}（scope: ${describeScope(scope)}）`, exitCode: 1 };
  }

  return {
    ok: true,
    message: [
      `${name}:`,
      `  default: ${resolveDefaultModel(effective) === name}`,
      `  provider: ${model.provider ?? 'gemini'}`,
      `  model: ${model.model ?? ''}`,
      `  baseUrl: ${model.baseUrl ?? ''}`,
      `  apiKey: ${model.apiKey ? maskSecret(String(model.apiKey)) : '(未配置)'}`,
      ...(typeof model.contextWindow === 'number' ? [`  contextWindow: ${model.contextWindow}`] : []),
      ...(typeof model.supportsVision === 'boolean' ? [`  supportsVision: ${model.supportsVision}`] : []),
    ].join('\n'),
  };
}

function runAdd(args: string[], options: ModelsCliRunOptions): ModelsCliResult {
  const { scope, rest } = parseScopeArgs(args);
  const { addOptions, positional } = parseAddArgs(rest);
  const name = normalizeModelName(positional[0]);
  if (!name) return { ok: false, message: '缺少模型名称。\n\n' + HELP_TEXT, exitCode: 2 };

  const target = resolveLlmTarget(scope, options);
  return withFileLockSync(target.filePath, () => {
    const llm = readLlmFile(target.filePath);
    llm.models ??= {};

    const effectiveBefore = readEffectiveLlmConfig(scope, options);
    const effectiveExisting = effectiveBefore.models?.[name]
      && typeof effectiveBefore.models[name] === 'object'
      && !Array.isArray(effectiveBefore.models[name])
      ? effectiveBefore.models[name] as ModelEntry
      : {};
    const localExisting = llm.models[name] && typeof llm.models[name] === 'object' && !Array.isArray(llm.models[name])
      ? llm.models[name] as ModelEntry
      : {};
    const existing = Object.keys(localExisting).length > 0 ? localExisting : effectiveExisting;
    const wasExisting = Object.keys(effectiveExisting).length > 0 || Object.keys(localExisting).length > 0;
    const hadEffectiveDefault = !!resolveDefaultModel(effectiveBefore);
    const provider = addOptions.provider ?? existing.provider ?? 'gemini';
    const defaults = PROVIDER_DEFAULTS[provider] ?? PROVIDER_DEFAULTS.gemini;
    const modelId = provider === 'deepseek'
      ? normalizeDeepSeekModelId(addOptions.model ?? existing.model ?? defaults.model)
      : addOptions.model ?? existing.model ?? defaults.model;

    const entry: ModelEntry = removeUndefined({
      ...existing,
      provider,
      model: modelId,
      apiKey: addOptions.apiKey ?? existing.apiKey ?? '',
      baseUrl: provider === 'deepseek' ? defaults.baseUrl : addOptions.baseUrl ?? existing.baseUrl ?? defaults.baseUrl,
      contextWindow: addOptions.contextWindow ?? existing.contextWindow ?? defaults.contextWindow,
      supportsVision: addOptions.supportsVision ?? existing.supportsVision,
    });

    llm.models[name] = entry;
    if (addOptions.setDefault || !hadEffectiveDefault) {
      llm.defaultModel = name;
    }
    writeLlmFile(target.filePath, llm);

    return {
      ok: true,
      message: [
        `已${wasExisting ? '更新' : '添加'}模型：${name}`,
        `  provider: ${entry.provider}`,
        `  model: ${entry.model}`,
        `  default: ${llm.defaultModel === name}`,
        `  scope: ${describeScope(scope)}`,
        `  file: ${target.filePath}`,
      ].join('\n'),
    };
  });
}

function runRemove(args: string[], options: ModelsCliRunOptions): ModelsCliResult {
  const { scope, rest } = parseScopeArgs(args);
  const name = normalizeModelName(extractPositional(rest)[0]);
  if (!name) return { ok: false, message: '缺少模型名称。', exitCode: 2 };

  const target = resolveLlmTarget(scope, options);
  return withFileLockSync(target.filePath, () => {
    const llm = readLlmFile(target.filePath);
    const effectiveBefore = readEffectiveLlmConfig(scope, options);
    const existsInEffective = !!effectiveBefore.models?.[name] && typeof effectiveBefore.models[name] === 'object';

    if (!existsInEffective) {
      return { ok: false, message: `未找到模型：${name}（scope: ${describeScope(scope)}）`, exitCode: 1 };
    }

    llm.models ??= {};
    const global = scope.kind === 'agent'
      ? readLlmFile(path.join(getRuntimeDataDir(options), 'configs', 'llm.yaml'))
      : undefined;
    const inheritedFromGlobal = !!global?.models?.[name]
      && typeof global.models[name] === 'object'
      && !Array.isArray(global.models[name]);
    if (scope.kind === 'agent' && inheritedFromGlobal) {
      // Agent 覆盖层删除全局继承模型时，写 null 作为遮罩，确保从合并后的有效配置中移除。
      llm.models[name] = null;
    } else {
      delete llm.models[name];
    }

    if (llm.defaultModel === name) {
      delete llm.defaultModel;
    }
    writeLlmFile(target.filePath, llm);

    const latest = readLlmFile(target.filePath);
    const effectiveAfter = readEffectiveLlmConfig(scope, options);
    const nextDefault = resolveDefaultModel(effectiveAfter);
    if (!latest.defaultModel && nextDefault) {
      latest.defaultModel = nextDefault;
      writeLlmFile(target.filePath, latest);
    }

    return { ok: true, message: `已移除模型：${name}\nfile: ${target.filePath}` };
  });
}

function runSetDefault(args: string[], options: ModelsCliRunOptions): ModelsCliResult {
  const { scope, rest } = parseScopeArgs(args);
  const name = normalizeModelName(extractPositional(rest)[0]);
  if (!name) return { ok: false, message: '缺少模型名称。', exitCode: 2 };

  const target = resolveLlmTarget(scope, options);
  return withFileLockSync(target.filePath, () => {
    const effective = readEffectiveLlmConfig(scope, options);
    const model = effective.models?.[name];
    if (!model || typeof model !== 'object' || Array.isArray(model)) {
      return { ok: false, message: `未找到模型：${name}（scope: ${describeScope(scope)}）`, exitCode: 1 };
    }

    const llm = readLlmFile(target.filePath);
    llm.defaultModel = name;
    writeLlmFile(target.filePath, llm);

    return { ok: true, message: `已设置默认模型：${name}\nfile: ${target.filePath}` };
  });
}

function parseScopeArgs(args: string[]): ParsedArgs {
  let scope: ModelsCliScope = { kind: 'global' };
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
  const addOptions: AddOptions = { setDefault: false };
  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--') {
      positional.push(...args.slice(i + 1));
     break;
    }
    if (arg === '--provider' || arg === '-p') {
      addOptions.provider = requireValue(args, ++i, arg);
      continue;
    }
    if (arg.startsWith('--provider=')) {
      addOptions.provider = arg.slice('--provider='.length).trim();
      continue;
    }
    if (arg === '--model' || arg === '-m') {
      addOptions.model = requireValue(args, ++i, arg);
      continue;
    }
    if (arg.startsWith('--model=')) {
      addOptions.model = arg.slice('--model='.length).trim();
      continue;
    }
    if (arg === '--api-key' || arg === '-k') {
      addOptions.apiKey = requireValue(args, ++i, arg);
      continue;
    }
    if (arg.startsWith('--api-key=')) {
      addOptions.apiKey = arg.slice('--api-key='.length);
      continue;
    }
    if (arg === '--base-url' || arg === '-b') {
      addOptions.baseUrl = requireValue(args, ++i, arg);
      continue;
    }
    if (arg.startsWith('--base-url=')) {
      addOptions.baseUrl = arg.slice('--base-url='.length).trim();
      continue;
    }
    if (arg === '--context-window') {
      addOptions.contextWindow = Number(requireValue(args, ++i, arg));
      continue;
    }
    if (arg.startsWith('--context-window=')) {
      addOptions.contextWindow = Number(arg.slice('--context-window='.length));
      continue;
    }
    if (arg === '--supports-vision') {
      addOptions.supportsVision = parseBoolean(requireValue(args, ++i, arg));
      continue;
    }
    if (arg.startsWith('--supports-vision=')) {
      addOptions.supportsVision = parseBoolean(arg.slice('--supports-vision='.length));
      continue;
    }
    if (arg === '--default' || arg === '-d') {
      addOptions.setDefault = true;
      continue;
    }
    positional.push(arg);
  }

  if (addOptions.provider !== undefined) {
    addOptions.provider = normalizeProvider(addOptions.provider);
  }
  if (addOptions.contextWindow !== undefined && (!Number.isFinite(addOptions.contextWindow) || addOptions.contextWindow <= 0)) {
    throw new Error('--context-window 必须为正数');
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

function normalizeProvider(value: string): string {
  const provider = value.trim();
  if (!provider) throw new Error('provider 不能为空');
  return provider;
}

function normalizeModelName(value: string | undefined): string {
  const name = (value ?? '').trim();
  if (!name) return '';
  if (!/^[a-zA-Z0-9_.-]+$/.test(name)) {
    throw new Error(`模型名称 "${name}" 无效：仅支持字母、数字、下划线、点和连字符`);
  }
  return name;
}

function normalizeDeepSeekModelId(modelId: unknown): string {
  const value = typeof modelId === 'string' ? modelId.trim() : '';
  return value === 'deepseek-v4-pro' ? value : 'deepseek-v4-flash';
}

function parseBoolean(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'n', 'off'].includes(normalized)) return false;
  throw new Error(`布尔值无效: ${value}（应为 true/false）`);
}

function getRuntimeDataDir(options: ModelsCliRunOptions): string {
  return path.resolve(options.dataDir || process.env.IRIS_DATA_DIR || path.join(os.homedir(), '.iris'));
}

function resolveLlmTarget(scope: ModelsCliScope, options: ModelsCliRunOptions): { filePath: string } {
  const dataDir = getRuntimeDataDir(options);
  if (scope.kind === 'global') {
    return { filePath: path.join(dataDir, 'configs', 'llm.yaml') };
  }

  const manifestPath = path.join(dataDir, 'agents.yaml');
  const agentDataDir = resolveAgentDataDir(manifestPath, dataDir, scope.agentName);
  return { filePath: path.join(agentDataDir, 'configs', 'llm.yaml') };
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

function readLlmFile(filePath: string): LlmYaml {
  if (!fs.existsSync(filePath)) return { models: {} };
  const raw = parseYAML(fs.readFileSync(filePath, 'utf-8')) as unknown;
  if (raw === undefined || raw === null) return { models: {} };
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`llm.yaml 格式无效，应为对象: ${filePath}`);
  }
  const data = raw as LlmYaml;
  return { ...data, models: { ...(data.models ?? {}) } };
}

function readEffectiveLlmConfig(scope: ModelsCliScope, options: ModelsCliRunOptions): LlmYaml {
  const globalPath = path.join(getRuntimeDataDir(options), 'configs', 'llm.yaml');
  const global = readLlmFile(globalPath);
  if (scope.kind === 'global') return global;

  const agent = readLlmFile(resolveLlmTarget(scope, options).filePath);
  return {
    ...global,
    ...agent,
    models: {
      ...(global.models ?? {}),
      ...(agent.models ?? {}),
    },
  };
}

function writeLlmFile(filePath: string, config: LlmYaml): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const output = `# LLM 配置（模型池）\n\n${stringifyYAML(cleanLlmConfig(config), { indent: 2 })}`;
  atomicWriteTextFileSync(filePath, output);
}

function cleanLlmConfig(config: LlmYaml): LlmYaml {
  const models = config.models ?? {};
  const next: LlmYaml = { ...config, models };
  if (!next.defaultModel) {
    const first = Object.entries(models).find(([, value]) => value && typeof value === 'object')?.[0];
    if (first) next.defaultModel = first;
  }
  return next;
}

function resolveDefaultModel(config: LlmYaml): string | undefined {
  const requested = typeof config.defaultModel === 'string' ? config.defaultModel.trim() : '';
  if (requested && config.models?.[requested] && typeof config.models[requested] === 'object') return requested;
  return Object.entries(config.models ?? {}).find(([, value]) => value && typeof value === 'object')?.[0];
}

function formatModelSummary(name: string, model: ModelEntry, isDefault: boolean): string {
  const marker = isDefault ? '*' : ' ';
  const provider = model.provider ?? 'gemini';
  const modelId = model.model ?? '';
  const baseUrl = model.baseUrl ? ` · ${model.baseUrl}` : '';
  return `${marker} ${name}: ${provider} · ${modelId}${baseUrl}`;
}

function maskSecret(value: string): string {
  if (!value) return '';
  if (value.length <= 4) return '****';
  return `****${value.slice(-4)}`;
}

function removeUndefined<T extends object>(value: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) out[key] = entry;
  }
  return out as T;
}

function describeScope(scope: ModelsCliScope): string {
  return scope.kind === 'global' ? '全局 ~/.iris/configs' : `Agent ${scope.agentName}`;
}
