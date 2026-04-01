/**
 * Terminal TUI 命令共享工具
 *
 * 解析和启动 iris-onboard 终端二进制，供 main.ts 和 cli.ts 共用。
 */

import * as childProcess from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

/** 需要路由到 terminal TUI 的子命令名称 */
export const TERMINAL_COMMANDS = new Set([
  'onboard',
  'platforms',
  'models',
  'settings',
]);

/** 查找 iris-onboard 二进制路径 */
export function resolveTerminalBinary(): string {
  const binaryName = process.platform === 'win32' ? 'iris-onboard.exe' : 'iris-onboard';
  const hiddenBinaryName = process.platform === 'win32' ? '.iris-onboard.exe' : '.iris-onboard';
  const execDir = path.dirname(fs.realpathSync(process.execPath));
  const candidates = [
    path.join(execDir, binaryName),
    path.join(execDir, hiddenBinaryName),
  ];

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
