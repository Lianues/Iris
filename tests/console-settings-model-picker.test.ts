import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildSettingsShortcutHelp,
  fitModelPickerSingleLine,
  getModelPickerVisibleRowCount,
  getModelPickerWindow,
  getSettingsBottomBarContentRowCount,
  normalizeModelCatalogEntries,
} from '../extensions/console/src/settings-model-picker';
import { getTextWidth } from '../extensions/console/src/text-layout';
import { ICONS } from '../extensions/console/src/terminal-compat';

function createCatalogModels(count = 20) {
  return Array.from({ length: count }, (_, index) => {
    const id = `provider/model-${String(index + 1).padStart(2, '0')}-with-a-rather-long-identifier`;
    return { id, label: `${id} · Model ${index + 1} display name` };
  });
}

describe('Settings 模型目录选择器', () => {
  it('保留完整 label，且仅在缺少 label 时组合 displayName', () => {
    expect(normalizeModelCatalogEntries([
      { id: 'gpt-4', label: 'gpt-4 · openai' },
      { id: 'claude', displayName: 'Claude Sonnet' },
      { id: 'plain' },
      { id: 'gpt-4', label: '重复项' },
      { id: '   ' },
    ])).toEqual([
      { id: 'gpt-4', label: `gpt-4 ${ICONS.separator} openai` },
      { id: 'claude', label: `claude ${ICONS.separator} Claude Sonnet` },
      { id: 'plain', label: 'plain' },
    ]);
  });

  it('根据终端高度计算窗口，并始终让高亮项留在可视范围', () => {
    const entries = normalizeModelCatalogEntries(createCatalogModels());
    expect(getModelPickerVisibleRowCount(24)).toBe(5);
    expect(getModelPickerVisibleRowCount(30)).toBe(8);
    expect(getModelPickerVisibleRowCount(40)).toBe(8);

    const window = getModelPickerWindow(entries, 12, 5);
    expect(window.entries).toHaveLength(5);
    expect(window.startIndex).toBeLessThanOrEqual(12);
    expect(window.startIndex + window.entries.length).toBeGreaterThan(12);
  });

  it('长标签和快捷键提示不会超过给定显示宽度', () => {
    const fitted = fitModelPickerSingleLine(
      'provider/model-with-an-extremely-long-id · A very long display name',
      32,
    );
    expect(getTextWidth(fitted)).toBeLessThanOrEqual(32);
    expect(fitted).not.toContain('\n');

    const help = buildSettingsShortcutHelp([
      'F 拉取模型',
      'Enter 手动编辑',
      `${ICONS.arrowUp}${ICONS.arrowDown} 选择`,
      'S 保存',
      'Esc 返回',
      'R 重载',
    ], 50);
    expect(help).toContain('F 拉取模型');
    expect(getTextWidth(help)).toBeLessThanOrEqual(50);

    const narrowHelp = buildSettingsShortcutHelp([
      `${ICONS.arrowUp}${ICONS.arrowDown} 选择`,
      `${ICONS.arrowLeft}${ICONS.arrowRight} 切换`,
      'Enter 编辑/执行',
      'S 保存',
      'Esc 返回',
      'Space 开关',
    ], 56);
    expect(narrowHelp).toContain('Esc 返回');
  });

  it('底栏在普通和编辑状态使用稳定、可预测的高度', () => {
    expect(getSettingsBottomBarContentRowCount(false, false)).toBe(3);
    expect(getSettingsBottomBarContentRowCount(true, false)).toBe(3);
    expect(getSettingsBottomBarContentRowCount(true, true)).toBe(4);
  });

  it('使用可取消的加载状态、固定浮层和上下文 F 快捷键', () => {
    const source = readFileSync(
      path.resolve(__dirname, '../extensions/console/src/components/SettingsView.tsx'),
      'utf8',
    );

    expect(source).toContain("phase: 'loading'");
    expect(source).toContain("phase: 'ready'");
    expect(source).toContain('modelFetchRequestIdRef.current !== requestId');
    expect(source).toMatch(/cancelModelPicker[\s\S]*?modelFetchRequestIdRef\.current \+= 1/);
    expect(source).toContain('position="absolute"');
    expect(source).toContain('height={pickerPanelHeight}');
    expect(source).not.toContain('<scrollbox maxHeight={8}');
    expect(source).toMatch(/selectedFetchTarget[\s\S]*?'F 拉取模型'/);
    expect(source).toContain('height={bottomBarPanelHeight}');
    expect(source).toMatch(/flexDirection="row"[\s\S]*?<input[\s\S]*?flexGrow=\{1\}/);
    expect(source).not.toMatch(/statusText && \([\s\S]*?<text[\s\S]*?编辑：/);
    expect(source).toContain('{pickerHeaderText}');
    expect(source).toContain('{pickerPromptText}');
    expect(source).toContain('{pickerFooterText}');
  });
});
