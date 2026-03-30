import * as fs from 'fs';
import * as path from 'path';
import { createLogger } from '../logger';
import { extensionsDir as defaultInstalledExtensionsDir, workspaceExtensionsDir as defaultLocalExtensionsDir } from '../paths';
import { assertInstallableExtensionPackage, copyExtensionDirectory } from './dependencies';
import type {
  ExtensionManifest,
  ExtensionDistributionMode,
  ExtensionInstallFallbackReason,
  InstalledExtensionResult,
} from '@irises/extension-sdk';
import { readManifestFromDir } from './utils';
import {
  normalizeRelativeFilePath,
  normalizeRequestedExtensionPath,
  resolveSafeRelativePath,
  isDirectory,
  ensureDirectory,
  createTempInstallDir,
  cleanupTempInstallDir,
  MANIFEST_FILE,
  fetchBuffer,
  fetchJson,
  fetchRemoteIndex,
  fetchRemoteManifest,
  buildRemoteExtensionPath,
  getRemoteDistributionFiles,
  buildRemoteExtensionFileUrl,
  getRemoteExtensionIndexUrl as getRemoteExtensionIndexUrlShared,
  type RemoteExtensionOptions,
} from '@irises/extension-sdk/utils';

const logger = createLogger('ExtensionInstaller');

export interface ExtensionInstallOptions extends RemoteExtensionOptions {
  installedExtensionsDir?: string;
  localExtensionsDir?: string;
}

interface LocalExtensionSource {
  manifest: ExtensionManifest;
  rootDir: string;
}

type RemoteInstallFailureKind = 'remote_source_unavailable' | ExtensionInstallFallbackReason;

class RemoteInstallError extends Error {
  constructor(
    readonly kind: RemoteInstallFailureKind,
    message: string,
  ) {
    super(message);
    this.name = 'RemoteInstallError';
  }
}

function getInstalledExtensionsDir(options?: ExtensionInstallOptions): string {
  return path.resolve(options?.installedExtensionsDir || defaultInstalledExtensionsDir);
}

function getLocalExtensionsDir(options?: ExtensionInstallOptions): string {
  return path.resolve(options?.localExtensionsDir || defaultLocalExtensionsDir);
}

export function getRemoteExtensionIndexUrl(options?: ExtensionInstallOptions): string {
  return getRemoteExtensionIndexUrlShared(options);
}

function finalizeInstall(
  tempDir: string,
  manifest: ExtensionManifest,
  requested: string,
  source: 'remote' | 'local',
  extras: {
    distributionMode?: ExtensionDistributionMode;
    remotePath?: string;
    sourceDir?: string;
    fallbackReason?: ExtensionInstallFallbackReason;
    fallbackDetail?: string;
  },
  installedRootDir: string,
): InstalledExtensionResult {
  const targetDir = path.join(installedRootDir, manifest.name);
  fs.rmSync(targetDir, { recursive: true, force: true });
  fs.renameSync(tempDir, targetDir);

  return {
    source,
    requested,
    name: manifest.name,
    version: manifest.version,
    targetDir,
    distributionMode: extras.distributionMode,
    remotePath: extras.remotePath,
    sourceDir: extras.sourceDir,
    fallbackReason: extras.fallbackReason,
    fallbackDetail: extras.fallbackDetail,
  };
}

function isPathLike(requested: string): boolean {
  return requested.includes('/') || requested.includes('\\') || requested.startsWith('.');
}

function resolveLocalSourceByRelativePath(requested: string, localExtensionsDir: string): LocalExtensionSource | undefined {
  if (!isPathLike(requested) || path.isAbsolute(requested)) return undefined;
  try {
    const candidateDir = resolveSafeRelativePath(localExtensionsDir, requested);
    if (!isDirectory(candidateDir)) return undefined;
    const manifest = readManifestFromDir(candidateDir);
    if (!manifest) return undefined;
    return { manifest, rootDir: candidateDir };
  } catch {
    return undefined;
  }
}

function findLocalExtensionSource(requested: string, localExtensionsDir: string): LocalExtensionSource | undefined {
  if (!isDirectory(localExtensionsDir)) return undefined;

  const directSource = resolveLocalSourceByRelativePath(requested, localExtensionsDir);
  if (directSource) return directSource;

  for (const entry of fs.readdirSync(localExtensionsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const rootDir = path.join(localExtensionsDir, entry.name);
    const manifest = readManifestFromDir(rootDir);
    if (!manifest) continue;
    if (entry.name === requested || manifest.name === requested) {
      return { manifest, rootDir };
    }
  }

  return undefined;
}

async function installRemoteExtensionFromIndex(
  requestedPath: string,
  options?: ExtensionInstallOptions,
): Promise<InstalledExtensionResult> {
  const requested = normalizeRequestedExtensionPath(requestedPath, 'extension 路径');
  const remotePath = buildRemoteExtensionPath(requested, options);
  const installedRootDir = getInstalledExtensionsDir(options);
  const tempDir = createTempInstallDir(installedRootDir);

  try {
    let remoteIndex: string[];
    try {
      remoteIndex = await fetchRemoteIndex(options);
    } catch (err) {
      throw new RemoteInstallError(
        'remote_source_unavailable',
        err instanceof Error ? err.message : String(err),
      );
    }

    if (!remoteIndex.includes(requested)) {
      throw new RemoteInstallError('remote_path_not_found', `远程 extension 目录不存在: ${remotePath}`);
    }

    const manifest = await fetchRemoteManifest(requested, options) as ExtensionManifest;
    const files = getRemoteDistributionFiles(manifest);

    ensureDirectory(tempDir);
    fs.writeFileSync(
      path.join(tempDir, MANIFEST_FILE),
      `${JSON.stringify(manifest, null, 2)}\n`,
      'utf8',
    );

    for (const relativePath of files) {
      const normalizedRelativePath = normalizeRelativeFilePath(relativePath);
      if (normalizedRelativePath === MANIFEST_FILE) continue;
      const destination = resolveSafeRelativePath(tempDir, normalizedRelativePath);
      ensureDirectory(path.dirname(destination));
      fs.writeFileSync(destination, await fetchBuffer(buildRemoteExtensionFileUrl(requested, normalizedRelativePath, options), 'extension 文件'));
    }

    const installedManifest = readManifestFromDir(tempDir);
    if (!installedManifest) {
      throw new RemoteInstallError('remote_path_not_found', `远程 extension 目录缺少 manifest.json: ${remotePath}`);
    }

    const validated = assertInstallableExtensionPackage(tempDir, installedManifest);
    return finalizeInstall(tempDir, installedManifest, requested, 'remote', {
      distributionMode: validated.distributionMode,
      remotePath,
    }, installedRootDir);
  } catch (err) {
    cleanupTempInstallDir(tempDir);
    throw err;
  }
}

export async function installLocalExtension(
  requestedName: string,
  options?: ExtensionInstallOptions,
): Promise<InstalledExtensionResult> {
  const requested = normalizeRequestedExtensionPath(requestedName, 'extension 名称或路径');
  const localExtensionsDir = getLocalExtensionsDir(options);
  const installedRootDir = getInstalledExtensionsDir(options);
  const source = findLocalExtensionSource(requested, localExtensionsDir);

  if (!source) {
    throw new Error(`本地 extension 目录中未找到: ${requested}`);
  }

  const tempDir = createTempInstallDir(installedRootDir);
  try {
    copyExtensionDirectory(source.rootDir, tempDir);
    const manifest = readManifestFromDir(tempDir);
    if (!manifest) {
      throw new Error(`本地 extension 缺少有效 manifest.json: ${source.rootDir}`);
    }

    const validated = assertInstallableExtensionPackage(tempDir, manifest);

    return finalizeInstall(tempDir, manifest, requested, 'local', {
      distributionMode: validated.distributionMode,
      sourceDir: source.rootDir,
    }, installedRootDir);
  } catch (err) {
    cleanupTempInstallDir(tempDir);
    throw err;
  }
}

export async function installExtension(
  requestedPath: string,
  options?: ExtensionInstallOptions,
): Promise<InstalledExtensionResult> {
  const requested = normalizeRequestedExtensionPath(requestedPath, 'extension 路径');

  try {
    return await installRemoteExtensionFromIndex(requested, options);
  } catch (err) {
    if (!(err instanceof RemoteInstallError)) {
      throw err;
    }

    if (err.kind === 'remote_source_unavailable') {
      throw new Error(`远程 extension 仓库不可用: ${err.message}`);
    }

    try {
      const localInstalled = await installLocalExtension(requested, options);
      return {
        ...localInstalled,
        fallbackReason: err.kind,
        fallbackDetail: err.message,
      };
    } catch (localErr) {
      const localMessage = localErr instanceof Error ? localErr.message : String(localErr);
      throw new Error(`远程 extension 目录不存在，且本地安装也失败：${err.message}；${localMessage}`);
    }
  }
}
