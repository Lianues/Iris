/**
 * iris extension CLI 子命令实现（非 TUI 模式）
 *
 * 当 `iris extension <subcommand>` 出现可识别子命令时，绕过 OpenTUI 渲染，
 * 直接执行一次性操作并把结果以纯文本输出到 stdout/stderr。
 *
 * 支持的子命令：
 *   list                         按当前 scope 列出已发现的扩展
 *   install <path|url>           远程仓库安装；URL 时自动转为 install-git
 *   install-git <url>            Git 安装（支持 --ref/--subdir）
 *   install-local <name>         本地 extensions/ 目录安装
 *   update <name>                按记录的 Git 来源升级
 *   delete <name>                删除（仅 installed / agent-installed）
 *   enable <name>                写 plugins.yaml: enabled: true
 *   disable <name>               写 plugins.yaml: enabled: false
 *   help                         打印此帮助
 *
 * 范围 flag（所有子命令通用）：
 *   --global, -g                 装到 ~/.iris/extensions/
 *   --agent <name>, -A <name>    装到 ~/.iris/agents/<name>/extensions/
 *   缺省                         全局
 */

import { isGitExtensionUrlLike } from "irises-extension-sdk/utils"
import {
  deleteInstalledExtension,
  disableInstalledExtension,
  enableInstalledExtensionWithDependencies,
  inspectGitExtensionUpdate,
  installGitExtension,
  installLocalExtension,
  installRemoteExtension,
  loadInstalledExtensions,
  updateGitInstalledExtension,
  type ExtensionSummary,
} from "../../shared/extensions/runtime.js"
import {
  describeScope,
  parseScopeFromArgs,
  resolveInstallDirForScope,
  type InstallScope,
} from "../../shared/install-dir.js"

export interface CliResult {
  ok: boolean
  message: string
  exitCode?: number
}

export const CLI_SUBCOMMANDS = new Set([
  "list",
  "install", "i",
  "install-git", "git", "ig",
  "install-local", "local", "il",
  "update", "upgrade", "up",
  "delete", "remove", "rm",
  "enable",
  "disable",
  "help", "-h", "--help",
])

/** 入口分发 */
export async function runExtensionCli(args: string[], installDir: string): Promise<CliResult> {
  const subcommand = args[0]
  const rest = args.slice(1)

  if (!subcommand || subcommand === "help" || subcommand === "-h" || subcommand === "--help") {
    return { ok: true, message: HELP_TEXT }
  }

  const scope = parseScopeFromArgs(rest) ?? { kind: "global" as const }
  const positional = extractPositional(rest)
  const target = positional[0]

  try {
    switch (subcommand) {
      case "list":
        return runList(installDir, scope)
      case "install": case "i":
        return await runInstall(target, scope)
      case "install-git": case "git": case "ig":
        return await runInstallGit(target, parseGitFlags(rest), scope)
      case "install-local": case "local": case "il":
        return await runInstallLocal(target, scope)
      case "update": case "upgrade": case "up":
        return await runUpdate(target, installDir, scope, parseGitFlags(rest))
      case "delete": case "remove": case "rm":
        return runDelete(target, installDir, scope)
      case "enable":
        return await runEnable(target, installDir, scope)
      case "disable":
        return runDisable(target, installDir, scope)
      default:
        return { ok: false, message: `未知子命令: ${subcommand}\n\n${HELP_TEXT}`, exitCode: 2 }
    }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err), exitCode: 1 }
  }
}

// ==================== 子命令实现 ====================

function runList(installDir: string, scope: InstallScope): CliResult {
  const opts = scope.kind === "agent"
    ? { installDir, agentExtensionsDir: resolveInstallDirForScope(scope), agentName: scope.agentName }
    : { installDir }
  const items = loadInstalledExtensions(opts)

  if (items.length === 0) {
    return { ok: true, message: `当前 scope (${describeScope(scope)}) 下未发现任何扩展。` }
  }

  const lines: string[] = [
    `已发现 ${items.length} 个扩展（scope: ${describeScope(scope)}）：`,
    "",
  ]

  // 按 source 分组
  const groups: Record<string, ExtensionSummary[]> = {
    "agent-installed": [],
    installed: [],
    embedded: [],
    workspace: [],
  }
  for (const item of items) {
    const key = item.localSource ?? "installed"
    if (!groups[key]) groups[key] = []
    groups[key].push(item)
  }

  const sectionTitles: Record<string, string> = {
    "agent-installed": "[Agent 安装]",
    installed: "[全局安装]",
    embedded: "[内嵌]",
    workspace: "[源码 workspace]",
  }

  for (const key of ["agent-installed", "installed", "embedded", "workspace"]) {
    const group = groups[key]
    if (!group || group.length === 0) continue
    lines.push(`${sectionTitles[key] ?? key}：`)
    for (const item of group) {
      const enabled = item.enabled ? "✓" : "✗"
      lines.push(`  ${enabled} ${item.name.padEnd(28)} v${item.version.padEnd(10)} ${item.typeLabel.padEnd(8)} ${item.description}`)
    }
    lines.push("")
  }

  return { ok: true, message: lines.join("\n").trimEnd() }
}

async function runInstall(target: string | undefined, scope: InstallScope): Promise<CliResult> {
  if (!target?.trim()) return { ok: false, message: "缺少 path/url 参数。\n\n" + HELP_TEXT, exitCode: 2 }
  if (isGitExtensionUrlLike(target)) {
    return runInstallGit(target, {}, scope)
  }
  return runInstallRemote(target, scope)
}

async function runInstallRemote(requested: string, scope: InstallScope): Promise<CliResult> {
  const result = await installRemoteExtension(requested, scope)
  await enableInstalledExtensionWithDependencies(result)
  return {
    ok: true,
    message: formatInstalled(result, scope, "下载安装"),
  }
}

async function runInstallGit(
  url: string | undefined,
  gitFlags: { ref?: string; subdir?: string },
  scope: InstallScope,
): Promise<CliResult> {
  if (!url?.trim()) return { ok: false, message: "缺少 url 参数。\n\n" + HELP_TEXT, exitCode: 2 }
  const result = await installGitExtension({ url, ...gitFlags }, {}, scope)
  await enableInstalledExtensionWithDependencies(result)
  return {
    ok: true,
    message: formatInstalled(result, scope, "Git 拉取安装"),
  }
}

async function runInstallLocal(_name: string | undefined, _scope: InstallScope): Promise<CliResult> {
  if (!_name?.trim()) return { ok: false, message: "缺少 extension 名称或路径参数。\n\n" + HELP_TEXT, exitCode: 2 }
  const result = await installLocalExtension(_name, _scope)
  await enableInstalledExtensionWithDependencies(result)
  return {
    ok: true,
    message: formatInstalled(result, _scope, "本地安装"),
  }
}

async function runUpdate(
  name: string | undefined,
  installDir: string,
  scope: InstallScope,
  gitFlags: { ref?: string; subdir?: string },
): Promise<CliResult> {
  if (!name?.trim()) return { ok: false, message: "缺少 extension 名称参数。\n\n" + HELP_TEXT, exitCode: 2 }
  const summary = findInstalledByName(name, installDir, scope)
  if (!summary) return { ok: false, message: `未找到已安装的扩展: ${name}（scope: ${describeScope(scope)}）`, exitCode: 1 }
  if (summary.installSource !== "git") {
    return { ok: false, message: `${name} 不是通过 Git 安装的，无法升级`, exitCode: 1 }
  }
  // 预检
  const preview = await inspectGitExtensionUpdate(summary)
  // 实际升级
  const updated = await updateGitInstalledExtension(summary)
  return {
    ok: true,
    message: [
      `升级完成：${updated.name}`,
      `  版本：${summary.version} -> ${updated.version}`,
      `  Git commit：${preview.previousCommit?.slice(0, 8) ?? "未知"} -> ${preview.commit?.slice(0, 8) ?? "未知"}`,
      `  目录：${updated.rootDir}`,
      `  scope：${describeScope(scope)}`,
    ].join("\n"),
  }
  // 提示：gitFlags 暂未使用（SDK 升级走记录的 metadata）；保留参数兼容未来扩展
  void gitFlags
}

function runDelete(name: string | undefined, installDir: string, scope: InstallScope): CliResult {
  if (!name?.trim()) return { ok: false, message: "缺少 extension 名称参数。", exitCode: 2 }
  const summary = findInstalledByName(name, installDir, scope)
  if (!summary) return { ok: false, message: `未找到已安装的扩展: ${name}（scope: ${describeScope(scope)}）`, exitCode: 1 }
  if (summary.localSource === "embedded" || summary.localSource === "workspace") {
    return {
      ok: false,
      message: `${name} 是 ${summary.localSource} 类型，不可删除（请用 disable 子命令禁用）`,
      exitCode: 1,
    }
  }
  deleteInstalledExtension(summary)
  return { ok: true, message: `已删除：${name}（${summary.rootDir}）` }
}

async function runEnable(name: string | undefined, installDir: string, scope: InstallScope): Promise<CliResult> {
  if (!name?.trim()) return { ok: false, message: "缺少 extension 名称参数。", exitCode: 2 }
  const summary = findInstalledByName(name, installDir, scope)
  if (!summary) return { ok: false, message: `未发现扩展: ${name}（scope: ${describeScope(scope)}）`, exitCode: 1 }
  await enableInstalledExtensionWithDependencies(summary)
  return { ok: true, message: `已启用：${name}（写入 ${pluginsYamlForSummary(summary)}）` }
}

function runDisable(name: string | undefined, installDir: string, scope: InstallScope): CliResult {
  if (!name?.trim()) return { ok: false, message: "缺少 extension 名称参数。", exitCode: 2 }
  const summary = findInstalledByName(name, installDir, scope)
  if (!summary) return { ok: false, message: `未发现扩展: ${name}（scope: ${describeScope(scope)}）`, exitCode: 1 }
  disableInstalledExtension(summary)
  return { ok: true, message: `已禁用：${name}（写入 ${pluginsYamlForSummary(summary)}）` }
}

// ==================== helper ====================

function formatInstalled(result: ExtensionSummary, scope: InstallScope, verb: string): string {
  return [
    `${verb}完成：${result.name}@${result.version}`,
    `  scope：${describeScope(scope)}`,
    `  目录：${result.rootDir}`,
    result.gitUrl ? `  Git：${result.gitUrl}${result.gitRef ? "#" + result.gitRef : ""}${result.gitCommit ? " (" + result.gitCommit.slice(0, 8) + ")" : ""}` : "",
    `  状态：${result.stateLabel}`,
  ].filter(Boolean).join("\n")
}

function findInstalledByName(name: string, installDir: string, scope: InstallScope): ExtensionSummary | undefined {
  const opts = scope.kind === "agent"
    ? { installDir, agentExtensionsDir: resolveInstallDirForScope(scope), agentName: scope.agentName }
    : { installDir }
  return loadInstalledExtensions(opts).find((item) => item.name === name)
}

function pluginsYamlForSummary(summary: ExtensionSummary): string {
  if (summary.localSource === "agent-installed" && summary.agentName) {
    return `~/.iris/agents/${summary.agentName}/configs/plugins.yaml`
  }
  return "~/.iris/configs/plugins.yaml"
}

function parseGitFlags(args: string[]): { ref?: string; subdir?: string } {
  let ref: string | undefined
  let subdir: string | undefined
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === "--ref" || a === "--branch" || a === "-r") { ref = args[++i]; continue }
    if (a.startsWith("--ref=")) { ref = a.slice("--ref=".length); continue }
    if (a.startsWith("--branch=")) { ref = a.slice("--branch=".length); continue }
    if (a === "--subdir" || a === "--dir" || a === "-s") { subdir = args[++i]; continue }
    if (a.startsWith("--subdir=")) { subdir = a.slice("--subdir=".length); continue }
    if (a.startsWith("--dir=")) { subdir = a.slice("--dir=".length); continue }
  }
  return { ref, subdir }
}

function extractPositional(args: string[]): string[] {
  const out: string[] = []
  const SKIP_NEXT = new Set(["--ref", "--branch", "-r", "--subdir", "--dir", "-s", "--agent", "-A"])
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (SKIP_NEXT.has(a)) { i++; continue }
    if (a === "--global" || a === "-g") continue
    if (a.startsWith("-")) continue
    out.push(a)
  }
  return out
}

const HELP_TEXT = `
Iris Extension CLI

用法：
  iris extension                              打开 TUI 安装与管理界面
  iris extension list                         列出当前 scope 下的已发现扩展
  iris extension install <path>               从远程仓库安装；URL 时自动转 install-git
  iris extension install-git <url>            从 Git 仓库安装 (支持 --ref/--subdir)
  iris extension install-local <name>         从本地 extensions/ 目录安装
  iris extension update <name>                按记录的 Git 来源升级
  iris extension delete <name>                删除已安装扩展（embedded/workspace 不可删）
  iris extension enable <name>                写 plugins.yaml: enabled: true
  iris extension disable <name>               写 plugins.yaml: enabled: false
  iris extension help                         显示此帮助

scope 范围（所有子命令通用，缺省 = 全局）：
  --global, -g                                目标 ~/.iris/extensions/
  --agent <name>, -A <name>                   目标 ~/.iris/agents/<name>/extensions/

Git 选项（install-git / update）：
  --ref <branch/tag/commit>, -r               指定 ref
  --subdir <repo/path>, -s                    指定子目录

示例：
  iris extension list --agent my-agent
  iris extension install-git https://github.com/x/y.git --agent my-agent
  iris extension enable virtual-lover --agent my-agent
  iris extension disable cron --global
  iris extension delete foo
`.trim()
