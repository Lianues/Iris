/**
 * servers-config.ts
 *
 * 解析 remote_exec_servers.yaml（通过 Extension SDK 配置接口读取）。
 */

export interface ServerEntry {
  /** 服务器名 / 别名（remote_exec.yaml defaultEnvironment 与 switch_server 使用） */
  host: string;
  hostName: string;
  port: number;
  user?: string;
  identityFile?: string;
  /** 明文密码（可选，与 identityFile 二选一） */
  password?: string;
  /** 该服务器上的默认工作目录（覆盖 remote_exec.yaml 的 remoteWorkdir） */
  workdir?: string;
  /** 服务器操作系统（AI 可见，用于选择正确的命令语法）。例如: linux / windows / macos */
  os?: string;
  /** 该服务器的人类可读描述（switch_server 工具会展示给 AI） */
  description?: string;
  /** 传输策略：auto（默认）/ sftp / bash */
  transport?: 'auto' | 'sftp' | 'bash';
}

export function parseServersSection(raw: unknown): Map<string, ServerEntry> {
  return parseServersSectionDetailed(raw).servers;
}

export interface ParseServersSectionResult {
  servers: Map<string, ServerEntry>;
  warnings: string[];
}

export function parseServersSectionDetailed(raw: unknown): ParseServersSectionResult {
  const out = new Map<string, ServerEntry>();
  const warnings: string[] = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { servers: out, warnings };
  }

  const root = raw as Record<string, unknown>;
  const serversRaw = root.servers;
  if (!serversRaw || typeof serversRaw !== 'object' || Array.isArray(serversRaw)) {
    warnings.push('缺少顶层 servers: map。');
    return { servers: out, warnings };
  }

  for (const [alias, value] of Object.entries(serversRaw as Record<string, unknown>)) {
    const parsed = parseServerEntry(alias, value);
    if (parsed.entry) out.set(parsed.entry.host, parsed.entry);
    else warnings.push(parsed.error ?? `服务器 ${alias} 配置无效。`);
  }
  return { servers: out, warnings };
}

function parseServerEntry(alias: string, value: unknown): { entry?: ServerEntry; error?: string } {
  if (!alias) return { error: '服务器别名不能为空。' };
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { error: `服务器 ${alias} 必须是对象。` };
  }
  const obj = value as Record<string, unknown>;

  const hostName = stringField(obj.hostName) ?? stringField(obj.hostname) ?? stringField(obj.host);
  if (!hostName) {
    const keys = Object.keys(obj).join(', ') || '(无字段)';
    return { error: `服务器 ${alias} 缺少 hostName（也可写 hostname/host）。当前字段: ${keys}` };
  }

  const transportRaw = stringField(obj.transport)?.toLowerCase();
  const transport =
    transportRaw === 'sftp' || transportRaw === 'bash' || transportRaw === 'auto'
      ? transportRaw
      : undefined;

  const port = numberField(obj.port) ?? 22;

  return {
    entry: {
      host: alias,
      hostName,
      port,
      user: stringField(obj.user),
      identityFile: stringField(obj.identityFile),
      password: stringField(obj.password),
      workdir: stringField(obj.workdir),
      os: stringField(obj.os),
      description: stringField(obj.description),
      transport,
    },
  };
}

function stringField(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

function numberField(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return Math.floor(v);
  if (typeof v === 'string' && v.trim()) {
    const n = Number.parseInt(v.trim(), 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return undefined;
}
