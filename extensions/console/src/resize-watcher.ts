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

  const syncResize = () => {
    if (disposed) return;

    const { width, height } = getTerminalSize(internalRenderer);
    if (width <= 0 || height <= 0) return;
    if (width === lastWidth && height === lastHeight) return;

    lastWidth = width;
    lastHeight = height;
    applyResize(internalRenderer, width, height);
  };

  const stdoutResizeListener = () => {
    syncResize();
  };

  process.stdout.on('resize', stdoutResizeListener);

  const pollInterval = setInterval(syncResize, 120);
  pollInterval.unref?.();

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    clearInterval(pollInterval);
    process.stdout.off('resize', stdoutResizeListener);
    internalRenderer.off('destroy', dispose);
  };

  internalRenderer.on('destroy', dispose);
  syncResize();

  return dispose;
}
