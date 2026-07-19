#!/usr/bin/env node

/**
 * 在与仓库 node_modules 隔离的临时目录中，用编译后的 Bun 探针加载平台包 extension。
 *
 * 这项检查专门覆盖以下发行边界：
 * - build 目录内存在依赖，但 npm/归档后的独立布局无法解析；
 * - Node createRequire() 可解析，但 Bun --compile 运行时不可解析；
 * - extension 本地依赖失效后，测试环境悄悄回退到仓库根 node_modules。
 */

import * as childProcess from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { fileURLToPath } from "node:url"

interface RuntimePackageJson {
  dependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
}

interface ExtensionManifest {
  entry?: string
  plugin?: { entry?: string }
  platforms?: Array<{ entry?: string }>
}

interface CliOptions {
  npmPack: boolean
  packageDirs: string[]
}

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, "..")

function formatRelative(filePath: string): string {
  return path.relative(rootDir, filePath).replace(/\\/g, "/")
}

function listDefaultPackageDirs(): string[] {
  const distBinDir = path.join(rootDir, "dist", "bin")
  if (!fs.existsSync(distBinDir)) return []
  return fs.readdirSync(distBinDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("iris-"))
    .map((entry) => path.join(distBinDir, entry.name))
    .sort((a, b) => a.localeCompare(b))
}

function normalizePackageDirs(inputDirs: string[]): string[] {
  const dirs = inputDirs.length > 0
    ? inputDirs.map((dir) => path.resolve(rootDir, dir))
    : listDefaultPackageDirs()
  return Array.from(new Set(dirs)).filter((dir) => fs.existsSync(path.join(dir, "package.json")))
}

function parseCliOptions(args: string[]): CliOptions {
  const packageDirs: string[] = []
  let npmPack = false
  for (const arg of args) {
    if (arg === "--npm-pack") {
      npmPack = true
    } else if (arg.startsWith("--")) {
      throw new Error(`未知参数: ${arg}`)
    } else {
      packageDirs.push(arg)
    }
  }
  return { npmPack, packageDirs }
}

function parsePackageTarget(packageDir: string): { platform: string, arch: string } | undefined {
  const match = /^iris(?:es)?-(linux|darwin|windows)-(.+)$/.exec(path.basename(packageDir))
  return match ? { platform: match[1], arch: match[2] } : undefined
}

function getCurrentTarget(): { platform: string, arch: string } {
  return {
    platform: process.platform === "win32" ? "windows" : process.platform,
    arch: process.arch,
  }
}

function hasRuntimeDependencies(extensionDir: string): boolean {
  const packageJsonPath = path.join(extensionDir, "package.json")
  if (!fs.existsSync(packageJsonPath)) return false
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as RuntimePackageJson
  return [packageJson.dependencies, packageJson.optionalDependencies]
    .some((dependencies) => !!dependencies && Object.keys(dependencies).length > 0)
}

function collectRuntimeEntries(extensionDir: string): string[] {
  const manifestPath = path.join(extensionDir, "manifest.json")
  if (!fs.existsSync(manifestPath)) return []
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as ExtensionManifest
  const entries = [
    manifest.entry,
    manifest.plugin?.entry,
    ...(manifest.platforms ?? []).map((platform) => platform.entry),
  ]
    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    .map((entry) => entry.trim())
  return Array.from(new Set(entries))
}

function run(
  command: string,
  args: string[],
  cwd: string,
  envOverrides: NodeJS.ProcessEnv = {},
): void {
  const result = childProcess.spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
    env: { ...process.env, ...envOverrides },
  })

  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`命令失败: ${command} ${args.join(" ")} (exit=${result.status})`)
  }
}

function resolveNpmCliPath(): string {
  const executableDir = path.dirname(process.execPath)
  const candidates = [
    process.env.npm_execpath,
    path.join(executableDir, "node_modules", "npm", "bin", "npm-cli.js"),
    path.resolve(executableDir, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
  ].filter((candidate): candidate is string => typeof candidate === "string" && candidate.length > 0)
  const npmCliPath = candidates.find((candidate) => fs.existsSync(candidate))
  if (!npmCliPath) {
    throw new Error("无法定位 npm CLI，不能执行 --npm-pack 校验")
  }
  return npmCliPath
}

function packPackageForValidation(packageDir: string, tempRoot: string, index: number): string {
  const packRoot = path.join(tempRoot, "npm-pack", String(index))
  const archiveDir = path.join(packRoot, "archive")
  const extractDir = path.join(packRoot, "extracted")
  fs.mkdirSync(archiveDir, { recursive: true })
  fs.mkdirSync(extractDir, { recursive: true })

  run(
    process.execPath,
    [
      resolveNpmCliPath(),
      "pack",
      packageDir,
      "--pack-destination",
      archiveDir,
      "--loglevel",
      "error",
    ],
    rootDir,
    {
      npm_config_cache: path.join(packRoot, "npm-cache"),
      npm_config_update_notifier: "false",
    },
  )
  const archives = fs.readdirSync(archiveDir)
    .filter((fileName) => fileName.endsWith(".tgz"))
    .map((fileName) => path.join(archiveDir, fileName))
  if (archives.length !== 1) {
    throw new Error(`npm pack 产物数量异常: ${archives.length}`)
  }

  run("tar", ["-xf", archives[0], "-C", extractDir], rootDir)
  const extractedPackageDir = path.join(extractDir, "package")
  if (!fs.existsSync(path.join(extractedPackageDir, "package.json"))) {
    throw new Error(`npm tarball 缺少 package.json: ${extractedPackageDir}`)
  }
  return extractedPackageDir
}

function compileProbe(tempRoot: string): string {
  const executableName = process.platform === "win32" ? "extension-runtime-probe.exe" : "extension-runtime-probe"
  const outputPath = path.join(tempRoot, executableName)
  const bunExecutable = process.env.IRIS_BUN_EXECUTABLE
    || (process.platform === "win32" ? "bun.exe" : "bun")
  run(
    bunExecutable,
    [
      "build",
      path.join(rootDir, "script", "extension-runtime-probe.ts"),
      "--compile",
      "--outfile",
      outputPath,
    ],
    rootDir,
  )
  return outputPath
}

function validatePackage(
  packageDir: string,
  packageLabel: string,
  probeExecutable: string,
  tempRoot: string,
): number {
  const extensionsDir = path.join(packageDir, "extensions")
  if (!fs.existsSync(extensionsDir)) return 0

  let checkedEntries = 0
  for (const entry of fs.readdirSync(extensionsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const sourceExtensionDir = path.join(extensionsDir, entry.name)
    if (!hasRuntimeDependencies(sourceExtensionDir)) continue

    const runtimeEntries = collectRuntimeEntries(sourceExtensionDir)
    if (runtimeEntries.length === 0) continue

    const isolatedExtensionDir = path.join(tempRoot, "extensions", packageLabel, entry.name)
    fs.cpSync(sourceExtensionDir, isolatedExtensionDir, { recursive: true })
    for (const runtimeEntry of runtimeEntries) {
      console.log(`[extension-runtime] ${packageLabel}/${entry.name}: ${runtimeEntry}`)
      run(probeExecutable, [isolatedExtensionDir, runtimeEntry], tempRoot)
      checkedEntries++
    }
  }
  return checkedEntries
}

function main(): void {
  const options = parseCliOptions(process.argv.slice(2))
  const packageDirs = normalizePackageDirs(options.packageDirs)
  if (packageDirs.length === 0) {
    throw new Error("未找到可检查的平台包目录")
  }

  const currentTarget = getCurrentTarget()
  const matchingPackageDirs = packageDirs.filter((packageDir) => {
    const target = parsePackageTarget(packageDir)
    if (!target) throw new Error(`无法解析平台包目录名: ${formatRelative(packageDir)}`)
    if (target.platform === currentTarget.platform && target.arch === currentTarget.arch) return true
    console.log(
      `[extension-runtime] SKIP ${formatRelative(packageDir)}: `
      + `目标 ${target.platform}-${target.arch}，当前 ${currentTarget.platform}-${currentTarget.arch}`,
    )
    return false
  })

  if (matchingPackageDirs.length === 0) return

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "iris-extension-runtime-"))
  try {
    const probeExecutable = compileProbe(tempRoot)
    let checkedEntries = 0
    for (const [index, packageDir] of matchingPackageDirs.entries()) {
      const packageLabel = path.basename(packageDir)
      const validationDir = options.npmPack
        ? packPackageForValidation(packageDir, tempRoot, index)
        : packageDir
      checkedEntries += validatePackage(validationDir, packageLabel, probeExecutable, tempRoot)
    }
    if (checkedEntries === 0) {
      throw new Error("没有找到带运行时依赖的 extension 入口，检查未实际执行")
    }
    console.log(`[extension-runtime] OK: ${checkedEntries} 个入口`)
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
}

try {
  main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
