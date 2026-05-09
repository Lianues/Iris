/**
 * Helpers for running shell/bash tools as background, non-interactive commands.
 *
 * Important boundary:
 * - This module does NOT pre-block commands by name.
 * - It only hardens the execution environment and annotates real failures that
 *   look like TTY / password / prompt interaction problems.
 */

export type CommandShellKind = 'powershell' | 'bash';

export interface InteractiveFailureInput {
  command: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  killed?: boolean;
}

export interface InteractiveFailureHint {
  reason: string;
  matched?: string;
}

/**
 * Build a conservative non-interactive environment for background command tools.
 *
 * Keep this intentionally small: variables here should disable prompts/pagers
 * without broadly changing build/test semantics. In particular, do not set CI=1.
 */
export function buildNonInteractiveEnv(
  baseEnv: NodeJS.ProcessEnv = process.env,
  _shellKind: CommandShellKind = 'bash',
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...baseEnv,
    // Git should fail with a clear error instead of prompting for credentials.
    GIT_TERMINAL_PROMPT: '0',
    GCM_INTERACTIVE: 'never',
    GIT_ASKPASS: '',
    SSH_ASKPASS: '',
    SSH_ASKPASS_REQUIRE: 'never',
    // Pagers/full-screen viewers should degrade to plain output when possible.
    PAGER: 'cat',
    GIT_PAGER: 'cat',
    LESS: '-F -X',
  };

  // Some tools only need TERM to exist; avoid overwriting user's configured TERM.
  if (!env.TERM) env.TERM = 'dumb';

  return env;
}

/** Close child stdin early so commands cannot wait forever for piped input. */
export function closeChildStdin(child: { stdin?: NodeJS.WritableStream | null } | undefined): void {
  const stdin = child?.stdin;
  if (!stdin) return;
  try {
    stdin.end();
  } catch {
    try { (stdin as unknown as { destroy?: () => void }).destroy?.(); } catch { /* ignore */ }
  }
}

const HIGH_CONFIDENCE_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\bnot a tty\b/i, reason: '命令需要 TTY，但当前是后台非交互执行环境' },
  { pattern: /\bstdin (?:is )?not (?:a )?terminal\b/i, reason: '命令需要终端 stdin' },
  { pattern: /\binput is not from a terminal\b/i, reason: '命令需要终端输入' },
  { pattern: /\binappropriate ioctl for device\b/i, reason: '命令尝试访问终端控制接口失败' },
  { pattern: /\b(?:cannot|can't) open \/dev\/tty\b/i, reason: '命令尝试读取终端 /dev/tty 失败' },
  { pattern: /\bread_passphrase:.*\b(?:cannot|can't) open \/dev\/tty\b/i, reason: '命令需要读取密码/密钥短语，但没有可用终端' },
  { pattern: /\bno tty present\b/i, reason: '命令需要 TTY' },
  { pattern: /\b(?:requires|require|needs) (?:a )?(?:tty|terminal)\b/i, reason: '命令声明需要交互式终端' },
  { pattern: /\ba terminal is required\b/i, reason: '命令声明需要交互式终端' },
  { pattern: /\bthe input device is not a TTY\b/i, reason: '命令需要 TTY 输入设备' },
  { pattern: /\bterminal prompts disabled\b/i, reason: '命令需要凭据提示，但终端提示已禁用' },
  { pattern: /\bcannot prompt because terminal prompts have been disabled\b/i, reason: '命令需要凭据提示，但终端提示已禁用' },
  { pattern: /\bGIT_TERMINAL_PROMPT\s*=\s*0\b/i, reason: 'Git 凭据提示已被后台执行环境禁用' },
  { pattern: /\bcould not read (?:Username|Password)\b/i, reason: '命令需要读取用户名或密码' },
  { pattern: /\bNo such device or address\b.*\b(?:Username|Password)\b/i, reason: '命令需要终端凭据输入' },
  { pattern: /\bHost key verification failed\b/i, reason: 'SSH 主机密钥确认需要人工处理或预先配置 known_hosts' },
];

const PROMPT_TAIL_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /(?:^|\n)[^\n]{0,160}\b(?:password|passphrase)(?:\s+for\s+[^:\n]+)?\s*:\s*$/i, reason: '命令停在密码/密钥短语输入提示' },
  { pattern: /(?:^|\n)[^\n]{0,200}\benter passphrase\b[^\n]*:\s*$/i, reason: '命令停在密钥短语输入提示' },
  { pattern: /(?:^|\n)[^\n]{0,240}\bare you sure you want to continue connecting\b[^\n]*\?\s*$/i, reason: '命令停在 SSH 主机确认提示' },
  { pattern: /(?:^|\n)[^\n]{0,160}\[(?:y\/n|yes\/no|Y\/n|y\/N)\]\s*$/i, reason: '命令停在确认输入提示' },
];

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
}

function tail(text: string, max = 1200): string {
  return text.length <= max ? text : text.slice(-max);
}

/**
 * Detect whether a finished/failed command appears to have needed interactive
 * terminal input. This is deliberately result-based to avoid command-name
 * blacklists and reduce false positives.
 */
export function detectInteractiveFailure(input: InteractiveFailureInput): InteractiveFailureHint | null {
  const exitCode = input.exitCode ?? 0;
  const failedOrTimedOut = input.killed === true || exitCode !== 0;
  if (!failedOrTimedOut) return null;

  const combined = stripAnsi([input.stdout ?? '', input.stderr ?? ''].filter(Boolean).join('\n'));
  if (!combined.trim()) return null;

  for (const { pattern, reason } of HIGH_CONFIDENCE_PATTERNS) {
    const match = pattern.exec(combined);
    if (match) return { reason, matched: match[0] };
  }

  const recent = tail(combined);
  for (const { pattern, reason } of PROMPT_TAIL_PATTERNS) {
    const match = pattern.exec(recent);
    if (match) return { reason, matched: match[0].trim() };
  }

  return null;
}

export function formatInteractiveFailureHint(hint: InteractiveFailureHint): string {
  const matched = hint.matched ? `（检测到：${hint.matched.replace(/\s+/g, ' ').slice(0, 120)}）` : '';
  return `检测到该命令可能需要交互式终端：${hint.reason}${matched}。shell/bash 工具在后台非交互环境中执行，无法完成密码、确认输入或全屏交互。请改为非交互命令；如果确实需要人工交互，请用户在外部终端执行。`;
}
