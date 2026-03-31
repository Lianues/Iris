import * as childProcess from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { createLogger } from '../logger';
import type { ExtensionManifest } from '@irises/extension-sdk';
import {
  analyzeRuntimeEntries as analyzeRuntimeEntriesShared,
  describeRuntimeIssues,
  collectRelativeFilesFromDir,
  type RuntimeEntryGroupAnalysis,
} from '@irises/extension-sdk/utils';

const logger = createLogger('ExtensionDependencies');

export type ExtensionPackageManager = 'npm' | 'pnpm' | 'bun' | 'yarn';

export interface ExtensionInstallablePackageJson {
  name?: string;
  version?: string;
  private?: boolean;
  type?: string;
  packageManager?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

export interface DetectedExtensionPackageManager {
  name: ExtensionPackageManager;
  lockfile?: string;
  executable: string;
}

export interface InstallExtensionDependenciesOptions {
  frozenLockfile?: boolean;
  commandRunner?: (command: string, args: string[], cwd: string) => Promise<void> | void;
}

export interface ExtensionDependencyInstallResult {
  installed: boolean;
  packageManager?: ExtensionPackageManager;
  lockfile?: string;
  frozenLockfile?: boolean;
}

export interface ValidatedInstallableExtensionResult {
  distributionMode: 'bundled';
  runnableEntries: string[];
}

function defaultCommandRunner(command: string, args: string[], cwd: string): void {
  const result = childProcess.spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  if (result.error) {
    throw result.error;
  }

  if (typeof result.status === 'number' && result.status !== 0) {
    throw new Error(`命令执行失败: ${command} ${args.join(' ')} (exit=${result.status})`);
  }
}

function readPackageJson(packageJsonPath: string): ExtensionInstallablePackageJson | undefined {
  if (!fs.existsSync(packageJsonPath)) return undefined;
  return JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8')) as ExtensionInstallablePackageJson;
}

/**
 * 分析运行时入口 —— core 版本（基于文件系统扫描）。
 * 内部先收集文件列表，再调用共享包的 analyzeRuntimeEntries。
 */
function analyzeRuntimeEntries(extensionDir: string, manifest: ExtensionManifest): RuntimeEntryGroupAnalysis[] {
  const files = collectRelativeFilesFromDir(extensionDir);
  return analyzeRuntimeEntriesShared(files, manifest);
}

function detectPackageManagerFromPackageJson(packageJson: ExtensionInstallablePackageJson | undefined): ExtensionPackageManager | undefined {
  const field = packageJson?.packageManager?.trim();
  if (!field) return undefined;
  if (field.startsWith('bun@')) return 'bun';
  if (field.startsWith('pnpm@')) return 'pnpm';
  if (field.startsWith('yarn@')) return 'yarn';
  if (field.startsWith('npm@')) return 'npm';
  return undefined;
}

export function detectExtensionPackageManager(extensionDir: string, packageJson?: ExtensionInstallablePackageJson): DetectedExtensionPackageManager {
  const lockfileCandidates: Array<{ file: string; manager: ExtensionPackageManager }> = [
    { file: 'bun.lock', manager: 'bun' },
    { file: 'bun.lockb', manager: 'bun' },
    { file: 'pnpm-lock.yaml', manager: 'pnpm' },
    { file: 'yarn.lock', manager: 'yarn' },
    { file: 'package-lock.json', manager: 'npm' },
    { file: 'npm-shrinkwrap.json', manager: 'npm' },
  ];

  for (const candidate of lockfileCandidates) {
    const lockfilePath = path.join(extensionDir, candidate.file);
    if (fs.existsSync(lockfilePath)) {
      return {
        name: candidate.manager,
        lockfile: candidate.file,
        executable: candidate.manager,
      };
    }
  }

  const resolvedPackageJson = packageJson ?? readPackageJson(path.join(extensionDir, 'package.json'));
  const fromPackageJson = detectPackageManagerFromPackageJson(resolvedPackageJson);
  if (fromPackageJson) {
    return {
      name: fromPackageJson,
      executable: fromPackageJson,
    };
  }

  return {
    name: 'npm',
    executable: 'npm',
  };
}

function getInstallCommand(manager: DetectedExtensionPackageManager, frozenLockfile: boolean): { command: string; args: string[] } {
  switch (manager.name) {
    case 'bun':
      return { command: manager.executable, args: frozenLockfile ? ['install', '--frozen-lockfile'] : ['install'] };
    case 'pnpm':
      return { command: manager.executable, args: frozenLockfile ? ['install', '--frozen-lockfile'] : ['install'] };
    case 'yarn':
      return { command: manager.executable, args: frozenLockfile ? ['install', '--frozen-lockfile'] : ['install'] };
    case 'npm':
    default:
      return { command: manager.executable, args: frozenLockfile ? ['ci'] : ['install'] };
  }
}

function copyDirectoryWithoutNodeModules(sourceDir: string, targetDir: string): void {
  fs.cpSync(sourceDir, targetDir, {
    recursive: true,
    filter: (sourcePath) => path.basename(sourcePath) !== 'node_modules',
  });
}

export function copyExtensionDirectory(sourceDir: string, targetDir: string): void {
  copyDirectoryWithoutNodeModules(sourceDir, targetDir);
}

export async function installExtensionDependencies(
  extensionDir: string,
  options: InstallExtensionDependenciesOptions = {},
): Promise<ExtensionDependencyInstallResult> {
  const manager = detectExtensionPackageManager(extensionDir);
  const frozenLockfile = options.frozenLockfile === true;
  const installCommand = getInstallCommand(manager, frozenLockfile);
  const runner = options.commandRunner ?? defaultCommandRunner;

  logger.info(`安装 extension 依赖: ${extensionDir} | manager=${manager.name}${manager.lockfile ? ` | lockfile=${manager.lockfile}` : ''}${frozenLockfile ? ' | frozen=true' : ''}`);
  try {
    await runner(installCommand.command, installCommand.args, extensionDir);
    return {
      installed: true,
      packageManager: manager.name,
      lockfile: manager.lockfile,
      frozenLockfile,
    };
  } catch (err) {
    if (process.platform === 'win32' && manager.name === 'bun') {
      logger.warn(`Bun 在 Windows 上处理 file: 本地依赖存在已知 EPERM 问题 (oven-sh/bun#13379)。尝试回退到 npm install...`);
      try {
        await runner('npm', ['install'], extensionDir);
        return {
          installed: true,
          packageManager: 'npm',
          lockfile: 'package-lock.json',
          frozenLockfile: false,
        };
      } catch (npmErr) {
        logger.error(`回退到 npm install 失败: ${npmErr instanceof Error ? npmErr.message : String(npmErr)}`);
        throw err;
      }
    }
    throw err;
  }
}

export function assertInstallableExtensionPackage(
  extensionDir: string,
  manifest: ExtensionManifest,
): ValidatedInstallableExtensionResult {
  const analyses = analyzeRuntimeEntries(extensionDir, manifest);
  const issues = analyses.filter((item) => item.needsBuild);

  if (issues.length > 0) {
    throw new Error(`这不是可直接安装的发行包：${describeRuntimeIssues(issues)}`);
  }

  return {
    distributionMode: 'bundled',
    runnableEntries: analyses.flatMap((item) => item.runnableAlternatives),
  };
}
