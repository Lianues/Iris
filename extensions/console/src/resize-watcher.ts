import type { CliRenderer } from '@opentui/core';

interface InternalResizeAwareRenderer {
  handleResize?: (width: number, height: number) => void;
  processResize?: (width: number, height: number) => void;
  requestRender: () => void;
  width: number;
  height: number;
  on: (event: string, listener: (...args: any[]) => void) => unknown;
  off: (event: string, listener: (...args: any[]) => void) => unknown;
}

function getTerminalSize(renderer: InternalResizeAwareRenderer): { width: number; height: number } {
  const width = process.stdout.columns || renderer.width || 80;
  const height = process.stdout.rows || renderer.height || 24;
  return { width, height };
}

/**
 * 直接从操作系统查询终端尺寸，绕过 process.stdout.columns/rows 的缓存。
 *
 * Bun 编译后的二进制中 process.stdout.columns/rows 可能不会在终端
 * 窗口大小变化时自动更新（SIGWINCH 未触发内部刷新），导致 OpenTUI
 * 内置的 sigwinchHandler 和轮询都读取到旧值而跳过 resize。
 *
 * 此函数通过 `stty size` 命令直接执行 ioctl(TIOCGWINSZ)，获取当前
 * 终端真实尺寸。仅在 Unix 系统可用。
 */
function queryNativeTerminalSize(): { width: number; height: number } | null {
  if (process.platform === 'win32') return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { execSync } = require('child_process');
    const output = (execSync('stty size </dev/tty 2>/dev/null', {
      encoding: 'utf8',
      timeout: 500,
    }) as string).trim();
    const parts = output.split(/\s+/);
    const rows = parseInt(parts[0], 10);
    const cols = parseInt(parts[1], 10);
    if (rows > 0 && cols > 0) return { width: cols, height: rows };
  } catch { /* stty 不可用或 /dev/tty 无法访问，静默降级 */ }
  return null;
}

function applyResize(renderer: InternalResizeAwareRenderer, width: number, height: number): void {
  if (typeof renderer.handleResize === 'function') {
    renderer.handleResize(width, height);
    return;
  }

  if (typeof renderer.processResize === 'function') {
    renderer.processResize(width, height);
    return;
  }

  renderer.requestRender();
}

export function attachCompiledResizeWatcher(renderer: CliRenderer, isCompiledBinary: boolean): () => void {
  if (!isCompiledBinary || !process.stdout.isTTY) {
    return () => {};
  }

  const internalRenderer = renderer as unknown as InternalResizeAwareRenderer;
  let { width: lastWidth, height: lastHeight } = getTerminalSize(internalRenderer);
  let disposed = false;

  const checkAndApply = (width: number, height: number) => {
    if (width <= 0 || height <= 0) return;
    if (width === lastWidth && height === lastHeight) return;
    lastWidth = width;
    lastHeight = height;
    applyResize(internalRenderer, width, height);
  };

  // ── 快速路径：读取 process.stdout.columns/rows ──────────────
  // 成本极低，如果运行时能正确更新这些值就能立刻检测到 resize。
  const syncResize = () => {
    if (disposed) return;
    const { width, height } = getTerminalSize(internalRenderer);
    checkAndApply(width, height);
  };

  // ── 原生路径：通过 stty 直接查询 OS ────────────────────────
  // 绕过可能不更新的 stdout.columns/rows，作为可靠的备用检测。
  const nativeSyncResize = () => {
    if (disposed) return;
    const size = queryNativeTerminalSize();
    if (size) checkAndApply(size.width, size.height);
  };

  const stdoutResizeListener = () => {
    syncResize();
  };

  process.stdout.on('resize', stdoutResizeListener);

  // SIGWINCH 处理：信号到达时立即通过 stty 查询真实尺寸。
  // 即使 Bun 编译后 stdout.columns/rows 不更新，stty 仍可获得正确值。
  const sigwinchHandler = () => nativeSyncResize();
  process.on('SIGWINCH', sigwinchHandler);

  // 快速轮询：120ms 检查 stdout.columns/rows（低成本）
  const pollInterval = setInterval(syncResize, 120);
  pollInterval.unref?.();

  // 原生轮询：每秒通过 stty 检查一次（兜底，覆盖 SIGWINCH 完全不触发的情况）
  const nativePollInterval = setInterval(nativeSyncResize, 1000);
  (nativePollInterval as any).unref?.();

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    clearInterval(pollInterval);
    clearInterval(nativePollInterval);
    process.stdout.off('resize', stdoutResizeListener);
    try { process.removeListener('SIGWINCH', sigwinchHandler); } catch { /* ignore */ }
    internalRenderer.off('destroy', dispose);
  };

  internalRenderer.on('destroy', dispose);
  syncResize();

  return dispose;
}
