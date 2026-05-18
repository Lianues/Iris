import { afterEach, describe, expect, it, vi } from 'vitest';
import { createExtensionHandlers } from '../extensions/web/src/handlers/extensions.js';

const originalRemoteIndexUrl = process.env.IRIS_EXTENSION_REMOTE_INDEX_URL;
const originalRemoteRawBaseUrl = process.env.IRIS_EXTENSION_REMOTE_RAW_BASE_URL;

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
      writeHead: vi.fn((status: number) => { statusCode = status; }),
      end: vi.fn((chunk: string) => { body = chunk; }),
    } as any,
    getStatus: () => statusCode,
    getJson: () => JSON.parse(body) as Record<string, unknown>,
  };
}

afterEach(() => {
  process.env.IRIS_EXTENSION_REMOTE_INDEX_URL = originalRemoteIndexUrl;
  process.env.IRIS_EXTENSION_REMOTE_RAW_BASE_URL = originalRemoteRawBaseUrl;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('web extension remote handler', () => {
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
