/**
 * 本地 extension 扫描与解析。
 *
 * 当前阶段先不接入 HTTP Registry，只支持：
 * 1. 用户数据目录 ~/.iris/extensions/
 * 2. 源码仓库根目录 ./extensions/
 *
 * 这样可以先把 plugin 与 channel 统一到 extension 概念下，
 * 后续再接入远程下载与多版本管理。
 */

import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { createLogger } from '../logger';
import { extensionsDir, workspaceExtensionsDir } from '../paths';
import type { PlatformFactory, PlatformRegistry } from '../core/platform-registry';
import type {
  ExtensionManifest,
  ExtensionPackage,
  ExtensionPlatformContribution,
  ExtensionPluginContribution,
  ExtensionSource,
  ResolvedLocalPlugin,
} from '@irises/extension-sdk';
import { isDirectory, MANIFEST_FILE, resolveSafeRelativePath } from '@irises/extension-sdk/utils';
import { DISABLED_MARKER_FILE } from '@irises/extension-sdk/utils';

const logger = createLogger('ExtensionRegistry');
const DEFAULT_PLUGIN_ENTRY_CANDIDATES = ['index.ts', 'index.js', 'index.mjs'];

interface ExtensionSearchDirectory {
  dir: string;
  source: ExtensionSource;
}

function getExtensionSearchDirectories(): ExtensionSearchDirectory[] {
  const dirs: ExtensionSearchDirectory[] = [];

  if (isDirectory(extensionsDir)) {
    dirs.push({ dir: extensionsDir, source: 'installed' });
  }

  if (workspaceExtensionsDir !== extensionsDir && isDirectory(workspaceExtensionsDir)) {
    dirs.push({ dir: workspaceExtensionsDir, source: 'workspace' });
  }

  return dirs;
}

function resolveOptionalFile(rootDir: string, relativePath: string | undefined, strict = false): string | undefined {
  if (!relativePath || !relativePath.trim()) return undefined;

  const resolvedPath = resolveSafeRelativePath(rootDir, relativePath.trim());
  if (!fs.existsSync(resolvedPath)) {
    if (strict) {
      throw new Error(`文件不存在: ${resolvedPath}`);
    }
    return undefined;
  }

  return resolvedPath;
}

function resolvePluginEntryFile(rootDir: string, contribution?: ExtensionPluginContribution): string | undefined {
  const explicitEntry = contribution?.entry?.trim();
  if (explicitEntry) {
    return resolveOptionalFile(rootDir, explicitEntry, true);
  }

  for (const candidate of DEFAULT_PLUGIN_ENTRY_CANDIDATES) {
    const candidatePath = path.join(rootDir, candidate);
    if (fs.existsSync(candidatePath)) {
      return candidatePath;
    }
  }

  return undefined;
}

function readExtensionManifest(rootDir: string): ExtensionManifest | undefined {
  const manifestPath = path.join(rootDir, MANIFEST_FILE);
  if (!fs.existsSync(manifestPath)) return undefined;

  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  } catch (err) {
    logger.warn(`extension manifest 解析失败: ${manifestPath}`, err);
    return undefined;
  }

  if (!raw || typeof raw !== 'object') {
    logger.warn(`extension manifest 格式无效，应为对象: ${manifestPath}`);
    return undefined;
  }

  const manifest = raw as Record<string, unknown>;
  if (typeof manifest.name !== 'string' || !manifest.name.trim()) {
    logger.warn(`extension manifest 缺少 name: ${manifestPath}`);
    return undefined;
  }
  if (typeof manifest.version !== 'string' || !manifest.version.trim()) {
    logger.warn(`extension manifest 缺少 version: ${manifestPath}`);
    return undefined;
  }

  return manifest as unknown as ExtensionManifest;
}

function isDisabledExtension(rootDir: string): boolean {
  return fs.existsSync(path.join(rootDir, DISABLED_MARKER_FILE));
}

function normalizePluginContribution(manifest: ExtensionManifest): ExtensionPluginContribution | undefined {
  if (manifest.plugin && typeof manifest.plugin === 'object') {
    return manifest.plugin;
  }

  if (typeof manifest.entry === 'string' && manifest.entry.trim()) {
    return { entry: manifest.entry.trim() };
  }

  const hasPlatforms = Array.isArray(manifest.platforms) && manifest.platforms.length > 0;
  if (!hasPlatforms) {
    return {};
  }

  return undefined;
}

function getPlatformContributions(manifest: ExtensionManifest): ExtensionPlatformContribution[] {
  if (!Array.isArray(manifest.platforms)) return [];
  return manifest.platforms.filter((item): item is ExtensionPlatformContribution => {
    return !!item && typeof item === 'object' && typeof item.name === 'string' && typeof item.entry === 'string';
  });
}

function resolvePlatformFactoryExport(
  mod: Record<string, unknown>,
  contribution: ExtensionPlatformContribution,
  extensionName: string,
): PlatformFactory {
  const exportName = contribution.exportName?.trim();
  const candidate = exportName
    ? mod[exportName]
    : mod.default ?? mod.factory ?? mod.platform ?? mod;

  if (typeof candidate !== 'function') {
    throw new Error(`extension "${extensionName}" 的平台 "${contribution.name}" 未导出有效工厂函数`);
  }

  return candidate as PlatformFactory;
}

export function discoverLocalExtensions(): ExtensionPackage[] {
  const packages: ExtensionPackage[] = [];
  const seenNames = new Set<string>();

  for (const searchDir of getExtensionSearchDirectories()) {
    const entries = fs.readdirSync(searchDir.dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const rootDir = path.join(searchDir.dir, entry.name);
      const manifest = readExtensionManifest(rootDir);
      if (!manifest) continue;

      if (isDisabledExtension(rootDir)) {
        if (!seenNames.has(manifest.name)) {
          seenNames.add(manifest.name);
        }
        logger.info(`extension "${manifest.name}" 已被禁用，跳过加载: ${rootDir}`);
        continue;
      }

      if (manifest.name !== entry.name) {
        logger.warn(`extension 目录名与 manifest.name 不一致，已按 manifest.name 处理: ${rootDir}`);
      }

      if (seenNames.has(manifest.name)) {
        logger.warn(`检测到重名 extension "${manifest.name}"，已跳过后出现的目录: ${rootDir}`);
        continue;
      }

      seenNames.add(manifest.name);
      packages.push({
        manifest,
        rootDir,
        source: searchDir.source,
      });
    }
  }

  return packages;
}

export function resolveLocalPluginSource(
  name: string,
  extensionPackages: ExtensionPackage[] = discoverLocalExtensions(),
): ResolvedLocalPlugin {
  const extensionPackage = extensionPackages.find((item) => item.manifest.name === name);
  if (!extensionPackage) {
    throw new Error(`未找到本地 extension: ${name}`);
  }

  const pluginContribution = normalizePluginContribution(extensionPackage.manifest);
  if (!pluginContribution) {
    throw new Error(`extension "${name}" 未声明插件入口`);
  }

  const entryFile = resolvePluginEntryFile(extensionPackage.rootDir, pluginContribution);
  if (!entryFile) {
    throw new Error(`extension "${name}" 缺少插件入口文件`);
  }

  const configPath = pluginContribution.configFile?.trim()
    ? resolveOptionalFile(extensionPackage.rootDir, pluginContribution.configFile, true)
    : resolveOptionalFile(extensionPackage.rootDir, 'config.yaml');

  return {
    type: 'extension-plugin',
    name: extensionPackage.manifest.name,
    rootDir: extensionPackage.rootDir,
    entryFile,
    configPath,
    extensionPackage,
  };
}

export async function importLocalExtensionModule(entryFile: string): Promise<Record<string, unknown>> {
  const moduleUrl = pathToFileURL(entryFile).href;
  return await import(moduleUrl) as Record<string, unknown>;
}

export function registerExtensionPlatforms(
  registry: PlatformRegistry,
  extensionPackages: ExtensionPackage[] = discoverLocalExtensions(),
): string[] {
  const registeredPlatforms: string[] = [];

  for (const extensionPackage of extensionPackages) {
    const contributions = getPlatformContributions(extensionPackage.manifest);
    for (const contribution of contributions) {
      if (!contribution.name.trim()) continue;

      if (registry.has(contribution.name)) {
        logger.warn(`平台 "${contribution.name}" 已存在，跳过 extension "${extensionPackage.manifest.name}" 的同名贡献`);
        continue;
      }

      let entryFile: string;
      try {
        entryFile = resolveOptionalFile(extensionPackage.rootDir, contribution.entry, true)!;
      } catch (err) {
        logger.error(`extension "${extensionPackage.manifest.name}" 的平台入口无效:`, err);
        continue;
      }

      registry.register(contribution.name, async (context) => {
        const mod = await importLocalExtensionModule(entryFile);
        const factory = resolvePlatformFactoryExport(mod, contribution, extensionPackage.manifest.name);
        return await factory(context);
      });
      registeredPlatforms.push(contribution.name);
    }
  }

  return registeredPlatforms;
}
