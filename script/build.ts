#!/usr/bin/env bun

/**
 * Iris 全平台编译脚本
 *
 * 使用 bun build --compile 为每个目标平台生成独立可执行文件。
 * 产物内嵌 Bun 运行时 + opentui 原生库 + 全部依赖，无需外部运行时。
 *
 * 产物结构：
 *   dist/bin/iris-{platform}-{arch}/
 *     bin/iris(.exe)       编译后的二进制
 *     data/                配置模板和示例文件
 *     package.json         平台包描述
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
const dir = path.resolve(__dirname, "..")
process.chdir(dir)

const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"))
const version: string = pkg.version

interface Target {
  os: string
  arch: "x64" | "arm64"
}

const allTargets: Target[] = [
  { os: "linux",  arch: "x64" },
  { os: "linux",  arch: "arm64" },
  { os: "darwin", arch: "arm64" },
  { os: "darwin", arch: "x64" },
  { os: "win32",  arch: "x64" },
]

const singleFlag = process.argv.includes("--single")
const targets = singleFlag
  ? allTargets.filter(t => t.os === process.platform && t.arch === process.arch)
  : allTargets

if (targets.length === 0) {
  console.error(`当前平台 ${process.platform}-${process.arch} 不在支持的目标列表中`)
  process.exit(1)
}

// 清理旧产物
const distBinDir = path.join(dir, "dist", "bin")
if (fs.existsSync(distBinDir)) {
  try {
    fs.rmSync(distBinDir, { recursive: true, force: true })
  } catch (err: any) {
    // Windows 下目录可能被其他进程占用，跳过清理继续编译（覆盖写入）
    console.warn(`警告: 无法清理旧产物目录 (${err.code || err.message})，将覆盖写入`)
  }
}

// 确保安装所有平台的 opentui 原生依赖
const opentuiVersion = pkg.optionalDependencies?.["@opentui/core"] ?? "latest"
await $`bun install --os="*" --cpu="*" @opentui/core@${opentuiVersion}`

const binaries: Record<string, string> = {}

for (const item of targets) {
  const platformName = item.os === "win32" ? "windows" : item.os
  const name = `iris-${platformName}-${item.arch}`
  console.log(`\n=== Building ${name} ===`)

  const outDir = path.join(distBinDir, name)
  fs.mkdirSync(path.join(outDir, "bin"), { recursive: true })

  try {
    await Bun.build({
      entrypoints: ["./src/main.ts"],
      // Playwright / OpenTUI 内部可选依赖，编译时无法解析，运行时不影响核心功能
      external: ["chromium-bidi", "electron", "react-devtools-core"],
      compile: {
        target: `bun-${item.os}-${item.arch}` as any,
        outfile: `dist/bin/${name}/bin/iris`,
      },
      define: {
        IRIS_VERSION: `'${version}'`,
      },
    })

    // 复制 data/ 目录（配置模板和示例文件）
    const dataSrc = path.join(dir, "data")
    const dataDest = path.join(outDir, "data")
    if (fs.existsSync(dataSrc)) {
      fs.cpSync(dataSrc, dataDest, { recursive: true })
      console.log(`  ✓ data/ copied`)
    }

    // 生成平台包 package.json
    fs.writeFileSync(
      path.join(outDir, "package.json"),
      JSON.stringify(
        {
          name,
          version,
          description: `Prebuilt ${platformName}-${item.arch} binary for Iris`,
          bin: {
            iris: item.os === "win32" ? "./bin/iris.exe" : "./bin/iris",
          },
          os: [item.os],
          cpu: [item.arch],
          license: pkg.license ?? "MIT",
        },
        null,
        2,
      ),
    )

    binaries[name] = version
    console.log(`  ✓ ${name} built successfully`)
  } catch (err) {
    console.error(`  ✗ ${name} build failed:`, err)
  }
}

console.log("\n=== Build Summary ===")
for (const [name, ver] of Object.entries(binaries)) {
  console.log(`  ${name}@${ver}`)
}

export { binaries }
