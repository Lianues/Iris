import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveTerminalInstallDir } from '../terminal/src/shared/install-dir.js';

const createdDirs: string[] = [];
const originalIrisDir = process.env.IRIS_DIR;
const originalIrisPkgDir = process.env.__IRIS_PKG_DIR;

function createTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  createdDirs.push(dir);
  return dir;
}

function createPackagedRuntimeResources(rootDir: string): void {
  fs.mkdirSync(path.join(rootDir, 'data', 'configs.example'), { recursive: true });
  fs.mkdirSync(path.join(rootDir, 'extensions'), { recursive: true });
  fs.writeFileSync(path.join(rootDir, 'data', 'configs.example', 'llm.yaml'), 'models: {}\n', 'utf8');
}

function currentPlatformPackageName(): string {
  const platformMap: Record<string, string> = { darwin: 'darwin', linux: 'linux', win32: 'windows' };
  const archMap: Record<string, string> = { x64: 'x64', arm64: 'arm64', arm: 'arm' };
  const platform = platformMap[os.platform()] ?? os.platform();
  const arch = archMap[os.arch()] ?? os.arch();
  return `irises-${platform}-${arch}`;
}

function restoreEnv(name: 'IRIS_DIR' | '__IRIS_PKG_DIR', value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

afterEach(() => {
  restoreEnv('IRIS_DIR', originalIrisDir);
  restoreEnv('__IRIS_PKG_DIR', originalIrisPkgDir);
  for (const dir of createdDirs.splice(0, createdDirs.length)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('terminal install dir resolution', () => {
  it('应能从发行包 iris-onboard 可执行文件推导安装目录', () => {
    const installDir = createTempDir('iris-tui-release-');
    const executablePath = path.join(
      installDir,
      'bin',
      process.platform === 'win32' ? 'iris-onboard.exe' : 'iris-onboard',
    );

    createPackagedRuntimeResources(installDir);
    fs.mkdirSync(path.dirname(executablePath), { recursive: true });
    fs.writeFileSync(executablePath, '', 'utf8');

    expect(resolveTerminalInstallDir([], executablePath)).toBe(path.resolve(installDir));
  });

  it('应能通过 __IRIS_PKG_DIR 在 npm 包装器的 node_modules 中找到平台包资源', () => {
    const wrapperDir = createTempDir('iris-tui-wrapper-');
    const platformPackageDir = path.join(wrapperDir, 'node_modules', currentPlatformPackageName());
    const cachedExecutablePath = path.join(
      wrapperDir,
      'bin',
      process.platform === 'win32' ? '.iris-onboard.exe' : '.iris-onboard',
    );

    createPackagedRuntimeResources(platformPackageDir);
    fs.mkdirSync(path.dirname(cachedExecutablePath), { recursive: true });
    fs.writeFileSync(cachedExecutablePath, '', 'utf8');
    process.env.__IRIS_PKG_DIR = wrapperDir;

    expect(resolveTerminalInstallDir([], cachedExecutablePath)).toBe(path.resolve(platformPackageDir));
  });

  it('extension CLI 子命令的位置参数不应被误判为 install-dir 覆盖', () => {
    const installDir = createTempDir('iris-tui-extension-cli-');
    const executablePath = path.join(
      installDir,
      'bin',
      process.platform === 'win32' ? 'iris-onboard.exe' : 'iris-onboard',
    );

    createPackagedRuntimeResources(installDir);
    fs.mkdirSync(path.dirname(executablePath), { recursive: true });
    fs.writeFileSync(executablePath, '', 'utf8');

    expect(
      resolveTerminalInstallDir(['install', 'demo-extension'], executablePath, { allowPositionalOverride: false }),
    ).toBe(path.resolve(installDir));
  });
});
