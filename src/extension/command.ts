import { installExtension, installLocalExtension } from './installer';

const EXTENSION_COMMAND_NAMES = new Set(['extension', 'extensions', 'ext']);
const INSTALL_COMMAND_NAMES = new Set(['install', 'i']);
const INSTALL_LOCAL_COMMAND_NAMES = new Set(['install-local', 'local', 'il']);
const HELP_COMMAND_NAMES = new Set(['-h', '--help', 'help']);

export interface ParsedExtensionCommand {
  namespace: string;
  action: 'install' | 'install-local' | 'help';
  target?: string;
}

const HELP_TEXT = `
Iris Extension 命令

用法:
  iris extension install <path>        从远程仓库的 extensions/<path>/ 安装；远程不存在时回退到本地 extension 目录
  iris extension install-local <name>  仅从本地 extension 目录安装
  iris extension <path>                install 的简写
  iris ext install <path>              extension 的简写别名
  iris ext <path>                      install 的最简写法

说明:
  - install 支持这些写法：aaa、group/aaa、extensions/aaa
  - 安装目标目录：~/.iris/extensions/<manifest.name>/
  - install 会优先从远程仓库压缩包提取 extensions/<path>/；仅当远程不存在该目录时，才尝试本地安装
  - install-local 只会从当前仓库根目录 ./extensions/ 查找并安装
  - 可通过环境变量 IRIS_EXTENSION_REMOTE_ARCHIVE_URL 覆盖远程仓库压缩包地址
`.trim();

export function isExtensionCommandNamespace(value: string | undefined): boolean {
  return !!value && EXTENSION_COMMAND_NAMES.has(value);
}

export function parseExtensionCommandArgs(args: string[]): ParsedExtensionCommand | undefined {
  const namespace = args[0];
  if (!isExtensionCommandNamespace(namespace)) return undefined;

  const rest = args.slice(1);
  if (rest.length === 0 || HELP_COMMAND_NAMES.has(rest[0])) {
    return { namespace, action: 'help' };
  }

  const subcommand = rest[0];
  if (INSTALL_COMMAND_NAMES.has(subcommand)) {
    return {
      namespace,
      action: 'install',
      target: rest[1],
    };
  }

  if (INSTALL_LOCAL_COMMAND_NAMES.has(subcommand)) {
    return {
      namespace,
      action: 'install-local',
      target: rest[1],
    };
  }

  if (!subcommand.startsWith('-')) {
    return {
      namespace,
      action: 'install',
      target: subcommand,
    };
  }

  return { namespace, action: 'help' };
}

function printInstalledSummary(result: Awaited<ReturnType<typeof installExtension>>): void {
  console.log('extension 安装完成');
  console.log(`- 名称: ${result.name}`);
  console.log(`- 版本: ${result.version}`);
  console.log(`- 来源: ${result.source}`);
  console.log(`- 目录: ${result.targetDir}`);

  if (result.remotePath) {
    console.log(`- 远程目录: ${result.remotePath}`);
  }
  if (result.sourceDir) {
    console.log(`- 本地来源: ${result.sourceDir}`);
  }
  if (result.fallbackReason === 'remote_path_not_found' && result.fallbackDetail) {
    console.log(`- 回退原因: 远程目录不存在：${result.fallbackDetail}`);
  }
}

export async function runExtensionCommand(args: string[]): Promise<void> {
  const parsed = parseExtensionCommandArgs(args);
  if (!parsed) {
    throw new Error('当前参数不是 extension 命令');
  }

  if (parsed.action === 'help') {
    console.log(HELP_TEXT);
    return;
  }

  if (!parsed.target?.trim()) {
    throw new Error(`缺少 ${parsed.action === 'install' ? 'path' : 'name'} 参数。\n\n${HELP_TEXT}`);
  }

  const result = parsed.action === 'install'
    ? await installExtension(parsed.target)
    : await installLocalExtension(parsed.target);

  printInstalledSummary(result);
}
