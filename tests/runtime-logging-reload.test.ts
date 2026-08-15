import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { applyRuntimeConfigReload } from '../src/config/runtime.js';
import { LLMRouter } from '../src/llm/router.js';
import type { LLMProviderLike } from '../src/llm/providers/base.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
});

function fakeProvider(name: string): LLMProviderLike {
  return {
    name,
    setLogging: vi.fn(),
    clearLogging: vi.fn(),
    chat: vi.fn(),
    async *chatStream() { /* no-op */ },
  } as unknown as LLMProviderLike;
}

describe('runtime request logging reload', () => {
  it('keeps the shared router identity and applies logging to reloaded providers', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iris-runtime-log-'));
    tempDirs.push(dataDir);
    const logsDir = path.join(dataDir, 'logs');
    const initialProvider = fakeProvider('initial');
    const sharedRouter = new LLMRouter({
      defaultModelName: 'main',
      models: [{
        modelName: 'main',
        provider: initialProvider,
        config: { provider: 'fake', apiKey: '', model: 'old-model', baseUrl: '' },
      }],
    });
    sharedRouter.setLogging(logsDir);

    const reloadedProvider = fakeProvider('reloaded');
    const reloadLLM = vi.fn((next: LLMRouter) => sharedRouter.replaceWith(next));
    const reloadConfig = vi.fn();
    const backend = {
      getCurrentModelName: () => sharedRouter.getCurrentModelName(),
      reloadLLM,
      reloadConfig,
      isStreamEnabled: () => true,
    } as any;

    await applyRuntimeConfigReload({
      backend,
      dataDir,
      logsDir,
      extensions: {
        llmProviders: {
          get: (provider: string) => provider === 'fake'
            ? (() => reloadedProvider)
            : undefined,
        },
      } as any,
    }, {
      llm: {
        defaultModel: 'main',
        models: {
          main: { provider: 'fake', apiKey: '', model: 'new-model', baseUrl: '' },
        },
      },
      system: { logRequests: true, stream: true },
      tools: { permissions: {} },
    });

    expect(reloadLLM).toHaveBeenCalledOnce();
    expect(sharedRouter.resolve('main')).toBe(reloadedProvider);
    expect(sharedRouter.getModelInfo('main').modelId).toBe('new-model');
    expect(reloadedProvider.setLogging).toHaveBeenLastCalledWith(logsDir);
    expect(reloadConfig).toHaveBeenCalledOnce();
  });

  it('disables provider logging when logRequests is turned off', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iris-runtime-log-off-'));
    tempDirs.push(dataDir);
    const provider = fakeProvider('reloaded');
    const sharedRouter = new LLMRouter({
      defaultModelName: 'main',
      models: [{
        modelName: 'main', provider: fakeProvider('initial'),
        config: { provider: 'fake', apiKey: '', model: 'old', baseUrl: '' },
      }],
    });
    const backend = {
      getCurrentModelName: () => 'main',
      reloadLLM: (next: LLMRouter) => sharedRouter.replaceWith(next),
      reloadConfig: vi.fn(),
      isStreamEnabled: () => true,
    } as any;

    await applyRuntimeConfigReload({
      backend,
      dataDir,
      logsDir: path.join(dataDir, 'logs'),
      extensions: { llmProviders: { get: () => () => provider } } as any,
    }, {
      llm: { models: { main: { provider: 'fake', model: 'new', apiKey: '' } } },
      system: { logRequests: false },
      tools: { permissions: {} },
    });

    expect(provider.clearLogging).toHaveBeenCalled();
  });
});
