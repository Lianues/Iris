/**
 * 本地 extension 扫描与解析。
 *
 * 扩展有四类加载源（按发现优先级降序，同名取最先发现的，后续重名跳过）：
 *   - agent-installed：~/.iris/agents/<id>/extensions/<name>                 —— 当前 agent 上下文专属安装，仅在 opts.agentExtensionsDir 提供时纳入；
 *                                                                              优先级最高，可就近覆盖同名的 installed/embedded。
 *   - installed：~/.iris/extensions/<name>                                   —— 用户通过 `iris extension install*` 主动安装到全局，始终参与发现。
 *   - embedded： <projectRoot>/extensions/<name>，且 name ∈ embedded.json    —— 随发行包/源码仓库内置（构建时被打包进发行产物），始终参与发现；
 *                                                                              在 ~/.iris/extensions/ 出现同名 installed 时 installed 优先。
 *   - workspace：<projectRoot>/extensions/<name>，且 name ∉ embedded.json    —— 源码仓库里"额外"的扩展（开发态可见），默认 **不参与发现**；
 *                                                                              需 system.yaml 中 `extensions.loadWorkspaceExtensions: true` 才会扫描，
 *                                                                              并可用 `workspaceAllowlist` 进一步收窄。
 *
 * 调用方通过 `ExtensionDiscoveryOptions` 传入开关与白名单：
 *   - `agentExtensionsDir`：当前 agent 的扩展目录绝对路径；不传则不纳入 agent-installed 源。
 *   - `workspace.enabled`：是否纳入 workspace 源；默认 false。
 *   - `workspace.allowlist`：纳入后再按名收窄；空数组 = 不收窄。
 *
 * 与 devSourceExtensions 正交：本文件决定一个扩展"是否被发现"；
 * devSourceExtensions 决定被发现后"用 dist 还是 src 入口"（对四类源都一视同仁）。
 *
 * 启用/禁用单个扩展请通过 plugins.yaml（全局或 agent 层），与本文件的"发现范围"控制正交。
 */

import type { PluginEntry } from 'irises-extension-sdk';

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
} from 'irises-extension-sdk';
import {
  getMissingExtensionRuntimeDependencies,
  isDirectory,
  MANIFEST_FILE,
  resolveSafeRelativePath,
} from 'irises-extension-sdk/utils';
import { DISABLED_MARKER_FILE } from 'irises-extension-sdk/utils';

const logger = createLogger('ExtensionRegistry');
const DEFAULT_PLUGIN_ENTRY_CANDIDATES = ['index.ts', 'index.js', 'index.mjs'];

const DEV_SOURCE_ENTRY = 'src/index.ts';

interface ExtensionSearchDirectory {
  dir: string;
  source: ExtensionSource;
}

/** 扩展发现选项 — 由调用方根据 system.yaml 构造并透传到下游所有 discover/register 函数。 */
export interface ExtensionDiscoveryOptions {
  /**
   * 当前 agent 的扩展安装目录绝对路径（~/.iris/agents/<id>/extensions/）。
   * 提供时会作为最高优先级的发现源参与扫描，同名时覆盖 installed/embedded。
   */
  agentExtensionsDir?: string;
  workspace?: {
    /** 是否扫描 <projectRoot>/extensions/ 目录。默认 false。 */
    enabled: boolean;
    /** 仅这些名字会被纳入；空数组表示不收窄。 */
    allowlist?: string[];
  };
}

/** 加载 <workspaceExtensionsDir>/embedded.json 的 name 集合；不存在或解析失败时返回空集合。 */
function loadEmbeddedExtensionNames(): Set<string> {
  const configPath = path.join(workspaceExtensionsDir, 'embedded.json');
  if (!fs.existsSync(configPath)) return new Set<string>();
  try {
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    const list = Array.isArray(raw?.extensions) ? raw.extensions : [];
    const names = new Set<string>();
    for (const item of list) {
      const name = typeof item === 'string'
        ? item
        : (item && typeof item === 'object' && typeof item.name === 'string' ? item.name : '');
      if (name && name.trim()) names.add(name.trim());
    }
    return names;
  } catch (err) {
    logger.warn(`extensions/embedded.json 解析失败，忽略 embedded 分类: ${configPath}`, err);
    return new Set<string>();
  }
}

function getExtensionSearchDirectories(opts?: ExtensionDiscoveryOptions): ExtensionSearchDirectory[] {
  const dirs: ExtensionSearchDirectory[] = [];

  // agent-installed：仅当调用方提供 agentExtensionsDir 且目录存在时纳入；优先级最高。
  if (opts?.agentExtensionsDir && isDirectory(opts.agentExtensionsDir)) {
    // 防止与全局 extensionsDir 重合时被重复扫描（极端情况下 customDataDir 指向相同位置）
    if (path.resolve(opts.agentExtensionsDir) !== path.resolve(extensionsDir)) {
      dirs.push({ dir: opts.agentExtensionsDir, source: 'agent-installed' });
    }
  }

  if (isDirectory(extensionsDir)) {
    dirs.push({ dir: extensionsDir, source: 'installed' });
  }

  // workspace 目录总是扫描（用于找出 embedded 分类的扩展）；
  // 是否启用 non-embedded 项由 discoverLocalExtensions 内部按 opts 过滤。
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

export function discoverLocalExtensions(opts?: ExtensionDiscoveryOptions): ExtensionPackage[] {
  const packages: ExtensionPackage[] = [];
  const seenNames = new Set<string>();

  const workspaceEnabled = opts?.workspace?.enabled === true;
  const allowlist = opts?.workspace?.allowlist ?? [];
  const allowlistSet = allowlist.length > 0 ? new Set(allowlist) : undefined;
  const embeddedNames = loadEmbeddedExtensionNames();

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

      // workspace 目录里的扩展按 embedded.json 二次分类：
      //   - 在 embedded.json 中 → source='embedded'，始终参与发现；
      //   - 不在 → source='workspace'，受 loadWorkspaceExtensions + allowlist 控制。
      let effectiveSource: ExtensionSource = searchDir.source;
      if (searchDir.source === 'workspace') {
        if (embeddedNames.has(manifest.name)) {
          effectiveSource = 'embedded';
        } else {
          if (!workspaceEnabled) continue;
          if (allowlistSet && !allowlistSet.has(manifest.name)) continue;
        }
      }

      seenNames.add(manifest.name);
      packages.push({
        manifest,
        rootDir,
        source: effectiveSource,
      });
    }
  }

  return packages;
}

/**
 * 自动发现所有具有 plugin 贡献的本地 extension，返回 PluginEntry 列表。
 *
 * 与 registerExtensionPlatforms() 对 platform 的处理方式一致：
 * 扫描 extensions/ 目录，凡 manifest 中含 plugin 贡献的 extension 均自动纳入。
 * 调用方可将返回值与 plugins.yaml 的显式配置合并，显式配置拥有更高优先级。
 */
export function discoverLocalPluginEntries(
  extensionPackages?: ExtensionPackage[],
  opts?: ExtensionDiscoveryOptions,
): PluginEntry[] {
  const packages = extensionPackages ?? discoverLocalExtensions(opts);
  const entries: PluginEntry[] = [];
  for (const pkg of packages) {
    const pluginContribution = normalizePluginContribution(pkg.manifest);
    if (!pluginContribution) continue; // 纯 platform extension，跳过
    entries.push({
      name: pkg.manifest.name,
      type: 'local',
      enabled: true,
    });
  }
  return entries;
}

/**
 * 将自动发现的 plugin entries 与 plugins.yaml 中的显式配置合并。
 *
 * 合并策略：
 * - 自动发现的 entry 作为基础列表
 * - plugins.yaml 中的同名条目覆盖自动发现的（可设 enabled/priority/config）
 * - plugins.yaml 中独有的条目（如 npm 插件）追加到末尾
 */
export function mergePluginEntries(
  discovered: PluginEntry[],
  explicit: PluginEntry[],
): PluginEntry[] {
  const explicitMap = new Map(explicit.map(e => [e.name, e]));
  const merged: PluginEntry[] = [];

  for (const entry of discovered) {
    const override = explicitMap.get(entry.name);
    if (override) {
      merged.push(override); // 显式配置优先
      explicitMap.delete(entry.name);
    } else {
      merged.push(entry); // 自动发现，默认 enabled
    }
  }

  // 追加 plugins.yaml 中独有的条目（如 npm 插件）
  for (const entry of explicitMap.values()) {
    merged.push(entry);
  }

  return merged;
}




export function resolveLocalPluginSource(
  name: string,
  extensionPackages?: ExtensionPackage[],
  devSourceExtensions?: string[],
  opts?: ExtensionDiscoveryOptions,
): ResolvedLocalPlugin {
  const packages = extensionPackages ?? discoverLocalExtensions(opts);
  const extensionPackage = packages.find((item) => item.manifest.name === name);
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
  extensionPackages?: ExtensionPackage[],
  devSourceExtensions?: string[],
  opts?: ExtensionDiscoveryOptions,
): string[] {
  const packages = extensionPackages ?? discoverLocalExtensions(opts);
  const registeredPlatforms: string[] = [];

  for (const extensionPackage of packages) {
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
        const depsResult = getMissingExtensionRuntimeDependencies(extensionPackage.rootDir);
        if (depsResult.missingDependencies.length > 0) {
          throw new Error(
            `extension "${extensionPackage.manifest.name}" 缺少运行时依赖: ${depsResult.missingDependencies.join(', ')}。请在 TUI/Web 中重新启用该 extension 并确认安装依赖，或在 ${extensionPackage.rootDir} 手动运行 npm install。`,
          );
        }
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
 * 但 DevSource 模式直接加载扩展源码，源码中的 `import 'irises-extension-sdk'`
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
  { dist: 'ipc/index.js',      src: '../../src/ipc/index.ts' },
  { dist: 'host-events.js',    src: '../src/host-events.ts' },
];

/**
 * 确保 irises-extension-sdk 的 dist/ 包含指向源码的 shim。
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
    logger.info(`[DevSource] 已为 irises-extension-sdk 生成 ${shimCount} 个源码 shim（dist/ → src/）`);
  }
}
