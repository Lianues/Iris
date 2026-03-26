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
const webUiDistDir = path.join(rootDir, "src", "platforms", "web", "web-ui", "dist")

if (!fs.existsSync(webUiDistDir)) {
  console.error("未找到 Web UI 构建产物，请先运行 npm run build:ui")
  process.exit(1)
}

interface Target {
  os: string
  arch: "x64" | "arm64"
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

function getPlatformName(osName: string): string {
  return osName === "win32" ? "windows" : osName
}

function formatBuildLogs(result: Awaited<ReturnType<typeof Bun.build>>): string {
  return result.logs.map((entry) => entry.message).filter(Boolean).join("\n")
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

function copyDirectoryIfExists(sourceDir: string, targetDir: string, label: string): void {
  if (!fs.existsSync(sourceDir)) return
  fs.cpSync(sourceDir, targetDir, { recursive: true })
  console.log(`  ✓ ${label} copied`)
}

const binaries: Record<string, string> = {}

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
      entrypoint: "./onboard/src/index.tsx",
      outfile: `dist/bin/${dirName}/bin/iris-onboard`,
      target: compileTarget,
      minify: true,
    })
    console.log("  ✓ iris-onboard built")

    copyDirectoryIfExists(path.join(rootDir, "data"), path.join(outDir, "data"), "data/")
    copyDirectoryIfExists(webUiDistDir, path.join(outDir, "web-ui", "dist"), "web-ui/dist")

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
    console.error(`  ✗ ${packageName} build failed:`, err)
  }
}

console.log("\n=== Build Summary ===")
for (const [name, ver] of Object.entries(binaries)) {
  console.log(`  ${name}@${ver}`)
}

export { binaries }
