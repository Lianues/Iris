import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createExtensionHandlers } from '../extensions/web/src/handlers/extensions.js';

const originalRemoteIndexUrl = process.env.IRIS_EXTENSION_REMOTE_INDEX_URL;
const originalRemoteRawBaseUrl = process.env.IRIS_EXTENSION_REMOTE_RAW_BASE_URL;
const originalIrisDataDir = process.env.IRIS_DATA_DIR;
const createdDirs: string[] = [];

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function mockFetchWithMap(map: Record<string, Response>) {
  const fetchMock = vi.fn(async (input: any) => {
    const url = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : String(input?.url ?? input);
    return map[url] ?? new Response('not found', { status: 404, statusText: 'Not Found' });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function createMockResponse() {
  let statusCode = 0;
  let body = '';
  return {
    res: {
      get headersSent() { return statusCode !== 0; },
      writeHead: vi.fn((status: number) => { statusCode = status; }),
      end: vi.fn((chunk: string) => { body = chunk; }),
    } as any,
    getStatus: () => statusCode,
    getJson: () => JSON.parse(body) as Record<string, unknown>,
  };
}

function createTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  createdDirs.push(dir);
  return dir;
}

afterEach(() => {
  process.env.IRIS_EXTENSION_REMOTE_INDEX_URL = originalRemoteIndexUrl;
  process.env.IRIS_EXTENSION_REMOTE_RAW_BASE_URL = originalRemoteRawBaseUrl;
  if (originalIrisDataDir === undefined) delete process.env.IRIS_DATA_DIR;
  else process.env.IRIS_DATA_DIR = originalIrisDataDir;
  for (const dir of createdDirs.splice(0, createdDirs.length)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('web extension remote handler', () => {
  it('拒绝带路径穿越的 extension 名称，避免越过 installed extensions 目录', async () => {
    const rootDir = createTempDir('iris-web-extension-handler-');
    process.env.IRIS_DATA_DIR = path.join(rootDir, 'data');
    const outsideDir = path.join(rootDir, 'data', 'outside-extension');
    fs.mkdirSync(outsideDir, { recursive: true });
    fs.writeFileSync(
      path.join(outsideDir, 'manifest.json'),
      JSON.stringify({ name: 'outside-extension', version: '1.0.0' }),
      'utf8',
    );

    const handlers = createExtensionHandlers(process.cwd());
    for (const action of ['enable', 'disable', 'remove'] as const) {
      const { res, getStatus, getJson } = createMockResponse();
      await handlers[action]({} as any, res, { name: '../outside-extension' });

      expect(getStatus()).toBe(400);
      expect(String(getJson().error)).toContain('extension 名称无效');
      expect(fs.existsSync(outsideDir)).toBe(true);
    }
  });

  it('仍允许删除 installed extensions 目录下的普通 extension 名称', async () => {
    const rootDir = createTempDir('iris-web-extension-handler-');
    process.env.IRIS_DATA_DIR = path.join(rootDir, 'data');
    const extensionDir = path.join(rootDir, 'data', 'extensions', 'demo-extension');
    fs.mkdirSync(extensionDir, { recursive: true });
    fs.writeFileSync(
      path.join(extensionDir, 'manifest.json'),
      JSON.stringify({ name: 'demo-extension', version: '1.0.0' }),
      'utf8',
    );

    const { res, getStatus, getJson } = createMockResponse();
    await createExtensionHandlers(process.cwd()).remove({} as any, res, { name: 'demo-extension' });

    expect(getStatus()).toBe(200);
    expect(getJson()).toEqual({ ok: true });
    expect(fs.existsSync(extensionDir)).toBe(false);
  });

  it('远程 index 非空但所有 manifest 读取失败时返回明确错误而不是空列表', async () => {
    const remoteIndexUrl = 'https://example.com/extensions/index.json';
    const remoteRawBaseUrl = 'https://example.com/raw';
    process.env.IRIS_EXTENSION_REMOTE_INDEX_URL = remoteIndexUrl;
    process.env.IRIS_EXTENSION_REMOTE_RAW_BASE_URL = remoteRawBaseUrl;
    mockFetchWithMap({
      [remoteIndexUrl]: jsonResponse({ extensions: ['broken-extension'] }),
    });

    const { res, getStatus, getJson } = createMockResponse();
    await createExtensionHandlers(process.cwd()).remote({} as any, res);

    expect(getStatus()).toBe(500);
    expect(String(getJson().error)).toContain('远程 extension manifest 全部读取失败');
  });
});
