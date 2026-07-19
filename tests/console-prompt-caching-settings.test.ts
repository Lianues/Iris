import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  applyConsoleClaudePromptCacheMode,
  applyModelProviderChange,
  ConsoleSettingsController,
  getConsoleClaudePromptCacheMode,
  getConsolePromptCacheKind,
  isConsolePromptCachingEnabled,
  type ConsoleSettingsSnapshot,
} from '../extensions/console/src/settings';

function snapshot(): ConsoleSettingsSnapshot {
  return {
    models: [{
      modelName: 'main',
      originalModelName: 'main',
      provider: 'openai-responses',
      apiKey: 'test-key',
      modelId: 'gpt-5.6',
      contextWindow: 1_050_000,
      autoSummaryEnabled: true,
      autoSummaryThreshold: '90%',
      promptCaching: false,
      baseUrl: 'https://api.openai.com/v1',
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

describe('Console Prompt Cache 设置', () => {
  it('按 provider 和模型识别缓存能力与默认状态', () => {
    expect(getConsolePromptCacheKind({
      provider: 'claude',
      modelId: 'claude-sonnet-4-6',
    })).toBe('claude');
    expect(getConsolePromptCacheKind({
      provider: 'openai-responses',
      modelId: 'gpt-5.6-terra',
    })).toBe('openai-gpt-5.6');
    expect(getConsolePromptCacheKind({
      provider: 'openai-compatible',
      modelId: 'openai/gpt-5.7',
    })).toBe('openai-gpt-5.6');
    expect(getConsolePromptCacheKind({
      provider: 'openai-responses',
      modelId: 'gpt-5.5',
    })).toBeNull();

    expect(isConsolePromptCachingEnabled({
      provider: 'openai-responses',
      modelId: 'gpt-5.6',
    })).toBe(true);
    expect(isConsolePromptCachingEnabled({
      provider: 'openai-responses',
      modelId: 'gpt-5.6',
      promptCaching: false,
    })).toBe(false);
    expect(isConsolePromptCachingEnabled({
      provider: 'claude',
      modelId: 'claude-sonnet-4-6',
      promptCaching: undefined,
    })).toBe(false);
  });

  it('把 Claude 缓存表示为关闭、自动、显式三个互斥策略', () => {
    const claude = {
      ...snapshot().models[0],
      provider: 'claude',
      modelId: 'claude-sonnet-4-6',
      promptCaching: true,
      autoCaching: true,
    };

    // 旧配置两者都开启时，显式策略优先；当前 Iris 显式断点已覆盖最后消息。
    expect(getConsoleClaudePromptCacheMode(claude)).toBe('explicit');
    expect(applyConsoleClaudePromptCacheMode(claude, 'automatic')).toMatchObject({
      promptCaching: false,
      autoCaching: true,
    });
    expect(applyConsoleClaudePromptCacheMode(claude, 'explicit')).toMatchObject({
      promptCaching: true,
      autoCaching: false,
    });
    expect(applyConsoleClaudePromptCacheMode(claude, 'off')).toMatchObject({
      promptCaching: false,
      autoCaching: false,
    });
  });

  it('切换 Provider 时清理跨渠道缓存状态，同一 OpenAI 缓存家族保留选择', () => {
    const defaults = {
      claude: {
        model: 'claude-sonnet-4-6',
        baseUrl: 'https://api.anthropic.com/v1',
      },
      'openai-responses': {
        model: 'gpt-5.6',
        baseUrl: 'https://api.openai.com/v1',
      },
      'openai-compatible': {
        model: 'gpt-5.6',
        baseUrl: 'https://api.openai.com/v1',
      },
    };
    const claude = {
      ...snapshot().models[0],
      provider: 'claude',
      modelId: 'claude-sonnet-4-6',
      baseUrl: 'https://api.anthropic.com/v1',
      promptCaching: true,
      autoCaching: false,
    };

    const openai = applyModelProviderChange(claude, 'openai-responses', defaults);
    expect(openai).toMatchObject({
      provider: 'openai-responses',
      modelId: 'gpt-5.6',
      promptCaching: undefined,
      autoCaching: undefined,
    });
    expect(isConsolePromptCachingEnabled(openai)).toBe(true);

    const disabledOpenAI = { ...openai, promptCaching: false };
    const compatible = applyModelProviderChange(disabledOpenAI, 'openai-compatible', defaults);
    expect(compatible.promptCaching).toBe(false);

    const backToClaude = applyModelProviderChange(compatible, 'claude', defaults);
    expect(getConsoleClaudePromptCacheMode(backToClaude)).toBe('off');
    expect(backToClaude).toMatchObject({
      promptCaching: false,
      autoCaching: false,
    });
  });

  it('从配置快照读取缓存设置，并规范化 Claude 的冗余组合', async () => {
    const controller = new ConsoleSettingsController({
      backend: { getToolNames: () => [] } as any,
      configManager: {
        readEditableConfig: () => ({ llm: {}, system: {}, tools: {} }),
        parseLLMConfig: () => ({
          defaultModelName: 'openai',
          models: [
            {
              modelName: 'openai',
              provider: 'openai-responses',
              apiKey: 'key',
              model: 'gpt-5.6',
              baseUrl: 'https://api.openai.com/v1',
              promptCaching: false,
            },
            {
              modelName: 'claude',
              provider: 'claude',
              apiKey: 'key',
              model: 'claude-sonnet-4-6',
              baseUrl: 'https://api.anthropic.com/v1',
              promptCaching: true,
              autoCaching: true,
            },
          ],
        }),
        parseSystemConfig: () => ({}),
        parseToolsConfig: () => ({ permissions: {} }),
      } as any,
    });

    const loaded = await controller.loadSnapshot();
    expect(loaded.models[0]).toMatchObject({ promptCaching: false });
    expect(loaded.models[1]).toMatchObject({
      promptCaching: true,
      autoCaching: false,
    });
  });

  it('保存时写回规范化策略，并删除不适用 Provider 的旧缓存字段', async () => {
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
    });
    const draft = snapshot();
    draft.models.push({
      ...draft.models[0],
      modelName: 'claude',
      originalModelName: 'claude',
      provider: 'claude',
      modelId: 'claude-sonnet-4-6',
      promptCaching: true,
      autoCaching: true,
    });
    draft.models.push({
      ...draft.models[0],
      modelName: 'gemini',
      originalModelName: 'gemini',
      provider: 'gemini',
      modelId: 'gemini-2.0-flash',
      promptCaching: true,
      autoCaching: true,
    });
    draft.modelOriginalNames.push('claude');
    draft.modelOriginalNames.push('gemini');
    vi.spyOn(controller, 'loadSnapshot').mockResolvedValue(draft);

    expect((await controller.saveSnapshot(draft)).ok).toBe(true);
    expect(capturedUpdates?.llm?.models?.main?.promptCaching).toBe(false);
    expect(capturedUpdates?.llm?.models?.claude).toMatchObject({
      promptCaching: true,
      autoCaching: false,
    });
    expect(capturedUpdates?.llm?.models?.gemini).toMatchObject({
      promptCaching: null,
      autoCaching: null,
    });
  });

  it('Settings 界面为 Claude 只显示一条策略行，并保留 OpenAI 开关', () => {
    const source = readFileSync(
      path.resolve(__dirname, '../extensions/console/src/components/SettingsView.tsx'),
      'utf8',
    );

    expect(source).toContain('Prompt Cache 策略');
    expect(source).toContain('关闭 / 自动（推荐）/ 显式断点');
    expect(source).not.toContain('Prompt Cache / 手动断点');
    expect(source).not.toContain('Prompt Cache / 自动断点');
    expect(source).toContain('OpenAI GPT-5.6+');
    expect(source).toContain("target.kind === 'modelPromptCaching'");
    expect(source).toContain("target.kind === 'modelClaudePromptCacheMode'");
    expect(source).not.toContain("target.kind === 'modelAutoCaching'");
  });
});
