#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const sdkDir = path.join(rootDir, 'packages', 'extension-sdk');
const extensionDir = process.cwd();
const extensionPkgPath = path.join(extensionDir, 'package.json');
const targetSdkDir = path.join(extensionDir, 'node_modules', 'irises-extension-sdk');

function latestMtime(targetPath) {
  if (!fs.existsSync(targetPath)) return 0;
  const stat = fs.statSync(targetPath);
  if (stat.isFile()) return stat.mtimeMs;
  let latest = stat.mtimeMs;
  for (const entry of fs.readdirSync(targetPath, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const child = path.join(targetPath, entry.name);
    latest = Math.max(latest, latestMtime(child));
  }
  return latest;
}

function getSdkSourceLatestMtime() {
  return Math.max(
    latestMtime(path.join(sdkDir, 'package.json')),
    latestMtime(path.join(sdkDir, 'tsconfig.json')),
    latestMtime(path.join(sdkDir, 'src')),
  );
}

function getSdkDistLatestMtime() {
  return latestMtime(path.join(sdkDir, 'dist'));
}

function run(command, args, cwd) {
  // Windows 上直接 spawn npm.cmd 在部分 Node 版本会抛 EINVAL；改走 cmd.exe /c 更稳。
  const isWindows = process.platform === 'win32';
  const executable = isWindows ? (process.env.ComSpec || 'cmd.exe') : command;
  const spawnArgs = isWindows
    ? ['/d', '/s', '/c', [command, ...args].map(quoteCmdArg).join(' ')]
    : args;
  const result = spawnSync(executable, spawnArgs, {
    cwd,
    stdio: 'inherit',
    shell: false,
  });
  if (result.error) throw result.error;
  if (typeof result.status === 'number' && result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed (exit=${result.status})`);
  }
}

function quoteCmdArg(value) {
  const text = String(value);
  if (!/[\s&()^|<>"]/.test(text)) return text;
  return `"${text.replace(/"/g, '\\"')}"`;
}

function ensureSdkBuilt() {
  const distIndex = path.join(sdkDir, 'dist', 'index.js');
  const needsBuild = !fs.existsSync(distIndex) || getSdkSourceLatestMtime() > getSdkDistLatestMtime();
  if (!needsBuild) return false;
  console.log('[prepare-extension-sdk] building packages/extension-sdk ...');
  run('npm', ['run', 'build'], sdkDir);
  return true;
}

function syncSdkIntoExtension() {
  const sourceLatest = latestMtime(sdkDir);
  const targetLatest = latestMtime(targetSdkDir);
  if (targetLatest >= sourceLatest && fs.existsSync(path.join(targetSdkDir, 'dist', 'index.js'))) {
    return false;
  }

  fs.rmSync(targetSdkDir, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(targetSdkDir), { recursive: true });
  fs.cpSync(sdkDir, targetSdkDir, { recursive: true, dereference: true });
  return true;
}

function main() {
  if (!fs.existsSync(extensionPkgPath)) {
    console.warn('[prepare-extension-sdk] package.json not found in current directory, skip.');
    return;
  }

  const pkg = JSON.parse(fs.readFileSync(extensionPkgPath, 'utf8'));
  const sdkSpec = pkg?.dependencies?.['irises-extension-sdk'] ?? pkg?.devDependencies?.['irises-extension-sdk'];
  if (typeof sdkSpec !== 'string' || !sdkSpec.startsWith('file:')) {
    return;
  }

  const built = ensureSdkBuilt();
  const synced = syncSdkIntoExtension();
  if (built || synced) {
    const rel = path.relative(rootDir, extensionDir) || '.';
    console.log(`[prepare-extension-sdk] ${rel}: ${built ? 'sdk rebuilt' : 'sdk up-to-date'}, ${synced ? 'local copy synced' : 'local copy up-to-date'}`);
  }
}

main();
