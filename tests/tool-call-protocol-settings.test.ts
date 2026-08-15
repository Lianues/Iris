import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
  applyModelProviderChange,
  ConsoleSettingsController,
  createEmptyModel,
  supportsConsoleToolCallProtocol,
  type ConsoleSettingsSnapshot,
} from '../extensions/console/src/settings';

function snapshot(): ConsoleSettingsSnapshot {
  return {
    models: [{
      modelName: 'text_tools',
      originalModelName: 'text_tools',
      provider: 'openai-compatible',
      apiKey: 'key',
      modelId: 'local-model',
      contextWindow: 128_000,
      autoSummaryEnabled: true,
      autoSummaryThreshold: '90%',
      toolCallProtocol: 'tagged-json',
      baseUrl: 'http://127.0.0.1:8000/v1',
    }],
    modelOriginalNames: ['text_tools'],
    defaultModelName: 'text_tools',
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

describe('tool call protocol settings', () => {
  it('exposes tagged JSON only for the providers that implement it', () => {
    expect(supportsConsoleToolCallProtocol('openai-compatible')).toBe(true);
    expect(supportsConsoleToolCallProtocol('deepseek')).toBe(true);
    expect(supportsConsoleToolCallProtocol('gemini')).toBe(false);
    expect(createEmptyModel('openai-compatible').toolCallProtocol).toBe('native');

    const tagged = snapshot().models[0];
    expect(applyModelProviderChange(tagged, 'deepseek').toolCallProtocol).toBe('tagged-json');
    expect(applyModelProviderChange(tagged, 'gemini').toolCallProtocol).toBe('native');
  });

  it('loads and saves tagged-json without losing it in Console settings', async () => {
    const loadController = new ConsoleSettingsController({
      backend: { getToolNames: () => [] } as any,
      configManager: {
        readEditableConfig: () => ({ llm: {}, system: {}, tools: {} }),
        parseLLMConfig: () => ({
          defaultModelName: 'text_tools',
          models: [{
            modelName: 'text_tools',
            provider: 'openai-compatible',
            apiKey: 'key',
            model: 'local-model',
            baseUrl: 'http://127.0.0.1:8000/v1',
            toolCallProtocol: 'tagged-json',
          }],
        }),
        parseSystemConfig: () => ({}),
        parseToolsConfig: () => ({ permissions: {} }),
      } as any,
    });
    expect((await loadController.loadSnapshot()).models[0].toolCallProtocol).toBe('tagged-json');

    let capturedUpdates: Record<string, any> | undefined;
    const saveController = new ConsoleSettingsController({
      backend: { getToolNames: () => [] } as any,
      configManager: {
        updateEditableConfig: (updates: Record<string, any>) => {
          capturedUpdates = updates;
          return { mergedRaw: {}, sanitized: {} };
        },
        applyRuntimeConfigReload: async () => ({ success: true }),
      } as any,
    });
    const draft = snapshot();
    draft.models.push({
      ...draft.models[0],
      modelName: 'native',
      originalModelName: 'native',
      toolCallProtocol: 'native',
    });
    draft.models.push({
      ...draft.models[0],
      modelName: 'gemini',
      originalModelName: 'gemini',
      provider: 'gemini',
      toolCallProtocol: 'tagged-json',
    });
    draft.modelOriginalNames.push('native', 'gemini');
    vi.spyOn(saveController, 'loadSnapshot').mockResolvedValue(draft);

    expect((await saveController.saveSnapshot(draft)).ok).toBe(true);
    expect(capturedUpdates?.llm?.models?.text_tools?.toolCallProtocol).toBe('tagged-json');
    expect(capturedUpdates?.llm?.models?.native?.toolCallProtocol).toBeNull();
    expect(capturedUpdates?.llm?.models?.gemini?.toolCallProtocol).toBeNull();
  });

  it('keeps the Console TUI control wired to the protocol setting', () => {
    const consoleSource = readFileSync(
      path.resolve(__dirname, '../extensions/console/src/components/SettingsView.tsx'),
      'utf8',
    );

    expect(consoleSource).toContain('modelToolCallProtocol');
    expect(consoleSource).toContain('工具调用协议');
  });
});
