import * as childProcess from 'node:child_process';
import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import * as path from 'node:path';

export type ExtensionDependencyCommandRunner = (
  command: string,
  args: string[],
  cwd: string,
) => Promise<void> | void;

export interface ExtensionDependencyPackageJson {
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

export interface EnsureExtensionRuntimeDependenciesOptions {
  /** 默认 true；false 时只检查缺失依赖，不执行安装。 */
  install?: boolean;
  /** 用于测试或接入自定义安装器。 */
  commandRunner?: ExtensionDependencyCommandRunner;
}

export interface EnsureExtensionRuntimeDependenciesResult {
  packageJsonPath?: string;
  dependencySpecs: Record<string, string>;
  missingDependencies: string[];
  installed: boolean;
  installCommand?: string;
  installArgs?: string[];
}

const INTERNAL_HOST_DEPENDENCIES = new Set([
  // Extension SDK 通常会被 extension 构建进 dist；源码/开发依赖不应在用户目录里按 file: 重新安装。
  'irises-extension-sdk',
]);

function readPackageJson(packageJsonPath: string): ExtensionDependencyPackageJson | undefined {
  if (!fs.existsSync(packageJsonPath)) return undefined;
  try {
    const parsed = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8')) as ExtensionDependencyPackageJson;
    return parsed && typeof parsed === 'object' ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function collectRuntimeDependencySpecs(packageJson: ExtensionDependencyPackageJson | undefined): Record<string, string> {
  const specs: Record<string, string> = {};
  for (const source of [packageJson?.dependencies, packageJson?.optionalDependencies]) {
    if (!source || typeof source !== 'object') continue;
    for (const [name, spec] of Object.entries(source)) {
      const depName = name.trim();
      if (!depName || INTERNAL_HOST_DEPENDENCIES.has(depName)) continue;
      if (typeof spec === 'string' && spec.trim()) {
        specs[depName] = spec.trim();
      }
    }
  }
  return specs;
}

function isDependencyResolvable(extensionDir: string, dependencyName: string): boolean {
  const resolvedExtensionDir = path.resolve(extensionDir);
  const packageJsonPath = path.join(resolvedExtensionDir, 'package.json');
  const requireFromExtension = createRequire(packageJsonPath);
  try {
    requireFromExtension.resolve(`${dependencyName}/package.json`);
    return true;
  } catch {
    // 某些包通过 exports 隐藏 package.json，继续尝试解析主入口。
  }

  try {
    requireFromExtension.resolve(dependencyName);
    return true;
  } catch {
    return false;
  }
}

function isRegistryInstallableSpec(spec: string): boolean {
  const normalized = spec.trim().toLowerCase();
  if (!normalized) return false;
  return !(
    normalized.startsWith('file:')
    || normalized.startsWith('link:')
    || normalized.startsWith('workspace:')
    || normalized.startsWith('portal:')
    || normalized.startsWith('git+')
    || normalized.startsWith('http:')
    || normalized.startsWith('https:')
    || normalized.startsWith('ssh:')
  );
}

function formatInstallSpec(name: string, spec: string): string {
  const normalized = spec.trim();
  if (!normalized || normalized === '*' || normalized === 'latest') return name;
  return `${name}@${normalized}`;
}

function buildMissingInstallSpecs(dependencySpecs: Record<string, string>, missingDependencies: string[]): string[] {
  const installSpecs: string[] = [];
  const nonInstallable: string[] = [];

  for (const name of missingDependencies) {
    const spec = dependencySpecs[name];
    if (!isRegistryInstallableSpec(spec)) {
      nonInstallable.push(`${name}@${spec}`);
      continue;
    }
    installSpecs.push(formatInstallSpec(name, spec));
  }

  if (nonInstallable.length > 0) {
    throw new Error(
      `extension 缺少无法自动安装的本地/非 registry 依赖: ${nonInstallable.join(', ')}`,
    );
  }

  return installSpecs;
}

function resolvePackageManagerExecutable(command: string): string {
  return process.platform === 'win32' && command === 'npm' ? 'npm.cmd' : command;
}

function defaultCommandRunner(command: string, args: string[], cwd: string): void {
  const result = childProcess.spawnSync(resolvePackageManagerExecutable(command), args, {
    cwd,
    stdio: 'inherit',
    shell: false,
  });

  if (result.error) throw result.error;
  if (typeof result.status === 'number' && result.status !== 0) {
    throw new Error(`命令执行失败: ${command} ${args.join(' ')} (exit=${result.status})`);
  }
}

export function getMissingExtensionRuntimeDependencies(extensionDir: string): EnsureExtensionRuntimeDependenciesResult {
  const resolvedExtensionDir = path.resolve(extensionDir);
  const packageJsonPath = path.join(resolvedExtensionDir, 'package.json');
  const packageJson = readPackageJson(packageJsonPath);
  const dependencySpecs = collectRuntimeDependencySpecs(packageJson);
  const missingDependencies = Object.keys(dependencySpecs)
    .filter((name) => !isDependencyResolvable(resolvedExtensionDir, name));

  return {
    packageJsonPath: packageJson ? packageJsonPath : undefined,
    dependencySpecs,
    missingDependencies,
    installed: false,
  };
}

/**
 * 确保 extension 的运行时 dependencies / optionalDependencies 可解析。
 *
 * 规则：
 * - 没有 package.json 或没有运行时依赖 → 直接跳过。
 * - 依赖已能从 extension 目录解析 → 直接跳过。
 * - 缺失 registry 依赖 → 默认用 npm 安装缺失项到 extension/node_modules。
 * - file:/workspace:/git/URL 依赖无法安全自动安装 → 抛出明确错误。
 */
export async function ensureExtensionRuntimeDependencies(
  extensionDir: string,
  options: EnsureExtensionRuntimeDependenciesOptions = {},
): Promise<EnsureExtensionRuntimeDependenciesResult> {
  const resolvedExtensionDir = path.resolve(extensionDir);
  const result = getMissingExtensionRuntimeDependencies(resolvedExtensionDir);
  if (result.missingDependencies.length === 0) return result;
  if (options.install === false) return result;

  const installSpecs = buildMissingInstallSpecs(result.dependencySpecs, result.missingDependencies);
  const command = 'npm';
  const args = [
    'install',
    '--no-save',
    '--package-lock=false',
    '--no-audit',
    '--no-fund',
    '--',
    ...installSpecs,
  ];
  const runner = options.commandRunner ?? defaultCommandRunner;
  await runner(command, args, resolvedExtensionDir);

  const afterInstall = getMissingExtensionRuntimeDependencies(resolvedExtensionDir);
  if (afterInstall.missingDependencies.length > 0) {
    throw new Error(`extension 依赖安装后仍缺失: ${afterInstall.missingDependencies.join(', ')}`);
  }

  return {
    ...afterInstall,
    missingDependencies: result.missingDependencies,
    installed: true,
    installCommand: command,
    installArgs: args,
  };
}
