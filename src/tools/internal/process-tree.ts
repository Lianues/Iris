import { spawn } from 'node:child_process';

export interface KillProcessTreeOptions {
  /** Signal used for the first graceful termination attempt on Unix-like platforms. */
  signal?: NodeJS.Signals;
  /** Delay before SIGKILL/taskkill force cleanup. Set to 0 to force immediately; false to disable. */
  forceAfterMs?: number | false;
}

function killWindowsProcessTree(pid: number | undefined): void {
  if (!pid) return;
  try {
    spawn('taskkill', ['/T', '/F', '/PID', String(pid)], {
      stdio: 'ignore',
      windowsHide: true,
    }).on('error', () => undefined);

    // taskkill /T works while the parent process still exists. If the parent has
    // already exited, use WMI to find children whose ParentProcessId still points
    // to the original process and terminate them individually.
    const wmic = spawn('wmic', [
      'process', 'where', `ParentProcessId=${pid}`, 'get', 'ProcessId', '/value',
    ], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });

    let output = '';
    wmic.stdout.on('data', (d: Buffer) => { output += d.toString(); });
    wmic.on('close', () => {
      const matches = output.match(/ProcessId=(\d+)/g);
      if (!matches) return;
      for (const m of matches) {
        const childPid = m.split('=')[1];
        spawn('taskkill', ['/T', '/F', '/PID', childPid], {
          stdio: 'ignore',
          windowsHide: true,
        }).on('error', () => undefined);
      }
    });
    wmic.on('error', () => undefined);
  } catch {
    // Process may already have exited.
  }
}

export function forceKillProcessTree(pid: number | undefined): void {
  if (!pid) return;
  if (process.platform === 'win32') {
    killWindowsProcessTree(pid);
    return;
  }

  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    try { process.kill(pid, 'SIGKILL'); } catch { /* process may already have exited */ }
  }
}

export function signalProcessTree(pid: number | undefined, signal: NodeJS.Signals = 'SIGTERM'): void {
  if (!pid) return;
  if (process.platform === 'win32') {
    // Windows does not support Unix process groups; use taskkill for tree cleanup.
    killWindowsProcessTree(pid);
    return;
  }

  try {
    process.kill(-pid, signal);
  } catch {
    try { process.kill(pid, signal); } catch { /* process may already have exited */ }
  }
}

/**
 * Terminate a process tree and optionally schedule a force kill.
 * Returns a cleanup function that cancels the scheduled force kill timer.
 */
export function killProcessTree(pid: number | undefined, options: KillProcessTreeOptions = {}): () => void {
  if (!pid) return () => undefined;

  const signal = options.signal ?? 'SIGTERM';
  const forceAfterMs = options.forceAfterMs === undefined ? 500 : options.forceAfterMs;

  if (process.platform === 'win32') {
    killWindowsProcessTree(pid);
    return () => undefined;
  }

  signalProcessTree(pid, signal);
  if (forceAfterMs === false) return () => undefined;

  const timer = setTimeout(() => forceKillProcessTree(pid), Math.max(0, forceAfterMs));
  timer.unref?.();
  return () => clearTimeout(timer);
}
