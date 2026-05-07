import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import {
  resolveScopeInstallDir,
  resolveScopePluginsYamlPath,
  type InstallScope,
} from "irises-extension-sdk/utils"

/**
 * 安装范围：
 *   - global：~/.iris/extensions/，所有 agent 共享
 *   - agent ：~/.iris/agents/<name>/extensions/，仅指定 agent 可见，优先级最高
 */
export type { InstallScope }

/** 是否为 global scope（type guard） */
export function isGlobalScope(scope: InstallScope): scope is { kind: "global" } {
  return scope.kind === "global"
}

/** 把 scope 解析成"已安装扩展"的根目录绝对路径 */
export function resolveInstallDirForScope(scope: InstallScope): string {
  return resolveScopeInstallDir(scope)
}

/** 把 scope 解析成对应层 plugins.yaml 路径 */
export function resolvePluginsYamlPathForScope(scope: InstallScope): string {
  return resolveScopePluginsYamlPath(scope)
}

/** scope 的人类可读标签 */
export function describeScope(scope: InstallScope): string {
  return scope.kind === "global" ? "全局 (~/.iris/extensions/)" : `agent: ${scope.agentName}`
}

function hasPackagedRuntimeResources(dir: string): boolean {
  return fs.existsSync(path.join(dir, "data", "configs.example"))
}

function resolvePlatformPackageName(): string {
  const platformMap: Record<string, string> = { darwin: "darwin", linux: "linux", win32: "windows" }
  const archMap: Record<string, string> = { x64: "x64", arm64: "arm64", arm: "arm" }
  const platform = platformMap[os.platform()] ?? os.platform()
  const arch = archMap[os.arch()] ?? os.arch()
  return `irises-${platform}-${arch}`
}

function findPlatformPackageInNodeModules(baseDir: string): string | undefined {
  const nodeModulesDir = path.join(baseDir, "node_modules")
  if (!fs.existsSync(nodeModulesDir)) return undefined

  const preferred = path.join(nodeModulesDir, resolvePlatformPackageName())
  if (hasPackagedRuntimeResources(preferred)) return preferred

  try {
    for (const entry of fs.readdirSync(nodeModulesDir)) {
      if (!entry.startsWith("irises-")) continue
      const candidate = path.join(nodeModulesDir, entry)
      if (hasPackagedRuntimeResources(candidate)) {
        return candidate
      }
    }
  } catch { /* ignore */ }

  return undefined
}

/**
 * （旧接口）解析"内嵌扩展所在的安装目录"，用于 embedded.json 查找。
 *
 * 这个目录是发行包/源码仓库根，与 InstallScope 概念正交：
 *   - InstallScope 决定写入位置（agent vs global）
 *   - 此函数返回值用于读取内嵌的 extensions/ 子目录
 */
export function resolveTerminalInstallDir(
  commandArgs: string[],
  executablePath: string,
  options: { allowPositionalOverride?: boolean } = {},
): string {
  const allowPositionalOverride = options.allowPositionalOverride !== false
  if (allowPositionalOverride) {
    // 跳过 --global / --agent <name> 等 scope 参数，找到第一个非选项位置参数作为 install-dir 覆盖。
    // 注意：extension CLI 子命令的位置参数不是 install-dir，调用方应显式关闭此行为。
    const positional = extractPositional(commandArgs)
    const cliArg = positional[0]
    if (cliArg) return path.resolve(cliArg)
  }

  if (process.env.IRIS_DIR) {
    return path.resolve(process.env.IRIS_DIR)
  }

  const pkgDir = process.env.__IRIS_PKG_DIR
  if (pkgDir) {
    const resolvedPkgDir = path.resolve(pkgDir)
    if (hasPackagedRuntimeResources(resolvedPkgDir)) {
      return resolvedPkgDir
    }
    const found = findPlatformPackageInNodeModules(resolvedPkgDir)
    if (found) return found
  }

  const executableInstallDir = path.resolve(path.dirname(executablePath), "..")
  if (hasPackagedRuntimeResources(executableInstallDir)) {
    return executableInstallDir
  }

  const found = findPlatformPackageInNodeModules(executableInstallDir)
  if (found) return found

  return process.cwd()
}

/** 从 commandArgs 中剥离已知 flag（--global / --agent <name>），返回剩余位置参数。 */
function extractPositional(args: string[]): string[] {
  const out: string[] = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === "--global" || a === "-g") continue
    if (a === "--agent" || a === "-A") { i++; continue }
    if (a.startsWith("--agent=") || a.startsWith("--global=")) continue
    if (a.startsWith("-")) continue
    out.push(a)
  }
  return out
}

/**
 * 解析 CLI 参数中的 InstallScope；找不到返回 undefined。
 *   --global / -g                   → { kind: 'global' }
 *   --agent <name> / -A <name>      → { kind: 'agent', agentName: name }
 *   --agent=<name>                  → 同上
 */
export function parseScopeFromArgs(args: string[]): InstallScope | undefined {
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === "--global" || a === "-g") return { kind: "global" }
    if (a === "--agent" || a === "-A") {
      const name = args[i + 1]?.trim()
      if (name) return { kind: "agent", agentName: name }
    }
    if (a.startsWith("--agent=")) {
      const name = a.slice("--agent=".length).trim()
      if (name) return { kind: "agent", agentName: name }
    }
  }
  return undefined
}
