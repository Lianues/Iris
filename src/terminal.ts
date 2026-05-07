/**
 * Terminal TUI 命令共享工具
 *
 * 解析和启动 iris-onboard 终端二进制，供 main.ts 和 cli.ts 共用。
 */

import * as childProcess from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/** 需要路由到 terminal TUI 的子命令名称 */
export const TERMINAL_COMMANDS = new Set([
  'onboard',
  'platforms',
  'models',
  'settings',
]);

function resolvePlatformPackageName(): string {
  const platformMap: Record<string, string> = {
    darwin: 'darwin',
    linux: 'linux',
    win32: 'windows',
  };
  const archMap: Record<string, string> = {
    x64: 'x64',
    arm64: 'arm64',
    arm: 'arm',
  };

  const platform = platformMap[os.platform()] ?? os.platform();
  const arch = archMap[os.arch()] ?? os.arch();
  return `irises-${platform}-${arch}`;
}

function findPlatformPackageBinDir(pkgDir: string, binaryName: string): string | undefined {
  const nodeModulesDir = path.join(pkgDir, 'node_modules');
  if (!fs.existsSync(nodeModulesDir)) return undefined;

  const preferred = path.join(nodeModulesDir, resolvePlatformPackageName(), 'bin');
  if (fs.existsSync(path.join(preferred, binaryName))) return preferred;

  try {
    for (const entry of fs.readdirSync(nodeModulesDir)) {
      if (!entry.startsWith('irises-')) continue;
      const candidate = path.join(nodeModulesDir, entry, 'bin');
      if (fs.existsSync(path.join(candidate, binaryName))) return candidate;
    }
  } catch { /* ignore */ }

  return undefined;
}

/** 查找 iris-onboard 二进制路径 */
export function resolveTerminalBinary(): string {
  const binaryName = process.platform === 'win32' ? 'iris-onboard.exe' : 'iris-onboard';
  const hiddenBinaryName = process.platform === 'win32' ? '.iris-onboard.exe' : '.iris-onboard';

  const searchDirs: string[] = [];

  // 优先：npm 包装器传入的真实包目录（PRoot/L2S 安全）
  const pkgDir = process.env.__IRIS_PKG_DIR;
  if (pkgDir) {
    searchDirs.push(path.join(pkgDir, 'bin'));
    const platformPackageBinDir = findPlatformPackageBinDir(pkgDir, binaryName);
    if (platformPackageBinDir) searchDirs.push(platformPackageBinDir);
  }

  // 回退：从 process.execPath 推导（正常环境）
  try {
    searchDirs.push(path.dirname(fs.realpathSync(process.execPath)));
  } catch { /* ignore */ }

  const dedupedSearchDirs = Array.from(new Set(searchDirs.map((dir) => path.resolve(dir))));

  const candidates = dedupedSearchDirs.flatMap((dir) => [
    path.join(dir, binaryName),
    path.join(dir, hiddenBinaryName),
  ]);

  const terminalBinary = candidates.find((candidate) => fs.existsSync(candidate));
  if (!terminalBinary) {
    console.error('未找到 iris-onboard 二进制，请确认当前发行包已包含 terminal 工具。');
    process.exit(1);
  }

  return terminalBinary;
}

/** 启动终端命令并接管进程（不会返回） */
export function runTerminalCommand(commandName: string, extraArgs: string[] = []): never {
  const terminalBinary = resolveTerminalBinary();
  const result = childProcess.spawnSync(terminalBinary, [commandName, ...extraArgs], {
    stdio: 'inherit',
  });

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }

  process.exit(typeof result.status === 'number' ? result.status : 0);
}
