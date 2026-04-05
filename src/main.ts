/**
 * 统一入口
 *
 * 编译为二进制时使用此文件。根据子命令路由到不同模式。
 *
 * 路由规则：
 *   iris                               → 启动平台服务（默认）
 *   iris start | serve                 → 启动平台服务
 *   iris chat <prompt>                 → CLI 提示词模式
 *   iris onboard                       → 交互式配置引导
 *   iris platforms                     → 平台配置界面
 *   iris models                        → 模型配置界面
 *   iris settings                      → 配置文件查看与编辑
 *   iris extension                     → 插件安装与管理界面
 *   iris extension install <path>      → 安装 extension
 *   iris ext install-local <name>      → 本地安装 extension
 *   iris --help                        → 显示帮助
 *   iris --version                     → 显示版本
 */

import { TERMINAL_COMMANDS, runTerminalCommand } from './terminal';
import { createRequire } from 'module';

const args = process.argv.slice(2);
const command = args[0];

// ── 全局标志（无子命令时） ──

const HELP_TEXT = `
Iris - AI Agent

命令:
  iris start              启动平台服务（Web / Telegram 等）
  iris attach             连接已运行的 Iris 实例（跨进程 Console）
  iris chat <prompt>      执行 AI 提示词（CLI 模式）
  iris onboard            交互式配置引导
  iris models             模型配置界面
  iris platforms          平台配置界面
  iris settings           配置文件查看与编辑
  iris extension          插件安装与管理

全局参数:
  -h, --help              显示帮助
  -v, --version           显示版本

使用 iris chat --help 查看 CLI 模式详细帮助。
`.trim();

if (!command || command === '-h' || command === '--help') {
  if (!command) {
    // iris（无参数）→ 启动平台服务
  } else {
    console.log(HELP_TEXT);
    process.exit(0);
  }
}

if (command === '-v' || command === '--version') {
  try {
    const v = (globalThis as any).IRIS_VERSION
      || (() => {
        const require = createRequire(import.meta.url);
        return require('../package.json').version;
      })();
    console.log(`iris ${v}`);
  } catch {
    console.log('iris (unknown version)');
  }
  process.exit(0);
}

// ── 子命令路由 ──

// 修正：原路由使用并列 if，匹配到命令后执行完仍会 fall-through 到末尾的"未知命令"。
// 改为 if/else if 链，确保每个命令分支互斥，不再误报。

// Terminal TUI 命令（onboard / platforms / models / settings）
if (command && TERMINAL_COMMANDS.has(command)) {
  runTerminalCommand(command, args.slice(1));
} else if (command === 'extension' || command === 'extensions' || command === 'ext') {
  // Extension（TUI / 子命令）
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
} else if (command === 'chat') {
  // CLI 提示词模式
  process.argv.splice(2, 1); // 移除 'chat'，让 cli.ts 解析剩余参数
  await import('./cli');
} else if (command === 'attach') {
  // 跨进程连接已运行的 Iris 实例
  const { runAttach } = await import('./attach');
  await runAttach(args.slice(1));
} else if (!command || command === 'serve' || command === 'start') {
  // 平台服务（默认命令）
  if (command) {
    process.argv.splice(2, 1);
  }
  await import('./index');
} else {
  // 未知命令
  console.error(`未知命令: ${command}`);
  console.error('运行 iris --help 查看可用命令。');
  process.exit(1);
}
