#!/usr/bin/env bun

/**
 * Iris 全平台编译脚本
 *
 * 使用 bun build --compile 为每个目标平台生成独立可执行文件。
 * 产物内嵌 Bun 运行时、依赖、Web UI 静态资源和 onboard 配置引导工具。
 *
 * 产物结构：
 *   dist/bin/iris-{platform}-{arch}/
 *     bin/iris(.exe)            编译后的主程序二进制
 *     bin/iris-onboard(.exe)    交互式配置引导工具
 *     data/                     配置模板和示例文件
 *     extensions/               按 extensions/embedded.json 白名单内嵌的 extension
 *     web-ui/dist/              Web 平台静态资源
 *     package.json              平台包描述（npm 包名使用 irises-{platform}-{arch}）
 *
 * 用法：
 *   bun run script/build.ts            # 编译所有平台
 *   bun run script/build.ts --single   # 仅编译当前平台
 */

import { $ } from "bun"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import {
  findDisallowedBareRuntimeImports,
  formatDisallowedBareRuntimeImports,
} from "./extension-bundle-validation"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, "..")
process.chdir(rootDir)

const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8"))
const version: string = pkg.version
// 修正：Web UI 已从 src/platforms/web/ 重构到 extensions/web/，路径同步更新
const webUiDistDir = path.join(rootDir, "extensions", "web", "web-ui", "dist")
const opentuiCoreDir = path.join(rootDir, "node_modules", "@opentui", "core")
const opentuiRuntimeStagingDir = path.join(rootDir, "dist", ".opentui-runtime")
const embeddedExtensionsConfigPath = path.join(rootDir, "extensions", "embedded.json")

if (!fs.existsSync(webUiDistDir)) {
  console.error("未找到 Web UI 构建产物，请先运行 npm run build:ui")
  process.exit(1)
}

interface Target {
  os: string
  arch: "x64" | "arm64"
}

type BundledModuleTarget = "node" | "bun"
type BundledModuleFormat = "esm" | "cjs"

interface EmbeddedExtensionBuildConfigItem {
  name: string
  sourceDir?: string
  external?: string[]
  entrypoint?: string
  outfile?: string
  target?: BundledModuleTarget
  format?: BundledModuleFormat
}

interface EmbeddedExtensionBuildTarget {
  name: string
  sourceDir: string
  external: string[]
  entrypoint: string
  outfile: string
  target: BundledModuleTarget
  format: BundledModuleFormat
}

const allTargets: Target[] = [
  { os: "linux", arch: "x64" },
  { os: "linux", arch: "arm64" },
  { os: "darwin", arch: "arm64" },
  { os: "darwin", arch: "x64" },
  { os: "win32", arch: "x64" },
]

const singleFlag = process.argv.includes("--single")
const targetArgIndex = process.argv.indexOf("--target")
const targetArgValue = targetArgIndex >= 0 ? process.argv[targetArgIndex + 1] : null

let targets: Target[]
if (targetArgValue) {
  // --target darwin-x64 形式，指定单个平台交叉编译
  const [os, arch] = targetArgValue.split("-")
  const osName = os === "windows" ? "win32" : os
  targets = allTargets.filter((t) => t.os === osName && t.arch === arch)
} else if (singleFlag) {
  targets = allTargets.filter((target) => target.os === process.platform && target.arch === process.arch)
} else {
  targets = allTargets
}

if (targets.length === 0) {
  console.error(`当前平台 ${process.platform}-${process.arch} 不在支持的目标列表中`)
  process.exit(1)
}

const distBinDir = path.join(rootDir, "dist", "bin")
if (fs.existsSync(distBinDir)) {
  try {
    fs.rmSync(distBinDir, { recursive: true, force: true })
  } catch (err: any) {
    console.warn(`警告: 无法清理旧产物目录 (${err.code || err.message})，将覆盖写入`)
  }
}

const opentuiVersion = pkg.optionalDependencies?.["@opentui/core"] ?? "latest"
await $`bun install --os="*" --cpu="*" @opentui/core@${opentuiVersion}`

// bun install 对 file: 依赖仅拷贝部分子目录，丢失 package.json、dist 根级 .js 等关键文件。
// 修补：检测到残缺时用 cpSync 完整覆盖 node_modules 中的 irises-extension-sdk。
function patchExtensionSdkInNodeModules(nodeModulesDir: string): void {
  const sdkSource = path.join(rootDir, "packages", "extension-sdk")
  const sdkInstalled = path.join(nodeModulesDir, "irises-extension-sdk")
  // 无条件覆盖：bun 的 .l2s 链接缓存可能基于残缺副本，仅检查单个文件不够可靠
  if (fs.existsSync(sdkInstalled)) {
    fs.rmSync(sdkInstalled, { recursive: true, force: true })
    fs.cpSync(sdkSource, sdkInstalled, { recursive: true, dereference: true })
    console.log(`✓ patched irises-extension-sdk in ${path.relative(rootDir, nodeModulesDir)}`)
  }
}

{
  // 先编译 extension-sdk：CI 上 dist/ 被 .gitignore 忽略，需要在 patch 前生成编译产物
  const sdkDir = path.join(rootDir, "packages", "extension-sdk")
  if (!fs.existsSync(path.join(sdkDir, "dist", "index.js"))) {
    console.log("⚙ building irises-extension-sdk ...")
    const result = Bun.spawnSync(["npm", "run", "build"], { cwd: sdkDir, stdio: ["inherit", "inherit", "inherit"] })
    if (result.exitCode !== 0) throw new Error("irises-extension-sdk build failed")
    console.log("✓ irises-extension-sdk built")
  }
  patchExtensionSdkInNodeModules(path.join(rootDir, "node_modules"))
}

await prepareOpenTuiRuntime(opentuiRuntimeStagingDir)
console.log("✓ OpenTUI tree-sitter runtime prepared")

function getPlatformName(osName: string): string {
  return osName === "win32" ? "windows" : osName
}

function formatBuildLogs(result: Awaited<ReturnType<typeof Bun.build>>): string {
  return result.logs.map((entry) => entry.message).filter(Boolean).join("\n")
}

function patchBundledWorkerWasmPath(workerPath: string): void {
  const original = fs.readFileSync(workerPath, "utf8")
  const patched = original.replace(
    /module2\.exports = "\.\/([^"]+\.wasm)";/,
    'module2.exports = new URL("./$1", import.meta.url).href;',
  )

  if (patched === original) {
    throw new Error(`无法修补 OpenTUI worker 中的 wasm 路径: ${workerPath}`)
  }

  fs.writeFileSync(workerPath, patched)
}

async function prepareOpenTuiRuntime(stagingDir: string): Promise<void> {
  const workerEntry = path.join(opentuiCoreDir, "parser.worker.js")
  const assetsDir = path.join(opentuiCoreDir, "assets")

  if (!fs.existsSync(workerEntry)) {
    throw new Error(`未找到 OpenTUI parser.worker.js: ${workerEntry}`)
  }
  if (!fs.existsSync(assetsDir)) {
    throw new Error(`未找到 OpenTUI tree-sitter 资源目录: ${assetsDir}`)
  }

  fs.rmSync(stagingDir, { recursive: true, force: true })
  fs.mkdirSync(stagingDir, { recursive: true })

  const result = await Bun.build({
    entrypoints: [workerEntry],
    outdir: stagingDir,
    target: "bun",
  })

  if (!result.success) {
    const logs = formatBuildLogs(result)
    throw new Error(logs || "OpenTUI tree-sitter worker 构建失败")
  }

  const workerOutputPath = path.join(stagingDir, "parser.worker.js")
  if (!fs.existsSync(workerOutputPath)) {
    throw new Error(`OpenTUI worker 构建后未生成 parser.worker.js: ${workerOutputPath}`)
  }

  patchBundledWorkerWasmPath(workerOutputPath)
  fs.cpSync(assetsDir, path.join(stagingDir, "assets"), { recursive: true })
}

async function buildCompiledBinary(options: {
  entrypoint: string
  outfile: string
  target: string
  define?: Record<string, string>
  external?: string[]
  minify?: boolean
}): Promise<void> {
  const result = await Bun.build({
    entrypoints: [options.entrypoint],
    compile: {
      target: options.target as any,
      outfile: options.outfile,
    },
    define: options.define,
    external: options.external,
    minify: options.minify,
  })

  if (!result.success) {
    const logs = formatBuildLogs(result)
    throw new Error(logs || `构建失败: ${options.outfile}`)
  }
}

async function buildBundledModule(options: {
  entrypoint: string
  outfile: string
  target?: "node" | "bun"
  format?: "esm" | "cjs"
  // 需要保持 external 的包列表（由主程序运行时提供的包），其余依赖全部打包进 bundle。
  // 统一使用 outdir 模式，构建后将入口产物重命名到 outfile。
  external?: string[]
}): Promise<void> {
  // 统一使用 outdir 模式：
  // 1. 规避 Bun 1.x `external + outfile` 偶发不写 outfile 的问题；
  // 2. 支持 remote-exec/ssh2 这类依赖在 bundle 时额外产出 .node 原生资产文件。
  // 构建后再把 Bun 默认输出的 index.js 重命名为 manifest 期望的 index.mjs。
  const outDir = path.dirname(options.outfile)
  const targetName = path.basename(options.outfile)
  fs.rmSync(outDir, { recursive: true, force: true })
  fs.mkdirSync(outDir, { recursive: true })

  const result = await Bun.build({
    entrypoints: [options.entrypoint],
    outdir: outDir,
    target: options.target ?? "node",
    format: options.format ?? "esm",
    external: options.external,
    packages: "bundle",
  })
  if (!result.success) {
    const logs = formatBuildLogs(result)
    throw new Error(logs || `构建失败: ${options.outfile}`)
  }

  const outputJs = path.join(outDir, "index.js")
  if (!fs.existsSync(outputJs)) {
    throw new Error(`构建失败: 未生成 ${formatRelativePath(outputJs)}`)
  }
  if (targetName !== "index.js") {
    fs.renameSync(outputJs, path.join(outDir, targetName))
  }
}

function resolvePathFromRoot(filePath: string): string {
  return path.isAbsolute(filePath) ? filePath : path.resolve(rootDir, filePath)
}

function formatRelativePath(filePath: string): string {
  return path.relative(rootDir, filePath).replace(/\\/g, "/")
}

function loadEmbeddedExtensionBuildTargets(): EmbeddedExtensionBuildTarget[] {
  if (!fs.existsSync(embeddedExtensionsConfigPath)) {
    console.log("! 未找到 extensions/embedded.json，跳过 extension 内嵌打包")
    return []
  }

  const raw = JSON.parse(fs.readFileSync(embeddedExtensionsConfigPath, "utf8")) as {
    extensions?: unknown
  }

  if (!Array.isArray(raw.extensions)) {
    throw new Error("extensions/embedded.json 格式无效：缺少 extensions 数组")
  }

  const targets: EmbeddedExtensionBuildTarget[] = []
  const seenNames = new Set<string>()

  for (const [index, item] of raw.extensions.entries()) {
    if (!item || typeof item !== "object") {
      throw new Error(`extensions/embedded.json 第 ${index + 1} 项不是对象`)
    }

    const config = item as EmbeddedExtensionBuildConfigItem
    const name = typeof config.name === "string" ? config.name.trim() : ""
    if (!name) {
      throw new Error(`extensions/embedded.json 第 ${index + 1} 项缺少有效 name`)
    }
    if (seenNames.has(name)) {
      throw new Error(`extensions/embedded.json 存在重复 extension: ${name}`)
    }
    seenNames.add(name)

    const sourceDirInput = typeof config.sourceDir === "string" && config.sourceDir.trim()
      ? config.sourceDir.trim()
      : path.join("extensions", name)
    const entrypointInput = typeof config.entrypoint === "string" && config.entrypoint.trim()
      ? config.entrypoint.trim()
      : path.join(sourceDirInput, "src", "index.ts")
    const outfileInput = typeof config.outfile === "string" && config.outfile.trim()
      ? config.outfile.trim()
      : path.join(sourceDirInput, "dist", "index.mjs")

    const sourceDir = resolvePathFromRoot(sourceDirInput)
    const entrypoint = resolvePathFromRoot(entrypointInput)
    const outfile = resolvePathFromRoot(outfileInput)

    if (!fs.existsSync(sourceDir)) {
      throw new Error(`内嵌 extension 目录不存在: ${formatRelativePath(sourceDir)}`)
    }
    if (!fs.existsSync(entrypoint)) {
      throw new Error(`内嵌 extension 入口不存在: ${formatRelativePath(entrypoint)}`)
    }

    targets.push({
      name,
      sourceDir,
      // 解析 external 数组：配合 packages:"bundle" 使用，
      // 指定哪些包保持 external（由主程序提供），其余全部内联
      external: Array.isArray(config.external) ? config.external.filter((e): e is string => typeof e === "string") : [],
      entrypoint,
      outfile,
      target: config.target === "bun" ? "bun" : "node",
      format: config.format === "cjs" ? "cjs" : "esm",
    })
  }

  return targets
}

function validateBundledModuleRuntimeImports(extension: EmbeddedExtensionBuildTarget): void {
  const content = fs.readFileSync(extension.outfile, "utf8")
  const violations = findDisallowedBareRuntimeImports(content, {
    allowedBarePackages: extension.external,
  })

  if (violations.length === 0) return

  throw new Error(
    `extension "${extension.name}" bundle 中仍包含非 external bare ESM import: `
    + `${formatDisallowedBareRuntimeImports(violations)}。`
    + "Bun compiled binary 动态加载 extension 文件时不能可靠解析这类 node_modules specifier；"
    + "请将依赖打包进 bundle，或在 extensions/embedded.json 的 external 中声明并由目标平台安装。",
  )
}

async function buildEmbeddedExtensions(extensions: EmbeddedExtensionBuildTarget[]): Promise<void> {
  for (const extension of extensions) {
    await buildBundledModule({
      entrypoint: extension.entrypoint,
      outfile: extension.outfile,
      // 传入 external 配置：让指定的包保持 external，其余打包进 bundle
      external: extension.external,
      target: extension.target,
      format: extension.format,
    })
    validateBundledModuleRuntimeImports(extension)
    console.log(`✓ extension bundled: ${extension.name} -> ${formatRelativePath(extension.outfile)}`)
  }
}

interface DistributionPruneStats {
  files: number
  dirs: number
  bytes: number
}

const distributionPruneDirNames = new Set([
  "test",
  "tests",
  "__tests__",
  "coverage",
  "doc",
  "docs",
  "example",
  "examples",
])

const distributionPruneLockfiles = new Set([
  "package-lock.json",
  "npm-shrinkwrap.json",
  "bun.lock",
  "bun.lockb",
  "yarn.lock",
  "pnpm-lock.yaml",
])

const platformNativeExtensions: Record<string, string[]> = {
  win32: [".dll", ".pdb", ".exe"],
  linux: [".so", ".so."],
  darwin: [".dylib"],
}

function isNativeFileForOtherPlatform(fileName: string, target: Target): boolean {
  const lowerName = fileName.toLowerCase()
  for (const [platform, extensions] of Object.entries(platformNativeExtensions)) {
    if (platform === target.os) continue
    if (extensions.some((ext) => lowerName.endsWith(ext) || lowerName.includes(ext))) {
      return true
    }
  }
  return false
}

function isWithinDirectory(candidatePath: string, parentDir: string): boolean {
  const relative = path.relative(parentDir, candidatePath)
  return relative === "" || (!!relative && !relative.startsWith("..") && !path.isAbsolute(relative))
}

function getDirectorySize(dir: string): number {
  let total = 0
  if (!fs.existsSync(dir)) return total
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      total += getDirectorySize(fullPath)
    } else if (entry.isFile()) {
      total += fs.statSync(fullPath).size
    }
  }
  return total
}

function pruneDistributionArtifacts(targetDir: string, target: Target): DistributionPruneStats {
  const stats: DistributionPruneStats = { files: 0, dirs: 0, bytes: 0 }
  const nodeModulesDir = path.join(targetDir, "node_modules")

  function removeFile(filePath: string): void {
    stats.bytes += fs.statSync(filePath).size
    fs.rmSync(filePath, { force: true })
    stats.files++
  }

  function removeDirectory(dirPath: string): void {
    stats.bytes += getDirectorySize(dirPath)
    fs.rmSync(dirPath, { recursive: true, force: true })
    stats.dirs++
  }

  function visit(dir: string): void {
    if (!fs.existsSync(dir)) return
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name)
      const inNodeModules = fs.existsSync(nodeModulesDir) && isWithinDirectory(fullPath, nodeModulesDir)

      if (entry.isDirectory()) {
        if (inNodeModules && distributionPruneDirNames.has(entry.name)) {
          removeDirectory(fullPath)
          continue
        }
        visit(fullPath)
      } else if (entry.isFile()) {
        const isSourceMap = entry.name.endsWith(".map")
        const isDeclarationFile = entry.name.endsWith(".d.ts")
        const isOtherPlatformNative = inNodeModules && isNativeFileForOtherPlatform(entry.name, target)
        if (distributionPruneLockfiles.has(entry.name) || (inNodeModules && (isSourceMap || isDeclarationFile || isOtherPlatformNative))) {
          removeFile(fullPath)
        }
      }
    }
  }

  visit(targetDir)
  return stats
}

function removeInstallLockfiles(targetDir: string): void {
  for (const fileName of distributionPruneLockfiles) {
    const fullPath = path.join(targetDir, fileName)
    if (fs.existsSync(fullPath)) {
      fs.rmSync(fullPath, { force: true })
    }
  }
}

function hasInstallableRuntimeDependencies(targetDir: string): boolean {
  const packageJsonPath = path.join(targetDir, "package.json")
  if (!fs.existsSync(packageJsonPath)) return false
  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as {
    dependencies?: Record<string, string>
    optionalDependencies?: Record<string, string>
  }
  return [pkg.dependencies, pkg.optionalDependencies].some((deps) => !!deps && Object.keys(deps).length > 0)
}

function installExternalDependenciesForTarget(targetDir: string, target: Target, extension: EmbeddedExtensionBuildTarget): void {
  if (!hasInstallableRuntimeDependencies(targetDir)) return

  removeInstallLockfiles(targetDir)
  fs.rmSync(path.join(targetDir, "node_modules"), { recursive: true, force: true })

  console.log(`  ⚙ installing external deps for ${extension.name} (${target.os}-${target.arch})`)
  const installResult = Bun.spawnSync(
    ["npm", "install", "--omit=dev", "--no-audit", "--no-fund", "--package-lock=false", `--os=${target.os}`, `--cpu=${target.arch}`],
    {
      cwd: targetDir,
      stdio: ["ignore", "pipe", "pipe"],
    },
  )
  if (installResult.exitCode !== 0) {
    const stderr = new TextDecoder().decode(installResult.stderr).trim()
    throw new Error(`安装 ${extension.name} 的目标平台依赖失败 (${target.os}-${target.arch})${stderr ? `: ${stderr}` : ''}`)
  }
}

function copyEmbeddedExtensions(extensions: EmbeddedExtensionBuildTarget[], targetRootDir: string, target: Target): void {
  if (extensions.length === 0) return
  fs.mkdirSync(targetRootDir, { recursive: true })

  // 运行时通过 extensions/embedded.json 判断发行包内置扩展。
  // 如果这里只复制各扩展目录、不复制 embedded.json，构建后的二进制会把这些目录误判为
  // workspace 扩展；默认 loadWorkspaceExtensions=false 时，console/web 等平台就不会被注册。
  if (fs.existsSync(embeddedExtensionsConfigPath)) {
    fs.copyFileSync(embeddedExtensionsConfigPath, path.join(targetRootDir, "embedded.json"))
    console.log("  ✓ extensions/embedded.json copied")
  }

  for (const extension of extensions) {
    const targetDir = path.join(targetRootDir, extension.name)
    fs.rmSync(targetDir, { recursive: true, force: true })
    fs.cpSync(extension.sourceDir, targetDir, {
      recursive: true,
      dereference: true,
      filter: (src) => {
        const relativePath = path.relative(extension.sourceDir, src).replace(/\\/g, "/")
        const isTopLevelSrc = relativePath === "src" || relativePath.startsWith("src/")
        const isTopLevelWebUi = relativePath === "web-ui" || relativePath.startsWith("web-ui/")
        const isTopLevelNodeModules = relativePath === "node_modules" || relativePath.startsWith("node_modules/")
        // 不直接复制源码目录里的 node_modules：
        // - 同平台跨架构构建（如 macOS arm64 -> darwin-x64）会把宿主机原生包错误带入目标产物
        // - 目标产物的 external 依赖改为按 target.os/target.arch 重新安装，确保拿到正确的 optional native packages
        if (isTopLevelSrc || isTopLevelWebUi) return false
        if (isTopLevelNodeModules) return false
        return true
      },
    })
    // 目标目录中的依赖声明需要按 external 裁剪；随后针对目标平台/架构重新安装。
    // 这样可避免 cross-compile 时把宿主机架构（例如 darwin-arm64）的原生 optional package
    // 直接拷进另一个目标（例如 darwin-x64）。
    const targetPkgPath = path.join(targetDir, "package.json")
    if (fs.existsSync(targetPkgPath)) {
      // 修复目标目录中 package.json 的依赖声明。
      //
      // 扩展的 dist/index.mjs 已由 Bun 打包完成：non-external 依赖全部内联，
      // 仅 external 列出的包需要由 node_modules 提供。
      //
      // 因此目标 package.json 必须只保留 external 中声明的依赖，否则运行时
      // getMissingExtensionRuntimeDependencies 会因 dependencies 里有未安装
      // 的包而抛错（之前的版本只删 file: 依赖，registry 依赖没清理）。
      const targetPkg = JSON.parse(fs.readFileSync(targetPkgPath, "utf8"))
      const externalSet = new Set(extension.external)
      let pkgModified = false
      for (const field of ["dependencies", "devDependencies", "optionalDependencies"] as const) {
        const deps = targetPkg[field] as Record<string, string> | undefined
        if (!deps) continue
        for (const [name, version] of Object.entries(deps)) {
          // 只保留：external 列表里的依赖（运行时仍需 require）。
          // 删除：file: 本地依赖（路径已失效）+ 已被 bundle 的 registry 依赖。
          const isExternal = field !== "devDependencies" && externalSet.has(name)
          if (!isExternal) {
            delete deps[name]
            pkgModified = true
          }
        }
        if (Object.keys(deps).length === 0) delete targetPkg[field]
      }
      if (pkgModified) {
        fs.writeFileSync(targetPkgPath, JSON.stringify(targetPkg, null, 2) + "\n")
      }
    }

    installExternalDependenciesForTarget(targetDir, target, extension)
    const pruneStats = pruneDistributionArtifacts(targetDir, target)
    if (pruneStats.files > 0 || pruneStats.dirs > 0) {
      console.log(
        `  ✓ distribution artifacts pruned: ${pruneStats.files} files, ${pruneStats.dirs} dirs, ${Math.round(pruneStats.bytes / 1024 / 1024 * 100) / 100} MB`,
      )
    }
    console.log(`  ✓ extension copied: extensions/${extension.name}`)
  }
}

function copyDirectoryIfExists(sourceDir: string, targetDir: string, label: string): void {
  if (!fs.existsSync(sourceDir)) return
  fs.cpSync(sourceDir, targetDir, { recursive: true })
  console.log(`  ✓ ${label} copied`)
}

const embeddedExtensions = loadEmbeddedExtensionBuildTargets()
const binaries: Record<string, string> = {}
const failedTargets: { name: string; error: unknown }[] = []

// 修补内嵌扩展 node_modules 中残缺的 irises-extension-sdk
{
  for (const ext of embeddedExtensions) {
    patchExtensionSdkInNodeModules(path.join(ext.sourceDir, "node_modules"))
  }
}

await buildEmbeddedExtensions(embeddedExtensions)

for (const target of targets) {
  const platformName = getPlatformName(target.os)
  const dirName = `iris-${platformName}-${target.arch}`
  const npmPackageName = `irises-${platformName}-${target.arch}`
  const outDir = path.join(distBinDir, dirName)
  const compileTarget = `bun-${target.os}-${target.arch}`

  console.log(`\n=== Building ${dirName} ===`)
  fs.mkdirSync(path.join(outDir, "bin"), { recursive: true })

  try {
    await buildCompiledBinary({
      entrypoint: "./src/main.ts",
      outfile: `dist/bin/${dirName}/bin/iris`,
      target: compileTarget,
      define: {
        "globalThis.IRIS_VERSION": `'${version}'`,
        "globalThis.__IRIS_COMPILED__": "true",
      },
      external: ["chromium-bidi", "electron"],
    })
    console.log("  ✓ iris built")

    await buildCompiledBinary({
      entrypoint: "./terminal/src/index.tsx",
      outfile: `dist/bin/${dirName}/bin/iris-onboard`,
      target: compileTarget,
      minify: true,
    })
    console.log("  ✓ iris-onboard built")

    copyDirectoryIfExists(path.join(rootDir, "data"), path.join(outDir, "data"), "data/")
    copyEmbeddedExtensions(embeddedExtensions, path.join(outDir, "extensions"), target)
    copyDirectoryIfExists(webUiDistDir, path.join(outDir, "web-ui", "dist"), "web-ui/dist")
    copyDirectoryIfExists(opentuiRuntimeStagingDir, path.join(outDir, "bin", "opentui"), "bin/opentui")

    // 复制平台部署脚本到产物根目录
    const deployScriptsDir = path.join(rootDir, "deploy", target.os === "win32" ? "windows" : "linux")
    if (fs.existsSync(deployScriptsDir)) {
      const scriptExt = target.os === "win32" ? ".bat" : ".sh"
      for (const file of fs.readdirSync(deployScriptsDir)) {
        if (!file.endsWith(scriptExt)) continue
        fs.copyFileSync(path.join(deployScriptsDir, file), path.join(outDir, file))
      }
      console.log(`  ✓ deploy scripts copied`)
    }

    const licensePath = path.join(rootDir, "LICENSE")
    if (fs.existsSync(licensePath)) {
      fs.copyFileSync(licensePath, path.join(outDir, "LICENSE"))
      console.log("  ✓ LICENSE copied")
    }

    fs.writeFileSync(
      path.join(outDir, "package.json"),
      JSON.stringify(
        {
          name: npmPackageName,
          version,
          description: `Prebuilt ${platformName}-${target.arch} binary for Iris`,
          bin: {
            iris: target.os === "win32" ? "./bin/iris.exe" : "./bin/iris",
          },
          os: [target.os],
          cpu: [target.arch],
          license: pkg.license ?? "GPL-3.0-only",
        },
        null,
        2,
      ),
    )

    binaries[npmPackageName] = version
    console.log(`  ✓ ${dirName} built successfully`)
  } catch (err) {
    console.error(`  ✗ ${dirName} build failed:`, err)
    failedTargets.push({ name: dirName, error: err })
  }
}

console.log("\n=== Build Summary ===")
for (const [name, ver] of Object.entries(binaries)) {
  console.log(`  ${name}@${ver}`)
}

if (failedTargets.length > 0) {
  console.error(`\n=== Build Failures (${failedTargets.length}) ===`)
  for (const { name, error } of failedTargets) {
    const msg = error instanceof Error ? (error.stack || error.message) : String(error)
    console.error(`✗ ${name}:\n${msg}\n`)
  }
  // 必须以非零码退出，否则 CI 会误判为成功，
  // 导致后续 Docker COPY / npm 上传出现"找不到文件"等连锁错误。
  process.exit(1)
}

// 防御性兜底：即便没有抛错，但产物为空也算失败。
// 例如 targets 数组为空、或者循环未真正执行某个分支等极端情况，
// 避免再次出现"build 阶段全绿、上传阶段才发现没文件"的现象。
if (Object.keys(binaries).length === 0) {
  console.error("\n✗ 没有任何平台编译成功，dist/bin 为空。")
  process.exit(1)
}

export { binaries }
