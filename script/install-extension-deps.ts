#!/usr/bin/env node

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { detectExtensionPackageManager, installExtensionDependencies } from '../src/extension/dependencies';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const extensionsDir = path.join(rootDir, 'extensions');
const embeddedConfigPath = path.join(extensionsDir, 'embedded.json');

interface EmbeddedConfig {
  extensions?: Array<{ name?: string }>;
}

function loadEmbeddedExtensionNames(): Set<string> {
  if (!fs.existsSync(embeddedConfigPath)) {
    return new Set<string>();
  }

  const raw = JSON.parse(fs.readFileSync(embeddedConfigPath, 'utf8')) as EmbeddedConfig;
  return new Set(
    (raw.extensions ?? [])
      .map((item) => String(item?.name ?? '').trim())
      .filter(Boolean),
  );
}
function listExtensionDirs(embeddedOnly: boolean): string[] {
  const embeddedNames = loadEmbeddedExtensionNames();
  return fs.readdirSync(extensionsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => !embeddedOnly || embeddedNames.has(name))
    .map((name) => path.join(extensionsDir, name))
    .filter((dir) => fs.existsSync(path.join(dir, 'package.json')))
    .sort((a, b) => a.localeCompare(b));
}

function parseArgs(args: string[]): { embeddedOnly: boolean; frozenLockfile: boolean } {
  return {
    embeddedOnly: args.includes('--embedded-only'),
    frozenLockfile: args.includes('--frozen-lockfile'),
  };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const extensionDirs = listExtensionDirs(options.embeddedOnly);

  if (extensionDirs.length === 0) {
    console.log('未找到需要安装依赖的 extension 目录');
    return;
  }

  console.log(`准备安装 ${extensionDirs.length} 个 extension 的依赖${options.embeddedOnly ? '（仅 embedded）' : ''}...`);

  const failedExtensions: string[] = [];

  for (const extensionDir of extensionDirs) {
    const packageJsonPath = path.join(extensionDir, 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as { name?: string };
    const displayName = packageJson.name || path.basename(extensionDir);
    const manager = detectExtensionPackageManager(extensionDir);
    console.log(`- ${displayName} | manager=${manager.name}${manager.lockfile ? ` | lockfile=${manager.lockfile}` : ''}`);
    try {
      await installExtensionDependencies(extensionDir, {
        frozenLockfile: options.frozenLockfile,
      });
    } catch (error) {
      console.warn(`[警告] Extension "${displayName}" 安装失败，跳过。错误: ${error instanceof Error ? error.message : String(error)}`);
      failedExtensions.push(displayName);
    }
  }

  if (failedExtensions.length > 0) {
    console.log('\n安装完成，但以下 extension 安装失败：');
    failedExtensions.forEach((name) => console.log(`- ${name}`));
    if (failedExtensions.length === extensionDirs.length) {
      process.exit(1);
    }
  } else {
    console.log('extension 依赖安装完成');
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
