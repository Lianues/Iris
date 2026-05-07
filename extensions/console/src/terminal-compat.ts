import { execFileSync } from 'child_process';

/**
 * 终端兼容性模块。
 *
 * 检测终端渲染能力并提供安全的字符常量。
 *
 * 分级:
 * - full:     Windows Terminal / 已知现代终端，支持完整 Unicode + Emoji
 * - standard: Linux / macOS 默认终端，假定支持完整 Unicode
 * - basic:    Windows cmd.exe / PowerShell (conhost)，仅支持 BMP 常见字符
 */

// ── 终端能力检测 ──────────────────────────────────────────

export type TerminalTier = 'full' | 'standard' | 'basic';

const KNOWN_MODERN_TERMS = new Set([
  'iTerm.app', 'Hyper', 'vscode', 'WezTerm', 'Alacritty', 'kitty',
  'Tabby', 'warp', 'ghostty',
]);

function detectTier(): TerminalTier {
  if ((process.env.TERM ?? '').toLowerCase() === 'dumb') return 'basic';
  if (process.env.WT_SESSION) return 'full';
  const tp = process.env.TERM_PROGRAM ?? '';
  if (KNOWN_MODERN_TERMS.has(tp)) return 'full';
  if (process.env.ConEmuANSI === 'ON') return 'standard';
  if (process.env.TERM_PROGRAM === 'Apple_Terminal') return 'standard';
  if (process.platform === 'win32') return 'basic';
  return 'standard';
}

export const terminalTier: TerminalTier = detectTier();

/** 当前终端是否支持 Emoji (SMP) 渲染 */
export function supportsEmoji(): boolean {
  return terminalTier !== 'basic';
}

export function supportsBoxDrawing(): boolean {
  return terminalTier !== 'basic';
}

export const BORDER_CHARS = supportsBoxDrawing()
  ? {
      topLeft: '┌',
      topRight: '┐',
      bottomLeft: '└',
      bottomRight: '┘',
      horizontal: '─',
      vertical: '│',
    }
  : {
      topLeft: '+',
      topRight: '+',
      bottomLeft: '+',
      bottomRight: '+',
      horizontal: '-',
      vertical: '|',
    };

export function readClipboardText(): string | undefined {
  const timeout = 1500;
  const read = (command: string, args: string[]): string | undefined => {
    try {
      const output = execFileSync(command, args, {
        encoding: 'utf8',
        windowsHide: true,
        timeout,
      });
      return typeof output === 'string' && output.trim().length > 0 ? output : undefined;
    } catch {
      return undefined;
    }
  };

  if (process.platform === 'win32') {
    return read('powershell.exe', ['-NoProfile', '-Command', 'Get-Clipboard -Raw'])
      ?? read('powershell', ['-NoProfile', '-Command', 'Get-Clipboard -Raw']);
  }

  if (process.platform === 'darwin') {
    return read('pbpaste', []);
  }

  return read('wl-paste', ['-n'])
    ?? read('xclip', ['-selection', 'clipboard', '-out'])
    ?? read('xsel', ['--clipboard', '--output']);
}

export function normalizePastedSingleLine(text: string): string {
  return text.replace(/[\r\n]/g, '').trim();
}

// ── 工具函数 ─────────────────────────────────────────────

function pick<T>(modern: T, basic: T): T {
  return terminalTier === 'basic' ? basic : modern;
}

// ── 字符常量 ─────────────────────────────────────────────

export const ICONS = {
  // 思考强度 — Halfwidth Forms (保证单宽) / ASCII
  thinkingFilled: pick('\uFFED', '='),  // ￭ / =
  thinkingDim:    pick('\uFFEE', '-'),  // ￮ / -

  // 工具状态图标 — Emoji / BMP fallback
  statusStreaming:  pick('\uD83D\uDCE1', '~'),  // 📡 / ~
  statusQueued:     pick('\u23F3', '.'),          // ⏳ / .
  statusApproval:   pick('\uD83D\uDD10', '?'),   // 🔐 / ?
  statusExecuting:  pick('\uD83D\uDD27', '*'),   // 🔧 / *
  statusApply:      pick('\uD83D\uDCCB', '='),   // 📋 / =
  statusSuccess:    pick('\u2705', '\u2713'),     // ✅ / ✓
  statusWarning:    pick('\u26A0\uFE0F', '\u26A0'), // ⚠️ / ⚠
  statusError:      pick('\u274C', '\u2717'),     // ❌ / ✗

  // 通用符号 — ✓✗⚠⚡ 在中文 conhost 中为全角，需 basic 降级
  checkmark:     pick('\u2713', 'v'),   // ✓ / v
  crossmark:     pick('\u2717', 'x'),   // ✗ / x
  cancelled:     pick('\u2298', '-'),   // ⊘ / -
  warning:       pick('\u26A0', '!'),   // ⚠ / !
  lightning:     pick('\u26A1', '*'),   // ⚡ / *
  clock:         pick('\u23F0', '*'),   // ⏰ / *
  timer:         pick('\u23F1', '*'),   // ⏱ / *
  hourglass:     pick('\u23F3', '.'),   // ⏳ / .
  planMode:      '||',                  // 纯文本 pause，避免 Windows Terminal 将 ⏸ 渲染成蓝色 emoji 方块

  // 导航 / 选择
  selectorArrow:  pick('\u276F', '>'),  // ❯ / >
  triangleRight:  pick('\u25B8', '>'),  // ▸ / >
  bullet:         pick('\u2022', '*'),  // • / *
  resultArrow:    pick('\u21B3', '>'),  // ↳ / >
  delegateArrow:  pick('\u21E2', '=>'), // ⇢ / =>
  upArrow:        pick('\u2191', '^'),  // ↑ / ^
  downArrow:      pick('\u2193', 'v'),  // ↓ / v

  // 箭头 — 在中文 conhost 中为全角
  arrowLeft:   pick('\u2190', '<'),   // ← / <
  arrowRight:  pick('\u2192', '>'),   // → / >
  arrowUp:     pick('\u2191', '^'),   // ↑ / ^ (alias)
  arrowDown:   pick('\u2193', 'v'),   // ↓ / v (alias)

  // 状态点
  dotFilled:  pick('\u25CF', '*'),  // ● / *
  dotEmpty:   pick('\u25CB', 'o'),  // ○ / o

  // 文本符号 — 在中文 conhost 中为全角
  ellipsis:   pick('\u2026', '..'), // … / ..
  emDash:     pick('\u2014', '--'), // — / --

  // 分隔符 — `·` 在中文 conhost 中被渲染为全角 (2 格)
  separator: pick('\u00B7', '-'),  // · / -
} as const;

// ── Spinner 帧 ───────────────────────────────────────────

/**
 * 通用执行 spinner 帧（工具执行、后台任务等）。
 */
export const SPINNER_FRAMES: readonly string[] = terminalTier === 'basic'
  ? ['|', '/', '-', '\\', '|', '/', '-', '\\', '|', '/']
  : ['\u280B', '\u2819', '\u2839', '\u2838', '\u283C', '\u2834', '\u2826', '\u2827', '\u2807', '\u280F'];

/**
 * 输入栏排队状态专用沙漏 spinner 帧。
 * modern 终端使用“沙漏 + 沙粒波浪”帧，basic 终端使用单宽 ASCII 波浪帧。
 */
export const HOURGLASS_SPINNER_FRAMES: readonly string[] = terminalTier === 'basic'
  ? ['.  ', ' . ', '  .', ' . ']
  : ['⌛··', '·⌛·', '··⌛', '⏳··', '·⏳·', '··⏳'];

export const SPINNER_INTERVAL_MS = 80;
export const HOURGLASS_SPINNER_INTERVAL_MS = terminalTier === 'basic' ? 240 : 360;
