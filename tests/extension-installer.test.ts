import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import JSZip from 'jszip';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseExtensionCommandArgs } from '../src/extension/command.js';
import { installExtension, installLocalExtension } from '../src/extension/installer.js';

const createdDirs: string[] = [];

function createTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  createdDirs.push(dir);
  return dir;
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf-8');
}

function writeText(filePath: string, value: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value, 'utf-8');
}

async function createZipBuffer(files: Record<string, string | Buffer>): Promise<Buffer> {
  const zip = new JSZip();
  for (const [filePath, value] of Object.entries(files)) {
    zip.file(filePath, value);
  }
  return await zip.generateAsync({ type: 'nodebuffer' });
}

function mockFetchWithMap(map: Record<string, Response>): void {
  vi.stubGlobal('fetch', vi.fn(async (input: any) => {
    const url = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : String(input?.url ?? input);
    return map[url] ?? new Response('not found', { status: 404, statusText: 'Not Found' });
  }));
}

afterEach(() => {
  for (const dir of createdDirs.splice(0, createdDirs.length)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('extension installer', () => {
  it('install-local 支持按本地目录名安装，并按 manifest.name 写入目标目录', async () => {
    const localExtensionsDir = createTempDir('iris-ext-local-');
    const installedExtensionsDir = createTempDir('iris-ext-installed-');
    const sourceDir = path.join(localExtensionsDir, 'folder-demo');

    writeJson(path.join(sourceDir, 'manifest.json'), {
      name: 'demo-extension',
      version: '0.1.0',
    });
    writeText(path.join(sourceDir, 'index.mjs'), 'export default {};\n');

    const result = await installLocalExtension('folder-demo', {
      localExtensionsDir,
      installedExtensionsDir,
    });

    expect(result.source).toBe('local');
    expect(result.name).toBe('demo-extension');
    expect(result.targetDir).toBe(path.join(installedExtensionsDir, 'demo-extension'));
    expect(fs.existsSync(path.join(installedExtensionsDir, 'demo-extension', 'manifest.json'))).toBe(true);
    expect(fs.existsSync(path.join(installedExtensionsDir, 'demo-extension', 'index.mjs'))).toBe(true);
  });

  it('install 支持按远程 extensions 目录安装', async () => {
    const installedExtensionsDir = createTempDir('iris-ext-installed-');
    const remoteArchiveUrl = 'https://example.com/Iris-main.zip';
    const archive = await createZipBuffer({
      'Iris-main/extensions/community/demo-extension/manifest.json': JSON.stringify({
        name: 'remote-demo-extension',
        version: '1.2.3',
      }, null, 2),
      'Iris-main/extensions/community/demo-extension/plugin.mjs': 'export default {};\n',
      'Iris-main/extensions/community/demo-extension/assets/readme.md': '# demo\n',
    });

    mockFetchWithMap({
      [remoteArchiveUrl]: new Response(archive, { status: 200 }),
    });

    const result = await installExtension('community/demo-extension', {
      remoteArchiveUrl,
      remoteArchiveRootDir: 'Iris-main',
      installedExtensionsDir,
    });

    expect(result.source).toBe('remote');
    expect(result.remotePath).toBe('extensions/community/demo-extension');
    expect(result.name).toBe('remote-demo-extension');
    expect(result.targetDir).toBe(path.join(installedExtensionsDir, 'remote-demo-extension'));
    expect(fs.existsSync(path.join(installedExtensionsDir, 'remote-demo-extension', 'plugin.mjs'))).toBe(true);
    expect(fs.existsSync(path.join(installedExtensionsDir, 'remote-demo-extension', 'assets', 'readme.md'))).toBe(true);
  });

  it('install 在远程目录不存在时会回退到本地安装', async () => {
    const localExtensionsDir = createTempDir('iris-ext-local-');
    const installedExtensionsDir = createTempDir('iris-ext-installed-');
    const remoteArchiveUrl = 'https://example.com/Iris-main.zip';
    const sourceDir = path.join(localExtensionsDir, 'fallback-demo');
    const archive = await createZipBuffer({
      'Iris-main/extensions/another-extension/manifest.json': JSON.stringify({
        name: 'another-extension',
        version: '0.0.1',
      }, null, 2),
    });

    writeJson(path.join(sourceDir, 'manifest.json'), {
      name: 'fallback-demo',
      version: '0.3.0',
    });
    writeText(path.join(sourceDir, 'index.mjs'), 'export default {};\n');
    mockFetchWithMap({
      [remoteArchiveUrl]: new Response(archive, { status: 200 }),
    });

    const result = await installExtension('fallback-demo', {
      remoteArchiveUrl,
      remoteArchiveRootDir: 'Iris-main',
      localExtensionsDir,
      installedExtensionsDir,
    });

    expect(result.source).toBe('local');
    expect(result.fallbackReason).toBe('remote_path_not_found');
    expect(result.fallbackDetail).toContain('extensions/fallback-demo');
    expect(fs.existsSync(path.join(installedExtensionsDir, 'fallback-demo', 'manifest.json'))).toBe(true);
  });

  it('install 在远程仓库不可用时直接报错，不回退到本地安装', async () => {
    const localExtensionsDir = createTempDir('iris-ext-local-');
    const installedExtensionsDir = createTempDir('iris-ext-installed-');
    const remoteArchiveUrl = 'https://example.com/Iris-main.zip';
    const sourceDir = path.join(localExtensionsDir, 'fallback-demo');

    writeJson(path.join(sourceDir, 'manifest.json'), {
      name: 'fallback-demo',
      version: '0.3.0',
    });
    writeText(path.join(sourceDir, 'index.mjs'), 'export default {};\n');

    mockFetchWithMap({
      [remoteArchiveUrl]: new Response('not found', { status: 404, statusText: 'Not Found' }),
    });

    await expect(installExtension('fallback-demo', {
      remoteArchiveUrl,
      localExtensionsDir,
      installedExtensionsDir,
    })).rejects.toThrow('远程 extension 仓库不可用');
    expect(fs.existsSync(path.join(installedExtensionsDir, 'fallback-demo', 'manifest.json'))).toBe(false);
  });
});

describe('extension command parser', () => {
  it('支持 ext 的最简写法与 install-local 子命令', () => {
    expect(parseExtensionCommandArgs(['ext', 'community/demo-extension'])).toEqual({
      namespace: 'ext',
      action: 'install',
      target: 'community/demo-extension',
    });

    expect(parseExtensionCommandArgs(['extension', 'install-local', 'demo-extension'])).toEqual({
      namespace: 'extension',
      action: 'install-local',
      target: 'demo-extension',
    });
  });
});
