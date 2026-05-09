import type { IrisAPI } from 'irises-extension-sdk';
import type { EnvironmentManager } from './environment.js';

const CONSOLE_TOOL_DISPLAY_SERVICE_ID = 'console:tool-display';
const CONSOLE_SLASH_COMMAND_SERVICE_ID = 'console:slash-command';

interface DisplayProviderInput {
  toolName: string;
  args: Record<string, unknown>;
  progress?: Record<string, unknown>;
  result?: unknown;
}

interface ConsoleToolDisplayServiceLike {
  register(toolName: string, provider: {
    getArgsSummary?: (input: DisplayProviderInput) => string | undefined;
    getProgressLine?: (input: DisplayProviderInput) => string | undefined;
    getResultSummary?: (input: DisplayProviderInput) => string | undefined;
  }): { dispose(): void };
}

interface ConsoleSlashCommandServiceLike {
  register(command: {
    name: string;
    description: string;
    acceptsArgs?: boolean;
    color?: string;
    getArgSuggestions?: (input: { arg: string; raw: string }) => Array<{ value: string; description?: string; color?: string }>;
    handle(input: { raw: string; name: string; arg: string }): { message?: string; isError?: boolean; label?: string } | Promise<{ message?: string; isError?: boolean; label?: string } | void> | void;
  }): { dispose(): void };
}

let displayRegistration: { dispose(): void } | undefined;
let displayRegistering = false;
let slashRegistrations: Array<{ dispose(): void }> = [];
let slashRegistering = false;

export function registerRemoteExecConsoleIntegration(api: IrisAPI, envMgr: EnvironmentManager): void {
  registerTransferFilesDisplay(api);
  registerEnvironmentSlashCommands(api, envMgr);
}

export function disposeRemoteExecConsoleIntegration(): void {
  displayRegistration?.dispose();
  displayRegistration = undefined;
  displayRegistering = false;
  for (const registration of slashRegistrations.splice(0)) {
    try { registration.dispose(); } catch { /* ignore */ }
  }
  slashRegistering = false;
}

function registerTransferFilesDisplay(api: IrisAPI): void {
  if (displayRegistration || displayRegistering) return;
  displayRegistering = true;
  void api.services.waitFor<ConsoleToolDisplayServiceLike>(CONSOLE_TOOL_DISPLAY_SERVICE_ID, 5000)
    .then((service) => {
      if (displayRegistration) return;
      displayRegistration = service.register('transfer_files', {
        getArgsSummary({ args }) { return formatArgsSummary(args); },
        getProgressLine({ progress }) { return formatProgress(progress); },
        getResultSummary({ result }) { return formatResult(result); },
      });
    })
    .catch(() => {})
    .finally(() => { displayRegistering = false; });
}

function registerEnvironmentSlashCommands(api: IrisAPI, envMgr: EnvironmentManager): void {
  if (slashRegistrations.length > 0 || slashRegistering) return;
  slashRegistering = true;
  void api.services.waitFor<ConsoleSlashCommandServiceLike>(CONSOLE_SLASH_COMMAND_SERVICE_ID, 5000)
    .then((service) => {
      if (slashRegistrations.length > 0) return;
      const switchTo = async (name: string) => {
        const sid = api.agentManager?.getActiveSessionId?.();
        if (sid) {
          // 有活跃对话 → 写入 session meta
          const { previous, current } = await envMgr.setActive(name);
          return {
            message: previous === current
              ? `当前已经在服务器：${current}`
              : `已切换服务器：${previous} → ${current}`,
            label: 'env',
          };
        }
        // 无活跃对话 → 写入 agent 级作为新对话默认
        const store = api.globalStore.agent(api.agentName ?? '__global__').namespace('remote-exec');
        const prev = store.get<string>('activeEnvironment') ?? 'local';
        store.set('activeEnvironment', name);
        const msg = prev === name ? `已将默认服务器设为：${name}（新对话生效）` : `已将默认服务器从 ${prev} 改为：${name}（新对话生效）`;
        return { message: msg, label: 'env' };
      };

      slashRegistrations.push(service.register({
        name: '/env',
        description: '查看或快速切换 remote-exec 执行服务器',
        acceptsArgs: true,
        getArgSuggestions({ arg }) {
          const q = arg.trim().toLowerCase();
          return envMgr.listEnvs()
            .filter((env) => !q || env.name.toLowerCase().includes(q))
            .map((env) => ({
              value: env.name,
              description: env.isLocal
                ? '本地执行'
                : [env.description, env.hostName ? `${env.user ?? '?'}@${env.hostName}` : undefined].filter(Boolean).join(' · '),
            }));
        },
        async handle({ arg }) {
          const name = arg.trim();
          if (name) return switchTo(name);
          const current = envMgr.getActive();
          const lines = [
            `当前服务器：${current}`,
            '可用服务器：',
            ...envMgr.listEnvs().map((env) => `  - ${env.name}${env.isLocal ? ' (local)' : env.hostName ? ` (${env.user ?? '?'}@${env.hostName})` : ''}`),
            '',
            '用法：/env <服务器名>',
          ];
          return { message: lines.join('\n'), label: 'env' };
        },
      }));
    })
    .catch(() => {})
    .finally(() => { slashRegistering = false; });
}

function formatArgsSummary(args: Record<string, unknown>): string {
  const first = Array.isArray(args.transfers) && args.transfers.length > 0 ? args.transfers[0] : args;
  if (!first || typeof first !== 'object' || Array.isArray(first)) {
    return Array.isArray(args.transfers) ? `${args.transfers.length} transfers` : '';
  }
  const obj = first as Record<string, unknown>;
  const from = `${String(obj.fromEnvironment || '')}:${String(obj.fromPath || '')}`;
  const to = `${String(obj.toEnvironment || '')}:${String(obj.toPath || '')}`;
  const summary = `${from} → ${to}`;
  const clipped = summary.length > 60 ? `${summary.slice(0, 60)}…` : summary;
  return Array.isArray(args.transfers) && args.transfers.length > 1 ? `${clipped} +${args.transfers.length - 1}` : clipped;
}

function formatProgress(progress: Record<string, unknown> | undefined): string | undefined {
  if (progress?.kind !== 'transfer_files') return undefined;
  const transferred = numberField(progress.bytesTransferred);
  const total = numberField(progress.totalBytes);
  const percent = numberField(progress.percent)
    ?? (transferred != null && total != null && total > 0 ? Math.round((transferred / total) * 100) : undefined);
  const speed = numberField(progress.speedBytesPerSec);
  const eta = numberField(progress.etaSec);
  const filesDone = numberField(progress.filesTransferred);
  const filesTotal = numberField(progress.totalFiles);

  const chunks: string[] = [];
  if (percent != null) chunks.push(`${Math.max(0, Math.min(100, Math.round(percent)))}%`);
  if (transferred != null && total != null) chunks.push(`${formatBytes(transferred)}/${formatBytes(total)}`);
  else if (transferred != null) chunks.push(formatBytes(transferred));
  if (filesDone != null && filesTotal != null && filesTotal > 1) chunks.push(`${Math.round(filesDone)}/${Math.round(filesTotal)} files`);
  if (speed != null && speed > 0) chunks.push(`${formatBytes(speed)}/s`);
  if (eta != null && eta > 0) chunks.push(`ETA ${formatDuration(eta)}`);
  return chunks.join(' ') || undefined;
}

function formatResult(result: unknown): string | undefined {
  if (!result || typeof result !== 'object') return undefined;
  const obj = result as Record<string, unknown>;
  const total = numberField(obj.totalCount);
  const ok = numberField(obj.successCount);
  const results = Array.isArray(obj.results) ? obj.results : [];
  let bytes = 0;
  for (const item of results) {
    if (item && typeof item === 'object') {
      const b = numberField((item as Record<string, unknown>).bytes);
      if (b != null) bytes += b;
    }
  }
  const chunks: string[] = [];
  if (ok != null && total != null) chunks.push(`${Math.round(ok)}/${Math.round(total)}`);
  if (bytes > 0) chunks.push(formatBytes(bytes));
  return chunks.join(' ') || undefined;
}

function numberField(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = n;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) { value /= 1024; i++; }
  const digits = value >= 100 || i === 0 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(digits)}${units[i]}`;
}

function formatDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '';
  if (sec < 60) return `${Math.ceil(sec)}s`;
  const m = Math.floor(sec / 60);
  const s = Math.ceil(sec % 60);
  return `${m}m${String(s).padStart(2, '0')}s`;
}
