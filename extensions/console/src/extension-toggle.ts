import { ensureExtensionRuntimeDependencies } from 'irises-extension-sdk/utils';

interface ConsoleToggleApiLike {
  extensions?: {
    discover?: () => ExtensionPackageLike[];
    discoverAll?: () => ExtensionPackageLike[];
    setWorkspaceDiscovery?: (workspace: { enabled: boolean; allowlist?: string[] }) => void;
    activate?: (entry: string | PluginEntryLike) => Promise<void> | void;
    deactivate?: (name: string) => Promise<void> | void;
  };
  configManager?: {
    readEditableConfig(): Record<string, any>;
    updateEditableConfig(updates: Record<string, unknown>): { mergedRaw?: Record<string, unknown> };
  };
  pluginManager?: {
    listPlugins?: () => Array<{ name: string }>;
  };
}

interface ExtensionPackageLike {
  manifest: { name: string; entry?: string; plugin?: any; platforms?: any[] };
  source?: string;
  rootDir?: string;
}

interface PluginEntryLike {
  name: string;
  enabled?: boolean;
  type?: string;
  priority?: number;
  config?: Record<string, unknown>;
  [key: string]: any;
}

export function readConsolePluginEntries(raw: Record<string, any> | undefined): PluginEntryLike[] {
  const section = raw?.plugins;
  if (Array.isArray(section)) return section.filter((item) => item && typeof item.name === 'string');
  if (section && typeof section === 'object' && Array.isArray(section.plugins)) {
    return section.plugins.filter((item: any) => item && typeof item.name === 'string');
  }
  return [];
}

export function buildConsolePluginsConfigUpdate(raw: Record<string, any> | undefined, pluginEntries: PluginEntryLike[]): Record<string, unknown> {
  const section = raw?.plugins;
  if (Array.isArray(section)) return { plugins: pluginEntries };
  const nextSection = section && typeof section === 'object' ? { ...section } : {};
  nextSection.plugins = pluginEntries;
  return { plugins: nextSection };
}

export function hasConsolePluginContribution(manifest: { entry?: string; plugin?: any; platforms?: any[] }): boolean {
  const hasPlatforms = Array.isArray(manifest.platforms) && manifest.platforms.length > 0;
  return !!manifest.plugin || !!manifest.entry || !hasPlatforms;
}

export function readWorkspaceExtensionDiscoveryConfig(raw: Record<string, any> | undefined): { enabled: boolean; allowlist: string[] } {
  const extensions = raw?.system?.extensions;
  if (!extensions || typeof extensions !== 'object') return { enabled: false, allowlist: [] };
  const allowlist = Array.isArray(extensions.workspaceAllowlist)
    ? extensions.workspaceAllowlist.filter((item: unknown): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
  return { enabled: extensions.loadWorkspaceExtensions === true, allowlist };
}

export function isWorkspaceExtensionEnabled(raw: Record<string, any> | undefined, name: string): boolean {
  const discovery = readWorkspaceExtensionDiscoveryConfig(raw);
  if (!discovery.enabled) return false;
  return discovery.allowlist.length === 0 || discovery.allowlist.includes(name);
}

export function updateWorkspaceExtensionDiscoveryConfig(
  configManager: NonNullable<ConsoleToggleApiLike['configManager']>,
  name: string,
  enabled: boolean,
  packages: Array<{ manifest: { name: string }; source?: string }>,
): { workspace: { enabled: boolean; allowlist: string[] }; mergedRaw?: Record<string, unknown> } {
  const raw = configManager.readEditableConfig() as Record<string, any>;
  const system = raw.system && typeof raw.system === 'object' ? { ...raw.system } : {};
  const currentExtensions = system.extensions && typeof system.extensions === 'object' ? { ...system.extensions } : {};
  const workspaceNames = packages.filter(pkg => pkg.source === 'workspace').map(pkg => pkg.manifest.name);
  const currentAllowlist = Array.isArray(currentExtensions.workspaceAllowlist)
    ? currentExtensions.workspaceAllowlist.filter((item: unknown): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
  const currentlyAllWorkspace = currentExtensions.loadWorkspaceExtensions === true && currentAllowlist.length === 0;

  let nextAllowlist: string[];
  let nextEnabled: boolean;
  if (enabled) {
    nextEnabled = true;
    nextAllowlist = currentlyAllWorkspace ? [] : Array.from(new Set([...currentAllowlist, name]));
  } else {
    nextAllowlist = currentlyAllWorkspace
      ? workspaceNames.filter((item: string) => item !== name)
      : currentAllowlist.filter((item: string) => item !== name);
    nextEnabled = nextAllowlist.length > 0;
    if (!nextEnabled) nextAllowlist = [];
  }

  system.extensions = { ...currentExtensions, loadWorkspaceExtensions: nextEnabled, workspaceAllowlist: nextAllowlist };
  const result = configManager.updateEditableConfig({ system } as any);
  return { workspace: { enabled: nextEnabled, allowlist: nextAllowlist }, mergedRaw: result.mergedRaw as Record<string, unknown> };
}

export async function handleConsoleToggleExtension(
  api: ConsoleToggleApiLike | undefined,
  name: string,
  desiredEnabled?: boolean,
): Promise<{ ok: boolean; message: string }> {
  const ext = api?.extensions;
  const configManager = api?.configManager;
  if (!ext || !configManager) {
    return { ok: false, message: '扩展管理 API 不可用' };
  }

  let workspaceRollback: { enabled: boolean; allowlist: string[] } | undefined;
  let rollbackWorkspaceOnFailure = false;
  try {
    const raw = configManager.readEditableConfig() as Record<string, any>;
    const pluginEntries: PluginEntryLike[] = [...readConsolePluginEntries(raw)];
    const existing = pluginEntries.find(p => p.name === name);
    const packages: ExtensionPackageLike[] = ext.discoverAll?.() ?? ext.discover?.() ?? [];
    const pkg = packages.find((item) => item.manifest.name === name);
    const hasPlugin = pkg ? hasConsolePluginContribution(pkg.manifest) : true;
    const isWorkspace = pkg?.source === 'workspace';

    const active = api?.pluginManager?.listPlugins?.() ?? [];
    const isActive = active.some((p: any) => p.name === name);
    const shouldEnable = desiredEnabled ?? !isActive;

    if (!shouldEnable) {
      if (isActive) await ext.deactivate?.(name);
      if (isWorkspace) {
        const workspaceUpdate = updateWorkspaceExtensionDiscoveryConfig(configManager, name, false, packages);
        ext.setWorkspaceDiscovery?.(workspaceUpdate.workspace);
      }
      if (existing) {
        existing.enabled = false;
      } else if (hasPlugin) {
        pluginEntries.push({ name, enabled: false });
      }
      configManager.updateEditableConfig(buildConsolePluginsConfigUpdate(raw, pluginEntries) as any);
      return { ok: true, message: `已禁用 "${name}"` };
    }

    let installedDeps: string[] = [];
    if (pkg?.rootDir) {
      const depsResult = await ensureExtensionRuntimeDependencies(pkg.rootDir);
      if (depsResult.installed) installedDeps = depsResult.missingDependencies;
    }

    if (isWorkspace) {
      workspaceRollback = readWorkspaceExtensionDiscoveryConfig(raw);
      const workspaceUpdate = updateWorkspaceExtensionDiscoveryConfig(configManager, name, true, packages);
      rollbackWorkspaceOnFailure = true;
      ext.setWorkspaceDiscovery?.(workspaceUpdate.workspace);
    }

    if (hasPlugin) {
      const activationEntry = existing
        ? { ...existing, enabled: true }
        : { name, type: 'local', enabled: true };
      await ext.activate?.(activationEntry);
      rollbackWorkspaceOnFailure = false;
    }
    if (existing) {
      existing.enabled = true;
    } else if (hasPlugin) {
      pluginEntries.push({ name, enabled: true });
    }
    if (hasPlugin) configManager.updateEditableConfig(buildConsolePluginsConfigUpdate(raw, pluginEntries) as any);
    if (!hasPlugin) return {
      ok: true,
      message: installedDeps.length > 0 ? `已安装依赖 ${installedDeps.join(', ')} 并启用可选平台扩展 "${name}"；请在 platform.yaml 中选择该平台，必要时重启 Iris。` : `已启用可选平台扩展 "${name}"；请在 platform.yaml 中选择该平台，必要时重启 Iris。`,
    };
    return { ok: true, message: installedDeps.length > 0 ? `已安装依赖 ${installedDeps.join(', ')} 并启用 "${name}"` : `已启用 "${name}"` };
  } catch (err) {
    if (rollbackWorkspaceOnFailure && workspaceRollback) {
      try {
        const currentRaw = configManager.readEditableConfig() as Record<string, any>;
        const system = currentRaw.system && typeof currentRaw.system === 'object' ? { ...currentRaw.system } : {};
        const currentExtensions = system.extensions && typeof system.extensions === 'object' ? { ...system.extensions } : {};
        system.extensions = {
          ...currentExtensions,
          loadWorkspaceExtensions: workspaceRollback.enabled,
          workspaceAllowlist: workspaceRollback.allowlist,
        };
        configManager.updateEditableConfig({ system } as any);
        ext.setWorkspaceDiscovery?.({ enabled: workspaceRollback.enabled, allowlist: workspaceRollback.allowlist });
      } catch {
        // best-effort rollback；保留原始错误返回给用户
      }
    }
    return { ok: false, message: `操作失败: ${err instanceof Error ? err.message : String(err)}` };
  }
}
