import fs from "node:fs"
import path from "node:path"
import { parse, stringify } from "yaml"
import {
  normalizeText,
  normalizeRelativeFilePath,
  normalizeRequestedExtensionPath,
  resolveSafeRelativePath,
  MANIFEST_FILE,
  DISABLED_MARKER_FILE,
  readManifestFromDir,
  ensureDirectory,
  createTempInstallDir,
  cleanupTempInstallDir,
  collectRelativeFilesFromDir,
  getInstalledExtensionsDir,
  resolveRuntimeConfigDir,
  fetchBuffer,
  fetchRemoteIndex,
  fetchRemoteManifest,
  buildRemoteExtensionFileUrl,
  getRemoteDistributionFiles,
  analyzeRuntimeEntries,
  describeRuntimeIssues,
  type ExtensionManifestLike,
  ensureExtensionRuntimeDependencies,
  getMissingExtensionRuntimeDependencies,
  type EnsureExtensionRuntimeDependenciesResult,
  cloneGitRepository,
  resolveGitExtensionTarget,
  formatGitExtensionTarget,
  readGitInstallMetadata,
  writeGitInstallMetadata,
  type GitCommandRunner,
  type GitExtensionTarget,
  type GitInstallMetadata,
  installExtension as sdkInstallExtension,
  installGitExtension as sdkInstallGitExtension,
  installLocalExtension as sdkInstallLocalExtension,
  updateGitExtension as sdkUpdateGitExtension,
  inspectGitExtensionUpdate as sdkInspectGitExtensionUpdate,
  deleteInstalledExtension as sdkDeleteInstalledExtension,
} from "irises-extension-sdk/utils"
import type { InstalledExtensionResult } from "irises-extension-sdk"
import {
  resolveInstallDirForScope,
  resolvePluginsYamlPathForScope,
  type InstallScope,
} from "../install-dir.js"

// ==================== TUI 专属类型 ====================

interface EditablePluginEntry {
  name: string
  type?: "local" | "npm"
  enabled?: boolean
  priority?: number
  config?: Record<string, unknown>
}

/**
 * 扩展来源：
 *   - installed       = ~/.iris/extensions/<name>            （全局已安装）
 *   - agent-installed = ~/.iris/agents/<id>/extensions/<name>（agent 专属，优先级最高）
 *   - embedded        = <installDir>/extensions/<name> 且 ∈ embedded.json （随发行包内嵌）
 *   - workspace       = <installDir>/extensions/<name> 且 ∉ embedded.json （源码仓库的额外项）
 */
type ExtensionLocalSource = "installed" | "agent-installed" | "embedded" | "workspace"

interface DistributionAnalysis {
  distributionMode: "bundled" | "source"
  distributionLabel: string
  distributionDetail: string
  runnableEntries: string[]
}

export interface ExtensionSummary {
  requestedPath: string
  name: string
  version: string
  description: string
  typeLabel: string
  typeDetail: string
  distributionMode: "bundled" | "source"
  distributionLabel: string
  distributionDetail: string
  runnableEntries: string[]
  hasPlugin: boolean
  hasPlatforms: boolean
  platformCount: number
  installed: boolean
  enabled: boolean
  stateLabel: string
  statusDetail: string
  rootDir?: string
  localSource?: ExtensionLocalSource
  installSource?: "remote" | "local" | "git" | "embedded" | "workspace"
  gitUrl?: string
  gitRef?: string
  gitCommit?: string
  gitSubdir?: string
  localSourceLabel?: string
  localVersion?: string
  localVersionHint?: string
  /** agent-installed 时记录所属 agent 名（用于后续 update/delete 时定位 plugins.yaml） */
  agentName?: string
}

export interface GitExtensionInstallInput {
  url: string
  ref?: string
  subdir?: string
}

export interface GitExtensionRuntimeOptions {
  commandRunner?: GitCommandRunner
}

export interface GitExtensionPreview {
  summary: ExtensionSummary
  target: GitExtensionTarget
  commit?: string
}

export interface GitExtensionUpdatePreview extends GitExtensionPreview {
  current: ExtensionSummary
  previousCommit?: string
  sameCommit: boolean
}

export { getRemoteExtensionRequestTimeoutMs } from "irises-extension-sdk/utils"
export { isGitExtensionUrlLike } from "irises-extension-sdk/utils"

// ==================== TUI 专属工具 ====================

function getEmbeddedExtensionsDir(installDir: string): string {
  return path.join(path.resolve(installDir), "extensions")
}

function getPlatformCount(manifest: ExtensionManifestLike): number {
  return Array.isArray(manifest.platforms)
    ? manifest.platforms.filter((platform) => !!normalizeText(platform?.name) && !!normalizeText(platform?.entry)).length
    : 0
}

function hasPlatformContribution(manifest: ExtensionManifestLike): boolean {
  return getPlatformCount(manifest) > 0
}

function hasPluginContribution(manifest: ExtensionManifestLike): boolean {
  if (manifest.plugin && typeof manifest.plugin === "object") {
    return true
  }

  if (normalizeText(manifest.entry)) {
    return true
  }

  return !hasPlatformContribution(manifest)
}

function buildTypeLabel(manifest: ExtensionManifestLike): string {
  const hasPlugin = hasPluginContribution(manifest)
  const platformCount = getPlatformCount(manifest)

  if (hasPlugin && platformCount > 0) return "插件 + 平台"
  if (hasPlugin) return "插件"
  if (platformCount > 1) return `${platformCount} 个平台`
  if (platformCount === 1) return "平台"
  return "扩展"
}

function buildTypeDetail(manifest: ExtensionManifestLike): string {
  const hasPlugin = hasPluginContribution(manifest)
  const platformCount = getPlatformCount(manifest)

  if (hasPlugin && platformCount > 0) {
    return `包含插件入口，并贡献 ${platformCount} 个平台。`
  }
  if (hasPlugin) {
    return "只包含插件入口。"
  }
  if (platformCount > 0) {
    return `只包含平台贡献，共 ${platformCount} 个平台。`
  }
  return "未声明插件入口或平台贡献。"
}

function analyzeDistribution(availableFiles: string[], manifest: ExtensionManifestLike): DistributionAnalysis {
  const analyses = analyzeRuntimeEntries(availableFiles, manifest)
  const issues = analyses.filter((item) => item.needsBuild)
  if (issues.length > 0) {
    return {
      distributionMode: "source",
      distributionLabel: "源码包",
      distributionDetail: `当前包不是可直接安装的发行包：${describeRuntimeIssues(issues)}`,
      runnableEntries: [],
    }
  }

  return {
    distributionMode: "bundled",
    distributionLabel: "可直接安装",
    distributionDetail: "当前包已包含可运行入口，可直接下载安装。",
    runnableEntries: analyses.flatMap((item) => item.runnableAlternatives),
  }
}

// ==================== plugins.yaml 读写 ====================

function readEditablePluginEntries(scope: InstallScope = { kind: "global" }): EditablePluginEntry[] {
  const pluginsPath = resolvePluginsYamlPathForScope(scope)
  if (!fs.existsSync(pluginsPath)) return []

  try {
    const raw = parse(fs.readFileSync(pluginsPath, "utf-8"))
    const list = Array.isArray(raw)
      ? raw
      : raw && typeof raw === "object" && Array.isArray((raw as { plugins?: unknown }).plugins)
        ? (raw as { plugins: unknown[] }).plugins
        : []

    return list
      .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
      .filter((item) => !!normalizeText(item.name))
      .map((item) => ({
        name: normalizeText(item.name)!,
        type: item.type === "npm" ? "npm" : "local",
        enabled: item.enabled !== false,
        priority: typeof item.priority === "number" ? item.priority : undefined,
        config: item.config && typeof item.config === "object" && !Array.isArray(item.config)
          ? item.config as Record<string, unknown>
          : undefined,
      }))
  } catch {
    return []
  }
}

function writeEditablePluginEntries(entries: EditablePluginEntry[], scope: InstallScope = { kind: "global" }): void {
  const pluginsPath = resolvePluginsYamlPathForScope(scope)
  ensureDirectory(path.dirname(pluginsPath))
  const content = `# 插件配置\n\n${stringify({ plugins: entries }, { indent: 2 })}`
  fs.writeFileSync(pluginsPath, content, "utf-8")
}

function upsertLocalPluginEnabled(name: string, enabled: boolean, scope: InstallScope = { kind: "global" }): void {
  const entries = readEditablePluginEntries(scope)
  const existingIndex = entries.findIndex((entry) => entry.name === name && (entry.type ?? "local") === "local")

  if (existingIndex >= 0) {
    entries[existingIndex] = {
      ...entries[existingIndex],
      type: "local",
      enabled,
    }
  } else {
    entries.push({
      name,
      type: "local",
      enabled,
    })
  }

  writeEditablePluginEntries(entries, scope)
}

function removeLocalPluginEntry(name: string, scope: InstallScope = { kind: "global" }): void {
  const nextEntries = readEditablePluginEntries(scope).filter((entry) => !(entry.name === name && (entry.type ?? "local") === "local"))
  writeEditablePluginEntries(nextEntries, scope)
}

function getPluginEnabledState(name: string, scope: InstallScope = { kind: "global" }): boolean | undefined {
  const entry = readEditablePluginEntries(scope).find((item) => item.name === name && (item.type ?? "local") === "local")
  if (!entry) return undefined
  return entry.enabled !== false
}

/** 将 ExtensionSummary 还原成 InstallScope，用于后续 update/delete/enable/disable 写对应层 plugins.yaml。 */
function scopeFromSummary(summary: ExtensionSummary): InstallScope {
  if (summary.localSource === "agent-installed" && summary.agentName) {
    return { kind: "agent", agentName: summary.agentName }
  }
  return { kind: "global" }
}

// ==================== 安装状态 ====================

function hasDisabledMarker(rootDir: string): boolean {
  return fs.existsSync(path.join(rootDir, DISABLED_MARKER_FILE))
}

function setDisabledMarker(rootDir: string, disabled: boolean): void {
  const markerPath = path.join(rootDir, DISABLED_MARKER_FILE)
  if (disabled) {
    fs.writeFileSync(markerPath, "disabled\n", "utf-8")
  } else if (fs.existsSync(markerPath)) {
    fs.rmSync(markerPath, { force: true })
  }
}

function readSystemConfigFile(): Record<string, unknown> {
  const systemPath = path.join(resolveRuntimeConfigDir(), "system.yaml")
  if (!fs.existsSync(systemPath)) return {}
  try {
    const parsed = parse(fs.readFileSync(systemPath, "utf-8"))
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

function writeSystemConfigFile(systemConfig: Record<string, unknown>): void {
  const configDir = resolveRuntimeConfigDir()
  ensureDirectory(configDir)
  const systemPath = path.join(configDir, "system.yaml")
  fs.writeFileSync(systemPath, `# 系统配置\n\n${stringify(systemConfig, { indent: 2 })}`, "utf-8")
}

function getWorkspaceDiscoveryConfig(): { enabled: boolean; allowlist: string[] } {
  const system = readSystemConfigFile()
  const extensions = system.extensions && typeof system.extensions === "object"
    ? system.extensions as Record<string, unknown>
    : {}
  const allowlist = Array.isArray(extensions.workspaceAllowlist)
    ? extensions.workspaceAllowlist.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : []
  return {
    enabled: extensions.loadWorkspaceExtensions === true,
    allowlist,
  }
}

function isWorkspaceExtensionEnabled(name: string): boolean {
  const config = getWorkspaceDiscoveryConfig()
  if (!config.enabled) return false
  return config.allowlist.length === 0 || config.allowlist.includes(name)
}

function readEmbeddedNameSet(embeddedRootDir: string): Set<string> {
  const embeddedNames = new Set<string>()
  const embeddedConfigPath = path.join(embeddedRootDir, "embedded.json")
  if (!fs.existsSync(embeddedConfigPath)) return embeddedNames
  try {
    const raw = JSON.parse(fs.readFileSync(embeddedConfigPath, "utf-8")) as { extensions?: Array<{ name?: string }> }
    for (const item of raw.extensions ?? []) {
      const name = normalizeText(item?.name)
      if (name) embeddedNames.add(name)
    }
  } catch { /* ignore */ }
  return embeddedNames
}

function listWorkspaceExtensionNames(embeddedRootDir: string): string[] {
  const embeddedNames = readEmbeddedNameSet(embeddedRootDir)
  if (!fs.existsSync(embeddedRootDir) || !fs.statSync(embeddedRootDir).isDirectory()) return []
  return fs.readdirSync(embeddedRootDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(embeddedRootDir, entry.name))
    .map((rootDir) => readManifestFromDir(rootDir)?.name)
    .filter((name): name is string => !!name && !embeddedNames.has(name))
}

function setWorkspaceExtensionEnabled(rootDir: string, name: string, enabled: boolean): void {
  const system = readSystemConfigFile()
  const current = getWorkspaceDiscoveryConfig()
  const workspaceNames = listWorkspaceExtensionNames(path.dirname(rootDir))
  const currentlyAllWorkspace = current.enabled && current.allowlist.length === 0
  const nextAllowlist = enabled
    ? (currentlyAllWorkspace ? [] : Array.from(new Set([...current.allowlist, name])))
    : (currentlyAllWorkspace ? workspaceNames.filter((item) => item !== name) : current.allowlist.filter((item) => item !== name))
  const nextEnabled = enabled || nextAllowlist.length > 0
  const extensions = system.extensions && typeof system.extensions === "object" ? { ...(system.extensions as Record<string, unknown>) } : {}
  system.extensions = { ...extensions, loadWorkspaceExtensions: nextEnabled, workspaceAllowlist: nextEnabled ? nextAllowlist : [] }
  writeSystemConfigFile(system)
}

function resolveInstalledState(
  manifest: ExtensionManifestLike,
  rootDir: string,
): { enabled: boolean; stateLabel: string; statusDetail: string } {
  const disabled = hasDisabledMarker(rootDir)
  if (disabled) {
    return {
      enabled: false,
      stateLabel: "已关闭",
      statusDetail: "检测到本地禁用标记。运行时将跳过该 extension。",
    }
  }

  const hasPlugin = hasPluginContribution(manifest)
  const hasPlatforms = hasPlatformContribution(manifest)
  const platformCount = getPlatformCount(manifest)

  if (hasPlugin) {
    const pluginEnabled = getPluginEnabledState(manifest.name!)
    // 自动发现机制下，未在 plugins.yaml 中声明（undefined）视为默认启用；仅显式 false 才关闭
    if (hasPlatforms && pluginEnabled === false) {
      return {
        enabled: false,
        stateLabel: "平台已启用，插件已关闭",
        statusDetail: "平台贡献仍可被注册，插件入口已在 plugins.yaml 中显式关闭。",
      }
    }

    if (!hasPlatforms && pluginEnabled === false) {
      return {
        enabled: false,
        stateLabel: "未启用",
        statusDetail: "该 extension 只包含插件入口，尚未启用。",
      }
    }
  }

  if (hasPlugin && hasPlatforms) {
    return {
      enabled: true,
      stateLabel: "已开启",
      statusDetail: `插件入口和 ${platformCount} 个平台贡献都会参与运行。`,
    }
  }

  if (hasPlugin) {
    return {
      enabled: true,
      stateLabel: "已开启",
      statusDetail: "插件入口已启用。",
    }
  }

  if (hasPlatforms) {
    return {
      enabled: true,
      stateLabel: "已开启",
      statusDetail: `该 extension 只包含 ${platformCount} 个平台贡献，运行时会自动注册。`,
    }
  }

  return {
    enabled: true,
    stateLabel: "已开启",
    statusDetail: "该 extension 未声明插件或平台贡献，但已存在于本地目录中。",
  }
}

// ==================== Summary 构建 ====================

function buildSummary(
  requestedPath: string,
  manifest: ExtensionManifestLike,
  options?: {
    rootDir?: string
    installed?: boolean
    enabled?: boolean
    stateLabel?: string
    statusDetail?: string
    localSource?: ExtensionLocalSource
    installSource?: "remote" | "local" | "git" | "embedded" | "workspace"
    gitUrl?: string
    gitRef?: string
    gitCommit?: string
    gitSubdir?: string
    localSourceLabel?: string
    localVersion?: string
    localVersionHint?: string
    distributionMode?: "bundled" | "source"
    distributionLabel?: string
    distributionDetail?: string
    runnableEntries?: string[]
  },
): ExtensionSummary {
  return {


    requestedPath,
    name: manifest.name!,
    version: manifest.version!,
    description: normalizeText(manifest.description) ?? "无描述",
    typeLabel: buildTypeLabel(manifest),
    typeDetail: buildTypeDetail(manifest),
    distributionMode: options?.distributionMode ?? "source",
    distributionLabel: options?.distributionLabel ?? "源码包",
    distributionDetail: options?.distributionDetail ?? "当前包未经过可运行发行校验。",
    runnableEntries: options?.runnableEntries ?? [],
    hasPlugin: hasPluginContribution(manifest),
    hasPlatforms: hasPlatformContribution(manifest),
    platformCount: getPlatformCount(manifest),
    installed: options?.installed === true,
    enabled: options?.enabled === true,
    stateLabel: options?.stateLabel ?? "未安装",
    statusDetail: options?.statusDetail ?? "当前本地未发现同名 extension。",
    rootDir: options?.rootDir,
    localSource: options?.localSource,
    installSource: options?.installSource,
    gitUrl: options?.gitUrl,
    gitRef: options?.gitRef,
    gitCommit: options?.gitCommit,
    gitSubdir: options?.gitSubdir,
    localSourceLabel: options?.localSourceLabel,
    localVersion: options?.localVersion,
    localVersionHint: options?.localVersionHint,
  }
}

/** 把 SDK installer 的 InstalledExtensionResult 转换成 terminal TUI 使用的 ExtensionSummary。 */
function summaryFromInstalledResult(result: InstalledExtensionResult, scope: InstallScope): ExtensionSummary {
  const manifest = readManifestFromDir(result.targetDir)
  if (!manifest) {
    throw new Error(`安装结果目录缺少 manifest.json: ${result.targetDir}`)
  }
  const distribution = analyzeDistribution(collectRelativeFilesFromDir(result.targetDir), manifest)
  const state = resolveInstalledState(manifest, result.targetDir)
  const localSource: ExtensionLocalSource = scope.kind === "agent" ? "agent-installed" : "installed"
  const localSourceLabel = scope.kind === "agent" ? "Agent 安装" : "已安装"
  return buildSummary(result.requested, manifest, {
    rootDir: result.targetDir,
    installed: true,
    enabled: state.enabled,
    stateLabel: state.stateLabel,
    statusDetail: state.statusDetail,
    localSource,
    localSourceLabel,
    installSource: result.source,
    gitUrl: result.gitUrl,
    gitRef: result.gitRef,
    gitCommit: result.gitCommit,
    gitSubdir: result.gitSubdir,
    localVersion: manifest.version!,
    localVersionHint: `本地已有版本 ${manifest.version!}（${localSourceLabel}，运行时优先于源码内嵌）`,
    distributionMode: distribution.distributionMode,
    distributionLabel: distribution.distributionLabel,
    distributionDetail: distribution.distributionDetail,
    runnableEntries: distribution.runnableEntries,
    agentName: scope.kind === "agent" ? scope.agentName : undefined,
  })
}


// ==================== 公开 API ====================

/**
 * 加载所有已发现的 extension。
 *
 * 顺序（同名取优先级最高的，后续重名跳过）：
 *   1. agent-installed（仅当 opts.agentExtensionsDir 提供）
 *   2. installed       (~/.iris/extensions/)
 *   3. embedded + workspace（来自 installDir/extensions/，按 embedded.json 二分类）
 *
 * @param installDir   发行包根目录（用于扫描 embedded/workspace）；不传则跳过该层
 * @param opts.agentExtensionsDir 当前 agent 的扩展目录（用于扫描 agent-installed）
 * @param opts.agentName          agent 名（用于在 ExtensionSummary 中记录归属）
 */
export function loadInstalledExtensions(opts?: {
  installDir?: string
  agentExtensionsDir?: string
  agentName?: string
}): ExtensionSummary[] {
  const seen = new Set<string>()
  const results: ExtensionSummary[] = []

  // 1) agent-installed
  if (opts?.agentExtensionsDir) {
    for (const item of scanInstalledDir(opts.agentExtensionsDir, "agent-installed", { kind: "agent", agentName: opts.agentName ?? "" })) {
      if (seen.has(item.name)) continue
      seen.add(item.name)
      results.push({ ...item, agentName: opts.agentName })
    }
  }

  // 2) installed (global)
  for (const item of scanInstalledDir(getInstalledExtensionsDir(), "installed", { kind: "global" })) {
    if (seen.has(item.name)) continue
    seen.add(item.name)
    results.push(item)
  }

  // 3) embedded + workspace（来自 installDir/extensions/）
  if (opts?.installDir) {
    for (const item of loadEmbeddedAndWorkspaceExtensions(opts.installDir)) {
      if (seen.has(item.name)) continue
      seen.add(item.name)
      results.push(item)
    }
  }

  return results.sort((a, b) => a.name.localeCompare(b.name))
}

/** 扫描指定目录下的扩展（installed 或 agent-installed）。 */
function scanInstalledDir(installedRootDir: string, source: "installed" | "agent-installed", scope: InstallScope): ExtensionSummary[] {
  if (!fs.existsSync(installedRootDir) || !fs.statSync(installedRootDir).isDirectory()) {
    return []
  }

  const results: ExtensionSummary[] = []
  for (const entry of fs.readdirSync(installedRootDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue

    const rootDir = path.join(installedRootDir, entry.name)
    const manifest = readManifestFromDir(rootDir)
    if (!manifest) continue
    const distribution = analyzeDistribution(collectRelativeFilesFromDir(rootDir), manifest)

    const installMetadata = readGitInstallMetadata(rootDir)
    const state = resolveInstalledState(manifest, rootDir)
    const sourceLabel = source === "agent-installed" ? "Agent 安装" : "已安装"
    results.push(buildSummary(manifest.name!, manifest, {
      rootDir,
      installed: true,
      enabled: state.enabled,
      stateLabel: state.stateLabel,
      statusDetail: state.statusDetail,
      localSource: source,
      localSourceLabel: sourceLabel,
      installSource: installMetadata?.source,
      gitUrl: installMetadata?.url,
      gitRef: installMetadata?.ref,
      gitCommit: installMetadata?.commit,
      gitSubdir: installMetadata?.subdir,
      localVersion: manifest.version!,
      distributionMode: distribution.distributionMode,
      distributionLabel: distribution.distributionLabel,
      distributionDetail: distribution.distributionDetail,
      runnableEntries: distribution.runnableEntries,
    }))
  }

  return results
}

/**
 * 扫描 installDir/extensions/ 下所有扩展，按 embedded.json 二分类：
 *   - 名字在 embedded.json 里 → source='embedded'
 *   - 否则                      → source='workspace'
 */
function loadEmbeddedAndWorkspaceExtensions(installDir: string): ExtensionSummary[] {
  const embeddedRootDir = getEmbeddedExtensionsDir(installDir)
  if (!fs.existsSync(embeddedRootDir) || !fs.statSync(embeddedRootDir).isDirectory()) return []

  const embeddedNames = readEmbeddedNameSet(embeddedRootDir)

  const results: ExtensionSummary[] = []
  for (const dirent of fs.readdirSync(embeddedRootDir, { withFileTypes: true })) {
    if (!dirent.isDirectory()) continue
    const rootDir = path.join(embeddedRootDir, dirent.name)
    const manifest = readManifestFromDir(rootDir)
    if (!manifest) continue
    const distribution = analyzeDistribution(collectRelativeFilesFromDir(rootDir), manifest)

    const isEmbedded = embeddedNames.has(manifest.name!)
    const source: ExtensionLocalSource = isEmbedded ? "embedded" : "workspace"
    const sourceLabel = isEmbedded ? "源码内嵌" : "源码 workspace"
    const workspaceEnabled = !isEmbedded && isWorkspaceExtensionEnabled(manifest.name!)
    const stateLabel = isEmbedded ? "源码内嵌" : (workspaceEnabled ? "已开启" : "可选（未开启）")
    const statusDetail = isEmbedded
      ? "当前安装目录已内嵌该 extension。若用户目录安装同名版本，运行时将优先加载用户目录版本。"
      : "源码仓库中的可选扩展，可在 TUI 中开启/关闭，无需手动编辑 system.yaml。"

    results.push(buildSummary(manifest.name!, manifest, {
      rootDir,
      installed: false,
      enabled: isEmbedded ? getPluginEnabledState(manifest.name!) !== false && !hasDisabledMarker(rootDir) : workspaceEnabled,
      stateLabel,
      statusDetail,
      localSource: source,
      localSourceLabel: sourceLabel,
      installSource: isEmbedded ? "embedded" : "workspace",
      localVersion: manifest.version!,
      distributionMode: distribution.distributionMode,
      distributionLabel: distribution.distributionLabel,
      distributionDetail: distribution.distributionDetail,
      runnableEntries: distribution.runnableEntries,
    }))
  }

  return results.sort((a, b) => a.name.localeCompare(b.name))
}

function buildLocalVersionHint(summary: ExtensionSummary): string {
  if (summary.localSource === "installed") {
    return `本地已有版本 ${summary.version}（已安装，运行时优先于源码内嵌）`
  }

  if (summary.localSource === "embedded") {
    return `本地已有版本 ${summary.version}（源码内嵌）`
  }

  return `本地已有版本 ${summary.version}`
}

export async function listRemoteExtensions(installDir: string, opts?: {
  agentExtensionsDir?: string
  agentName?: string
}): Promise<ExtensionSummary[]> {
  const remoteIndex = await fetchRemoteIndex()
  const remoteEntries = (await Promise.allSettled(
    remoteIndex.map(async (requestedPath) => {
      const manifest = await fetchRemoteManifest(requestedPath)
      return {
        requestedPath,
        manifest,
        files: getRemoteDistributionFiles(manifest),
      }
    }),
  ))
    .filter((item): item is PromiseFulfilledResult<{ requestedPath: string; manifest: ExtensionManifestLike; files: string[] }> => {
      return item.status === "fulfilled"
    })
    .map((item) => item.value)
  if (remoteIndex.length > 0 && remoteEntries.length === 0) {
    throw new Error("远程 extension manifest 全部读取失败")
  }
  // 收集本地已发现的同名扩展（用于"本地兼容"提示），含 4 类源
  const localMap = new Map(
    loadInstalledExtensions({ installDir, agentExtensionsDir: opts?.agentExtensionsDir, agentName: opts?.agentName })
      .map((item) => [item.name, item])
  )
  const results: ExtensionSummary[] = []
  const seenRequestedPaths = new Set<string>()

  for (const entry of remoteEntries) {
    const requestedPath = entry.requestedPath
    if (seenRequestedPaths.has(requestedPath)) continue

    try {
      const distribution = analyzeDistribution(entry.files, entry.manifest)
      const local = localMap.get(entry.manifest.name!)

      results.push(buildSummary(requestedPath, entry.manifest, local ? {
        installed: local.installed,
        enabled: local.enabled,
        stateLabel: local.stateLabel,
        statusDetail: local.statusDetail,
        localSource: local.localSource,
        localSourceLabel: local.localSourceLabel,
        localVersion: local.version,
        localVersionHint: buildLocalVersionHint(local),
        distributionMode: distribution.distributionMode,
        distributionLabel: distribution.distributionLabel,
        distributionDetail: distribution.distributionDetail,
        runnableEntries: distribution.runnableEntries,
      } : {
        distributionMode: distribution.distributionMode,
        distributionLabel: distribution.distributionLabel,
        distributionDetail: distribution.distributionDetail,
        runnableEntries: distribution.runnableEntries,
      }))
      seenRequestedPaths.add(requestedPath)
    } catch {
      continue
    }
  }

  return results.sort((a, b) => a.requestedPath.localeCompare(b.requestedPath))
}

export async function installRemoteExtension(
  requestedPath: string,
  scope: InstallScope = { kind: "global" },
): Promise<ExtensionSummary> {
  const result = await sdkInstallExtension(requestedPath, {
    installedExtensionsDir: resolveInstallDirForScope(scope),
  })
  const summary = summaryFromInstalledResult(result, scope)
  if (summary.hasPlugin) {
    upsertLocalPluginEnabled(summary.name, false, scope)
  }
  return summary
}

type GitExtensionTargetInput = string | GitExtensionInstallInput

function resolveGitRuntimeTarget(input: GitExtensionTargetInput): GitExtensionTarget {
  if (typeof input === "string") {
    return resolveGitExtensionTarget(input)
  }
  return resolveGitExtensionTarget(input.url, {
    ref: input.ref,
    subdir: input.subdir,
  })
}



/** 从本地 extensions/ 目录安装扩展（发行包必须已包含可运行入口）。 */
export async function installLocalExtension(
  requestedName: string,
  scope: InstallScope = { kind: "global" },
): Promise<ExtensionSummary> {
  const result = await sdkInstallLocalExtension(requestedName, {
    installedExtensionsDir: resolveInstallDirForScope(scope),
  })
  const summary = summaryFromInstalledResult(result, scope)
  if (summary.hasPlugin) {
    upsertLocalPluginEnabled(summary.name, false, scope)
  }
  return summary
}

function buildGitExtensionSummary(
  target: GitExtensionTarget,
  manifest: ExtensionManifestLike,
  distribution: DistributionAnalysis,
  commit: string | undefined,
  rootDir?: string,
  scope: InstallScope = { kind: "global" },
): ExtensionSummary {
  const installed = loadInstalledExtensions(
    scope.kind === "agent" ? { agentExtensionsDir: resolveInstallDirForScope(scope), agentName: scope.agentName } : undefined,
  ).find((item) => item.name === manifest.name)
  const stateLabel = installed
    ? `将覆盖已安装版本 ${installed.version}`
    : "Git 待安装"
  const installLocation = scope.kind === "agent"
    ? `~/.iris/agents/${scope.agentName}/extensions/${manifest.name}/`
    : `~/.iris/extensions/${manifest.name}/`
  const statusDetail = installed
    ? `本地已安装 ${installed.version}。确认安装后会覆盖 ${installLocation}。`
    : `当前 Git 仓库中的 extension 尚未安装到用户目录（目标：${installLocation}）。`

  return buildSummary(formatGitExtensionTarget(target), manifest, {
    rootDir,
    installed: false,
    enabled: false,
    stateLabel,
    statusDetail,
    installSource: "git",
    gitUrl: target.url,
    gitRef: target.ref,
    gitCommit: commit,
    gitSubdir: target.subdir,
    distributionMode: distribution.distributionMode,
    distributionLabel: distribution.distributionLabel,
    distributionDetail: distribution.distributionDetail,
    runnableEntries: distribution.runnableEntries,
  })
}

export async function inspectGitExtension(
  input: GitExtensionTargetInput,
  options: GitExtensionRuntimeOptions = {},
  scope: InstallScope = { kind: "global" },
): Promise<GitExtensionPreview> {
  const target = resolveGitRuntimeTarget(input)
  const installedRootDir = resolveInstallDirForScope(scope)
  ensureDirectory(installedRootDir)
  const tempRootDir = createTempInstallDir(installedRootDir)
  const cloneDir = path.join(tempRootDir, "repo")

  try {
    const cloned = await cloneGitRepository(target, cloneDir, { commandRunner: options.commandRunner })
    const sourceDir = target.subdir ? resolveSafeRelativePath(cloneDir, target.subdir) : cloneDir
    const manifest = readManifestFromDir(sourceDir)
    if (!manifest) {
      throw new Error(`Git extension 缺少有效 manifest.json: ${sourceDir}`)
    }
    const distribution = analyzeDistribution(collectRelativeFilesFromDir(sourceDir), manifest)
    return {
      summary: buildGitExtensionSummary(target, manifest, distribution, cloned.commit, undefined, scope),
      target,
      commit: cloned.commit,
    }
  } finally {
    cleanupTempInstallDir(tempRootDir)
  }
}


export async function installGitExtension(
  input: GitExtensionTargetInput,
  options: GitExtensionRuntimeOptions = {},
  scope: InstallScope = { kind: "global" },
): Promise<ExtensionSummary> {
  const target = resolveGitRuntimeTarget(input)
  const result = await sdkInstallGitExtension(target.url, {
    ref: target.ref,
    subdir: target.subdir,
    commandRunner: options.commandRunner,
    installedExtensionsDir: resolveInstallDirForScope(scope),
  })
  const summary = summaryFromInstalledResult(result, scope)
  if (summary.hasPlugin) {
    upsertLocalPluginEnabled(summary.name, false, scope)
  }
  return summary
}

export async function inspectGitExtensionUpdate(
  summary: ExtensionSummary,
  options: GitExtensionRuntimeOptions = {},
): Promise<GitExtensionUpdatePreview> {

  const scope = scopeFromSummary(summary)
  const preview = await sdkInspectGitExtensionUpdate(summary.name, {
    installedExtensionsDir: resolveInstallDirForScope(scope),
    commandRunner: options.commandRunner,
  })
  const target = resolveGitExtensionTarget(preview.gitUrl, {
    ref: preview.gitRef,
    subdir: preview.gitSubdir,
  })
  const previewSummary = buildSummary(formatGitExtensionTarget(target), {
    name: preview.name,
    version: preview.nextVersion,
  }, {
    installed: true,
    enabled: summary.enabled,
    stateLabel: preview.sameCommit ? "当前已是记录的 Git commit" : `准备升级到 ${preview.nextVersion}`,
    statusDetail: `当前 commit: ${preview.currentCommit ?? "未知"}；远程 commit: ${preview.nextCommit ?? "未知"}。`,
    installSource: "git",
    gitUrl: target.url,
    gitRef: target.ref,
    gitCommit: preview.nextCommit,
    gitSubdir: target.subdir,
    localVersion: summary.version,
    distributionMode: preview.distributionMode,
    distributionLabel: preview.distributionMode === "bundled" ? "可直接安装" : "源码包",
    distributionDetail: preview.distributionMode === "bundled" ? "远程 Git 包已通过可运行入口校验。" : "远程 Git 包不是可直接安装的发行包。",
    runnableEntries: preview.runnableEntries,
  })
  return {
    summary: previewSummary,
    target,
    commit: preview.nextCommit,
    current: summary,
    previousCommit: preview.currentCommit,
    sameCommit: preview.sameCommit,
  }
}

export async function updateGitInstalledExtension(
  summary: ExtensionSummary,
  options: GitExtensionRuntimeOptions = {},
): Promise<ExtensionSummary> {
  const scope = scopeFromSummary(summary)
  const rootDir = summary.rootDir || path.join(resolveInstallDirForScope(scope), summary.name)
  const preserveDisabledMarker = fs.existsSync(path.join(rootDir, DISABLED_MARKER_FILE))
  const wasEnabled = summary.enabled

  const result = await sdkUpdateGitExtension(summary.name, {
    installedExtensionsDir: resolveInstallDirForScope(scope),
    commandRunner: options.commandRunner,
  })
  const updated = summaryFromInstalledResult(result, scope)

  if (preserveDisabledMarker) {
    disableInstalledExtension(updated)
  } else if (wasEnabled) {
    await enableInstalledExtensionWithDependencies(updated)
  }

  // 同 scope 重新加载
  const reloaded = scope.kind === "agent"
    ? loadInstalledExtensions({ agentExtensionsDir: resolveInstallDirForScope(scope), agentName: scope.agentName })
    : loadInstalledExtensions()
  return reloaded.find((item) => item.name === summary.name) ?? updated
}

export function enableInstalledExtension(summary: ExtensionSummary): void {
  const scope = scopeFromSummary(summary)
  const rootDir = summary.rootDir || path.join(resolveInstallDirForScope(scope), summary.name)
  if (!fs.existsSync(rootDir)) {
    throw new Error(`extension 不存在: ${summary.name}`)
  }

  if (summary.localSource === "workspace") {
    setWorkspaceExtensionEnabled(rootDir, summary.name, true)
  }

  setDisabledMarker(rootDir, false)
  if (summary.hasPlugin) {
    upsertLocalPluginEnabled(summary.name, true, scope)
  }
}

export function getExtensionRuntimeDependencyStatus(summary: ExtensionSummary): EnsureExtensionRuntimeDependenciesResult {
  const scope = scopeFromSummary(summary)
  const rootDir = summary.rootDir || path.join(resolveInstallDirForScope(scope), summary.name)
  if (!fs.existsSync(rootDir)) {
    throw new Error(`extension 不存在: ${summary.name}`)
  }
  return getMissingExtensionRuntimeDependencies(rootDir)
}

export async function enableInstalledExtensionWithDependencies(summary: ExtensionSummary): Promise<void> {
  const scope = scopeFromSummary(summary)
  const rootDir = summary.rootDir || path.join(resolveInstallDirForScope(scope), summary.name)
  if (!fs.existsSync(rootDir)) {
    throw new Error(`extension 不存在: ${summary.name}`)
  }
  await ensureExtensionRuntimeDependencies(rootDir)
  enableInstalledExtension(summary)
}

export function disableInstalledExtension(summary: ExtensionSummary): void {
  const scope = scopeFromSummary(summary)
  const rootDir = summary.rootDir || path.join(resolveInstallDirForScope(scope), summary.name)
  if (!fs.existsSync(rootDir)) {
    throw new Error(`extension 不存在: ${summary.name}`)
  }

  if (summary.localSource === "workspace") {
    setWorkspaceExtensionEnabled(rootDir, summary.name, false)
    if (summary.hasPlugin) {
      upsertLocalPluginEnabled(summary.name, false, scope)
    }
    return
  }

  setDisabledMarker(rootDir, true)
  if (summary.hasPlugin) {
    upsertLocalPluginEnabled(summary.name, false, scope)
  }
}

export function deleteInstalledExtension(summary: ExtensionSummary): void {
  const scope = scopeFromSummary(summary)
  const rootDir = summary.rootDir || path.join(resolveInstallDirForScope(scope), summary.name)
  if (!fs.existsSync(rootDir)) {
    throw new Error(`extension 不存在: ${summary.name}`)
  }

  fs.rmSync(rootDir, { recursive: true, force: true })
  if (summary.hasPlugin) {
    removeLocalPluginEntry(summary.name, scope)
  }
}
