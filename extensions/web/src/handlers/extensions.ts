/**
 * 扩展管理 + 平台目录 API 处理器
 *
 * GET    /api/extensions              → 已安装 + 内嵌扩展列表
 * GET    /api/extensions/remote       → 远程仓库可用扩展列表
 * POST   /api/extensions/install      → 安装扩展
 * POST   /api/extensions/:name/enable → 启用扩展
 * POST   /api/extensions/:name/disable→ 禁用扩展
 * DELETE /api/extensions/:name        → 删除扩展
 * GET    /api/platforms               → 可用平台列表（内置 + 扩展贡献）
 */

import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import { parse, stringify } from 'yaml';
import { readBody, sendJSON } from '../router';
import {
  normalizeText,
  normalizeRelativeFilePath,
  normalizeRequestedExtensionPath,
  resolveSafeRelativePath,
  MANIFEST_FILE,
  DISABLED_MARKER_FILE,
  readManifestFromDir,
  ensureDirectory,
  createTempInstallDir,
  cleanupTempInstallDir,
  collectRelativeFilesFromDir,
  getInstalledExtensionsDir,
  resolveRuntimeConfigDir,
  fetchBuffer,
  fetchRemoteIndex,
  fetchRemoteManifest,
  buildRemoteExtensionFileUrl,
  getRemoteDistributionFiles,
  analyzeRuntimeEntries,
  describeRuntimeIssues,
  type ExtensionManifestLike,
} from '@irises/extension-sdk/utils';

// ==================== 类型 ====================

export interface PanelFieldDefinition {
  key: string;
  configKey: string;
  type: 'string' | 'password' | 'number';
  label: string;
  description?: string;
  placeholder?: string;
  example?: string;
  defaultValue?: string | number;
  required?: boolean;
}

export interface PlatformOption {
  value: string;
  label: string;
  desc: string;
  source: 'builtin' | 'extension';
  panelTitle?: string;
  panelDescription?: string;
  panelFields: PanelFieldDefinition[];
}

export interface ExtensionSummaryDTO {
  name: string;
  version: string;
  description: string;
  typeLabel: string;
  hasPlugin: boolean;
  hasPlatforms: boolean;
  platformCount: number;
  distributionMode: 'bundled' | 'source';
  distributionLabel: string;
  installed: boolean;
  enabled: boolean;
  stateLabel: string;
  localSource?: 'installed' | 'embedded';
  localVersion?: string;
  localVersionHint?: string;
  requestedPath?: string;
}

// ==================== 内部工具 ====================

function getEmbeddedExtensionsDir(installDir: string): string {
  return path.join(path.resolve(installDir), 'extensions');
}

function getPlatformCount(manifest: ExtensionManifestLike): number {
  return Array.isArray(manifest.platforms)
    ? manifest.platforms.filter((p) => !!normalizeText(p?.name) && !!normalizeText(p?.entry)).length
    : 0;
}

function hasPlatformContribution(manifest: ExtensionManifestLike): boolean {
  return getPlatformCount(manifest) > 0;
}

function hasPluginContribution(manifest: ExtensionManifestLike): boolean {
  if (manifest.plugin && typeof manifest.plugin === 'object') return true;
  if (normalizeText(manifest.entry)) return true;
  return !hasPlatformContribution(manifest);
}

function buildTypeLabel(manifest: ExtensionManifestLike): string {
  const hasPlugin = hasPluginContribution(manifest);
  const pc = getPlatformCount(manifest);
  if (hasPlugin && pc > 0) return '插件 + 平台';
  if (hasPlugin) return '插件';
  if (pc > 1) return `${pc} 个平台`;
  if (pc === 1) return '平台';
  return '扩展';
}

function analyzeDistribution(files: string[], manifest: ExtensionManifestLike) {
  const analyses = analyzeRuntimeEntries(files, manifest);
  const issues = analyses.filter((a) => a.needsBuild);
  if (issues.length > 0) {
    return { distributionMode: 'source' as const, distributionLabel: '源码包', runnableEntries: [] as string[] };
  }
  return {
    distributionMode: 'bundled' as const,
    distributionLabel: '可直接安装',
    runnableEntries: analyses.flatMap((a) => a.runnableAlternatives),
  };
}

// ---- plugins.yaml 读写 ----

interface EditablePluginEntry {
  name: string;
  type?: 'local' | 'npm';
  enabled?: boolean;
  priority?: number;
  config?: Record<string, unknown>;
}

function readEditablePluginEntries(): EditablePluginEntry[] {
  const pluginsPath = path.join(resolveRuntimeConfigDir(), 'plugins.yaml');
  if (!fs.existsSync(pluginsPath)) return [];
  try {
    const raw = parse(fs.readFileSync(pluginsPath, 'utf-8'));
    const list = Array.isArray(raw)
      ? raw
      : raw && typeof raw === 'object' && Array.isArray((raw as { plugins?: unknown }).plugins)
        ? (raw as { plugins: unknown[] }).plugins
        : [];
    return list
      .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
      .filter((item) => !!normalizeText(item.name))
      .map((item) => ({
        name: normalizeText(item.name)!,
        type: item.type === 'npm' ? 'npm' as const : 'local' as const,
        enabled: item.enabled !== false,
        priority: typeof item.priority === 'number' ? item.priority : undefined,
        config: item.config && typeof item.config === 'object' && !Array.isArray(item.config)
          ? item.config as Record<string, unknown>
          : undefined,
      }));
  } catch {
    return [];
  }
}

function writeEditablePluginEntries(entries: EditablePluginEntry[]): void {
  const configDir = resolveRuntimeConfigDir();
  const pluginsPath = path.join(configDir, 'plugins.yaml');
  ensureDirectory(configDir);
  fs.writeFileSync(pluginsPath, `# 插件配置\n\n${stringify({ plugins: entries }, { indent: 2 })}`, 'utf-8');
}

function upsertLocalPluginEnabled(name: string, enabled: boolean): void {
  const entries = readEditablePluginEntries();
  const idx = entries.findIndex((e) => e.name === name && (e.type ?? 'local') === 'local');
  if (idx >= 0) {
    entries[idx] = { ...entries[idx], type: 'local', enabled };
  } else {
    entries.push({ name, type: 'local', enabled });
  }
  writeEditablePluginEntries(entries);
}

function removeLocalPluginEntry(name: string): void {
  writeEditablePluginEntries(
    readEditablePluginEntries().filter((e) => !(e.name === name && (e.type ?? 'local') === 'local')),
  );
}

function getPluginEnabledState(name: string): boolean | undefined {
  const entry = readEditablePluginEntries().find((e) => e.name === name && (e.type ?? 'local') === 'local');
  if (!entry) return undefined;
  return entry.enabled !== false;
}

function hasDisabledMarker(rootDir: string): boolean {
  return fs.existsSync(path.join(rootDir, DISABLED_MARKER_FILE));
}

function setDisabledMarker(rootDir: string, disabled: boolean): void {
  const markerPath = path.join(rootDir, DISABLED_MARKER_FILE);
  if (disabled) {
    fs.writeFileSync(markerPath, 'disabled\n', 'utf-8');
  } else if (fs.existsSync(markerPath)) {
    fs.rmSync(markerPath, { force: true });
  }
}

// ---- 状态判定 ----

function resolveInstalledState(manifest: ExtensionManifestLike, rootDir: string): {
  enabled: boolean; stateLabel: string;
} {
  if (hasDisabledMarker(rootDir)) return { enabled: false, stateLabel: '已关闭' };
  const hasPlugin = hasPluginContribution(manifest);
  const hasPlatforms = hasPlatformContribution(manifest);
  if (hasPlugin) {
    const pluginEnabled = getPluginEnabledState(manifest.name!);
    if (pluginEnabled === false || pluginEnabled == null) {
      return { enabled: hasPlatforms, stateLabel: hasPlatforms ? '平台已启用，插件未启用' : '未启用' };
    }
  }
  return { enabled: true, stateLabel: '已开启' };
}

// ---- 列表构建 ----

function buildDTO(
  manifest: ExtensionManifestLike,
  opts: Partial<ExtensionSummaryDTO> = {},
): ExtensionSummaryDTO {
  const dist = opts.distributionMode
    ? { distributionMode: opts.distributionMode, distributionLabel: opts.distributionLabel ?? '' }
    : { distributionMode: 'source' as const, distributionLabel: '源码包' };
  return {
    name: manifest.name!,
    version: manifest.version!,
    description: normalizeText(manifest.description) ?? '无描述',
    typeLabel: buildTypeLabel(manifest),
    hasPlugin: hasPluginContribution(manifest),
    hasPlatforms: hasPlatformContribution(manifest),
    platformCount: getPlatformCount(manifest),
    installed: false,
    enabled: false,
    stateLabel: '未安装',
    ...dist,
    ...opts,
  };
}

function loadInstalledExtensions(): ExtensionSummaryDTO[] {
  const rootDir = getInstalledExtensionsDir();
  if (!fs.existsSync(rootDir) || !fs.statSync(rootDir).isDirectory()) return [];
  const results: ExtensionSummaryDTO[] = [];
  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const extDir = path.join(rootDir, entry.name);
    const manifest = readManifestFromDir(extDir);
    if (!manifest) continue;
    const dist = analyzeDistribution(collectRelativeFilesFromDir(extDir), manifest);
    const state = resolveInstalledState(manifest, extDir);
    results.push(buildDTO(manifest, {
      installed: true,
      enabled: state.enabled,
      stateLabel: state.stateLabel,
      localSource: 'installed',
      localVersion: manifest.version!,
      distributionMode: dist.distributionMode,
      distributionLabel: dist.distributionLabel,
    }));
  }
  return results.sort((a, b) => a.name.localeCompare(b.name));
}

function loadEmbeddedExtensions(installDir: string): ExtensionSummaryDTO[] {
  const embeddedRoot = getEmbeddedExtensionsDir(installDir);
  const configPath = path.join(embeddedRoot, 'embedded.json');
  if (!fs.existsSync(configPath)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as { extensions?: Array<{ name?: string }> };
    const names = Array.isArray(raw.extensions)
      ? raw.extensions.map((i) => normalizeText(i?.name)).filter((n): n is string => !!n)
      : [];
    const results: ExtensionSummaryDTO[] = [];
    for (const name of names) {
      const extDir = path.join(embeddedRoot, name);
      const manifest = readManifestFromDir(extDir);
      if (!manifest) continue;
      const dist = analyzeDistribution(collectRelativeFilesFromDir(extDir), manifest);
      results.push(buildDTO(manifest, {
        installed: false,
        enabled: hasPlatformContribution(manifest) || getPluginEnabledState(manifest.name!) === true,
        stateLabel: '源码内嵌',
        localSource: 'embedded',
        localVersion: manifest.version!,
        distributionMode: dist.distributionMode,
        distributionLabel: dist.distributionLabel,
      }));
    }
    return results.sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

// ---- 平台目录 ----

const BUILTIN_PLATFORMS: PlatformOption[] = [
  {
    value: 'console',
    label: 'Console (TUI)',
    desc: '终端交互界面，适合本地开发和 SSH 使用。',
    source: 'builtin',
    panelFields: [],
  },
  {
    value: 'web',
    label: 'Web (HTTP + GUI)',
    desc: '浏览器访问，适合服务器部署和远程使用。',
    source: 'builtin',
    panelTitle: '平台配置',
    panelDescription: '填写 Web 平台的监听参数。',
    panelFields: [
      {
        key: 'port', configKey: 'port', type: 'number',
        label: 'Web 服务端口', description: 'Web 服务监听端口。',
        placeholder: '8192', example: '8192', defaultValue: 8192, required: true,
      },
    ],
  },
];

function normalizePanelField(field: Record<string, unknown>): PanelFieldDefinition | undefined {
  const key = normalizeText(field.key);
  if (!key) return undefined;
  const rawType = field.type;
  const type: PanelFieldDefinition['type'] = rawType === 'password' ? 'password' : rawType === 'number' ? 'number' : 'string';
  return {
    key,
    configKey: normalizeText(field.configKey) ?? key,
    type,
    label: normalizeText(field.label) ?? key,
    description: normalizeText(field.description),
    placeholder: normalizeText(field.placeholder),
    example: normalizeText(field.example),
    defaultValue: typeof field.defaultValue === 'string' || typeof field.defaultValue === 'number' ? field.defaultValue : undefined,
    required: field.required === true,
  };
}

function collectExtensionPlatforms(installDir: string): PlatformOption[] {
  const roots = [
    getInstalledExtensionsDir(),
    getEmbeddedExtensionsDir(installDir),
  ];
  const deduped = new Set<string>();
  const results: PlatformOption[] = [];

  for (const root of roots) {
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) continue;
    const resolvedRoot = path.resolve(root);
    if (deduped.has(resolvedRoot)) continue;
    deduped.add(resolvedRoot);

    for (const entry of fs.readdirSync(resolvedRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const extDir = path.join(resolvedRoot, entry.name);
      const manifestPath = path.join(extDir, 'manifest.json');
      if (!fs.existsSync(manifestPath)) continue;
      let manifest: Record<string, unknown>;
      try {
        manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
        if (!manifest || typeof manifest !== 'object') continue;
      } catch { continue; }

      const platforms = manifest.platforms;
      if (!Array.isArray(platforms)) continue;

      for (const pc of platforms) {
        if (!pc || typeof pc !== 'object') continue;
        const platformName = normalizeText((pc as Record<string, unknown>).name);
        if (!platformName) continue;

        const panel = (pc as Record<string, unknown>).panel as Record<string, unknown> | undefined;
        const panelFields = Array.isArray(panel?.fields)
          ? (panel.fields as Record<string, unknown>[]).map(normalizePanelField).filter((f): f is PanelFieldDefinition => !!f)
          : [];

        results.push({
          value: platformName,
          label: normalizeText((pc as Record<string, unknown>).label) ?? platformName,
          desc: normalizeText((pc as Record<string, unknown>).description)
            ?? normalizeText(manifest.description)
            ?? `${platformName} extension`,
          source: 'extension',
          panelTitle: normalizeText(panel?.title),
          panelDescription: normalizeText(panel?.description),
          panelFields,
        });
      }
    }
  }

  return results;
}

function loadAvailablePlatforms(installDir: string): PlatformOption[] {
  const map = new Map<string, PlatformOption>();
  for (const b of BUILTIN_PLATFORMS) map.set(b.value, b);
  for (const p of collectExtensionPlatforms(installDir)) {
    if (!map.has(p.value)) map.set(p.value, p);
  }
  const builtins = BUILTIN_PLATFORMS.map((b) => map.get(b.value)!).filter(Boolean);
  const exts = Array.from(map.values()).filter((p) => p.source === 'extension').sort((a, b) => a.value.localeCompare(b.value));
  return [...builtins, ...exts];
}

// ==================== Handler 工厂 ====================

export function createExtensionHandlers(installDir: string) {
  return {
    /** GET /api/extensions */
    async list(_req: http.IncomingMessage, res: http.ServerResponse) {
      try {
        const installed = loadInstalledExtensions();
        const embedded = loadEmbeddedExtensions(installDir);
        // 已安装的优先，内嵌的补充（去重）
        const seen = new Set(installed.map((e) => e.name));
        const all = [...installed, ...embedded.filter((e) => !seen.has(e.name))];
        sendJSON(res, 200, { extensions: all });
      } catch (err) {
        sendJSON(res, 500, { error: `加载扩展列表失败: ${err instanceof Error ? err.message : String(err)}` });
      }
    },

    /** GET /api/extensions/remote */
    async remote(_req: http.IncomingMessage, res: http.ServerResponse) {
      try {
        const remoteIndex = await fetchRemoteIndex();
        const remoteEntries = (await Promise.allSettled(
          remoteIndex.map(async (requestedPath) => {
            const manifest = await fetchRemoteManifest(requestedPath);
            return { requestedPath, manifest, files: getRemoteDistributionFiles(manifest) };
          }),
        ))
          .filter((r): r is PromiseFulfilledResult<{ requestedPath: string; manifest: ExtensionManifestLike; files: string[] }> => r.status === 'fulfilled')
          .map((r) => r.value);

        const installedMap = new Map(loadInstalledExtensions().map((e) => [e.name, e]));
        const embeddedMap = new Map(loadEmbeddedExtensions(installDir).map((e) => [e.name, e]));
        const results: ExtensionSummaryDTO[] = [];

        for (const entry of remoteEntries) {
          const dist = analyzeDistribution(entry.files, entry.manifest);
          const local = installedMap.get(entry.manifest.name!) ?? embeddedMap.get(entry.manifest.name!);
          results.push(buildDTO(entry.manifest, {
            requestedPath: entry.requestedPath,
            installed: local?.installed ?? false,
            enabled: local?.enabled ?? false,
            stateLabel: local?.stateLabel ?? '未安装',
            localSource: local?.localSource,
            localVersion: local?.localVersion,
            localVersionHint: local?.localVersion
              ? `本地已有版本 ${local.localVersion}${local.localSource === 'installed' ? '（已安装）' : local.localSource === 'embedded' ? '（源码内嵌）' : ''}`
              : undefined,
            distributionMode: dist.distributionMode,
            distributionLabel: dist.distributionLabel,
          }));
        }

        sendJSON(res, 200, { extensions: results.sort((a, b) => a.name.localeCompare(b.name)) });
      } catch (err) {
        sendJSON(res, 500, { error: `加载远程扩展列表失败: ${err instanceof Error ? err.message : String(err)}` });
      }
    },

    /** POST /api/extensions/install */
    async install(req: http.IncomingMessage, res: http.ServerResponse) {
      try {
        const body = await readBody(req);
        const requestedPath = typeof body?.requestedPath === 'string' ? body.requestedPath.trim() : '';
        if (!requestedPath) {
          sendJSON(res, 400, { error: '缺少 requestedPath 参数' });
          return;
        }

        const requested = normalizeRequestedExtensionPath(requestedPath, 'extension 路径');
        const installedRootDir = getInstalledExtensionsDir();
        const tempDir = createTempInstallDir(installedRootDir);

        try {
          const remoteIndex = await fetchRemoteIndex();
          if (!remoteIndex.includes(requested)) {
            cleanupTempInstallDir(tempDir);
            sendJSON(res, 404, { error: `远程 extension 目录不存在: ${requested}` });
            return;
          }

          const manifest = await fetchRemoteManifest(requested);
          const files = getRemoteDistributionFiles(manifest);

          ensureDirectory(tempDir);
          fs.writeFileSync(path.join(tempDir, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8');

          for (const relativePath of files) {
            const normalized = normalizeRelativeFilePath(relativePath);
            if (normalized === MANIFEST_FILE) continue;
            const dest = resolveSafeRelativePath(tempDir, normalized);
            ensureDirectory(path.dirname(dest));
            fs.writeFileSync(dest, await fetchBuffer(buildRemoteExtensionFileUrl(requested, normalized), 'extension 文件'));
          }

          const installed = readManifestFromDir(tempDir);
          if (!installed) {
            cleanupTempInstallDir(tempDir);
            sendJSON(res, 500, { error: `安装后 manifest 验证失败` });
            return;
          }

          const dist = analyzeDistribution(collectRelativeFilesFromDir(tempDir), installed);
          if (dist.distributionMode !== 'bundled') {
            cleanupTempInstallDir(tempDir);
            sendJSON(res, 400, { error: `这不是可直接安装的发行包：${describeRuntimeIssues(analyzeRuntimeEntries(collectRelativeFilesFromDir(tempDir), installed).filter((a) => a.needsBuild))}` });
            return;
          }

          const targetDir = path.join(installedRootDir, installed.name!);
          fs.rmSync(targetDir, { recursive: true, force: true });
          fs.renameSync(tempDir, targetDir);

          sendJSON(res, 200, {
            ok: true,
            extension: buildDTO(installed, {
              installed: true,
              enabled: true,
              stateLabel: '已开启',
              localSource: 'installed',
              localVersion: installed.version!,
              distributionMode: dist.distributionMode,
              distributionLabel: dist.distributionLabel,
            }),
          });
        } catch (innerErr) {
          cleanupTempInstallDir(tempDir);
          throw innerErr;
        }
      } catch (err) {
        if (!res.headersSent) {
          sendJSON(res, 500, { error: `安装失败: ${err instanceof Error ? err.message : String(err)}` });
        }
      }
    },

    /** POST /api/extensions/:name/enable */
    async enable(req: http.IncomingMessage, res: http.ServerResponse, params: Record<string, string>) {
      try {
        const name = params.name;
        const rootDir = path.join(getInstalledExtensionsDir(), name);
        if (!fs.existsSync(rootDir)) {
          sendJSON(res, 404, { error: `extension 不存在: ${name}` });
          return;
        }
        setDisabledMarker(rootDir, false);
        const manifest = readManifestFromDir(rootDir);
        if (manifest && hasPluginContribution(manifest)) {
          upsertLocalPluginEnabled(name, true);
        }
        sendJSON(res, 200, { ok: true });
      } catch (err) {
        sendJSON(res, 500, { error: `启用失败: ${err instanceof Error ? err.message : String(err)}` });
      }
    },

    /** POST /api/extensions/:name/disable */
    async disable(req: http.IncomingMessage, res: http.ServerResponse, params: Record<string, string>) {
      try {
        const name = params.name;
        const rootDir = path.join(getInstalledExtensionsDir(), name);
        if (!fs.existsSync(rootDir)) {
          sendJSON(res, 404, { error: `extension 不存在: ${name}` });
          return;
        }
        setDisabledMarker(rootDir, true);
        const manifest = readManifestFromDir(rootDir);
        if (manifest && hasPluginContribution(manifest)) {
          upsertLocalPluginEnabled(name, false);
        }
        sendJSON(res, 200, { ok: true });
      } catch (err) {
        sendJSON(res, 500, { error: `禁用失败: ${err instanceof Error ? err.message : String(err)}` });
      }
    },

    /** DELETE /api/extensions/:name */
    async remove(req: http.IncomingMessage, res: http.ServerResponse, params: Record<string, string>) {
      try {
        const name = params.name;
        const rootDir = path.join(getInstalledExtensionsDir(), name);
        if (!fs.existsSync(rootDir)) {
          sendJSON(res, 404, { error: `extension 不存在: ${name}` });
          return;
        }
        const manifest = readManifestFromDir(rootDir);
        fs.rmSync(rootDir, { recursive: true, force: true });
        if (manifest && hasPluginContribution(manifest)) {
          removeLocalPluginEntry(name);
        }
        sendJSON(res, 200, { ok: true });
      } catch (err) {
        sendJSON(res, 500, { error: `删除失败: ${err instanceof Error ? err.message : String(err)}` });
      }
    },

    /** GET /api/platforms */
    async platforms(_req: http.IncomingMessage, res: http.ServerResponse) {
      try {
        sendJSON(res, 200, { platforms: loadAvailablePlatforms(installDir) });
      } catch (err) {
        sendJSON(res, 500, { error: `加载平台列表失败: ${err instanceof Error ? err.message : String(err)}` });
      }
    },
  };
}

/**
 * 收集所有扩展平台中 type: "password" 的字段名。
 * 供 sanitizeConfig 动态脱敏使用。
 */
export function collectExtensionPasswordFields(installDir: string): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  for (const platform of collectExtensionPlatforms(installDir)) {
    const keys = platform.panelFields.filter((f) => f.type === 'password').map((f) => f.configKey);
    if (keys.length > 0) {
      result.set(platform.value, new Set(keys));
    }
  }
  return result;
}
