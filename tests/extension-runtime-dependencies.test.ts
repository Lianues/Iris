import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ensureExtensionRuntimeDependencies,
  getMissingExtensionRuntimeDependencies,
} from 'irises-extension-sdk/utils';

const createdDirs: string[] = [];

function createTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  createdDirs.push(dir);
  return dir;
}

function writePackageJson(extensionDir: string, value: unknown): void {
  fs.writeFileSync(path.join(extensionDir, 'package.json'), JSON.stringify(value, null, 2), 'utf8');
}

function createResolvedDependency(extensionDir: string, name: string): void {
  const packageDir = path.join(extensionDir, 'node_modules', ...name.split('/'));
  fs.mkdirSync(packageDir, { recursive: true });
  fs.writeFileSync(path.join(packageDir, 'package.json'), JSON.stringify({ name, version: '1.0.0' }), 'utf8');
  fs.writeFileSync(path.join(packageDir, 'index.js'), 'module.exports = {};\n', 'utf8');
}

afterEach(() => {
  for (const dir of createdDirs.splice(0, createdDirs.length)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('extension runtime dependencies', () => {
  it('缺少运行时依赖时应安装缺失项并再次校验', async () => {
    const extensionDir = createTempDir('iris-extension-deps-');
    writePackageJson(extensionDir, {
      dependencies: {
        ssh2: '^1.15.0',
        'irises-extension-sdk': 'file:../../packages/extension-sdk',
      },
    });

    const runner = vi.fn(async (command: string, args: string[], cwd: string) => {
      expect(command).toBe('npm');
      expect(args).toContain('--');
      expect(args).toContain('ssh2@^1.15.0');
      expect(args.join(' ')).not.toContain('irises-extension-sdk');
      createResolvedDependency(cwd, 'ssh2');
    });

    const result = await ensureExtensionRuntimeDependencies(extensionDir, { commandRunner: runner });

    expect(result.installed).toBe(true);
    expect(result.missingDependencies).toEqual(['ssh2']);
    expect(runner).toHaveBeenCalledOnce();
    expect(getMissingExtensionRuntimeDependencies(extensionDir).missingDependencies).toEqual([]);
  });

  it('依赖已存在时不重复安装', async () => {
    const extensionDir = createTempDir('iris-extension-deps-');
    writePackageJson(extensionDir, { dependencies: { yaml: '^2.8.2' } });
    createResolvedDependency(extensionDir, 'yaml');
    const runner = vi.fn();

    const result = await ensureExtensionRuntimeDependencies(extensionDir, { commandRunner: runner });

    expect(result.installed).toBe(false);
    expect(result.missingDependencies).toEqual([]);
    expect(runner).not.toHaveBeenCalled();
  });

  it('非 registry 依赖缺失时给出明确错误', async () => {
    const extensionDir = createTempDir('iris-extension-deps-');
    writePackageJson(extensionDir, { dependencies: { custom: 'file:../custom' } });

    await expect(ensureExtensionRuntimeDependencies(extensionDir, { commandRunner: vi.fn() }))
      .rejects
      .toThrow('无法自动安装');
  });
});
