#!/usr/bin/env node

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

interface TargetInfo {
  platform: 'linux' | 'darwin' | 'windows';
  arch: string;
  dirName: string;
}

interface Issue {
  level: 'error' | 'warn';
  message: string;
}

const platformTokens: Record<TargetInfo['platform'], Set<string>> = {
  linux: new Set(['linux']),
  darwin: new Set(['darwin']),
  windows: new Set(['win32', 'windows']),
};

const platformSpecificPackagePattern = /^(core|sharp|sharp-libvips|bun-webgpu)-(darwin|linux|win32|windows)-(.+)$/;

function formatRelative(filePath: string): string {
  return path.relative(rootDir, filePath).replace(/\\/g, '/');
}

function listDefaultPackageDirs(): string[] {
  const distBinDir = path.join(rootDir, 'dist', 'bin');
  if (!fs.existsSync(distBinDir)) return [];
  return fs.readdirSync(distBinDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('iris-'))
    .map((entry) => path.join(distBinDir, entry.name))
    .sort((a, b) => a.localeCompare(b));
}

function normalizePackageDirs(inputDirs: string[]): string[] {
  const dirs = inputDirs.length > 0
    ? inputDirs.map((dir) => path.resolve(rootDir, dir))
    : listDefaultPackageDirs();

  return Array.from(new Set(dirs)).filter((dir) => fs.existsSync(dir));
}

function parseTargetInfo(pkgDir: string): TargetInfo {
  const dirName = path.basename(pkgDir);
  const match = /^iris-(linux|darwin|windows)-(.+)$/.exec(dirName);
  if (!match) {
    throw new Error(`无法从目录名解析目标平台: ${formatRelative(pkgDir)}（期望 iris-<platform>-<arch>）`);
  }
  return {
    platform: match[1] as TargetInfo['platform'],
    arch: match[2],
    dirName,
  };
}

function checkPlatformSpecificPackage(entryName: string, fullPath: string, target: TargetInfo, issues: Issue[]): void {
  const match = platformSpecificPackagePattern.exec(entryName);
  if (!match) return;

  const packagePlatform = match[2];
  const packageArchSuffix = match[3];
  if (!platformTokens[target.platform].has(packagePlatform)) {
    issues.push({
      level: 'error',
      message: `native package 平台不匹配：${formatRelative(fullPath)} 属于 ${packagePlatform}，目标是 ${target.platform}-${target.arch}`,
    });
  }

  const packageArchParts = packageArchSuffix.split('-');
  if ((packageArchParts.includes('x64') || packageArchParts.includes('arm64')) && !packageArchParts.includes(target.arch)) {
    issues.push({
      level: 'error',
      message: `native package 架构不匹配：${formatRelative(fullPath)} 属于 ${packageArchSuffix}，目标是 ${target.platform}-${target.arch}`,
    });
  }
}

function checkNativeFile(filePath: string, target: TargetInfo, issues: Issue[]): void {
  const fileName = path.basename(filePath);
  const lowerName = fileName.toLowerCase();

  if (lowerName.endsWith('.dll') && target.platform !== 'windows') {
    issues.push({
      level: 'error',
      message: `发现 Windows DLL 出现在非 Windows 包中：${formatRelative(filePath)} -> ${target.dirName}`,
    });
  }

  if ((lowerName.endsWith('.so') || lowerName.includes('.so.')) && target.platform !== 'linux') {
    issues.push({
      level: 'error',
      message: `发现 Linux shared object 出现在非 Linux 包中：${formatRelative(filePath)} -> ${target.dirName}`,
    });
  }

  if (lowerName.endsWith('.dylib') && target.platform !== 'darwin') {
    issues.push({
      level: 'error',
      message: `发现 macOS dylib 出现在非 macOS 包中：${formatRelative(filePath)} -> ${target.dirName}`,
    });
  }
}

function walk(dir: string, target: TargetInfo, issues: Issue[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      checkPlatformSpecificPackage(entry.name, fullPath, target, issues);
      walk(fullPath, target, issues);
    } else if (entry.isFile()) {
      checkNativeFile(fullPath, target, issues);
    }
  }
}

function validatePackageDir(pkgDir: string): Issue[] {
  const target = parseTargetInfo(pkgDir);
  const issues: Issue[] = [];
  walk(pkgDir, target, issues);
  return issues;
}

function main(): void {
  const args = process.argv.slice(2);
  const packageDirs = normalizePackageDirs(args);

  if (packageDirs.length === 0) {
    throw new Error('未找到可检查的平台包目录（默认扫描 dist/bin/iris-*，或显式传入目录）');
  }

  let hasError = false;
  for (const pkgDir of packageDirs) {
    const issues = validatePackageDir(pkgDir);
    const errors = issues.filter((issue) => issue.level === 'error');
    const warnings = issues.filter((issue) => issue.level === 'warn');

    console.log(`[native-assets] ${formatRelative(pkgDir)}: ${errors.length === 0 ? 'OK' : 'FAIL'}`);
    for (const issue of issues) {
      const prefix = issue.level === 'error' ? '  ✗' : '  !';
      console.log(`${prefix} ${issue.message}`);
    }

    if (warnings.length > 0) {
      console.log(`  warnings: ${warnings.length}`);
    }
    if (errors.length > 0) {
      hasError = true;
    }
  }

  if (hasError) {
    throw new Error('native asset 校验失败');
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
