import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { registerVirtualLoverSettingsTab } from '../extensions/virtual-lover/src/settings-tab.js';

describe('virtual-lover TUI settings tab', () => {
  it('注册 virtual-lover settings tab，并保存 virtual_lover / delivery binding / prompt fragments', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iris-vlover-settings-'));
    try {
      let registered: any;
      const applyRuntimeConfigReload = vi.fn(async () => ({ success: true }));
      const updateEditableConfig = vi.fn((update: any) => ({ mergedRaw: update }));
      const ctx = {
        readConfigSection: vi.fn(() => ({
          enabled: true,
          proactive: { enabled: true, binding: 'lover-main' },
        })),
        getDataDir: vi.fn(() => tmpDir),
        getExtensionRootDir: vi.fn(() => undefined),
      } as any;
      const deliveryService = {
        getBinding: vi.fn(() => ({
          id: 'lover-main',
          label: 'Lover Main',
          platform: 'telegram',
          target: { kind: 'chat', id: '123' },
          enabled: true,
        })),
        listProviders: vi.fn(() => ([
          { platform: 'telegram', capabilities: { text: true } },
        ])),
        getPolicy: vi.fn(() => ({ id: 'lover-default', enabled: true })),
        evaluatePolicy: vi.fn(() => ({ allowed: true, skipped: false })),
        listRecentTargets: vi.fn(() => [{ platform: 'telegram', target: { kind: 'chat', id: '789' }, label: '最近私聊', lastActivityAt: Date.now() }]),
      };
      const consoleSettingsTabService = {
        register: vi.fn((tab: any) => { registered = tab; return { dispose() {} }; }),
      };
      const api = {
        router: {
          chat: vi.fn(async () => ({ content: { role: 'model', parts: [{ text: '预览消息' }] } })),
        },
        services: {
          waitFor: vi.fn(async (id: string) => id === 'console:settings-tab' ? consoleSettingsTabService : undefined),
          has: vi.fn((id: string) => id === 'memory.spaces' || id === 'delivery.registry'),
          get: vi.fn((id: string) => id === 'delivery.registry' ? deliveryService : undefined),
        },
        configManager: {
          updateEditableConfig,
          applyRuntimeConfigReload,
          readEditableConfig: vi.fn(() => ({
            delivery: {
              bindings: {
                'lover-main': {
                  label: 'Lover Main',
                  platform: 'telegram',
                  target: { kind: 'chat', id: '123' },
                  enabled: true,
                },
              },
            },
          })),
        },
      } as any;

      await new Promise<void>((resolve) => { registerVirtualLoverSettingsTab(ctx, api); setTimeout(resolve, 0); });

      expect(api.services.waitFor).toHaveBeenCalledWith('console:settings-tab', 5000);
      expect(consoleSettingsTabService.register).toHaveBeenCalledOnce();
      expect(registered.id).toBe('virtual-lover');
      const loaded = await registered.onLoad();
      expect(loaded.enabled).toBe(true);
      expect(loaded['proactive.binding']).toBe('lover-main');
      expect(loaded['delivery.binding.target.id']).toBe('123');
      expect(String(loaded['fragment.persona'])).toContain('# 伴侣人设');
      expect(loaded['status.memory']).toContain('可用');
      expect(loaded['status.delivery']).toContain('可用');
      expect(loaded['status.binding']).toContain('telegram · chat:123');
      expect(loaded['status.telegram']).toContain('已就绪');
      expect(loaded['status.recentTelegramTarget']).toContain('789');

      const bindingAction = await registered.onAction('action.testBinding', loaded);
      expect(bindingAction).toMatchObject({ success: true });

      const useLatestTargetAction = await registered.onAction('action.useLatestTelegramTarget', loaded);
      expect(useLatestTargetAction).toMatchObject({ success: true });
      expect(useLatestTargetAction.patch).toMatchObject({
        'delivery.binding.target.id': '789',
        'proactive.binding': 'lover-main',
      });

      const previewAction = await registered.onAction('action.proactiveDryRun', {
        ...loaded,
        enabled: true,
        'proactive.enabled': true,
      });
      expect(previewAction).toMatchObject({ success: true, message: '预览：预览消息' });

      const result = await registered.onSave({
        ...loaded,
        enabled: false,
        'proactive.enabled': true,
        'proactive.binding': 'lover-main',
        'proactive.generation.instruction': '第一行\\n第二行',
        'delivery.binding.target.id': '456',
        'delivery.binding.platform': 'telegram',
        'fragment.persona': '# 新人设\\n温柔但不油腻',
        'fragment.style': '# 新风格\\n简洁自然',
        'fragment.rules': '# 新边界\\n尊重现实边界',
      });

      expect(result).toEqual({ success: true });
      expect(updateEditableConfig).toHaveBeenCalledWith(expect.objectContaining({
        virtual_lover: expect.objectContaining({
          enabled: false,
          proactive: expect.objectContaining({
            enabled: true,
            binding: 'lover-main',
            generation: expect.objectContaining({ instruction: '第一行\n第二行' }),
          }),
        }),
        delivery: expect.objectContaining({
          bindings: expect.objectContaining({
            'lover-main': expect.objectContaining({
              platform: 'telegram',
              target: expect.objectContaining({ id: '456' }),
            }),
          }),
        }),
      }));
      expect(fs.readFileSync(path.join(tmpDir, 'agents', 'default', 'prompt', 'persona.md'), 'utf-8')).toContain('新人设');
      expect(fs.readFileSync(path.join(tmpDir, 'agents', 'default', 'prompt', 'style.md'), 'utf-8')).toContain('新风格');
      expect(fs.readFileSync(path.join(tmpDir, 'agents', 'default', 'prompt', 'rules.md'), 'utf-8')).toContain('新边界');
      expect(applyRuntimeConfigReload).toHaveBeenCalledOnce();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
