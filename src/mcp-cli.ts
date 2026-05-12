/**
 * Iris MCP CLI 子命令。
 *
 * 目标是提供类似 `claude mcp add ...` 的一次性命令体验，但写入 Iris 自己的
 * 运行时配置目录（默认 ~/.iris/configs/mcp.yaml，可通过 IRIS_DATA_DIR 覆盖）。
 *
 * 支持：
 *   iris mcp add --transport http exa https://mcp.exa.ai/mcp
 *   iris mcp add filesystem -- npx -y @modelcontextprotocol/server-filesystem /tmp
 *   iris mcp list
 *   iris mcp get exa
 *   iris mcp remove exa
 *   iris mcp enable exa / iris mcp disable exa
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { parse as parseYAML, stringify as stringifyYAML } from 'yaml';
import { atomicWriteTextFileSync, withFileLockSync } from './config/file-lock';

export type McpCliScope =
  | { kind: 'global' }
  | { kind: 'agent'; agentName: string };

export type McpCliTransport = 'stdio' | 'sse' | 'streamable-http';

export interface McpCliServerConfig {
  transport: McpCliTransport;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  headers?: Record<string, string>;
  timeout?: number;
  enabled?: boolean;
}

export interface McpCliConfig {
  servers?: Record<string, McpCliServerConfig>;
}

export interface McpCliResult {
  ok: boolean;
  message: string;
  exitCode?: number;
}

export interface McpCliRunOptions {
  /** 测试/嵌入场景可显式指定数据目录；不传时使用 IRIS_DATA_DIR 或 ~/.iris。 */
  dataDir?: string;
  /** 输出警告信息（例如 URL 被当成 stdio command 时）。 */
  stderr?: (message: string) => void;
}

interface ParsedArgs {
  scope: McpCliScope;
  rest: string[];
}

interface AddOptions {
  transport?: McpCliTransport;
  transportExplicit: boolean;
  headers: string[];
  env: string[];
  timeout?: number;
  cwd?: string;
}

const HELP_TEXT = `Iris MCP 管理命令

用法:
  iris mcp add [options] <name> <command-or-url> [args...]
  iris mcp list [--global | --agent <name>]
  iris mcp get <name> [--global | --agent <name>]
  iris mcp remove <name> [--global | --agent <name>]
  iris mcp enable <name> [--global | --agent <name>]
  iris mcp disable <name> [--global | --agent <name>]

范围:
  --global, -g              写入全局 ~/.iris/configs/mcp.yaml（默认）
  --agent <name>, -A <name> 写入指定 Agent 的 configs/mcp.yaml

add 选项:
  --transport, -t <type>    stdio | sse | http | streamable-http（默认 stdio；http 会保存为 streamable-http）
  --header, -H <K: V>       HTTP/SSE 请求头，可重复
  --env, -e <K=V>           stdio 子进程环境变量，可重复
  --timeout <ms>            连接/listTools 超时，默认 30000
  --cwd <dir>               stdio 子进程工作目录

示例:
  iris mcp add --transport http exa https://mcp.exa.ai/mcp
  iris mcp add --transport streamable-http exa https://mcp.exa.ai/mcp
  iris mcp add filesystem -- npx -y @modelcontextprotocol/server-filesystem /path/to/dir
  iris mcp add -e API_KEY=xxx my_server -- npx my-mcp-server
`;

export async function runMcpCli(args: string[], options: McpCliRunOptions = {}): Promise<McpCliResult> {
  const subcommand = args[0];
  const rest = args.slice(1);

  if (!subcommand || subcommand === 'help' || subcommand === '-h' || subcommand === '--help') {
    return { ok: true, message: HELP_TEXT };
  }

  try {
    switch (subcommand) {
      case 'add':
        return runAdd(rest, options);
      case 'list':
      case 'ls':
        return runList(rest, options);
      case 'get':
      case 'show':
        return runGet(rest, options);
      case 'remove':
      case 'delete':
      case 'rm':
        return runRemove(rest, options);
      case 'enable':
        return runSetEnabled(rest, true, options);
      case 'disable':
        return runSetEnabled(rest, false, options);
      default:
        return { ok: false, message: `未知 mcp 子命令: ${subcommand}\n\n${HELP_TEXT}`, exitCode: 2 };
    }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err), exitCode: 1 };
  }
}

function runAdd(args: string[], runOptions: McpCliRunOptions): McpCliResult {
  const { scope, rest } = parseScopeArgs(args);
  const { addOptions, positional } = parseAddArgs(rest);
  const [rawName, commandOrUrl, ...serverArgs] = positional;

  const name = normalizeServerName(rawName);
  if (!name) {
    return { ok: false, message: '缺少 MCP 服务器名称。\n\n' + HELP_TEXT, exitCode: 2 };
  }
  if (!commandOrUrl) {
    return { ok: false, message: `MCP 服务器 "${name}" 缺少 command 或 url。\n\n` + HELP_TEXT, exitCode: 2 };
  }

  const transport = addOptions.transport ?? 'stdio';
  const timeout = addOptions.timeout ?? 30000;
  validateTimeout(timeout, name);

  const looksLikeUrl = isUrlLike(commandOrUrl);
  if (transport === 'stdio' && !addOptions.transportExplicit && looksLikeUrl) {
    runOptions.stderr?.(
      `Warning: "${commandOrUrl}" 看起来像 URL，但未指定 --transport，将按 stdio 命令保存。` +
      ` 如果这是 HTTP MCP，请使用: iris mcp add --transport http ${name} ${commandOrUrl}`,
    );
  }

  let entry: McpCliServerConfig;
  if (transport === 'stdio') {
    entry = {
      transport: 'stdio',
      command: commandOrUrl,
      args: serverArgs.length > 0 ? serverArgs : undefined,
      env: parseEnvVars(addOptions.env),
      cwd: addOptions.cwd,
      timeout,
      enabled: true,
    };
  } else {
    if (!looksLikeUrl) {
      throw new Error(`MCP 服务器 "${name}" 使用 ${transport} 传输时需要 http(s) URL。`);
    }
    entry = {
      transport,
      url: commandOrUrl,
      headers: parseHeaders(addOptions.headers),
      timeout,
      enabled: true,
    };
  }

  const target = resolveMcpTarget(scope, runOptions);
  return withFileLockSync(target.filePath, () => {
    const config = readMcpConfig(target.filePath);
    config.servers ??= {};
    config.servers[name] = removeUndefined(entry);
    writeMcpConfig(target.filePath, config);

    return {
      ok: true,
      message: [
        `已添加 MCP 服务器：${name}`,
        `  transport: ${entry.transport}`,
        entry.transport === 'stdio' ? `  command: ${entry.command} ${(entry.args ?? []).join(' ')}`.trimEnd() : `  url: ${entry.url}`,
        `  scope: ${describeScope(scope)}`,
        `  file: ${target.filePath}`,
      ].join('\n'),
    };
  });
}

function runList(args: string[], options: McpCliRunOptions): McpCliResult {
  const { scope } = parseScopeArgs(args);
  const target = resolveMcpTarget(scope, options);
  const config = readMcpConfig(target.filePath);
  const entries = Object.entries(config.servers ?? {});

  if (entries.length === 0) {
    return {
      ok: true,
      message: `当前 scope（${describeScope(scope)}）未配置 MCP 服务器。\nfile: ${target.filePath}`,
    };
  }

  const lines = [`MCP 服务器（scope: ${describeScope(scope)}）:`, `file: ${target.filePath}`, ''];
  for (const [name, server] of entries) {
    lines.push(formatServerSummary(name, server));
  }
  return { ok: true, message: lines.join('\n') };
}

function runGet(args: string[], options: McpCliRunOptions): McpCliResult {
  const { scope, rest } = parseScopeArgs(args);
  const name = normalizeServerName(extractPositional(rest)[0]);
  if (!name) return { ok: false, message: '缺少 MCP 服务器名称。', exitCode: 2 };

  const target = resolveMcpTarget(scope, options);
  const config = readMcpConfig(target.filePath);
  const server = config.servers?.[name];
  if (!server) {
    return { ok: false, message: `未找到 MCP 服务器：${name}（scope: ${describeScope(scope)}）`, exitCode: 1 };
  }

  return {
    ok: true,
    message: [
      `${name}:`,
      `  enabled: ${server.enabled !== false}`,
      `  transport: ${server.transport}`,
      ...(server.transport === 'stdio'
        ? [
            `  command: ${server.command ?? ''}`,
            `  args: ${(server.args ?? []).join(' ')}`,
            ...(server.cwd ? [`  cwd: ${server.cwd}`] : []),
            ...(server.env ? [`  env: ${Object.keys(server.env).join(', ')}`] : []),
          ]
        : [
            `  url: ${server.url ?? ''}`,
            ...(server.headers ? [`  headers: ${Object.keys(server.headers).join(', ')}`] : []),
          ]),
      `  timeout: ${server.timeout ?? 30000}`,
      `  file: ${target.filePath}`,
    ].join('\n'),
  };
}

function runRemove(args: string[], options: McpCliRunOptions): McpCliResult {
  const { scope, rest } = parseScopeArgs(args);
  const name = normalizeServerName(extractPositional(rest)[0]);
  if (!name) return { ok: false, message: '缺少 MCP 服务器名称。', exitCode: 2 };

  const target = resolveMcpTarget(scope, options);
  return withFileLockSync(target.filePath, () => {
    const config = readMcpConfig(target.filePath);
    if (!config.servers?.[name]) {
      return { ok: false, message: `未找到 MCP 服务器：${name}（scope: ${describeScope(scope)}）`, exitCode: 1 };
    }

    delete config.servers[name];
    writeMcpConfig(target.filePath, config);
    return { ok: true, message: `已删除 MCP 服务器：${name}\nfile: ${target.filePath}` };
  });
}

function runSetEnabled(args: string[], enabled: boolean, options: McpCliRunOptions): McpCliResult {
  const { scope, rest } = parseScopeArgs(args);
  const name = normalizeServerName(extractPositional(rest)[0]);
  if (!name) return { ok: false, message: '缺少 MCP 服务器名称。', exitCode: 2 };

  const target = resolveMcpTarget(scope, options);
  return withFileLockSync(target.filePath, () => {
    const config = readMcpConfig(target.filePath);
    const server = config.servers?.[name];
    if (!server) {
      return { ok: false, message: `未找到 MCP 服务器：${name}（scope: ${describeScope(scope)}）`, exitCode: 1 };
    }

    server.enabled = enabled;
    writeMcpConfig(target.filePath, config);
    return { ok: true, message: `已${enabled ? '启用' : '禁用'} MCP 服务器：${name}\nfile: ${target.filePath}` };
  });
}

function parseScopeArgs(args: string[]): ParsedArgs {
  let scope: McpCliScope = { kind: 'global' };
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
  const addOptions: AddOptions = {
    transportExplicit: false,
    headers: [],
    env: [],
  };
  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--') {
      positional.push(...args.slice(i + 1));
      break;
    }

    if (arg === '--transport' || arg === '-t') {
      const value = args[++i];
      if (!value) throw new Error(`${arg} 需要 transport 值`);
      addOptions.transport = normalizeTransport(value);
      addOptions.transportExplicit = true;
      continue;
    }
    if (arg.startsWith('--transport=')) {
      addOptions.transport = normalizeTransport(arg.slice('--transport='.length));
      addOptions.transportExplicit = true;
      continue;
    }

    if (arg === '--header' || arg === '-H') {
      const value = args[++i];
      if (!value) throw new Error(`${arg} 需要请求头，格式如 "Authorization: Bearer xxx"`);
      addOptions.headers.push(value);
      continue;
    }
    if (arg.startsWith('--header=')) {
      addOptions.headers.push(arg.slice('--header='.length));
      continue;
    }

    if (arg === '--env' || arg === '-e') {
      const value = args[++i];
      if (!value) throw new Error(`${arg} 需要环境变量，格式如 KEY=value`);
      addOptions.env.push(value);
      continue;
    }
    if (arg.startsWith('--env=')) {
      addOptions.env.push(arg.slice('--env='.length));
      continue;
    }

    if (arg === '--timeout') {
      const value = args[++i];
      if (!value) throw new Error('--timeout 需要毫秒数');
      addOptions.timeout = Number(value);
      continue;
    }
    if (arg.startsWith('--timeout=')) {
      addOptions.timeout = Number(arg.slice('--timeout='.length));
      continue;
    }

    if (arg === '--cwd') {
      const value = args[++i];
      if (!value) throw new Error('--cwd 需要目录路径');
      addOptions.cwd = value;
      continue;
    }
    if (arg.startsWith('--cwd=')) {
      addOptions.cwd = arg.slice('--cwd='.length);
      continue;
    }

    positional.push(arg);
  }

  return { addOptions, positional };
}

function extractPositional(args: string[]): string[] {
  const { rest } = parseScopeArgs(args);
  const positional: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === '--') {
      positional.push(...rest.slice(i + 1));
      break;
    }
    if (arg.startsWith('-')) {
      // get/remove/enable/disable 当前只识别 scope flag；其他 flag 忽略，避免误当名称。
      continue;
    }
    positional.push(arg);
  }
  return positional;
}

function normalizeTransport(value: string): McpCliTransport {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'http' || normalized === 'streamable-http' || normalized === 'streamable_http') return 'streamable-http';
  if (normalized === 'sse') return 'sse';
  if (normalized === 'stdio') return 'stdio';
  throw new Error(`无效 transport: ${value}（支持 stdio、sse、http、streamable-http）`);
}

function normalizeServerName(value: string | undefined): string {
  const name = (value ?? '').trim();
  if (!name) return '';
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    throw new Error(`MCP 服务器名称 "${name}" 无效：仅支持字母、数字、下划线和连字符`);
  }
  return name;
}

function parseHeaders(values: string[]): Record<string, string> | undefined {
  if (values.length === 0) return undefined;
  const headers: Record<string, string> = {};
  for (const raw of values) {
    const index = raw.indexOf(':');
    if (index <= 0) throw new Error(`请求头格式无效: ${raw}（应为 "Key: Value"）`);
    const key = raw.slice(0, index).trim();
    const value = raw.slice(index + 1).trim();
    if (!key || !value) throw new Error(`请求头格式无效: ${raw}（应为 "Key: Value"）`);
    headers[key] = value;
  }
  return Object.keys(headers).length > 0 ? headers : undefined;
}

function parseEnvVars(values: string[]): Record<string, string> | undefined {
  if (values.length === 0) return undefined;
  const env: Record<string, string> = {};
  for (const raw of values) {
    const index = raw.indexOf('=');
    if (index <= 0) throw new Error(`环境变量格式无效: ${raw}（应为 KEY=value）`);
    const key = raw.slice(0, index).trim();
    const value = raw.slice(index + 1);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new Error(`环境变量名无效: ${key}`);
    env[key] = value;
  }
  return Object.keys(env).length > 0 ? env : undefined;
}

function validateTimeout(timeout: number, name: string): void {
  if (!Number.isFinite(timeout) || timeout < 1000 || timeout > 120000) {
    throw new Error(`MCP 服务器 "${name}" 的 timeout 必须在 1000 到 120000 毫秒之间`);
  }
}

function isUrlLike(value: string): boolean {
  return /^https?:\/\//i.test(value) || value.endsWith('/mcp') || value.endsWith('/sse');
}

function getRuntimeDataDir(options: McpCliRunOptions): string {
  return path.resolve(options.dataDir || process.env.IRIS_DATA_DIR || path.join(os.homedir(), '.iris'));
}

function resolveMcpTarget(scope: McpCliScope, options: McpCliRunOptions): { filePath: string } {
  const dataDir = getRuntimeDataDir(options);
  if (scope.kind === 'global') {
    return { filePath: path.join(dataDir, 'configs', 'mcp.yaml') };
  }

  const manifestPath = path.join(dataDir, 'agents.yaml');
  const agentDataDir = resolveAgentDataDir(manifestPath, dataDir, scope.agentName);
  return { filePath: path.join(agentDataDir, 'configs', 'mcp.yaml') };
}

function resolveAgentDataDir(manifestPath: string, dataDir: string, agentName: string): string {
  if (!fs.existsSync(manifestPath)) return path.join(dataDir, 'agents', agentName);

  try {
    const manifest = parseYAML(fs.readFileSync(manifestPath, 'utf-8')) as any;
    const agent = manifest?.agents?.[agentName];
    if (agent?.dataDir && typeof agent.dataDir === 'string') {
      return path.resolve(agent.dataDir);
    }
  } catch {
    // agents.yaml 解析失败时使用默认路径，避免 CLI 因无关配置阻塞全局操作。
  }

  return path.join(dataDir, 'agents', agentName);
}

function readMcpConfig(filePath: string): McpCliConfig {
  if (!fs.existsSync(filePath)) return { servers: {} };
  const raw = parseYAML(fs.readFileSync(filePath, 'utf-8')) as unknown;
  if (raw === undefined || raw === null) return { servers: {} };
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`mcp.yaml 格式无效，应为对象: ${filePath}`);
  }
  const data = raw as McpCliConfig;
  if (data.servers !== undefined && (typeof data.servers !== 'object' || Array.isArray(data.servers) || data.servers === null)) {
    throw new Error(`mcp.yaml 中 servers 格式无效，应为对象: ${filePath}`);
  }
  return { ...data, servers: { ...(data.servers ?? {}) } };
}

function writeMcpConfig(filePath: string, config: McpCliConfig): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const output = stringifyYAML({ servers: config.servers ?? {} }, { indent: 2 });
  atomicWriteTextFileSync(filePath, output);
}

function removeUndefined<T extends object>(value: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) out[key] = entry;
  }
  return out as T;
}

function formatServerSummary(name: string, server: McpCliServerConfig): string {
  const enabled = server.enabled === false ? '✗' : '✓';
  if (server.transport === 'stdio') {
    const args = server.args?.length ? ` ${server.args.join(' ')}` : '';
    return `${enabled} ${name}: ${server.command ?? ''}${args} (stdio)`;
  }
  return `${enabled} ${name}: ${server.url ?? ''} (${server.transport})`;
}

function describeScope(scope: McpCliScope): string {
  return scope.kind === 'global' ? '全局 ~/.iris/configs' : `Agent ${scope.agentName}`;
}
