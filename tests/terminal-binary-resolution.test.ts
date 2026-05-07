import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveTerminalBinary } from '../src/terminal.js';

const createdDirs: string[] = [];
const originalIrisPkgDir = process.env.__IRIS_PKG_DIR;

function createTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  createdDirs.push(dir);
  return dir;
}

function restoreEnv(name: '__IRIS_PKG_DIR', value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

function currentPlatformPackageName(): string {
  const platformMap: Record<string, string> = { darwin: 'darwin', linux: 'linux', win32: 'windows' };
  const archMap: Record<string, string> = { x64: 'x64', arm64: 'arm64', arm: 'arm' };
  const platform = platformMap[os.platform()] ?? os.platform();
  const arch = archMap[os.arch()] ?? os.arch();
  return `irises-${platform}-${arch}`;
}

afterEach(() => {
  restoreEnv('__IRIS_PKG_DIR', originalIrisPkgDir);
  for (const dir of createdDirs.splice(0, createdDirs.length)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('terminal binary resolution', () => {
  it('npm 包装器场景下应能从 node_modules 平台包找到 iris-onboard 二进制', () => {
    const wrapperDir = createTempDir('iris-terminal-wrapper-');
    const binaryName = process.platform === 'win32' ? 'iris-onboard.exe' : 'iris-onboard';
    const platformBinDir = path.join(wrapperDir, 'node_modules', currentPlatformPackageName(), 'bin');
    const expectedBinary = path.join(platformBinDir, binaryName);

    fs.mkdirSync(platformBinDir, { recursive: true });
    fs.mkdirSync(path.join(wrapperDir, 'bin'), { recursive: true });
    fs.writeFileSync(expectedBinary, '', 'utf8');
    process.env.__IRIS_PKG_DIR = wrapperDir;

    expect(resolveTerminalBinary()).toBe(path.resolve(expectedBinary));
  });
});
