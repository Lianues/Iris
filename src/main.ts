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
 *   iris daemon                        → 仅启动 Core / IPC 后台服务（不启动 TUI / GUI）
 *   iris stop                          → 关闭已运行的 Iris 实例
 *   iris start --headless              → 等价于 iris daemon
 *   iris platforms                     → 平台配置界面
 *   iris models                        → 模型配置界面
 *   iris settings                      → 配置文件查看与编辑
 *   iris extension                     → 插件安装与管理界面
 *   iris extension install <path>      → 安装 extension
 *   iris ext install-local <name>      → 本地安装 extension
 *   iris models list/add/...           → 管理 LLM 模型配置
 *   iris mcp add ...                   → 添加 MCP 服务器到 Iris 配置
 *   iris cron add/list/...             → 管理 Cron 定时任务
 *   iris ext install-git <url>         → 从 Git 仓库安装 extension
 *   iris ext update <name>             → 升级 Git 安装的 extension
 *   iris --help                        → 显示帮助
 *   iris --version                     → 显示版本
 */

import { TERMINAL_COMMANDS, runTerminalCommand } from './terminal';
import { createRequire } from 'module';

const args = process.argv.slice(2);
const command = args[0];

const HEADLESS_FLAGS = new Set(['--headless', '--core', '--daemon']);

function enableHeadlessMode() {
  process.env.IRIS_PLATFORM = 'headless';
}

// ── 全局标志（无子命令时） ──

const HELP_TEXT = `
Iris - AI Agent

命令:
  iris start              启动平台服务（Web / Telegram 等）
  iris attach             连接已运行的 Iris 实例（跨进程 / 跨设备）
  iris daemon             仅启动 Core / IPC 后台服务（无 TUI / GUI）
  iris stop               关闭已运行的 Iris 实例
  iris start --headless   以 Core-only 后台模式启动
  iris chat <prompt>      执行 AI 提示词（CLI 模式）
  iris onboard            交互式配置引导
  iris models             模型配置界面
  iris platforms          平台配置界面
  iris settings           配置文件查看与编辑
  iris models <cmd>       模型配置命令（list/add/get/remove/default）
  iris mcp                MCP 配置命令（add/list/get/remove/enable/disable）
  iris cron               定时任务命令（status/config/list/add/remove/enable/disable）
  iris extension          插件安装与管理（含远程 / Git 安装）

全局参数:
  -h, --help              显示帮助
  -v, --version           显示版本
  --headless              无子命令时以 Core-only 后台模式启动

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

if (command === 'models') {
  const { isModelsCliSubcommand, runModelsCli } = await import('./models-cli');
  if (isModelsCliSubcommand(args[1])) {
    const result = await runModelsCli(args.slice(1));
    if (result.message) (result.ok ? console.log : console.error)(result.message);
    process.exit(result.exitCode ?? (result.ok ? 0 : 1));
  }
}

// Terminal TUI 命令（onboard / platforms / models / settings）
if (command && TERMINAL_COMMANDS.has(command)) {
  runTerminalCommand(command, args.slice(1));
} else if (command === 'extension' || command === 'extensions' || command === 'ext') {
  // Extension：所有 `iris extension <args>` 都转给独立 TUI 二进制（iris-onboard extension），
  // 由它统一处理 install/list/manage/scope 选择等所有交互。
  // 别名 extensions/ext 都归一化成 extension。
  runTerminalCommand('extension', args.slice(1));
} else if (command === 'chat') {
  // CLI 提示词模式
  process.argv.splice(2, 1); // 移除 'chat'，让 cli.ts 解析剩余参数
  await import('./cli');
} else if (command === 'mcp') {
  // MCP 配置命令（写入 Iris 自己的 ~/.iris/configs/mcp.yaml 或 Agent 覆盖层）
  const { runMcpCli } = await import('./mcp-cli');
  const result = await runMcpCli(args.slice(1), { stderr: (message) => console.error(message) });
  if (result.message) (result.ok ? console.log : console.error)(result.message);
  process.exit(result.exitCode ?? (result.ok ? 0 : 1));
} else if (command === 'cron') {
  // Cron 定时任务命令（写入 cron.yaml 和 extension-data/cron/cron-jobs.json）
  const { runCronCli } = await import('./cron-cli');
  const result = await runCronCli(args.slice(1));
  if (result.message) (result.ok ? console.log : console.error)(result.message);
  process.exit(result.exitCode ?? (result.ok ? 0 : 1));
} else if (command === 'attach') {
  // 跨进程 / 跨设备连接已运行的 Iris 实例
  const { runAttach } = await import('./attach');
  await runAttach(args.slice(1));
} else if (command === 'stop' || command === 'shutdown') {
  // 关闭已运行的 Iris 实例
  const { runStop } = await import('./stop');
  await runStop(args.slice(1));
} else if (command === 'daemon' || command === 'headless' || command === 'core') {
  // 仅启动 Core / IPC，不创建任何平台
  process.argv.splice(2, 1);
  enableHeadlessMode();
  await import('./index');
} else if (command && HEADLESS_FLAGS.has(command)) {
  // iris --headless：无子命令时的 Core-only 快捷方式
  process.argv.splice(2, 1);
  enableHeadlessMode();
  await import('./index');
} else if (!command || command === 'serve' || command === 'start') {
  // 平台服务（默认命令）
  if (command) {
    process.argv.splice(2, 1);
  }
  if (args.slice(command ? 1 : 0).some(arg => HEADLESS_FLAGS.has(arg))) {
    enableHeadlessMode();
  }
  await import('./index');
} else {
  // 尝试匹配扩展注册的 CLI 命令
  const { tryExtensionCommand } = await import('./extension/cli-dispatch');
  const handled = await tryExtensionCommand(command, args.slice(1));
  if (!handled) {
    console.error(`未知命令: ${command}`);
    console.error('运行 iris --help 查看可用命令。');
    process.exit(1);
  }
}
