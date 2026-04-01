/**
 * 统一入口
 *
 * 编译为二进制时使用此文件。根据命令行参数路由到不同模式。
 *
 * 路由规则：
 *   iris                        → 启动平台服务（默认）
 *   iris serve                  → 启动平台服务
 *   iris start                  → 启动平台服务（serve 别名）
 *   iris onboard                → 启动交互式配置引导
 *   iris platforms              → 启动平台配置界面
 *   iris models                 → 启动模型配置界面
 *   iris extension              → 启动插件安装与管理界面
 *   iris extension install <path>      → 从远程仓库的 extensions/<path>/ 安装 extension
 *   iris ext install-local <name>      → 仅从本地 extension 目录安装
 *   iris -p "prompt"            → CLI 模式
 *   iris "prompt"               → CLI 模式
 *   iris --help                 → 显示帮助
 *   iris --version              → 显示版本
 */

import * as childProcess from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const args = process.argv.slice(2);

function spawnAndExit(command: string, forwardedArgs: string[]): never {
  const result = childProcess.spawnSync(command, forwardedArgs, {
    stdio: 'inherit',
  });

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }

  process.exit(typeof result.status === 'number' ? result.status : 0);
}

function resolveTerminalBinary(): string {
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

function runTerminalCommand(commandName: string): never {
  const terminalBinary = resolveTerminalBinary();
  spawnAndExit(terminalBinary, [commandName, ...args.slice(1)]);
}

if (args[0] === 'onboard' || args[0] === 'platforms' || args[0] === 'models') {
  runTerminalCommand(args[0]);
}

if (args[0] === 'extension' || args[0] === 'extensions' || args[0] === 'ext') {
  if (args.length === 1) {
    runTerminalCommand('extension');
  }

  try {
    const { runExtensionCommand } = await import('./extension/command');
    await runExtensionCommand(args);
    process.exit(0);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

{
  const CLI_FLAGS = new Set([
    '-p', '--prompt',
    '-s', '--session',
    '--model', '--agent', '--cwd',
    '--stream', '--no-stream',
    '--output', '--print-tools',
  ]);

  function shouldRunCLI(): boolean {
    if (args.length === 0) return false;
    if (args[0] === 'serve' || args[0] === 'start') return false;

    if (args.includes('-h') || args.includes('--help')) return true;
    if (args.includes('-v') || args.includes('--version')) return true;
    if (args.some(a => CLI_FLAGS.has(a))) return true;
    if (args.some(a => !a.startsWith('-'))) return true;

    return false;
  }

  if (shouldRunCLI()) {
    await import('./cli');
  } else {
    if (args[0] === 'serve' || args[0] === 'start') {
      process.argv.splice(2, 1);
    }
    await import('./index');
  }
}
