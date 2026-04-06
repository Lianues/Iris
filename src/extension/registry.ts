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
import { extensionsDir, workspaceExtensionsDir, projectRoot, isCompiledBinary } from '../paths';
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

const DEV_SOURCE_ENTRY = 'src/index.ts';

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

function resolveDevSourceEntryFile(rootDir: string): string | undefined {
  const devEntry = path.join(rootDir, DEV_SOURCE_ENTRY);
  return fs.existsSync(devEntry) ? devEntry : undefined;
}

function resolvePluginEntryFile(rootDir: string, contribution?: ExtensionPluginContribution, useDevSource = false): string | undefined {
  if (useDevSource) {
    const devEntry = resolveDevSourceEntryFile(rootDir);
    if (devEntry) return devEntry;
    logger.warn(`[DevSource] 源码入口 ${DEV_SOURCE_ENTRY} 不存在，回退到默认解析: ${rootDir}`);
  }

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
  devSourceExtensions?: string[],
): ResolvedLocalPlugin {
  const extensionPackage = extensionPackages.find((item) => item.manifest.name === name);
  if (!extensionPackage) {
    throw new Error(`未找到本地 extension: ${name}`);
  }

  const pluginContribution = normalizePluginContribution(extensionPackage.manifest);
  if (!pluginContribution) {
    throw new Error(`extension "${name}" 未声明插件入口`);
  }

  const useDevSource = devSourceExtensions?.includes(name) ?? false;
  const entryFile = resolvePluginEntryFile(extensionPackage.rootDir, pluginContribution, useDevSource);
  if (useDevSource && entryFile) logger.info(`[DevSource] 插件 "${name}" 使用源码入口: ${entryFile}`);

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
  devSourceExtensions?: string[],
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

      const useDevSource = devSourceExtensions?.includes(extensionPackage.manifest.name) ?? false;
      let entryFile: string | undefined;

      if (useDevSource) {
        entryFile = resolveDevSourceEntryFile(extensionPackage.rootDir);
        if (entryFile) {
          logger.info(`[DevSource] 平台 "${contribution.name}" (extension "${extensionPackage.manifest.name}") 使用源码入口: ${entryFile}`);
        } else {
          logger.warn(`[DevSource] extension "${extensionPackage.manifest.name}" 源码入口 ${DEV_SOURCE_ENTRY} 不存在，回退到 manifest 入口`);
        }
      }

      if (!entryFile) {
        try {
          entryFile = resolveOptionalFile(extensionPackage.rootDir, contribution.entry, true)!;
        } catch (err) {
          logger.error(`extension "${extensionPackage.manifest.name}" 的平台入口无效:`, err);
          continue;
        }
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

// ============ DevSource SDK shim ============

/**
 * SDK dist/ 中每个 exports 入口对应的 shim 映射。
 *
 * 正常模式下，扩展的 dist/index.mjs 在构建时已将 SDK 打包在内（非 external），
 * 运行时不需要解析 SDK 的 dist/。
 * 但 DevSource 模式直接加载扩展源码，源码中的 `import '@irises/extension-sdk'`
 * 会通过 node_modules 解析到 packages/extension-sdk/dist/index.js。
 * 如果 SDK 未编译（dist/ 不存在），就会报错。
 *
 * 本函数在 dist/ 中生成轻量 shim 文件，将入口重定向到 src/ 源码，
 * 由 tsx / bun 运行时负责 TypeScript 转译，无需预先编译 SDK。
 */
const DEV_SOURCE_SHIM_MARKER = '// @dev-source-shim';

const SDK_DIST_SHIMS: { dist: string; src: string }[] = [
  { dist: 'index.js',          src: '../src/index.ts' },
  { dist: 'plugin.js',         src: '../src/plugin.ts' },
  { dist: 'tool-utils.js',     src: '../src/tool-utils.ts' },
  { dist: 'pairing/index.js',  src: '../../src/pairing/index.ts' },
  { dist: 'utils/index.js',    src: '../../src/utils/index.ts' },
  { dist: 'plugin/index.js',   src: '../../src/plugin/index.ts' },
];

/**
 * 确保 @irises/extension-sdk 的 dist/ 包含指向源码的 shim。
 *
 * 在 DevSource + devSourceSdk 模式下调用。
 * 生成的 shim 文件以 `// @dev-source-shim` 开头作为标记，
 * 后续 `npm run build:extension-sdk`（tsc）会用真正的编译产物覆盖它们。
 */
export function ensureDevSourceSdkShims(): void {
  if (isCompiledBinary) return;

  const sdkDir = path.join(projectRoot, 'packages', 'extension-sdk');
  if (!isDirectory(sdkDir)) {
    logger.warn('[DevSource] packages/extension-sdk 目录不存在，跳过 SDK shim 生成');
    return;
  }

  const distDir = path.join(sdkDir, 'dist');
  let shimCount = 0;

  for (const { dist, src } of SDK_DIST_SHIMS) {
    const distFile = path.join(distDir, dist);
    const shimContent = `${DEV_SOURCE_SHIM_MARKER}\nexport * from '${src}';\n`;

    // 已存在且内容相同 → 跳过
    if (fs.existsSync(distFile)) {
      try {
        if (fs.readFileSync(distFile, 'utf-8') === shimContent) continue;
      } catch { /* 读取失败则重写 */ }
    }

    fs.mkdirSync(path.dirname(distFile), { recursive: true });
    fs.writeFileSync(distFile, shimContent, 'utf-8');
    shimCount++;
  }

  if (shimCount > 0) {
    logger.info(`[DevSource] 已为 @irises/extension-sdk 生成 ${shimCount} 个源码 shim（dist/ → src/）`);
  }
}
