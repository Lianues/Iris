import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('console slash panel layout regressions', () => {
  it('斜杠候选面板应作为浮层渲染并按视图高度限高，避免撑高底部面板', () => {
    const source = readFileSync(
      path.resolve(__dirname, '../extensions/console/src/components/InputBar.tsx'),
      'utf8',
    );

    expect(source).toContain('SLASH_PANEL_MAX_HEIGHT_RATIO');
    expect(source).toContain('Math.floor(termHeight * SLASH_PANEL_MAX_HEIGHT_RATIO)');
    expect(source).toContain('buildSuggestionWindow');
    expect(source).toContain('position="relative"');
    expect(source).toContain('position="absolute"');
    expect(source).toContain('bottom={slashPanelBottom}');
    expect(source).toContain('zIndex={100}');
    expect(source).toContain('width="100%"');
    expect(source).toContain('SLASH_PANEL_BORDER_ROWS');
    expect(source).toContain('height={visibleCommandRows.length + SLASH_PANEL_BORDER_ROWS}');
    expect(source).toContain('height={visibleArgRows.length + SLASH_PANEL_BORDER_ROWS}');
    expect(source).toContain('height={visibleFileRows.length + SLASH_PANEL_BORDER_ROWS}');
    expect(source).toContain('避免候选过多时撑高 BottomPanel');
  });

  it('候选行应固定为单行并填充背景，避免透明透出底层聊天内容', () => {
    const source = readFileSync(
      path.resolve(__dirname, '../extensions/console/src/components/InputBar.tsx'),
      'utf8',
    );

    expect(source.match(/height=\{1\}/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(source.match(/overflow="hidden"/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(source.match(/backgroundColor=\{isSelected \? C\.border : C\.panelBg\}/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(source.match(/shouldFill/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(source).toContain('height={inputVisibleRows}');
  });

  it('斜杠浮层应带单线边框，视觉上与原输入区域保持一致', () => {
    const source = readFileSync(
      path.resolve(__dirname, '../extensions/console/src/components/InputBar.tsx'),
      'utf8',
    );

    expect(source.match(/border\s*\n\s*borderStyle="single"\s*\n\s*borderColor=\{C\.border\}/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(source).toContain('const SLASH_PANEL_BORDER_ROWS = 2');
  });

  it('底部面板应显式高于聊天区，避免后插入的 ChatMessageList 盖住斜杠浮层', () => {
    const source = readFileSync(
      path.resolve(__dirname, '../extensions/console/src/components/BottomPanel.tsx'),
      'utf8',
    );

    expect(source).toContain('zIndex={10}');
    expect(source).toContain('显式提升层级');
    expect(source).toContain('确保输入栏浮层盖住聊天区');
  });
});
