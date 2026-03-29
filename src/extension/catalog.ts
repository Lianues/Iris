import * as fs from 'fs';
import * as path from 'path';
import { assertInstallableExtensionPackage } from './dependencies';
import type { ExtensionManifest } from './types';
import { MANIFEST_FILE, readManifestFromDirStrict } from './utils';

const INDEX_FILE = 'index.json';
const LEGACY_CATALOG_FILE = 'catalog.json';
const EXCLUDED_DIRECTORY_NAMES = new Set(['src', 'node_modules', '.git']);
const EXCLUDED_FILE_NAMES = new Set([
  MANIFEST_FILE,
  INDEX_FILE,
  LEGACY_CATALOG_FILE,
  'package-lock.json',
  'npm-shrinkwrap.json',
  'bun.lock',
  'bun.lockb',
  'pnpm-lock.yaml',
  'yarn.lock',
  'tsconfig.json',
]);
const EXCLUDED_FILE_SUFFIXES = ['.tsbuildinfo'];

export interface ExtensionIndex {
  extensions: string[];
}

export interface SyncExtensionMetadataResult {
  index: ExtensionIndex;
  updatedManifestPaths: string[];
  updatedIndexPath: string;
}

function normalizeRelativePath(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
}

function shouldExcludeFile(relativePath: string): boolean {
  const baseName = path.posix.basename(relativePath);
  if (EXCLUDED_FILE_NAMES.has(baseName)) {
    return true;
  }

  return EXCLUDED_FILE_SUFFIXES.some((suffix) => baseName.endsWith(suffix));
}

function collectDistributionFiles(extensionDir: string): string[] {
  const files: string[] = [];
  const stack = [extensionDir];

  while (stack.length > 0) {
    const currentDir = stack.pop()!;
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      const fullPath = path.join(currentDir, entry.name);
      const relativePath = normalizeRelativePath(path.relative(extensionDir, fullPath));

      if (entry.isDirectory()) {
        if (EXCLUDED_DIRECTORY_NAMES.has(entry.name)) {
          continue;
        }
        stack.push(fullPath);
        continue;
      }

      if (shouldExcludeFile(relativePath)) {
        continue;
      }

      files.push(relativePath);
    }
  }

  return files.sort((a, b) => a.localeCompare(b));
}

function discoverExtensionRootDirs(extensionsDir: string): string[] {
  const roots: string[] = [];
  const stack = [extensionsDir];

  while (stack.length > 0) {
    const currentDir = stack.pop()!;
    const manifestPath = path.join(currentDir, MANIFEST_FILE);
    if (currentDir !== extensionsDir && fs.existsSync(manifestPath)) {
      roots.push(currentDir);
      continue;
    }

    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }
      if (EXCLUDED_DIRECTORY_NAMES.has(entry.name)) {
        continue;
      }
      stack.push(path.join(currentDir, entry.name));
    }
  }

  return roots.sort((a, b) => a.localeCompare(b));
}

function stringifyJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function writeFileIfChanged(filePath: string, content: string): boolean {
  const previous = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : undefined;
  if (previous === content) {
    return false;
  }

  fs.writeFileSync(filePath, content, 'utf8');
  return true;
}

export function buildExtensionManifestWithDistribution(extensionDir: string): ExtensionManifest {
  const manifest = readManifestFromDirStrict(extensionDir);
  assertInstallableExtensionPackage(extensionDir, manifest);

  return {
    ...manifest,
    distribution: {
      ...manifest.distribution,
      files: collectDistributionFiles(extensionDir),
    },
  };
}

export function buildExtensionIndex(extensionsDir: string): ExtensionIndex {
  const normalizedExtensionsDir = path.resolve(extensionsDir);
  if (!fs.existsSync(normalizedExtensionsDir) || !fs.statSync(normalizedExtensionsDir).isDirectory()) {
    throw new Error(`extensions 目录不存在: ${normalizedExtensionsDir}`);
  }

  return {
    extensions: discoverExtensionRootDirs(normalizedExtensionsDir)
      .map((rootDir) => normalizeRelativePath(path.relative(normalizedExtensionsDir, rootDir)))
      .sort((a, b) => a.localeCompare(b)),
  };
}

export function syncExtensionMetadata(extensionsDir: string): SyncExtensionMetadataResult {
  const normalizedExtensionsDir = path.resolve(extensionsDir);
  const index = buildExtensionIndex(normalizedExtensionsDir);
  const updatedManifestPaths: string[] = [];

  for (const relativePath of index.extensions) {
    const extensionDir = path.join(normalizedExtensionsDir, relativePath);
    const manifestPath = path.join(extensionDir, MANIFEST_FILE);
    const nextManifest = buildExtensionManifestWithDistribution(extensionDir);
    if (writeFileIfChanged(manifestPath, stringifyJson(nextManifest))) {
      updatedManifestPaths.push(normalizeRelativePath(path.relative(normalizedExtensionsDir, manifestPath)));
    }
  }

  const indexPath = path.join(normalizedExtensionsDir, INDEX_FILE);
  writeFileIfChanged(indexPath, stringifyJson(index));

  const legacyCatalogPath = path.join(normalizedExtensionsDir, LEGACY_CATALOG_FILE);
  if (fs.existsSync(legacyCatalogPath)) {
    fs.rmSync(legacyCatalogPath, { force: true });
  }

  return {
    index,
    updatedManifestPaths,
    updatedIndexPath: normalizeRelativePath(path.relative(normalizedExtensionsDir, indexPath)),
  };
}
