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
} from './types';
import { isDirectory, MANIFEST_FILE, parseExtensionManifest, readManifestFromDir, resolveSafeRelativePath } from './utils';

const logger = createLogger('ExtensionInstaller');
const DEFAULT_REMOTE_EXTENSION_INDEX_URL = 'https://raw.githubusercontent.com/Lianues/Iris/main/extensions/index.json';
const DEFAULT_REMOTE_EXTENSION_RAW_BASE_URL = 'https://raw.githubusercontent.com/Lianues/Iris/main';
const DEFAULT_REMOTE_EXTENSIONS_SUBDIR = 'extensions';

interface RemoteIndexLike {
  extensions?: string[];
}

export interface ExtensionInstallOptions {
  remoteIndexUrl?: string;
  remoteRawBaseUrl?: string;
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

function getRemoteExtensionsSubdir(options?: ExtensionInstallOptions): string {
  const configured = options?.remoteExtensionsSubdir?.trim() || process.env.IRIS_EXTENSION_REMOTE_SUBDIR?.trim();
  return normalizeRelativeFilePath(configured || DEFAULT_REMOTE_EXTENSIONS_SUBDIR, '远程 extension 根目录');
}

export function getRemoteExtensionIndexUrl(options?: ExtensionInstallOptions): string {
  const configured = options?.remoteIndexUrl?.trim() || process.env.IRIS_EXTENSION_REMOTE_INDEX_URL?.trim();
  return configured || DEFAULT_REMOTE_EXTENSION_INDEX_URL;
}

function getRemoteRawBaseUrl(options?: ExtensionInstallOptions): string {
  const configured = options?.remoteRawBaseUrl?.trim() || process.env.IRIS_EXTENSION_REMOTE_RAW_BASE_URL?.trim();
  return configured || DEFAULT_REMOTE_EXTENSION_RAW_BASE_URL;
}

function encodeRepoPathForUrl(repoPath: string): string {
  return repoPath.split('/').map((part) => encodeURIComponent(part)).join('/');
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

async function fetchBuffer(url: string, label: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${label} 下载失败 (${response.status} ${response.statusText}): ${url}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function fetchJson<T>(url: string, label: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${label} 读取失败 (${response.status} ${response.statusText}): ${url}`);
  }
  return await response.json() as T;
}

async function fetchRemoteIndex(options?: ExtensionInstallOptions): Promise<string[]> {
  const raw = await fetchJson<RemoteIndexLike>(getRemoteExtensionIndexUrl(options), '远程 extension 索引');
  if (!Array.isArray(raw.extensions)) {
    throw new Error('远程 extension 索引返回格式无效');
  }

  return raw.extensions.map((entry) => normalizeRequestedExtensionPath(String(entry), '远程 extension 路径'));
}

function buildRemoteExtensionPath(requested: string, options?: ExtensionInstallOptions): string {
  return `${getRemoteExtensionsSubdir(options)}/${requested}`;
}

function getRemoteDistributionFiles(manifest: ExtensionManifest): string[] {
  return Array.isArray(manifest.distribution?.files)
    ? manifest.distribution.files.map((file) => normalizeRelativeFilePath(String(file), '远程 extension 文件路径'))
    : [];
}

function buildRemoteExtensionFileUrl(requestedPath: string, relativePath: string, options?: ExtensionInstallOptions): string {
  const repoPath = `${buildRemoteExtensionPath(requestedPath, options)}/${relativePath}`;
  return `${getRemoteRawBaseUrl(options)}/${encodeRepoPathForUrl(repoPath)}`;
}

async function fetchRemoteManifest(requestedPath: string, options?: ExtensionInstallOptions): Promise<ExtensionManifest> {
  const manifestUrl = buildRemoteExtensionFileUrl(requestedPath, MANIFEST_FILE, options);
  const raw = await fetchJson<unknown>(manifestUrl, 'extension manifest');
  return parseExtensionManifest(raw, `${buildRemoteExtensionPath(requestedPath, options)}/${MANIFEST_FILE}`);
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

    const manifest = await fetchRemoteManifest(requested, options);
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
