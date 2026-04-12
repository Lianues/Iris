import { describe, expect, it, vi } from 'vitest';
import { ConsoleSettingsController, type ConsoleSettingsSnapshot } from '../extensions/console/src/settings';

function createSnapshot(contextWindow?: number): ConsoleSettingsSnapshot {
  return {
    models: [{
      modelName: 'main',
      originalModelName: 'main',
      provider: 'gemini',
      apiKey: 'test-key',
      modelId: 'gemini-2.5-flash',
      contextWindow,
      baseUrl: 'https://example.invalid',
    }],
    modelOriginalNames: ['main'],
    defaultModelName: 'main',
    system: {
      systemPrompt: '',
      maxToolRounds: 30,
      stream: true,
      retryOnError: true,
      maxRetries: 3,
      logRequests: false,
      maxAgentDepth: 3,
      defaultMode: '',
      asyncSubAgents: false,
    },
    toolPolicies: [],
    autoApproveAll: false,
    autoApproveConfirmation: false,
    autoApproveDiff: false,
    mcpServers: [],
    mcpStatus: [],
    mcpOriginalNames: [],
  };
}

describe('ConsoleSettingsController 模型上下文窗口持久化', () => {
  it('保存快照时应将 contextWindow 写入 llm payload', async () => {
    let capturedUpdates: Record<string, any> | undefined;
    const controller = new ConsoleSettingsController({
      backend: { getToolNames: () => [] } as any,
      configManager: {
        updateEditableConfig: (updates: Record<string, any>) => {
          capturedUpdates = updates;
          return { mergedRaw: {}, sanitized: {} };
        },
        applyRuntimeConfigReload: async () => ({ success: true }),
      } as any,
      mcpManager: { listServers: () => [] } as any,
    });
    const snapshot = createSnapshot(2048);
    vi.spyOn(controller, 'loadSnapshot').mockResolvedValue(snapshot);

    const result = await controller.saveSnapshot(snapshot);

    expect(result.ok).toBe(true);
    expect(capturedUpdates?.llm?.models?.main?.contextWindow).toBe(2048);
  });

  it('contextWindow 为空时应写出 null 以便清除旧值', async () => {
    let capturedUpdates: Record<string, any> | undefined;
    const controller = new ConsoleSettingsController({
      backend: { getToolNames: () => [] } as any,
      configManager: {
        updateEditableConfig: (updates: Record<string, any>) => {
          capturedUpdates = updates;
          return { mergedRaw: {}, sanitized: {} };
        },
        applyRuntimeConfigReload: async () => ({ success: true }),
      } as any,
      mcpManager: { listServers: () => [] } as any,
    });
    const snapshot = createSnapshot(undefined);
    vi.spyOn(controller, 'loadSnapshot').mockResolvedValue(snapshot);

    const result = await controller.saveSnapshot(snapshot);

    expect(result.ok).toBe(true);
    expect(capturedUpdates?.llm?.models?.main?.contextWindow).toBeNull();
  });
});
