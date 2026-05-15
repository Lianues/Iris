#!/usr/bin/env node

import * as childProcess from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

interface PackFile {
  path: string;
  size: number;
}

interface PackResult {
  name?: string;
  version?: string;
  size: number;
  unpackedSize: number;
  entryCount?: number;
  files?: PackFile[];
}

interface Options {
  warnMb: number;
  failMb: number;
  top: number;
  dirs: string[];
}

function parseNumberArg(args: string[], name: string, fallback: number): number {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  const value = Number(args[index + 1]);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} 需要一个正数`);
  }
  return value;
}

function parseOptions(args: string[]): Options {
  const dirs: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--warn-mb' || arg === '--fail-mb' || arg === '--top') {
      i++;
      continue;
    }
    if (arg.startsWith('-')) {
      throw new Error(`未知参数: ${arg}`);
    }
    dirs.push(arg);
  }

  return {
    warnMb: parseNumberArg(args, '--warn-mb', 120),
    failMb: parseNumberArg(args, '--fail-mb', 125),
    top: Math.trunc(parseNumberArg(args, '--top', 10)),
    dirs,
  };
}

function toMb(bytes: number): number {
  return Math.round((bytes / 1024 / 1024) * 100) / 100;
}

function formatMb(bytes: number): string {
  return `${toMb(bytes).toFixed(2)} MB`;
}

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

  return Array.from(new Set(dirs)).filter((dir) => fs.existsSync(path.join(dir, 'package.json')));
}

function runNpmPackDryRun(pkgDir: string): PackResult {
  const result = childProcess.spawnSync('npm', ['pack', '--dry-run', '--json', pkgDir], {
    cwd: rootDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`npm pack --dry-run 失败 (${formatRelative(pkgDir)}): ${result.stderr.trim() || `exit=${result.status}`}`);
  }

  const parsed = JSON.parse(result.stdout.trim()) as PackResult | PackResult[];
  const packResult = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!packResult || typeof packResult.size !== 'number' || typeof packResult.unpackedSize !== 'number') {
    throw new Error(`npm pack 输出格式异常: ${formatRelative(pkgDir)}`);
  }
  return packResult;
}

function printTopFiles(pack: PackResult, top: number): void {
  const files = [...(pack.files ?? [])]
    .filter((file) => typeof file.size === 'number' && file.size > 0)
    .sort((a, b) => b.size - a.size)
    .slice(0, top);

  if (files.length === 0) return;
  console.log(`  Top ${files.length} files:`);
  for (const file of files) {
    console.log(`    ${formatMb(file.size).padStart(10)}  ${file.path}`);
  }
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const packageDirs = normalizePackageDirs(options.dirs);

  if (packageDirs.length === 0) {
    throw new Error('未找到可检查的平台包目录（默认扫描 dist/bin/iris-*，或显式传入目录）');
  }

  let failed = false;
  const warnBytes = options.warnMb * 1024 * 1024;
  const failBytes = options.failMb * 1024 * 1024;

  console.log(`[package-size] warn=${options.warnMb} MB fail=${options.failMb} MB`);
  for (const pkgDir of packageDirs) {
    const pack = runNpmPackDryRun(pkgDir);
    const displayName = pack.name && pack.version ? `${pack.name}@${pack.version}` : formatRelative(pkgDir);
    const status = pack.size >= failBytes ? 'FAIL' : pack.size >= warnBytes ? 'WARN' : 'OK';

    if (status === 'FAIL') failed = true;

    console.log(`\n[${status}] ${displayName}`);
    console.log(`  package:  ${formatMb(pack.size)}`);
    console.log(`  unpacked: ${formatMb(pack.unpackedSize)}`);
    if (typeof pack.entryCount === 'number') {
      console.log(`  files:    ${pack.entryCount}`);
    }
    printTopFiles(pack, options.top);
  }

  if (failed) {
    throw new Error(`平台包超过 ${options.failMb} MB 阈值`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
