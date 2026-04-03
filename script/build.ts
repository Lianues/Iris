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
  { os: "win32", arch: "arm64" },
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
  // 注意：Bun 1.x 的 external + outfile 存在 bug，会导致 outfile 被忽略、
  // 文件写入丢失。因此有 external 时改用 outdir 模式，构建后将产物重命名到 outfile。
  external?: string[]
}): Promise<void> {
  const hasExternal = options.external && options.external.length > 0

  if (hasExternal) {
    // Bun 1.x bug 规避：external + outfile 会导致输出文件丢失。
    // 改用 outdir 模式输出到 outfile 所在目录，再将产物 index.js 重命名为目标文件名。
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
    })

    if (!result.success) {
      const logs = formatBuildLogs(result)
      throw new Error(logs || `构建失败: ${options.outfile}`)
    }

    // Bun outdir 模式输出的文件名是 index.js，需要重命名为目标文件名（如 index.mjs）
    const outputJs = path.join(outDir, "index.js")
    if (fs.existsSync(outputJs) && targetName !== "index.js") {
      fs.renameSync(outputJs, path.join(outDir, targetName))
    }
    return
  }

  const result = await Bun.build({
    entrypoints: [options.entrypoint],
    outfile: options.outfile,
    target: options.target ?? "node",
    format: options.format ?? "esm",
  })
  if (!result.success) {
    const logs = formatBuildLogs(result)
    throw new Error(logs || `构建失败: ${options.outfile}`)
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
    console.log(`✓ extension bundled: ${extension.name} -> ${formatRelativePath(extension.outfile)}`)
  }
}

function copyEmbeddedExtensions(extensions: EmbeddedExtensionBuildTarget[], targetRootDir: string): void {
  if (extensions.length === 0) return
  fs.mkdirSync(targetRootDir, { recursive: true })
  for (const extension of extensions) {
    const targetDir = path.join(targetRootDir, extension.name)
    fs.rmSync(targetDir, { recursive: true, force: true })
    // 修正：Windows 上 extension 的 node_modules 里可能有 symlink/junction（如 @irises/extension-sdk），
    // cpSync 默认不解引用会 EPERM，加 dereference: true 将链接展开为实际文件再复制
    fs.cpSync(extension.sourceDir, targetDir, { recursive: true, dereference: true })
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
        IRIS_VERSION: `'${version}'`,
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
    copyEmbeddedExtensions(embeddedExtensions, path.join(outDir, "extensions"))
    copyDirectoryIfExists(webUiDistDir, path.join(outDir, "web-ui", "dist"), "web-ui/dist")
    copyDirectoryIfExists(opentuiRuntimeStagingDir, path.join(outDir, "bin", "opentui"), "bin/opentui")

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
  }
}

console.log("\n=== Build Summary ===")
for (const [name, ver] of Object.entries(binaries)) {
  console.log(`  ${name}@${ver}`)
}

export { binaries }
