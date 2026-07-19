import * as childProcess from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(__filename), '..');
const createdDirs: string[] = [];

function readJson(filePath: string): any {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function createPlatformFixture(options: { localDependency: boolean }): string {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'iris-runtime-validation-test-'));
  createdDirs.push(fixtureRoot);
  const platform = process.platform === 'win32' ? 'windows' : process.platform;
  const packageDir = path.join(fixtureRoot, `iris-${platform}-${process.arch}`);
  const extensionDir = path.join(packageDir, 'extensions', 'probe');
  fs.mkdirSync(path.join(extensionDir, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(packageDir, 'package.json'), JSON.stringify({
    name: `irises-${platform}-${process.arch}`,
    version: '0.0.0',
  }));
  fs.writeFileSync(path.join(extensionDir, 'manifest.json'), JSON.stringify({
    name: 'probe',
    version: '0.0.0',
    platforms: [{ name: 'probe', entry: 'dist/index.mjs' }],
  }));
  fs.writeFileSync(path.join(extensionDir, 'package.json'), JSON.stringify({
    name: '@iris-extension/probe',
    version: '0.0.0',
    type: 'module',
    dependencies: { 'iris-runtime-probe-dependency': '1.0.0' },
  }));
  fs.writeFileSync(
    path.join(extensionDir, 'dist', 'index.mjs'),
    'import value from "iris-runtime-probe-dependency";\nif (value !== 42) throw new Error("bad probe value");\n',
  );

  if (options.localDependency) {
    const dependencyDir = path.join(extensionDir, 'node_modules', 'iris-runtime-probe-dependency');
    fs.mkdirSync(dependencyDir, { recursive: true });
    fs.writeFileSync(path.join(dependencyDir, 'package.json'), JSON.stringify({
      name: 'iris-runtime-probe-dependency',
      version: '1.0.0',
      type: 'module',
      exports: './index.js',
    }));
    fs.writeFileSync(path.join(dependencyDir, 'index.js'), 'export default 42;\n');
  }

  return packageDir;
}

function runValidator(packageDir: string, options: { npmPack?: boolean } = {}): childProcess.SpawnSyncReturns<string> {
  return childProcess.spawnSync(
    process.execPath,
    [
      path.join(rootDir, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
      path.join(rootDir, 'script', 'validate-extension-runtime.ts'),
      ...(options.npmPack ? ['--npm-pack'] : []),
      packageDir,
    ],
    {
      cwd: rootDir,
      encoding: 'utf8',
      timeout: 60_000,
      env: process.env,
    },
  );
}

afterEach(() => {
  for (const dir of createdDirs.splice(0, createdDirs.length)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('extension runtime release validation', () => {
  it('锁定 Console 与根项目使用的 OpenTUI 版本', () => {
    const rootPackage = readJson(path.join(rootDir, 'package.json'));
    const consolePackage = readJson(path.join(rootDir, 'extensions', 'console', 'package.json'));
    const rootLock = readJson(path.join(rootDir, 'package-lock.json'));
    const consoleLock = readJson(path.join(rootDir, 'extensions', 'console', 'package-lock.json'));
    const consoleBunLock = fs.readFileSync(
      path.join(rootDir, 'extensions', 'console', 'bun.lock'),
      'utf8',
    );

    for (const dependencyName of ['@opentui/core', '@opentui/react']) {
      const consoleSpec = consolePackage.dependencies[dependencyName];
      expect(consoleSpec).toMatch(/^\d+\.\d+\.\d+$/);
      expect(rootPackage.optionalDependencies[dependencyName]).toBe(consoleSpec);
      expect(rootLock.packages[`node_modules/${dependencyName}`].version).toBe(consoleSpec);
      expect(consoleLock.packages[''].dependencies[dependencyName]).toBe(consoleSpec);
      expect(consoleLock.packages[`node_modules/${dependencyName}`].version).toBe(consoleSpec);
      expect(consoleBunLock).toContain(`"${dependencyName}": "${consoleSpec}"`);
      expect(consoleBunLock).toContain(`"${dependencyName}": ["${dependencyName}@${consoleSpec}"`);
    }

    const reactSpec = consolePackage.dependencies.react;
    expect(reactSpec).toMatch(/^\d+\.\d+\.\d+$/);
    expect(consoleLock.packages[''].dependencies.react).toBe(reactSpec);
    expect(consoleLock.packages['node_modules/react'].version).toBe(reactSpec);
    expect(consoleBunLock).toContain(`"react": "${reactSpec}"`);
    expect(consoleBunLock).toContain(`"react": ["react@${reactSpec}"`);
  });

  it('隔离校验可加载 extension 自己的运行时依赖', () => {
    const result = runValidator(
      createPlatformFixture({ localDependency: true }),
      { npmPack: true },
    );
    expect(result.error).toBeUndefined();
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stdout).toContain('[extension-runtime] OK: 1 个入口');
  });

  it('隔离校验拒绝缺失或向上回退的运行时依赖', () => {
    const result = runValidator(createPlatformFixture({ localDependency: false }));
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain('iris-runtime-probe-dependency');
  });
});
