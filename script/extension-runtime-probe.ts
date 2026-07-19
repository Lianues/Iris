#!/usr/bin/env bun

/**
 * 由 validate-extension-runtime.ts 编译成独立 Bun 可执行文件。
 *
 * 发行包中的 extension 由编译后的 Iris 在运行时动态 import。Node 的
 * createRequire() 预检与 Bun 编译运行时的解析结果并不总是一致，因此这里必须：
 * 1. 确认每个声明的运行时依赖都安装在 extension 自己的 node_modules；
 * 2. 禁止缺失依赖向上回退到仓库或全局 node_modules；
 * 3. 用编译后的 Bun 实际 import 打包后的 extension 入口。
 */

import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"

interface RuntimePackageJson {
  dependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
}

function normalizeForComparison(value: string): string {
  const resolved = path.resolve(value)
  return process.platform === "win32" ? resolved.toLowerCase() : resolved
}

function isWithinDirectory(candidate: string, parent: string): boolean {
  const normalizedCandidate = normalizeForComparison(candidate)
  const normalizedParent = normalizeForComparison(parent)
  const relative = path.relative(normalizedParent, normalizedCandidate)
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}

function collectRuntimeDependencyNames(packageJson: RuntimePackageJson): string[] {
  return Array.from(new Set([
    ...Object.keys(packageJson.dependencies ?? {}),
    ...Object.keys(packageJson.optionalDependencies ?? {}),
  ])).sort()
}

function getLocalDependencyDir(localNodeModulesDir: string, dependencyName: string): string {
  const parts = dependencyName.split("/")
  const valid = dependencyName.startsWith("@")
    ? parts.length === 2 && parts.every((part) => part.length > 0)
    : parts.length === 1 && parts[0].length > 0
  if (!valid || parts.some((part) => part === "." || part === "..")) {
    throw new Error(`无效的运行时依赖名称: ${dependencyName}`)
  }
  return path.join(localNodeModulesDir, ...parts)
}

const extensionDirArg = process.argv[2]
const entryArg = process.argv[3]
if (!extensionDirArg || !entryArg) {
  throw new Error("用法: extension-runtime-probe <extension-dir> <entry-file>")
}

const extensionDir = path.resolve(extensionDirArg)
const entryFile = path.resolve(extensionDir, entryArg)
const packageJsonPath = path.join(extensionDir, "package.json")
const localNodeModulesDir = path.join(extensionDir, "node_modules")

if (!fs.existsSync(packageJsonPath)) {
  throw new Error(`extension 缺少 package.json: ${packageJsonPath}`)
}
if (!fs.existsSync(entryFile)) {
  throw new Error(`extension 缺少运行时入口: ${entryFile}`)
}

const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as RuntimePackageJson
for (const dependencyName of collectRuntimeDependencyNames(packageJson)) {
  const dependencyDir = getLocalDependencyDir(localNodeModulesDir, dependencyName)
  const dependencyPackageJsonPath = path.join(dependencyDir, "package.json")
  if (
    !isWithinDirectory(dependencyDir, localNodeModulesDir)
    || !fs.existsSync(dependencyPackageJsonPath)
  ) {
    throw new Error(`extension 缺少本地运行时依赖 ${dependencyName}: ${dependencyPackageJsonPath}`)
  }
  console.log(`[runtime-probe] ${dependencyName} -> ${dependencyDir}`)
}

await import(pathToFileURL(entryFile).href)
console.log(`[runtime-probe] imported ${entryFile}`)
