#!/usr/bin/env bun

/**
 * Iris npm 发布脚本
 *
 * 将 dist/bin/ 下构建好的平台二进制包和包装器包发布到 npm。
 *
 * 产物结构：
 *   dist/bin/iris-linux-x64/        → npm publish (平台包 irises-linux-x64)
 *   dist/bin/iris-darwin-arm64/      → npm publish (平台包 irises-darwin-arm64)
 *   dist/bin/iris-windows-x64/       → npm publish (平台包 irises-windows-x64)
 *   dist/bin/irises/                 → npm publish (包装器包 irises)
 *
 * 用法：
 *   bun run script/publish.ts
 *   bun run script/publish.ts --tag preview
 *   bun run script/publish.ts --dry-run
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

// 解析 --tag 参数
const tagIndex = process.argv.indexOf("--tag")
const tag = tagIndex >= 0 && process.argv[tagIndex + 1] ? process.argv[tagIndex + 1] : "latest"
const dryRun = process.argv.includes("--dry-run")
const wrapperName = "irises"

// 收集已构建的平台二进制（目录名为 iris-*，但 package.json 中的 npm 包名为 irises-*）
const distBinDir = path.join(dir, "dist", "bin")
const binaries: Record<string, string> = {}
console.log(`[publish] distBinDir: ${distBinDir}`)
console.log(`[publish] exists: ${fs.existsSync(distBinDir)}`)
if (fs.existsSync(distBinDir)) {
  for (const entry of fs.readdirSync(distBinDir, { withFileTypes: true })) {
    console.log(`[publish]   entry: ${entry.name}  dir=${entry.isDirectory()}`)
  }
}
console.log("")

for (const entry of fs.readdirSync(distBinDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue
  const pkgJsonPath = path.join(distBinDir, entry.name, "package.json")
  console.log(`[publish] checking: ${pkgJsonPath}  exists=${fs.existsSync(pkgJsonPath)}`)
  if (!fs.existsSync(pkgJsonPath)) continue
  const p = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8"))
  console.log(`[publish]   name=${p.name} version=${p.version} startsWith(irises-)=${p.name?.startsWith("irises-")}`)
  if (p.name && p.version && p.name !== wrapperName && p.name.startsWith("irises-")) {
    binaries[p.name] = p.version
    console.log(`[publish]   -> MATCH`)
  } else {
    console.log(`[publish]   -> SKIP (name=${p.name}, version=${p.version}, wrapperName=${wrapperName})`)
  }
}

if (Object.keys(binaries).length === 0) {
  console.error("未找到已构建的平台二进制包。请先运行 bun run build:compile")
  process.exit(1)
}

console.log("待发布的平台包:", binaries)
if (dryRun) {
  console.log("\n⚠ npm dry-run 模式：将执行 npm publish --dry-run，不会真正上传/发布任何包。")
}

const version = Object.values(binaries)[0]

async function npmPackageVersionExists(name: string, packageVersion: string): Promise<boolean> {
  const result = Bun.spawnSync(
    ["npm", "view", `${name}@${packageVersion}`, "version", "--json"],
    { stdout: "pipe", stderr: "pipe" },
  )
  return result.exitCode === 0
}

// npm 不允许覆盖已发布过的 package@version。
// 先做完整 preflight，避免并发发布时出现部分平台包已发布、部分未发布的半失败状态。
{
  const existing: string[] = []
  for (const [name, packageVersion] of Object.entries(binaries)) {
    if (await npmPackageVersionExists(name, packageVersion)) {
      existing.push(`${name}@${packageVersion}`)
    }
  }
  if (await npmPackageVersionExists(wrapperName, version)) {
    existing.push(`${wrapperName}@${version}`)
  }

  if (existing.length > 0) {
    console.error("以下 npm 版本已存在，npm 不允许覆盖发布：")
    for (const item of existing) console.error(`- ${item}`)
    console.error("请提升 package.json 版本号并重新构建产物（不要复用旧 build_run_id）。")
    process.exit(1)
  }
}

function runNpmPublish(pkgDir: string): void {
  const args = [
    "publish",
    ...(dryRun ? ["--dry-run"] : []),
    "--access",
    "public",
    "--tag",
    tag,
  ]
  const result = Bun.spawnSync(["npm", ...args], {
    cwd: pkgDir,
    stdio: ["inherit", "inherit", "inherit"],
  })
  if (result.exitCode !== 0) {
    throw new Error(`npm ${args.join(" ")} failed in ${pkgDir} (exit=${result.exitCode})`)
  }
}

// 生成 npm 包装器
const wrapperDir = path.join(distBinDir, wrapperName)
fs.mkdirSync(path.join(wrapperDir, "bin"), { recursive: true })

// 复制启动器脚本
const launcherSrc = path.join(dir, "bin", "iris")
const launcherDest = path.join(wrapperDir, "bin", "iris")
fs.copyFileSync(launcherSrc, launcherDest)

// 复制 postinstall 脚本
const postinstallSrc = path.join(dir, "script", "postinstall.mjs")
const postinstallDest = path.join(wrapperDir, "postinstall.mjs")
fs.copyFileSync(postinstallSrc, postinstallDest)

// 复制 LICENSE（如果存在）
const licensePath = path.join(dir, "LICENSE")
if (fs.existsSync(licensePath)) {
  fs.copyFileSync(licensePath, path.join(wrapperDir, "LICENSE"))
}

// 生成包装器 package.json
fs.writeFileSync(
  path.join(wrapperDir, "package.json"),
  JSON.stringify(
    {
      name: wrapperName,
      version,
      description: pkg.description ?? "Iris AI Agent",
      license: pkg.license ?? "GPL-3.0-only",
      bin: {
        iris: "./bin/iris",
      },
      scripts: {
        postinstall: "bun ./postinstall.mjs || node ./postinstall.mjs",
      },
      optionalDependencies: binaries,
    },
    null,
    2,
  ),
)

console.log(`\n包装器包 ${wrapperName}@${version} 已生成`)

// 发布所有平台包（目录名为 iris-*，需要遍历找到含 irises-* 包名的目录）
const publishTasks: Promise<void>[] = []
for (const entry of fs.readdirSync(distBinDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue
  const pkgJsonPath = path.join(distBinDir, entry.name, "package.json")
  if (!fs.existsSync(pkgJsonPath)) continue
  const p = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8"))
  if (!p.name || !p.name.startsWith("irises-")) continue

  const pkgDir = path.join(distBinDir, entry.name)
  publishTasks.push(
    (async () => {
      if (process.platform !== "win32") {
        await $`chmod -R 755 .`.cwd(pkgDir)
      }
      console.log(`\n${dryRun ? "预发布检查" : "发布"} ${p.name}@${p.version}...`)
      runNpmPublish(pkgDir)
      console.log(`  ✓ ${p.name} ${dryRun ? "预发布检查通过" : "发布成功"}`)
    })(),
  )
}
await Promise.all(publishTasks)

// 发布包装器
console.log(`\n${dryRun ? "预发布检查" : "发布"} ${wrapperName}@${version}...`)
runNpmPublish(wrapperDir)
console.log(`  ✓ ${wrapperName} ${dryRun ? "预发布检查通过" : "发布成功"}`)

console.log(dryRun ? "\n=== npm 预发布检查完成（未上传） ===" : "\n=== 全部发布完成 ===")
