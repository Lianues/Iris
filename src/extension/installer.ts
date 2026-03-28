import * as fs from 'fs';
import * as path from 'path';
import JSZip from 'jszip';
import { createLogger } from '../logger';
import { extensionsDir as defaultInstalledExtensionsDir, workspaceExtensionsDir as defaultLocalExtensionsDir } from '../paths';
import type {
  ExtensionManifest,
  ExtensionInstallFallbackReason,
  InstalledExtensionResult,
} from './types';

const logger = createLogger('ExtensionInstaller');
const DEFAULT_REMOTE_EXTENSION_ARCHIVE_URL = 'https://codeload.github.com/lianues/Iris/zip/refs/heads/main';
const DEFAULT_REMOTE_EXTENSION_ARCHIVE_ROOT_DIR = 'Iris-main';
const DEFAULT_REMOTE_EXTENSIONS_SUBDIR = 'extensions';
const MANIFEST_FILE = 'manifest.json';

export interface ExtensionInstallOptions {
  remoteArchiveUrl?: string;
  remoteArchiveRootDir?: string;
  remoteExtensionsSubdir?: string;
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

function normalizeRelativeFilePath(input: string, label = '文件路径'): string {
  const normalized = input.trim().replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
  if (!normalized) {
    throw new Error(`${label}不能为空`);
  }

  const parts = normalized.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) {
    throw new Error(`${label}无效: ${input}`);
  }

  return parts.join('/');
}

function getRemoteArchiveRootDir(options?: ExtensionInstallOptions): string {
  const configured = options?.remoteArchiveRootDir?.trim() || process.env.IRIS_EXTENSION_REMOTE_ARCHIVE_ROOT_DIR?.trim();
  return normalizeRelativeFilePath(configured || DEFAULT_REMOTE_EXTENSION_ARCHIVE_ROOT_DIR, '远程压缩包根目录');
}

function getRemoteExtensionsSubdir(options?: ExtensionInstallOptions): string {
  const configured = options?.remoteExtensionsSubdir?.trim() || process.env.IRIS_EXTENSION_REMOTE_SUBDIR?.trim();
  return normalizeRelativeFilePath(configured || DEFAULT_REMOTE_EXTENSIONS_SUBDIR, '远程 extension 根目录');
}

export function getRemoteExtensionArchiveUrl(options?: ExtensionInstallOptions): string {
  const configured = options?.remoteArchiveUrl?.trim() || process.env.IRIS_EXTENSION_REMOTE_ARCHIVE_URL?.trim();
  return configured || DEFAULT_REMOTE_EXTENSION_ARCHIVE_URL;
}

function ensureNonEmptyRequested(requested: string, label: string): string {
  const trimmed = requested.trim();
  if (!trimmed) {
    throw new Error(`${label}不能为空`);
  }
  return trimmed;
}

function normalizeRequestedExtensionPath(requested: string, label: string): string {
  let normalized = ensureNonEmptyRequested(requested, label).replace(/\\/g, '/').trim();
  normalized = normalized.replace(/^\.\//, '').replace(/^\/+/, '');
  if (normalized === 'extensions' || normalized === 'extensions/') {
    throw new Error(`${label}不能为空`);
  }

  if (normalized.startsWith('extensions/')) {
    normalized = normalized.slice('extensions/'.length);
  }
  return normalizeRelativeFilePath(normalized, label);
}

function isDirectory(dirPath: string): boolean {
  try {
    return fs.statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}

function resolveSafeRelativePath(rootDir: string, relativePath: string): string {
  const normalizedRoot = path.resolve(rootDir);
  const resolvedPath = path.resolve(normalizedRoot, relativePath);
  const rel = path.relative(normalizedRoot, resolvedPath);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`路径越界: ${relativePath}`);
  }
  return resolvedPath;
}

function ensureDirectory(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

function createTempInstallDir(installedRootDir: string): string {
  ensureDirectory(installedRootDir);
  const tempDir = path.join(
    installedRootDir,
    `.tmp-install-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  fs.mkdirSync(tempDir, { recursive: true });
  return tempDir;
}

function cleanupTempInstallDir(tempDir: string): void {
  if (fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function finalizeInstall(
  tempDir: string,
  manifest: ExtensionManifest,
  requested: string,
  source: 'remote' | 'local',
  extras: {
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
    remotePath: extras.remotePath,
    sourceDir: extras.sourceDir,
    fallbackReason: extras.fallbackReason,
    fallbackDetail: extras.fallbackDetail,
  };
}

function parseExtensionManifest(raw: unknown, sourceLabel: string): ExtensionManifest {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`extension manifest 格式无效，应为对象: ${sourceLabel}`);
  }
  const manifest = raw as Record<string, unknown>;
  if (typeof manifest.name !== 'string' || !manifest.name.trim()) {
    throw new Error(`extension manifest 缺少 name: ${sourceLabel}`);
  }
  if (typeof manifest.version !== 'string' || !manifest.version.trim()) {
    throw new Error(`extension manifest 缺少 version: ${sourceLabel}`);
  }
  return manifest as unknown as ExtensionManifest;
}

function readManifestFromDir(rootDir: string): ExtensionManifest | undefined {
  const manifestPath = path.join(rootDir, MANIFEST_FILE);
  if (!fs.existsSync(manifestPath)) return undefined;
  try {
    const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    return parseExtensionManifest(raw, manifestPath);
  } catch (err) {
    logger.warn(`extension manifest 读取失败: ${manifestPath}`, err);
    return undefined;
  }
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

async function fetchBuffer(url: string, label: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${label} 下载失败 (${response.status} ${response.statusText}): ${url}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

function buildRemoteExtensionPath(requested: string, options?: ExtensionInstallOptions): string {
  return `${getRemoteExtensionsSubdir(options)}/${requested}`;
}

function buildRemoteArchivePrefix(requested: string, options?: ExtensionInstallOptions): string {
  return [
    getRemoteArchiveRootDir(options),
    buildRemoteExtensionPath(requested, options),
  ].join('/');
}

function normalizeZipEntryName(name: string): string {
  return name.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
}

function stripArchivePrefix(entryName: string, rootPrefix: string): string | undefined {
  const normalizedEntry = normalizeZipEntryName(entryName);
  const normalizedRoot = normalizeZipEntryName(rootPrefix);

  if (normalizedEntry === normalizedRoot) return '';
  if (normalizedEntry.startsWith(`${normalizedRoot}/`)) {
    return normalizedEntry.slice(normalizedRoot.length + 1);
  }

  const marker = `/${normalizedRoot}/`;
  const markerIndex = normalizedEntry.indexOf(marker);
  if (markerIndex >= 0) {
    return normalizedEntry.slice(markerIndex + marker.length);
  }

  return undefined;
}

async function loadRemoteArchive(options?: ExtensionInstallOptions): Promise<JSZip> {
  const archiveUrl = getRemoteExtensionArchiveUrl(options);
  try {
    const archiveBuffer = await fetchBuffer(archiveUrl, 'extension 远程仓库压缩包');
    return await JSZip.loadAsync(archiveBuffer);
  } catch (err) {
    throw new RemoteInstallError(
      'remote_source_unavailable',
      err instanceof Error ? err.message : String(err),
    );
  }
}

async function installRemoteExtension(
  requestedPath: string,
  options?: ExtensionInstallOptions,
): Promise<InstalledExtensionResult> {
  const requested = normalizeRequestedExtensionPath(requestedPath, 'extension 路径');
  const remotePath = buildRemoteExtensionPath(requested, options);
  const archivePrefix = buildRemoteArchivePrefix(requested, options);
  const installedRootDir = getInstalledExtensionsDir(options);
  const tempDir = createTempInstallDir(installedRootDir);

  try {
    const zip = await loadRemoteArchive(options);
    const fileEntries = Object.values(zip.files).filter((file) => !file.dir);
    let extractedCount = 0;

    for (const fileEntry of fileEntries) {
      const relativePath = stripArchivePrefix(fileEntry.name, archivePrefix);
      if (!relativePath) continue;

      const normalizedRelativePath = normalizeRelativeFilePath(relativePath);
      const destination = resolveSafeRelativePath(tempDir, normalizedRelativePath);
      ensureDirectory(path.dirname(destination));
      const content = await fileEntry.async('nodebuffer');
      fs.writeFileSync(destination, content);
      extractedCount += 1;
    }

    if (extractedCount === 0) {
      throw new RemoteInstallError('remote_path_not_found', `远程 extension 目录不存在: ${remotePath}`);
    }

    const manifest = readManifestFromDir(tempDir);
    if (!manifest) {
      throw new RemoteInstallError('remote_path_not_found', `远程 extension 目录缺少 manifest.json: ${remotePath}`);
    }

    return finalizeInstall(tempDir, manifest, requested, 'remote', {
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
    fs.cpSync(source.rootDir, tempDir, { recursive: true });
    const manifest = readManifestFromDir(tempDir);
    if (!manifest) {
      throw new Error(`本地 extension 缺少有效 manifest.json: ${source.rootDir}`);
    }

    return finalizeInstall(tempDir, manifest, requested, 'local', {
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
    return await installRemoteExtension(requested, options);
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
